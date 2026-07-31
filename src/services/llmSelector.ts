import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { DOMElementNode, SelectorMap, ElementMap } from "../types/dom";
import { BrowserState } from "./browserContext";
import { RateLimitError } from "./errors";

export interface RetryConfig {
  /** Attempts per call, including the first. */
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

/**
 * How much detail the model is asked to read from the screenshot.
 *
 * "low" is a flat ~85 tokens; "high"/"auto" tile a full-page screenshot into
 * thousands. Since the actual decision is made against the indexed element
 * listing and the screenshot only supplies layout context — with bounding boxes
 * that stay legible when downsampled — "low" is usually the right trade. It is
 * the single biggest lever on tokens-per-minute when many selections run
 * concurrently.
 */
export type ScreenshotDetail = "low" | "high" | "auto";

export interface LLMSelectorConfig {
  includeAttributes: string[];
  useVision: boolean;
  maxRetries: number;
  retry: RetryConfig;
  screenshotDetail: ScreenshotDetail;
}

/**
 * Restricts which elements from the "all elements" pool a caller wants
 * considered at all:
 * - "any" (default): every element is shown to the model, each tagged with
 *   its visibility so the model can reason about it.
 * - "visible-only": elements hidden by CSS (display:none, a responsive
 *   Tailwind class like `md:hidden` at the current viewport, etc.) are
 *   removed from the candidate pool before the model ever sees them. Use
 *   this when the caller's assertion can only ever be true of a visible
 *   element (e.g. "is visible", "is in the viewport").
 * - "hidden-only": the inverse — only elements NOT currently visible are
 *   considered. Use this when the caller's assertion expects the target to
 *   be hidden/collapsed/not shown.
 */
export type ElementVisibilityFilter = "any" | "visible-only" | "hidden-only";

export interface ElementSelectionResult {
  selectedElement: DOMElementNode | null;
  selectedIndex: number | null;
  confidence: number;
  reasoning: string;
}

export class LLMSelector {
  private llm: BaseChatModel | any; // Allow any LLM implementation that extends BaseChatModel
  private config: LLMSelectorConfig;

  constructor(
    llm: BaseChatModel | any,
    config: Partial<LLMSelectorConfig> = {}
  ) {
    this.llm = llm;
    this.config = {
      includeAttributes: [
        "title",
        "type",
        "name",
        "role",
        "aria-label",
        "placeholder",
        "value",
        "alt",
        "aria-expanded",
        "data-testid",
      ],
      useVision: true,
      maxRetries: 3,
      retry: {
        maxRetries: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
      },
      // "auto" preserves the previous behaviour for existing consumers.
      screenshotDetail: "auto",
      ...config,
    };

    // maxRetries was the only retry knob before retry {} existed. Honour it
    // when a caller sets it alone, so upgrading doesn't silently change how
    // many attempts they get.
    if (config.maxRetries !== undefined && config.retry === undefined) {
      this.config.retry = {
        ...this.config.retry,
        maxRetries: config.maxRetries,
      };
    }
  }

