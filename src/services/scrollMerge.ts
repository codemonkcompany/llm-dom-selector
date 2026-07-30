import { DOMElementNode, ElementMap, SelectorMap } from "../types/dom";

/**
 * Merges one snapshot's elements into a running xpath-keyed pool, in place.
 *
 * `buildDomTreeOverlay` walks the whole document on every call regardless of
 * scroll position, so the same element is re-extracted at every scroll
 * offset — xpath is what identifies "the same element" across snapshots.
 * When an element was previously seen off-screen (`isVisible: false`, no
 * `highlightIndex`) and a later snapshot — taken after scrolling — shows it
 * on-screen, the on-screen occurrence replaces the earlier one, since only
 * that occurrence is actually actionable.
 */
export function mergeElementsByXPath(
  pool: Map<string, DOMElementNode>,
  snapshotElementMap: ElementMap
): void {
  for (const element of Object.values(snapshotElementMap)) {
    const current = pool.get(element.xpath);
    if (!current || (!current.isVisible && element.isVisible)) {
      pool.set(element.xpath, element);
    }
  }
}

/**
 * Rebuilds `selectorMap`/`elementMap` from a deduped xpath pool with fresh,
 * contiguous indices.
 *
 * Raw `highlightIndex` values aren't comparable across snapshots: that
 * counter only increments for elements visible at a given scroll position,
 * so it restarts from 0 each time a different set of elements happens to be
 * on-screen — the same number can name a different element in every
 * snapshot. `elementIndex` doesn't have that problem (it increments for
 * every qualifying element regardless of visibility, so it's stable across
 * snapshots of the same DOM) and is used here purely to restore top-to-
 * bottom page order before reassigning fresh indices.
 */
export function buildIndexedMaps(pool: Map<string, DOMElementNode>): {
  selectorMap: SelectorMap;
  elementMap: ElementMap;
} {
  const selectorMap: SelectorMap = {};
  const elementMap: ElementMap = {};

  const ordered = [...pool.values()].sort(
    (a, b) => (a.elementIndex ?? 0) - (b.elementIndex ?? 0)
  );

  let highlightIndex = 0;
  ordered.forEach((element, elementIndex) => {
    element.elementIndex = elementIndex;
    elementMap[elementIndex] = element;

    if (element.isVisible && element.isInteractive) {
      element.highlightIndex = highlightIndex;
      selectorMap[highlightIndex] = element;
      highlightIndex++;
    } else {
      element.highlightIndex = null;
    }
  });

  return { selectorMap, elementMap };
}
