import { LLMSelector } from "../services/llmSelector";
import { DOMElementNode, SelectorMap } from "../types/dom";
import { BrowserState } from "../services/browserContext";
import { ChatOpenAI } from "@langchain/openai";

// Mock LLM for testing
class MockLLM {
  async invoke(messages: any[]) {
    // Simple mock that returns a basic response
    return {
      content: JSON.stringify({
        selectedIndex: 1,
        confidence: 0.9,
        reasoning: "Mock selection for testing",
      }),
    };
  }
}

describe("LLMSelector", () => {
  let selector: LLMSelector;
  let mockBrowserState: BrowserState;
  let mockSelectorMap: SelectorMap;

  beforeEach(() => {
    const mockLLM = new MockLLM() as any;
    selector = new LLMSelector(mockLLM, {
      includeAttributes: ["title", "aria-label"],
      useVision: false,
      maxRetries: 3,
    });

    // Create mock DOM elements
    const element1 = new DOMElementNode(
      "button",
      "/html/body/button[1]",
      { id: "btn1" },
      [],
      true,
      null
    );
    element1.highlightIndex = 1;
    element1.isInteractive = true;

    const element2 = new DOMElementNode(
      "input",
      "/html/body/input[1]",
      { type: "text", placeholder: "Enter text" },
      [],
      true,
      null
    );
    element2.highlightIndex = 2;
    element2.isInteractive = true;

    mockSelectorMap = {
      1: element1,
      2: element2,
    };

    mockBrowserState = {
      elementTree: element1,
      selectorMap: mockSelectorMap,
      elementMap: mockSelectorMap, // For testing, use the same map
      url: "https://example.com",
      title: "Test Page",
      screenshot: "",
      pixels_above: 0,
      pixels_below: 0,
    };
  });

  test("should select element based on prompt", async () => {
    const result = await selector.selectElement(
      "click the button",
      mockBrowserState
    );

    expect(result.selectedElement).toBeDefined();
    expect(result.selectedIndex).toBe(1);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasoning).toBeDefined();
  });

  test("should handle invalid JSON response", async () => {
    const mockLLM = {
      async invoke() {
        return { content: "invalid json" };
      },
    } as any;

    const selectorWithInvalidLLM = new LLMSelector(mockLLM);
    const result = await selectorWithInvalidLLM.selectElement(
      "test",
      mockBrowserState
    );

    expect(result.selectedElement).toBeNull();
    expect(result.selectedIndex).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test("should handle null selection", async () => {
    const mockLLM = {
      async invoke() {
        return {
          content: JSON.stringify({
            selectedIndex: null,
            confidence: 0,
            reasoning: "No element found",
          }),
        };
      },
    } as any;

    const selectorWithNullLLM = new LLMSelector(mockLLM);
    const result = await selectorWithNullLLM.selectElement(
      "test",
      mockBrowserState
    );

    expect(result.selectedElement).toBeNull();
    expect(result.selectedIndex).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test("should format elements correctly for LLM", () => {
    const formatted = selector["formatElementsForLLM"](
      mockBrowserState.elementTree,
      mockBrowserState.selectorMap
    );

    expect(formatted).toContain("[1]<button");
    expect(formatted).toContain("[2]<input");
  });

  describe("formatAllElementsForLLM visibility handling", () => {
    let visibleHeading: DOMElementNode;
    let hiddenButton: DOMElementNode;
    let elementMap: SelectorMap;

    beforeEach(() => {
      // A heading actually visible on the page.
      visibleHeading = new DOMElementNode(
        "h1",
        "/html/body/h1[1]",
        {},
        [],
        true,
        null
      );
      visibleHeading.elementIndex = 10;

      // A mobile-nav button hidden by a responsive class at this viewport
      // (e.g. Tailwind's `md:hidden`) — the exact real-world case that
      // produced a "hidden" element being picked for a visibility assertion.
      hiddenButton = new DOMElementNode(
        "button",
        "/html/body/button[1]",
        { "aria-label": "Open menu" },
        [],
        false,
        null
      );
      hiddenButton.elementIndex = 20;

      elementMap = { 10: visibleHeading, 20: hiddenButton };
    });

    test("tags a hidden element and leaves a visible one untagged, by default", () => {
      const candidates = selector["filterElementsByVisibility"](elementMap, "any");
      const formatted = selector["formatAllElementsForLLM"](candidates);

      expect(formatted).toContain("[10]<h1/>");
      expect(formatted).toContain("[20]<button hidden>Open menu</button>");
    });

    test('"visible-only" removes the hidden element from the listing entirely', () => {
      const candidates = selector["filterElementsByVisibility"](
        elementMap,
        "visible-only"
      );
      const formatted = selector["formatAllElementsForLLM"](candidates);

      expect(formatted).toContain("[10]<h1");
      expect(formatted).not.toContain("[20]<button");
      expect(formatted).not.toContain("hidden");
    });

    test('"hidden-only" removes the visible element from the listing entirely', () => {
      const candidates = selector["filterElementsByVisibility"](
        elementMap,
        "hidden-only"
      );
      const formatted = selector["formatAllElementsForLLM"](candidates);

      expect(formatted).not.toContain("[10]<h1");
      expect(formatted).toContain("[20]<button hidden");
    });

    test("a selectedIndex outside the filtered pool cannot resolve to a filtered-out element", () => {
      // Guards the lookup-bypass bug: the model must not be able to select
      // something it was never shown just because that index exists in the
      // full, unfiltered elementMap.
      const candidates = selector["filterElementsByVisibility"](
        elementMap,
        "visible-only"
      );
      const result = selector["parseLLMResponseForAllElements"](
        JSON.stringify({ selectedIndex: 20, confidence: 0.9, reasoning: "test" }),
        candidates
      );

      expect(result.selectedElement).toBeNull();
    });
  });

  describe("selectElementFromAllElements", () => {
    test("never offers a hidden element to the model when visibilityFilter is visible-only", async () => {
      const hiddenButton = new DOMElementNode(
        "button",
        "/html/body/button[1]",
        { "aria-label": "Open menu" },
        [],
        false,
        null
      );
      hiddenButton.elementIndex = 20;

      const visibleHeading = new DOMElementNode(
        "h1",
        "/html/body/h1[1]",
        {},
        [],
        true,
        null
      );
      visibleHeading.elementIndex = 10;

      const allElementsState: BrowserState = {
        ...mockBrowserState,
        elementMap: { 10: visibleHeading, 20: hiddenButton },
      };

      let capturedUserMessage = "";
      const mockLLM = {
        async invoke(messages: any[]) {
          capturedUserMessage = messages[1].content as string;
          return {
            content: JSON.stringify({
              selectedIndex: 10,
              confidence: 0.95,
              reasoning: "The visible heading matches",
            }),
          };
        },
      } as any;

      const selectorForAll = new LLMSelector(mockLLM, { useVision: false });
      const result = await selectorForAll.selectElementFromAllElements(
        'the heading "Start free." is visible',
        allElementsState,
        "visible-only"
      );

      expect(capturedUserMessage).not.toContain("Open menu");
      expect(result.selectedElement).toBe(visibleHeading);
    });
  });
});
