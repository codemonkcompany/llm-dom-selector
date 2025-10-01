import { Page } from "playwright";
import {
  DOMBaseNode,
  DOMElementNode,
  DOMState,
  DOMTextNode,
  SelectorMap,
  ViewportInfo,
} from "../types/dom";
import { buildDomTreeOverlay } from "../scripts/domExtractor";

export class DomService {
  private page: Page;
  private xpathCache: Record<string, any> = {};
  private jsCode: any;

  constructor(page: Page) {
    this.page = page;
    this.jsCode = buildDomTreeOverlay;
  }

  async getClickableElements(
    highlightElements: boolean = true,
    focusElement: number = -1,
    viewportExpansion: number = 0
  ): Promise<DOMState> {
    const [elementTree, selectorMap] = await this.buildDomTree(
      highlightElements,
      focusElement,
      viewportExpansion
    );
    return new DOMState(elementTree, selectorMap);
  }

  private async buildDomTree(
    highlightElements: boolean,
    focusElement: number,
    viewportExpansion: number
  ): Promise<[DOMElementNode, SelectorMap]> {
    if ((await this.page.evaluate("1+1")) !== 2) {
      throw new Error("The page cannot evaluate JavaScript code properly");
    }

    const debugMode = false;
    const args = {
      doHighlightElements: highlightElements,
      focusHighlightIndex: focusElement,
      viewportExpansion: viewportExpansion,
      debugMode: debugMode,
    };

    let evalPage;
    try {
      evalPage = await this.page.evaluate(this.jsCode, args);
    } catch (e) {
      console.error("Error evaluating JavaScript:", e);
      throw e;
    }

    return this.constructDomTree(evalPage);
  }

  private async constructDomTree(
    evalPage: any
  ): Promise<[DOMElementNode, SelectorMap]> {
    const jsNodeMap = evalPage.map;
    const jsRootId = evalPage.rootId;

    const selectorMap: SelectorMap = {};
    const nodeMap: Record<string, DOMBaseNode> = {};

    for (const [id, nodeData] of Object.entries(jsNodeMap)) {
      const [node, childrenIds] = this.parseNode(nodeData);
      if (!node) continue;

      nodeMap[id] = node;

      if (node instanceof DOMElementNode && node.highlightIndex !== null) {
        selectorMap[node.highlightIndex] = node;
      }

      if (node instanceof DOMElementNode) {
        for (const childId of childrenIds) {
          const childNode = nodeMap[childId];
          if (!childNode) continue;

          childNode.parent = node;
          node.children.push(childNode);
        }
      }
    }

    const htmlToDict = nodeMap[jsRootId];

    if (!htmlToDict || !(htmlToDict instanceof DOMElementNode)) {
      throw new Error("Failed to parse HTML to dictionary");
    }

    return [htmlToDict, selectorMap];
  }

  private parseNode(nodeData: any): [DOMBaseNode | null, number[]] {
    if (!nodeData) return [null, []];

    if (nodeData.type === "TEXT_NODE") {
      const textNode = new DOMTextNode(nodeData.text, nodeData.isVisible, null);
      return [textNode, []];
    }

    const viewportInfo = nodeData.viewport
      ? ({
          height: nodeData.viewport.width,
          width: nodeData.viewport.height,
        } as ViewportInfo)
      : null;

    const elementNode = new DOMElementNode(
      nodeData.tagName,
      nodeData.xpath,
      nodeData.attributes || {},
      [],
      nodeData.isVisible || false,
      null
    );

    // Set additional properties after initialization
    elementNode.isInteractive = nodeData.isInteractive || false;
    elementNode.isTopElement = nodeData.isTopElement || false;
    elementNode.isInViewport = nodeData.isInViewport || false;
    elementNode.shadowRoot = nodeData.shadowRoot || false;
    elementNode.highlightIndex = nodeData.highlightIndex || null;
    elementNode.viewportInfo = viewportInfo;
    const childrenIds = nodeData.children || [];

    return [elementNode, childrenIds];
  }
}
