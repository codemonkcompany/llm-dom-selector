import { Page, ElementHandle, FrameLocator } from "playwright";
import { DomService } from "./domService";
import { DOMElementNode, SelectorMap, ElementMap } from "../types/dom";
import { mergeElementsByXPath, buildIndexedMaps } from "./scrollMerge";

// BrowserState interface based on the original project
export interface BrowserState {
  elementTree: DOMElementNode;
  selectorMap: SelectorMap; // Interactive elements only
  elementMap: ElementMap; // ALL elements (interactive + non-interactive)
  url: string;
  title: string;
  screenshot: string;
  pixels_above: number;
  pixels_below: number;
  tab?: string;
}

export interface BrowserContextConfig {
  highlightElements: boolean;
  viewportExpansion: number;
  includeDynamicAttributes: boolean;
  waitBetweenActions: number;
  headless: boolean;
}

export interface ScrollCollectConfig {
  /**
   * How many times to redo a full "scroll to the bottom" pass after the page
   * grew during the previous pass (new content loaded in response to
   * scrolling — infinite scroll / lazy loading). This is what keeps an
   * infinite-scroll feed from turning this into an unbounded loop: a
   * genuinely endless feed always reports growth again, so iteration stops
   * here regardless of whether it's still growing.
   */
  maxContentLoadCycles: number;
  /**
   * Defensive ceiling on scroll steps WITHIN a single bottom-reaching pass.
   * This is not the normal limiting factor — a pass ends naturally once
   * `scrollY` stops moving, i.e. the actual bottom for whatever content
   * exists right now, however many steps that takes. It only guards against
   * a page whose scroll position never settles (e.g. a layout that keeps
   * shifting) turning a single pass into a real infinite loop.
   */
  maxStepsPerCycle: number;
  /** CSS pixels to scroll per step. Defaults to the viewport height. */
  scrollStepPx?: number;
  /** Wait after each scroll for lazy-loaded content to render before re-snapshotting. */
  settleMs: number;
}

const DEFAULT_SCROLL_COLLECT_CONFIG: ScrollCollectConfig = {
  maxContentLoadCycles: 3,
  maxStepsPerCycle: 100,
  settleMs: 700,
};

export class BrowserContext {
  private page: Page;
  private config: BrowserContextConfig;
  private currentState: BrowserState | null = null;

  constructor(page: Page, config: Partial<BrowserContextConfig> = {}) {
    this.page = page;
    this.config = {
      highlightElements: true,
      viewportExpansion: 500,
      includeDynamicAttributes: true,
      waitBetweenActions: 0.5,
      headless: true, // Default to headless mode for better performance and reliability
      ...config,
    };
  }

  async getState(): Promise<BrowserState> {
    if (this.currentState) {
      return this.currentState;
    }
    return await this.updateState();
  }

  async updateState(focusElement: number = -1): Promise<BrowserState> {
    try {
      await this.removeHighlights();
      const domService = new DomService(this.page);
      const content = await domService.getClickableElements(
        this.config.highlightElements,
        focusElement,
        this.config.viewportExpansion
      );

      const screenshot = await this.takeScreenshot();
      const [pixelsAbove, pixelsBelow] = await this.getScrollInfo();

      this.currentState = {
        elementTree: content.elementTree,
        selectorMap: content.selectorMap, // Interactive only
        elementMap: content.elementMap, // ALL elements
        url: this.page.url(),
        title: await this.page.title(),
        screenshot,
        pixels_above: pixelsAbove,
        pixels_below: pixelsBelow,
      };

      return this.currentState;
    } catch (e) {
      console.error(`Failed to update state: ${e}`);
      if (this.currentState) {
        return this.currentState;
      }
      throw e;
    }
  }

