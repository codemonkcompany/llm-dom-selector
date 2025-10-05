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
});
