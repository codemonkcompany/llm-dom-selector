import { mergeElementsByXPath, buildIndexedMaps } from "../services/scrollMerge";
import { DOMElementNode, ElementMap } from "../types/dom";

function makeElement(
  xpath: string,
  opts: { isVisible: boolean; isInteractive: boolean; elementIndex: number }
): DOMElementNode {
  const element = new DOMElementNode(
    "summary",
    xpath,
    {},
    [],
    opts.isVisible,
    null
  );
  element.isInteractive = opts.isInteractive;
  element.elementIndex = opts.elementIndex;
  element.highlightIndex = opts.isVisible && opts.isInteractive ? 0 : null;
  return element;
}

describe("mergeElementsByXPath", () => {
  it("adds elements not seen before", () => {
    const pool = new Map<string, DOMElementNode>();
    const snapshot: ElementMap = {
      0: makeElement("/html/body/div[1]", {
        isVisible: true,
        isInteractive: true,
        elementIndex: 0,
      }),
    };

    mergeElementsByXPath(pool, snapshot);

    expect(pool.size).toBe(1);
    expect(pool.get("/html/body/div[1]")).toBeDefined();
  });

  it("upgrades a previously off-screen element once a later snapshot shows it on-screen", () => {
    const pool = new Map<string, DOMElementNode>();
    const offscreen = makeElement("/html/body/div[6]", {
      isVisible: false,
      isInteractive: true,
      elementIndex: 5,
    });
    mergeElementsByXPath(pool, { 0: offscreen });

    const onscreen = makeElement("/html/body/div[6]", {
      isVisible: true,
      isInteractive: true,
      elementIndex: 5,
    });
    mergeElementsByXPath(pool, { 0: onscreen });

    expect(pool.size).toBe(1);
    expect(pool.get("/html/body/div[6]")).toBe(onscreen);
  });

  it("does not downgrade an on-screen element if it's re-seen off-screen later", () => {
    const pool = new Map<string, DOMElementNode>();
    const onscreen = makeElement("/html/body/div[2]", {
      isVisible: true,
      isInteractive: true,
      elementIndex: 1,
    });
    mergeElementsByXPath(pool, { 0: onscreen });

    const offscreenAgain = makeElement("/html/body/div[2]", {
      isVisible: false,
      isInteractive: true,
      elementIndex: 1,
    });
    mergeElementsByXPath(pool, { 0: offscreenAgain });

    expect(pool.get("/html/body/div[2]")).toBe(onscreen);
  });
});

describe("buildIndexedMaps", () => {
  it("re-numbers elements in stable elementIndex order and only includes visible+interactive ones in selectorMap", () => {
    const pool = new Map<string, DOMElementNode>();
    // Deliberately inserted out of page order to prove sorting happens.
    const third = makeElement("/html/body/div[3]", {
      isVisible: true,
      isInteractive: true,
      elementIndex: 2,
    });
    const first = makeElement("/html/body/div[1]", {
      isVisible: true,
      isInteractive: true,
      elementIndex: 0,
    });
    const second = makeElement("/html/body/p[1]", {
      isVisible: true,
      isInteractive: false, // content element, not clickable
      elementIndex: 1,
    });
    pool.set(third.xpath, third);
    pool.set(first.xpath, first);
    pool.set(second.xpath, second);

    const { selectorMap, elementMap } = buildIndexedMaps(pool);

    expect(Object.keys(elementMap)).toHaveLength(3);
    expect(elementMap[0].xpath).toBe("/html/body/div[1]");
    expect(elementMap[1].xpath).toBe("/html/body/p[1]");
    expect(elementMap[2].xpath).toBe("/html/body/div[3]");

    // Only the two interactive+visible elements get contiguous highlight
    // indices; the non-interactive paragraph is excluded from selectorMap.
    expect(Object.keys(selectorMap)).toHaveLength(2);
    expect(selectorMap[0].xpath).toBe("/html/body/div[1]");
    expect(selectorMap[1].xpath).toBe("/html/body/div[3]");
    expect(second.highlightIndex).toBeNull();
  });
});