  /**
   * Like {@link getState}, but scrolls through the page collecting elements
   * across multiple scroll positions and merges them into one pool, instead
   * of only seeing whatever's in the current viewport.
   *
   * Exists because `isVisible` (and therefore `highlightIndex`/inclusion in
   * `selectorMap`) is computed relative to the CURRENT scroll position — an
   * element further down a long page is invisible to a single snapshot no
   * matter how far `viewportExpansion` reaches, so an LLM element search
   * over one snapshot can never find it. This is the more expensive fallback
   * for when that single-snapshot search comes back empty; it isn't the
   * default because most pages don't need it.
   *
   * Runs in up to `maxContentLoadCycles` passes, each scrolling all the way
   * to the CURRENT real bottom of the page (however many steps that takes —
   * not bounded by a step count, since page length varies enormously). A
   * pass ending with more content on the page than when it started means
   * scrolling triggered a lazy-load / infinite-scroll batch, so another pass
   * runs to reach the new bottom too. A pass that ends with nothing new is
   * genuine end-of-content and stops immediately. The cycle cap is what
   * bounds a genuinely endless feed — such a page always "grows" again, so
   * it would otherwise never stop on its own. The page's original scroll
   * position is restored before returning, so this has no visible side
   * effect on the caller.
   */
  async getStateAcrossScroll(
    overrides: Partial<ScrollCollectConfig> = {}
  ): Promise<BrowserState> {
    const cfg = { ...DEFAULT_SCROLL_COLLECT_CONFIG, ...overrides };
    const originalScrollY = await this.page.evaluate(() => window.scrollY);

    const pool = new Map<string, DOMElementNode>();
    let baseState: BrowserState | null = null;

    const absorb = (state: BrowserState) => {
      if (!baseState) baseState = state;
      mergeElementsByXPath(pool, state.elementMap);
    };

    absorb(await this.updateState());

    for (let cycle = 0; cycle < cfg.maxContentLoadCycles; cycle++) {
      const scrollHeightBeforeCycle = await this.page.evaluate(
        () => document.body.scrollHeight
      );

      for (let step = 0; step < cfg.maxStepsPerCycle; step++) {
        const scrollYBefore = await this.page.evaluate(() => window.scrollY);

        // `behavior: "instant"` sidesteps pages that set `scroll-behavior:
        // smooth` (common) — with smooth scrolling, the scroll animates over
        // the following ~300-500ms, so reading scrollY back in the same
        // evaluate call (or even right after it) would still read the
        // pre-scroll position. Forcing instant scrolling here makes the
        // "did we move" check below reliable regardless of page CSS.
        await this.page.evaluate((stepPx) => {
          window.scrollBy({
            top: stepPx && stepPx > 0 ? stepPx : window.innerHeight,
            left: 0,
            behavior: "instant",
          });
        }, cfg.scrollStepPx);

        await this.page.waitForTimeout(cfg.settleMs);

        const scrollYAfter = await this.page.evaluate(() => window.scrollY);
        if (scrollYAfter === scrollYBefore) {
          // Couldn't scroll any further — the real bottom for whatever
          // content exists right now.
          break;
        }

        absorb(await this.updateState());
      }

      const scrollHeightAfterCycle = await this.page.evaluate(
        () => document.body.scrollHeight
      );

      if (scrollHeightAfterCycle <= scrollHeightBeforeCycle) {
        // Reaching the bottom didn't load anything new — genuine end of
        // content, not just a slow-loading batch. Further cycles would find
        // nothing new.
        break;
      }
    }

    await this.page.evaluate(
      (y) => window.scrollTo({ top: y, left: 0, behavior: "instant" }),
      originalScrollY
    );
    // The cached state now reflects the deepest scroll position visited,
    // not the restored one — invalidate so the next real getState() call
    // re-derives a snapshot that matches where the page actually is.
    this.currentState = null;

    const { selectorMap, elementMap } = buildIndexedMaps(pool);

    return {
      ...baseState!,
      selectorMap,
      elementMap,
      // Multiple scroll positions were sampled to build this pool — no
      // single screenshot represents all of them, so vision is disabled
      // here rather than showing the model a partial, misleading image.
      screenshot: "",
    };
  }

  async takeScreenshot(fullPage: boolean = false): Promise<string> {
    const screenshot = await this.page.screenshot({
      fullPage,
      type: "png",
    });
    return screenshot.toString("base64");
  }

  private async getScrollInfo(): Promise<[number, number]> {
    const scrollInfo = await this.page.evaluate(() => {
      return {
        pixelsAbove: window.scrollY,
        pixelsBelow: Math.max(
          0,
          document.body.scrollHeight - window.innerHeight - window.scrollY
        ),
      };
    });
    return [scrollInfo.pixelsAbove, scrollInfo.pixelsBelow];
  }

  async removeHighlights(): Promise<void> {
    await this.page.evaluate(() => {
      const container = document.getElementById(
        "playwright-highlight-container"
      );
      if (container) {
        container.remove();
      }
    });
  }

  async getSelectorMap(): Promise<SelectorMap> {
    const state = await this.getState();
    return state.selectorMap;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = await this.getSelectorMap();
    const element = selectorMap[index];
    if (!element) return null;
    return await this.get_locate_element(element);
  }

  async getDomElementByIndex(index: number): Promise<DOMElementNode | null> {
    const selectorMap = await this.getSelectorMap();
    return selectorMap[index] || null;
  }

  async getElementMap(): Promise<ElementMap> {
    const state = await this.getState();
    return state.elementMap;
  }

  async getAllElementByIndex(index: number): Promise<DOMElementNode | null> {
    const elementMap = await this.getElementMap();
    return elementMap[index] || null;
  }

