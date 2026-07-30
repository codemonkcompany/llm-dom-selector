// Main exports for the LLM DOM Selector package
export {
  LLMSelector,
  type ElementSelectionResult,
  type LLMSelectorConfig,
  type ElementVisibilityFilter,
} from "./services/llmSelector";
export {
  BrowserContext,
  type BrowserState,
  type BrowserContextConfig,
  type ScrollCollectConfig,
} from "./services/browserContext";
export { DomService } from "./services/domService";
export {
  DOMElementNode,
  DOMTextNode,
  DOMState,
  SelectorMap,
  ElementMap,
  type DOMBaseNode,
  type ViewportInfo,
  type CoordinateSet,
  type HashedDomElement,
} from "./types/dom";

// Main class that combines all functionality
import {
  BrowserContext,
  BrowserState,
  ScrollCollectConfig,
} from "./services/browserContext";
import {
  LLMSelector,
  ElementSelectionResult,
  ElementVisibilityFilter,
} from "./services/llmSelector";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Page } from "playwright";
import { DOMElementNode, ElementMap } from "./types/dom";

export interface LLMDOMSelectorConfig {
  browserContext?: Partial<{
    highlightElements: boolean;
    viewportExpansion: number;
    includeDynamicAttributes: boolean;
    headless: boolean;
  }>;
  llmSelector?: Partial<{
    includeAttributes: string[];
    useVision: boolean;
    maxRetries: number;
  }>;
}

export class LLMDOMSelector {
  private browserContext: BrowserContext;
  private llmSelector: LLMSelector;

  constructor(
    page: Page,
    llm: BaseChatModel | any, // Allow any LLM implementation that extends BaseChatModel
    config: LLMDOMSelectorConfig = {}
  ) {
    this.browserContext = new BrowserContext(page, config.browserContext || {});
    this.llmSelector = new LLMSelector(llm, config.llmSelector);
  }

  /**
   * Get the current browser state with all interactive elements
   */
  async getBrowserState(): Promise<BrowserState> {
    return await this.browserContext.getState();
  }

  /**
   * Select an element using LLM, scrolling through the page and merging
   * newly-revealed elements first. Use as a fallback after {@link selectElement}
   * finds nothing — the target may simply be further down the page than a
   * single viewport snapshot can see. See {@link BrowserContext.getStateAcrossScroll}.
   */
  async selectElementAcrossScroll(
    prompt: string,
    scrollConfig?: Partial<ScrollCollectConfig>
  ): Promise<ElementSelectionResult> {
    const browserState = await this.browserContext.getStateAcrossScroll(
      scrollConfig
    );
    return await this.llmSelector.selectElement(prompt, browserState);
  }

  /**
   * Select an element using LLM based on a text description
   */
  async selectElement(prompt: string): Promise<ElementSelectionResult> {
    const browserState = await this.browserContext.getState();
    return await this.llmSelector.selectElement(prompt, browserState);
  }

  /**
   * Select an element using LLM based on a text description.
   *
   * @param visibilityFilter Restrict the candidate pool before the model
   * sees it: "visible-only" for an assertion whose target must be visible
   * (e.g. "is visible", "is in the viewport"), "hidden-only" for one whose
   * target must be hidden/collapsed/not shown, or "any" (default) to show
   * every element, each tagged with its actual visibility.
   */
  async selectElementFromAllElements(
    prompt: string,
    visibilityFilter: ElementVisibilityFilter = "any"
  ): Promise<ElementSelectionResult> {
    const browserState = await this.browserContext.getState();
    return await this.llmSelector.selectElementFromAllElements(
      prompt,
      browserState,
      visibilityFilter
    );
  }

  /**
   * Select an element from ALL elements, scrolling through the page and
   * merging newly-revealed elements first. Use as a fallback after
   * {@link selectElementFromAllElements} finds nothing.
   */
  async selectElementFromAllElementsAcrossScroll(
    prompt: string,
    visibilityFilter: ElementVisibilityFilter = "any",
    scrollConfig?: Partial<ScrollCollectConfig>
  ): Promise<ElementSelectionResult> {
    const browserState = await this.browserContext.getStateAcrossScroll(
      scrollConfig
    );
    return await this.llmSelector.selectElementFromAllElements(
      prompt,
      browserState,
      visibilityFilter
    );
  }

  /**
   * Get a specific element by its index
   */
  async getElementByIndex(index: number): Promise<DOMElementNode | null> {
    return await this.browserContext.getDomElementByIndex(index);
  }

  /**
   * Get all available interactive elements
   */
  async getInteractiveElements(): Promise<DOMElementNode[]> {
    const selectorMap = await this.browserContext.getSelectorMap();
    return Object.values(selectorMap);
  }

  /**
   * Get ALL elements (both interactive and non-interactive)
   */
  async getAllElements(): Promise<DOMElementNode[]> {
    const elementMap = await this.browserContext.getElementMap();
    return Object.values(elementMap);
  }

  /**
   * Get the element map for ALL elements (interactive + non-interactive)
   */
  async getElementMap(): Promise<ElementMap> {
    return await this.browserContext.getElementMap();
  }

  /**
   * Get non-interactive elements only
   */
  async getNonInteractiveElements(): Promise<DOMElementNode[]> {
    const elementMap = await this.browserContext.getElementMap();
    return Object.values(elementMap).filter((el) => !el.isInteractive);
  }

  /**
   * Get element by elementIndex (works for all elements, not just interactive)
   */
  async getElementByElementIndex(
    index: number
  ): Promise<DOMElementNode | null> {
    return await this.browserContext.getAllElementByIndex(index);
  }

  /**
   * Click an element by its index
   */
  async clickElementByIndex(index: number): Promise<void> {
    const element = await this.browserContext.getDomElementByIndex(index);
    if (!element) {
      throw new Error(`Element with index ${index} not found`);
    }
    await this.browserContext._click_element_node(element);
  }

  /**
   * Input text to an element by its index
   */
  async inputTextToElementByIndex(index: number, text: string): Promise<void> {
    const element = await this.browserContext.getDomElementByIndex(index);
    if (!element) {
      throw new Error(`Element with index ${index} not found`);
    }
    await this.browserContext._input_text_element_node(element, text);
  }

  /**
   * Select and click an element using LLM
   */
  async selectAndClick(prompt: string): Promise<ElementSelectionResult> {
    const result = await this.selectElement(prompt);
    if (result.selectedElement) {
      await this.browserContext._click_element_node(result.selectedElement);
    }
    return result;
  }

  /**
   * Select and input text to an element using LLM
   */
  async selectAndInputText(
    prompt: string,
    text: string
  ): Promise<ElementSelectionResult> {
    const result = await this.selectElement(prompt);
    if (result.selectedElement) {
      await this.browserContext._input_text_element_node(
        result.selectedElement,
        text
      );
    }
    return result;
  }

  /**
   * Refresh the browser state (useful after page changes)
   */
  async refreshState(): Promise<BrowserState> {
    return await this.browserContext.updateState();
  }

  /**
   * Remove element highlights from the page
   */
  async removeHighlights(): Promise<void> {
    await this.browserContext.removeHighlights();
  }
}