  /**
   * Invokes the model, retrying with backoff on transient failures.
   *
   * This replaces two identical copies of a loop that retried immediately, with
   * no sleep and no error discrimination — so a 429 was hammered again the
   * instant the provider asked us to slow down, and a malformed request was
   * retried three times for nothing.
   */
  private async invokeWithRetry(messages: any[]): Promise<any> {
    const { maxRetries, initialDelayMs, maxDelayMs } = this.config.retry;

    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.llm.invoke(messages);
      } catch (error) {
        lastError = error;

        const status = this.statusOf(error);

        // A bad request, bad key or missing model will fail identically every
        // time. Retrying is pure latency and cost.
        if (status !== undefined && status !== 429 && status < 500) {
          throw error;
        }

        if (attempt === maxRetries - 1) {
          break;
        }

        // Honour the provider's own instruction when it gives one; it knows
        // when the window resets and we do not.
        const retryAfterMs = this.retryAfterMsOf(error);
        const backoffMs = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
        const delayMs =
          retryAfterMs ?? Math.floor(Math.random() * backoffMs);

        console.warn(
          `LLM invoke attempt ${attempt + 1}/${maxRetries} failed` +
            (status ? ` (status ${status})` : "") +
            `, retrying in ${Math.round(delayMs)}ms`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (this.statusOf(lastError) === 429) {
      throw new RateLimitError(
        `Rate limited after ${maxRetries} attempts: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
        this.retryAfterMsOf(lastError)
      );
    }

    throw lastError;
  }

  private statusOf(error: unknown): number | undefined {
    const status = (error as any)?.status ?? (error as any)?.response?.status;

    return typeof status === "number" ? status : undefined;
  }

  /**
   * Reads the provider's retry hint. `retry-after-ms` is preferred over
   * `retry-after` because OpenAI reports sub-second waits there — rounding
   * "234ms" up to a whole second would idle a worker for no reason.
   */
  private retryAfterMsOf(error: unknown): number | undefined {
    const headers = (error as any)?.headers;

    if (!headers) {
      return undefined;
    }

    const read = (name: string): string | undefined =>
      typeof headers.get === "function" ? headers.get(name) : headers[name];

    const ms = Number(read("retry-after-ms"));
    if (Number.isFinite(ms) && ms >= 0) {
      return ms;
    }

    const seconds = Number(read("retry-after"));
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    return undefined;
  }

  async selectElement(
    prompt: string,
    browserState: BrowserState
  ): Promise<ElementSelectionResult> {
    const systemPrompt = this.createSystemPrompt();
    const userMessage = this.createUserMessage(prompt, browserState);

    const messages = [systemPrompt, userMessage];

    // A RateLimitError from here propagates deliberately: the caller must be
    // able to tell throttling from "no element matched" (see errors.ts).
    const response = await this.invokeWithRetry(messages);
    const result = this.parseLLMResponse(
      response.content as string,
      browserState.selectorMap
    );

    if (result.selectedElement) {
      return result;
    }

    return {
      selectedElement: null,
      selectedIndex: null,
      confidence: 0,
      reasoning: "Failed to select element after all attempts",
    };
  }

  /**
   * Select an element from ALL elements (interactive + non-interactive)
   * Uses elementMap instead of selectorMap
   */
  async selectElementFromAllElements(
    prompt: string,
    browserState: BrowserState,
    visibilityFilter: ElementVisibilityFilter = "any"
  ): Promise<ElementSelectionResult> {
    // Computed once and used for BOTH the prompt text and the response
    // lookup below, so a selectedIndex can only ever resolve to something
    // the model actually saw. Looking it up against the full, unfiltered
    // elementMap instead would let a hallucinated (or misremembered) index
    // silently resolve to a real but filtered-out element — e.g. a
    // "visible-only" search returning something the model was never shown,
    // because it happens to share that index in the full map.
    const candidateElements = this.filterElementsByVisibility(
      browserState.elementMap,
      visibilityFilter
    );

    const systemPrompt = this.createSystemPromptForAllElements();
    const userMessage = this.createUserMessageForAllElements(
      prompt,
      browserState,
      candidateElements
    );

    const messages = [systemPrompt, userMessage];

    // A RateLimitError from here propagates deliberately: the caller must be
    // able to tell throttling from "no element matched" (see errors.ts).
    const response = await this.invokeWithRetry(messages);
    const result = this.parseLLMResponseForAllElements(
      response.content as string,
      candidateElements
    );

    if (result.selectedElement) {
      return result;
    }

    return {
      selectedElement: null,
      selectedIndex: null,
      confidence: 0,
      reasoning: "Failed to select element after all attempts",
    };
  }

  private createSystemPrompt(): SystemMessage {
    // Based on the original system_prompt.md from browser-use-typescript
    const prompt = `You are an AI assistant that helps select DOM elements from web pages based on user descriptions.

# Input Format
Interactive Elements are provided in this format:
[index]<type>text</type>
- index: Numeric identifier for interaction
- type: HTML element type (button, input, etc.)
- text: Element description
Example:
[33]<button>Submit Form</button>

- Only elements with numeric indexes in [] are interactive
- elements without [] provide only context

# Response Rules
1. RESPONSE FORMAT: You must ALWAYS respond with valid JSON in this exact format:
{
  "selectedIndex": number | null,
  "confidence": number (0-1),
  "reasoning": "Brief explanation of your selection"
}

2. ELEMENT SELECTION:
- Only select elements that are visible and interactive
- Consider the element's text content, attributes, and context
- If multiple elements could match, choose the most specific one
- If no element matches the description, return null
- Consider the element's position and hierarchy in the DOM

3. VISUAL CONTEXT:
- When an image is provided, use it to understand the page layout
- Bounding boxes with labels on their top right corner correspond to element indexes

Your responses must be always JSON with the specified format.`;

    return new SystemMessage(prompt);
  }

  private createUserMessage(
    prompt: string,
    browserState: BrowserState
  ): HumanMessage {
    const elementsText = this.formatElementsForLLM(
      browserState.elementTree,
      browserState.selectorMap
    );

    const hasContentAbove = browserState.pixels_above > 0;
    const hasContentBelow = browserState.pixels_below > 0;

    let formattedElementsText = "";
    if (elementsText !== "") {
      if (hasContentAbove) {
        formattedElementsText = `... ${browserState.pixels_above} pixels above - scroll to see more ...\n${elementsText}`;
      } else {
        formattedElementsText = `[Start of page]\n${elementsText}`;
      }

      if (hasContentBelow) {
        formattedElementsText = `${formattedElementsText}\n... ${browserState.pixels_below} pixels below - scroll to see more ...`;
      } else {
        formattedElementsText = `${formattedElementsText}\n[End of page]`;
      }
    } else {
      formattedElementsText = "No interactive elements found";
    }

    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current url: ${browserState.url}
Page title: ${browserState.title}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}

User Prompt: ${prompt}
`;

    if (this.config.useVision && browserState.screenshot) {
      return new HumanMessage({
        content: [
          { type: "text", text: stateDescription },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${browserState.screenshot}`,
              detail: this.config.screenshotDetail,
            },
          },
        ],
      });
    }

    return new HumanMessage(stateDescription);
  }

  private formatElementsForLLM(
    elementTree: DOMElementNode,
    selectorMap: SelectorMap
  ): string {
    const formattedText: string[] = [];

    // Process all interactive elements from selectorMap
    const sortedElements = Object.values(selectorMap).sort(
      (a, b) => (a.highlightIndex || 0) - (b.highlightIndex || 0)
    );

    for (const node of sortedElements) {
      if (node.highlightIndex !== null) {
        let attributesStr = "";
        const text = node.getAllTextTillNextClickableElement();

        if (this.config.includeAttributes) {
          const attributes = Array.from(
            new Set(
              Object.entries(node.attributes)
                .filter(
                  ([key, value]) =>
                    this.config.includeAttributes.includes(key) &&
                    value !== node.tagName
                )
                .map(([, value]) => value)
            )
          );
          if (attributes.includes(text))
            attributes.splice(attributes.indexOf(text), 1);
          attributesStr = attributes.join(";");
        }

        let line = `[${node.highlightIndex}]<${node.tagName}`;
        if (attributesStr) line += ` ${attributesStr}`;
        if (text) line += `>${text}</${node.tagName}>`;
        else line += "/>";

        formattedText.push(line);
      }
    }

    return formattedText.join("\n");
  }

  private parseLLMResponse(
    response: string,
    selectorMap: SelectorMap
  ): ElementSelectionResult {
    try {
      // Clean the response to extract JSON
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.includes("```")) {
        const codeBlockMatch = jsonStr.match(
          /```(?:json)?\s*(\{[\s\S]*?\})\s*```/
        );
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1];
        }
      }

      const parsed = JSON.parse(jsonStr);
      const selectedIndex = parsed.selectedIndex;
      const confidence = parsed.confidence || 0;
      const reasoning = parsed.reasoning || "";

      if (selectedIndex === null || selectedIndex === undefined) {
        return {
          selectedElement: null,
          selectedIndex: null,
          confidence: 0,
          reasoning: reasoning || "No element selected",
        };
      }

      const selectedElement = selectorMap[selectedIndex];
      if (!selectedElement) {
        return {
          selectedElement: null,
          selectedIndex: null,
          confidence: 0,
          reasoning: `Element with index ${selectedIndex} not found in selector map`,
        };
      }

      return {
        selectedElement,
        selectedIndex,
        confidence: Math.max(0, Math.min(1, confidence)),
        reasoning,
      };
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      return {
        selectedElement: null,
        selectedIndex: null,
        confidence: 0,
        reasoning: `Failed to parse LLM response: ${error}`,
      };
    }
  }

  // ===== Methods for selecting from ALL elements (interactive + non-interactive) =====

  /**
   * Create system prompt for selecting from ALL elements
   */
  private createSystemPromptForAllElements(): SystemMessage {
    const prompt = `You are an AI assistant that helps select DOM elements from web pages based on user descriptions.

# Input Format
ALL Elements (interactive and non-interactive) are provided in this format:
[index]<type>text</type>
- index: Numeric identifier for the element
- type: HTML element type (div, p, button, input, h1, img, etc.)
- text: Element description or text content
- An element tagged "hidden" (e.g. [index]<type hidden>text</type>) is NOT
  currently visible on the page — collapsed by responsive CSS at this
  viewport width, inside a menu/modal that isn't open, or otherwise not
  rendered. Its text may come only from an attribute like aria-label/title,
  not from anything a user can actually see or a screenshot would show.
Example:
[15]<h1>Welcome to Our Site</h1>
[33]<button>Submit Form</button>
[42]<p>This is a paragraph of text</p>
[57]<button hidden>Open menu</button>

# Response Rules
1. RESPONSE FORMAT: You must ALWAYS respond with valid JSON in this exact format:
{
  "selectedIndex": number | null,
  "confidence": number (0-1),
  "reasoning": "Brief explanation of your selection"
}

2. ELEMENT SELECTION:
- You can select ANY element (interactive or non-interactive)
- This includes headings, paragraphs, divs, images, buttons, inputs, etc.
- Consider the element's text content, attributes, and context
- Do not select an element tagged "hidden" unless the description itself
  expects the target to be hidden, closed, or not shown. Otherwise treat a
  "hidden" element as if it doesn't match at all, even when its text or
  attributes look like a strong textual match — a hidden element cannot be
  what a description of something on the page actually refers to.
- If multiple elements could match, choose the most specific one
- If no element matches the description, return null
- Consider the element's position and hierarchy in the DOM

3. VISUAL CONTEXT:
- When an image is provided, use it to understand the page layout — a
  "hidden" element will not appear anywhere in the screenshot
- Bounding boxes with labels on their top right corner correspond to element indexes

Your responses must be always JSON with the specified format.`;

    return new SystemMessage(prompt);
  }

  /**
   * Create user message for selecting from ALL elements
   */
  private createUserMessageForAllElements(
    prompt: string,
    browserState: BrowserState,
    candidateElements: ElementMap
  ): HumanMessage {
    const elementsText = this.formatAllElementsForLLM(candidateElements);

    const hasContentAbove = browserState.pixels_above > 0;
    const hasContentBelow = browserState.pixels_below > 0;

    let formattedElementsText = "";
    if (elementsText !== "") {
      if (hasContentAbove) {
        formattedElementsText = `... ${browserState.pixels_above} pixels above - scroll to see more ...\n${elementsText}`;
      } else {
        formattedElementsText = `[Start of page]\n${elementsText}`;
      }

      if (hasContentBelow) {
        formattedElementsText = `${formattedElementsText}\n... ${browserState.pixels_below} pixels below - scroll to see more ...`;
      } else {
        formattedElementsText = `${formattedElementsText}\n[End of page]`;
      }
    } else {
      formattedElementsText = "No elements found";
    }

    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current url: ${browserState.url}
Page title: ${browserState.title}
ALL elements from top layer of the current page inside the viewport:
${formattedElementsText}

User Prompt: ${prompt}
`;

    if (this.config.useVision && browserState.screenshot) {
      return new HumanMessage({
        content: [
          { type: "text", text: stateDescription },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${browserState.screenshot}`,
              detail: this.config.screenshotDetail,
            },
          },
        ],
      });
    }

    return new HumanMessage(stateDescription);
  }

  /**
   * Restricts an elementMap to the pool a given visibility filter allows,
   * used for BOTH what's shown to the model and what a returned index is
   * allowed to resolve to — see the call site in {@link selectElementFromAllElements}.
   */
  private filterElementsByVisibility(
    elementMap: ElementMap,
    visibilityFilter: ElementVisibilityFilter
  ): ElementMap {
    if (visibilityFilter === "any") return elementMap;

    const filtered: ElementMap = {};
    for (const [key, node] of Object.entries(elementMap)) {
      const keep =
        visibilityFilter === "visible-only" ? node.isVisible : !node.isVisible;
      if (keep) filtered[Number(key)] = node;
    }
    return filtered;
  }

  /**
   * Format ALL elements (interactive + non-interactive) for LLM.
   *
   * Every element is tagged with its actual visibility (`isVisible`, computed
   * from real `getComputedStyle`/bounding-rect checks during DOM extraction —
   * see `buildDomTreeOverlay`). Without this, a button hidden by a responsive
   * class like `md:hidden` is indistinguishable in this listing from a
   * genuinely visible one: its only "text" often comes from an aria-label/
   * title fallback (`DOMElementNode.getDirectTextContent`), so it can read as
   * a strong match for a description that names visible page content.
   *
   * `elementMap` is expected to already be filtered to the intended candidate
   * pool (see {@link filterElementsByVisibility}) — this only formats it.
   */
  private formatAllElementsForLLM(elementMap: ElementMap): string {
    const formattedText: string[] = [];

    const sortedElements = Object.values(elementMap).sort(
      (a, b) => (a.elementIndex || 0) - (b.elementIndex || 0)
    );

    for (const node of sortedElements) {
      if (node.elementIndex !== null) {
        let attributesStr = "";
        const text = node.getAllTextTillNextClickableElement();

        if (this.config.includeAttributes) {
          const attributes = Array.from(
            new Set(
              Object.entries(node.attributes)
                .filter(
                  ([key, value]) =>
                    this.config.includeAttributes.includes(key) &&
                    value !== node.tagName
                )
                .map(([, value]) => value)
            )
          );
          if (attributes.includes(text))
            attributes.splice(attributes.indexOf(text), 1);
          attributesStr = attributes.join(";");
        }

        const visibilityTag = node.isVisible ? "" : " hidden";

        let line = `[${node.elementIndex}]<${node.tagName}${visibilityTag}`;
        if (attributesStr) line += ` ${attributesStr}`;
        if (text) line += `>${text}</${node.tagName}>`;
        else line += "/>";

        formattedText.push(line);
      }
    }

    return formattedText.join("\n");
  }

  /**
   * Parse LLM response for ALL elements selection
   */
  private parseLLMResponseForAllElements(
    response: string,
    elementMap: ElementMap
  ): ElementSelectionResult {
    try {
      // Clean the response to extract JSON
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.includes("```")) {
        const codeBlockMatch = jsonStr.match(
          /```(?:json)?\s*(\{[\s\S]*?\})\s*```/
        );
        if (codeBlockMatch) {
          jsonStr = codeBlockMatch[1];
        }
      }

      const parsed = JSON.parse(jsonStr);
      const selectedIndex = parsed.selectedIndex;
      const confidence = parsed.confidence || 0;
      const reasoning = parsed.reasoning || "";

      if (selectedIndex === null || selectedIndex === undefined) {
        return {
          selectedElement: null,
          selectedIndex: null,
          confidence: 0,
          reasoning: reasoning || "No element selected",
        };
      }

      const selectedElement = elementMap[selectedIndex];
      if (!selectedElement) {
        return {
          selectedElement: null,
          selectedIndex: null,
          confidence: 0,
          reasoning: `Element with index ${selectedIndex} not found in element map`,
        };
      }

      return {
        selectedElement,
        selectedIndex,
        confidence: Math.max(0, Math.min(1, confidence)),
        reasoning,
      };
    } catch (error) {
      console.error("Failed to parse LLM response:", error);
      return {
        selectedElement: null,
        selectedIndex: null,
        confidence: 0,
        reasoning: `Failed to parse LLM response: ${error}`,
      };
    }
  }
}