  // Based on get_locate_element from original project
  async get_locate_element(
    element: DOMElementNode
  ): Promise<ElementHandle | null> {
    let currentFrame: any = await this.get_current_page();
    let current = element;
    const parent: DOMElementNode[] = [];

    // Build parent chain
    while (current.parent !== null) {
      parent.push(current.parent);
      current = current.parent;
    }
    parent.reverse();

    // Handle iframes
    const iframes = parent.filter((item) => item.tagName === "iframe");
    for (const iframe of iframes) {
      const cssSelector = await this._enhanced_css_selector_for_element(
        iframe,
        this.config.includeDynamicAttributes
      );
      currentFrame = currentFrame.frameLocator(cssSelector);
    }

    const cssSelector = await this._enhanced_css_selector_for_element(
      element,
      this.config.includeDynamicAttributes
    );

    try {
      if (
        "frameLocator" in currentFrame &&
        typeof currentFrame.frameLocator === "function"
      ) {
        const elementHandle = await currentFrame
          .locator(cssSelector)
          .elementHandle();
        return elementHandle;
      } else {
        // Try to scroll into view if hidden
        const elementHandle = await currentFrame.querySelector(cssSelector);
        if (elementHandle) {
          await elementHandle.scrollIntoViewIfNeeded();
          return elementHandle;
        }
        return null;
      }
    } catch (e) {
      console.error(`Failed to locate element: ${e}`);
      return null;
    }
  }

  async get_current_page(): Promise<Page> {
    return this.page;
  }

  // Based on _enhanced_css_selector_for_element from original project
  private async _enhanced_css_selector_for_element(
    element: DOMElementNode,
    include_dynamic_attributes: boolean = true
  ): Promise<string> {
    try {
      // Get base selector from XPath
      let css_selector = await this._convert_simple_xpath_to_css_selector(
        element.xpath
      );

      // Handle class attributes
      if (
        "class" in element.attributes &&
        element.attributes["class"] &&
        include_dynamic_attributes
      ) {
        // Define a regex pattern for valid class names in CSS
        const valid_class_name_pattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

        // Iterate through the class attribute values
        const classes = element.attributes["class"].split(" ");
        for (const class_name of classes) {
          // Skip empty class names
          if (!class_name.trim()) {
            continue;
          }

          // Check if the class name is valid
          if (valid_class_name_pattern.test(class_name)) {
            // Append the valid class name to the CSS selector
            css_selector += `.${class_name}`;
          }
        }
      }

      // Expanded set of safe attributes that are stable and useful for selection
      const SAFE_ATTRIBUTES = new Set([
        "id",
        "name",
        "type",
        "placeholder",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "role",
        "for",
        "autocomplete",
        "required",
        "readonly",
        "alt",
        "title",
        "src",
        "href",
        "target",
      ]);

      if (include_dynamic_attributes) {
        const dynamic_attributes = [
          "data-id",
          "data-qa",
          "data-cy",
          "data-testid",
        ];
        dynamic_attributes.forEach((attr) => SAFE_ATTRIBUTES.add(attr));
      }

      // Handle other attributes
      for (const [attribute, value] of Object.entries(element.attributes)) {
        if (attribute === "class") {
          continue;
        }

        // Skip invalid attribute names
        if (!attribute.trim()) {
          continue;
        }

        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }

        // Escape special characters in attribute names
        const safe_attribute = attribute.replace(/:/g, "\\:");

        // Handle different value cases
        if (value === "") {
          css_selector += `[${safe_attribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          // Use contains for values with special characters
          const collapsed_value = value.replace(/\s+/g, " ").trim();
          const safe_value = collapsed_value.replace(/"/g, '\\"');
          css_selector += `[${safe_attribute}*="${safe_value}"]`;
        } else {
          css_selector += `[${safe_attribute}="${value}"]`;
        }
      }

      return css_selector;
    } catch (e) {
      // Fallback to a more basic selector if something goes wrong
      const tag_name = element.tagName || "*";
      return `${tag_name}[highlight_index='${element.highlightIndex}']`;
    }
  }

  private async _convert_simple_xpath_to_css_selector(
    xpath: string
  ): Promise<string> {
    // Simplified XPath to CSS conversion
    if (xpath.startsWith("/html/body/")) {
      return xpath.replace(/\/html\/body\//g, "").replace(/\//g, " > ");
    }
    return xpath.replace(/\//g, " > ");
  }

  // Based on _input_text_element_node from original project
  async _input_text_element_node(
    element_node: DOMElementNode,
    text: string
  ): Promise<void> {
    try {
      const element_handle = await this.get_locate_element(element_node);
      if (!element_handle) {
        throw new Error("Element not found");
      }

      await element_handle.fill(text);
    } catch (e) {
      console.error(`Failed to input text into element: ${e}`);
      throw new Error(
        `Failed to input text into index ${element_node.highlightIndex}`
      );
    }
  }

  // Based on _click_element_node from original project
  async _click_element_node(element_node: DOMElementNode): Promise<void> {
    try {
      const element_handle = await this.get_locate_element(element_node);
      if (!element_handle) {
        throw new Error("Element not found");
      }

      const perform_click = async (click_func: () => Promise<void>) => {
        try {
          await click_func();
        } catch (e) {
          // Fallback to JavaScript click
          const page = await this.get_current_page();
          await page.evaluate("(el) => el.click()", element_handle);
        }
      };

      await perform_click(async () => {
        await element_handle.click({ timeout: 1500 });
      });
    } catch (e) {
      console.error(`Failed to click element: ${e}`);
      throw new Error(`Failed to click element: ${e}`);
    }
  }
}
