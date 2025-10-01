import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { DOMElementNode, SelectorMap } from "../types/dom";
import { BrowserState } from "./browserContext";

export interface LLMSelectorConfig {
  includeAttributes: string[];
  useVision: boolean;
  maxRetries: number;
}

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
      ...config,
    };
  }

  async selectElement(
    prompt: string,
    browserState: BrowserState
  ): Promise<ElementSelectionResult> {
    const systemPrompt = this.createSystemPrompt();
    const userMessage = this.createUserMessage(prompt, browserState);

    const messages = [systemPrompt, userMessage];

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.llm.invoke(messages);
        const result = this.parseLLMResponse(
          response.content as string,
          browserState.selectorMap
        );

        if (result.selectedElement) {
          return result;
        }
      } catch (error) {
        console.warn(`LLM selection attempt ${attempt + 1} failed:`, error);
        if (attempt === this.config.maxRetries - 1) {
          throw new Error(
            `Failed to select element after ${this.config.maxRetries} attempts: ${error}`
          );
        }
      }
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
}
