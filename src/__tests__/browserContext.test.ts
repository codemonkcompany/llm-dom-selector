import { BrowserContext, BrowserState } from "../services/browserContext";
import { DOMElementNode, ElementMap } from "../types/dom";

function makeElement(
  xpath: string,
  opts: { isVisible: boolean; isInteractive: boolean; elementIndex: number; scrollY?: number | null }
): DOMElementNode {
  const element = new DOMElementNode("a", xpath, {}, [], opts.isVisible, null);
  element.isInteractive = opts.isInteractive;
  element.elementIndex = opts.elementIndex;
  element.scrollY = opts.scrollY ?? null;
  return element;
}

function makeLiveState(elementMap: ElementMap, screenshot = "live-screenshot"): BrowserState {
  return {
    elementTree: Object.values(elementMap)[0] ?? makeElement("/html/body", { isVisible: true, isInteractive: false, elementIndex: 0 }),
    selectorMap: {},
    elementMap,
    url: "https://example.com",
    title: "Test Page",
    screenshot,
    pixels_above: 0,
    pixels_below: 0,
  };
}

describe("BrowserContext.mergeCachedElements", () => {
  // page is unused by mergeCachedElements itself — a real Playwright Page is
  // never needed for this pure pool-merging logic.
  const ctx = new BrowserContext({} as any);

  it("adds a cached element the live snapshot never saw, and disables vision", () => {
    const live = makeLiveState({
      0: makeElement("/html/body/a[1]", { isVisible: true, isInteractive: true, elementIndex: 0 }),
    });
    const cached = makeElement("/html/body/a[2]", {
      isVisible: true,
      isInteractive: true,
      elementIndex: 5,
      scrollY: 4000,
    });

    const merged = ctx.mergeCachedElements(live, [cached]);

    expect(Object.values(merged.elementMap)).toHaveLength(2);
    const revived = Object.values(merged.elementMap).find((el) => el.xpath === "/html/body/a[2]");
    expect(revived?.scrollY).toBe(4000);
    expect(merged.screenshot).toBe("");
  });

  it("does not let a cached entry override a live element that's currently visible, and keeps the screenshot", () => {
    const liveVisible = makeElement("/html/body/a[1]", { isVisible: true, isInteractive: true, elementIndex: 0 });
    const live = makeLiveState({ 0: liveVisible });
    const staleCached = makeElement("/html/body/a[1]", {
      isVisible: false,
      isInteractive: true,
      elementIndex: 0,
      scrollY: 1200,
    });

    const merged = ctx.mergeCachedElements(live, [staleCached]);

    const winner = Object.values(merged.elementMap).find((el) => el.xpath === "/html/body/a[1]");
    expect(winner).toBe(liveVisible);
    expect(merged.screenshot).toBe("live-screenshot");
  });

  it("upgrades a live element that's currently off-screen with the cached (last-seen-visible) version", () => {
    const liveOffscreen = makeElement("/html/body/a[1]", { isVisible: false, isInteractive: true, elementIndex: 0 });
    const live = makeLiveState({ 0: liveOffscreen });
    const cachedVisible = makeElement("/html/body/a[1]", {
      isVisible: true,
      isInteractive: true,
      elementIndex: 0,
      scrollY: 2400,
    });

    const merged = ctx.mergeCachedElements(live, [cachedVisible]);

    const winner = Object.values(merged.elementMap).find((el) => el.xpath === "/html/body/a[1]");
    expect(winner).toBe(cachedVisible);
    expect(winner?.scrollY).toBe(2400);
    expect(merged.screenshot).toBe("");
  });

  it("with an empty cache, returns the live state's own screenshot untouched", () => {
    const live = makeLiveState({
      0: makeElement("/html/body/a[1]", { isVisible: true, isInteractive: true, elementIndex: 0 }),
    });

    const merged = ctx.mergeCachedElements(live, []);

    expect(merged.screenshot).toBe("live-screenshot");
    expect(Object.values(merged.elementMap)).toHaveLength(1);
  });
});
