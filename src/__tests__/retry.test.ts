import { LLMSelector } from "../services/llmSelector";
import { RateLimitError } from "../services/errors";
import { DOMElementNode, SelectorMap } from "../types/dom";
import { BrowserState } from "../services/browserContext";

/** Shapes an OpenAI APIError closely enough for the retry logic to read it. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Record<string, string> = {}
  ) {
    super(`stub api error ${status}`);
  }
}

const goodResponse = {
  content: JSON.stringify({
    selectedIndex: 1,
    confidence: 0.9,
    reasoning: "ok",
  }),
};

function buildBrowserState(): BrowserState {
  const element = new DOMElementNode(
    "button",
    "/html/body/button[1]",
    { id: "btn1" },
    [],
    true,
    null
  );
  element.highlightIndex = 1;
  element.isInteractive = true;

  const selectorMap: SelectorMap = { 1: element };

  return {
    elementTree: element,
    selectorMap,
    elementMap: selectorMap,
    url: "https://example.com",
    title: "Test Page",
    screenshot: "",
    pixels_above: 0,
    pixels_below: 0,
  };
}

/** Zero the backoff so tests don't actually sleep. */
const noWait = { maxRetries: 3, initialDelayMs: 0, maxDelayMs: 0 };

describe("LLMSelector retry behaviour", () => {
  let browserState: BrowserState;

  beforeEach(() => {
    browserState = buildBrowserState();
  });

  test("retries a 429 and succeeds once the provider recovers", async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(429))
      .mockResolvedValueOnce(goodResponse);

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      retry: noWait,
    });

    const result = await selector.selectElement("click it", browserState);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.selectedIndex).toBe(1);
  });

  test("surfaces a RateLimitError once retries are exhausted, so callers can tell throttling from 'not found'", async () => {
    const invoke = jest.fn().mockRejectedValue(new ApiError(429));

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      retry: noWait,
    });

    await expect(
      selector.selectElement("click it", browserState)
    ).rejects.toBeInstanceOf(RateLimitError);

    expect(invoke).toHaveBeenCalledTimes(3);
  });

  test("carries the provider's retry-after-ms hint on the error", async () => {
    const invoke = jest
      .fn()
      .mockRejectedValue(new ApiError(429, { "retry-after-ms": "1507" }));

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      retry: noWait,
    });

    await expect(
      selector.selectElement("click it", browserState)
    ).rejects.toMatchObject({ retryAfterMs: 1507 });
  });

  test("does not retry a 400 — the same malformed request fails identically every time", async () => {
    const invoke = jest.fn().mockRejectedValue(new ApiError(400));

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      retry: noWait,
    });

    await expect(
      selector.selectElement("click it", browserState)
    ).rejects.toThrow("stub api error 400");

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("retries a 500", async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(503))
      .mockResolvedValueOnce(goodResponse);

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      retry: noWait,
    });

    await selector.selectElement("click it", browserState);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("applies the same retry logic to selectElementFromAllElements", async () => {
    const invoke = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(429))
      .mockResolvedValueOnce(goodResponse);

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      retry: noWait,
    });

    await selector.selectElementFromAllElements("click it", browserState);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("a bare maxRetries still controls attempt count for callers that predate retry {}", async () => {
    const invoke = jest.fn().mockRejectedValue(new ApiError(429));

    const selector = new LLMSelector({ invoke } as any, {
      useVision: false,
      maxRetries: 1,
    });

    await expect(
      selector.selectElement("click it", browserState)
    ).rejects.toBeInstanceOf(RateLimitError);

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("screenshot detail", () => {
  test("passes the configured detail through on the image payload", async () => {
    const invoke = jest.fn().mockResolvedValue(goodResponse);

    const selector = new LLMSelector({ invoke } as any, {
      useVision: true,
      screenshotDetail: "low",
      retry: noWait,
    });

    const state = buildBrowserState();
    state.screenshot = "AAAA";

    await selector.selectElement("click it", state);

    const imagePart = invoke.mock.calls[0][0][1].content.find(
      (part: any) => part.type === "image_url"
    );

    expect(imagePart.image_url.detail).toBe("low");
  });

  test("defaults to auto so existing consumers see no change", async () => {
    const invoke = jest.fn().mockResolvedValue(goodResponse);

    const selector = new LLMSelector({ invoke } as any, { useVision: true });

    const state = buildBrowserState();
    state.screenshot = "AAAA";

    await selector.selectElement("click it", state);

    const imagePart = invoke.mock.calls[0][0][1].content.find(
      (part: any) => part.type === "image_url"
    );

    expect(imagePart.image_url.detail).toBe("auto");
  });
});
