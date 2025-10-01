// Simplified types for DOM elements without external dependencies
export interface ViewportInfo {
  width: number;
  height: number;
}

export interface CoordinateSet {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HashedDomElement {
  branch_path_hash: string;
  attributes_hash: string;
  xpath_hash: string;
}

export interface DOMBaseNode {
  isVisible: boolean;
  parent: DOMElementNode | null;
}

export class DOMTextNode implements DOMBaseNode {
  text: string;
  type: string = "TEXT_NODE";
  isVisible: boolean;
  parent: DOMElementNode | null;

  constructor(text: string, isVisible: boolean, parent: DOMElementNode | null) {
    this.text = text;
    this.isVisible = isVisible;
    this.parent = parent;
  }

  hasParentWithHighlightIndex(): boolean {
    let current = this.parent;
    while (current !== null) {
      if (current.highlightIndex !== null) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  isParentInViewport(): boolean {
    return this.parent?.isInViewport ?? false;
  }

  isParentTopElement(): boolean {
    return this.parent?.isTopElement ?? false;
  }
}

export class DOMElementNode implements DOMBaseNode {
  tagName: string;
  xpath: string;
  attributes: Record<string, string>;
  children: DOMBaseNode[];
  isVisible: boolean;
  parent: DOMElementNode | null;
  isInteractive: boolean = false;
  isTopElement: boolean = false;
  isInViewport: boolean = false;
  shadowRoot: boolean = false;
  highlightIndex: number | null = null;
  viewportCoordinates: CoordinateSet | null = null;
  pageCoordinates: CoordinateSet | null = null;
  viewportInfo: ViewportInfo | null = null;

  constructor(
    tagName: string,
    xpath: string,
    attributes: Record<string, string>,
    children: DOMBaseNode[],
    isVisible: boolean,
    parent: DOMElementNode | null
  ) {
    this.tagName = tagName;
    this.xpath = xpath;
    this.attributes = attributes;
    this.children = children;
    this.isVisible = isVisible;
    this.parent = parent;
  }

  toString(): string {
    let tagStr = `<${this.tagName}`;
    for (const [key, value] of Object.entries(this.attributes)) {
      tagStr += ` ${key}="${value}"`;
    }
    tagStr += ">";

    const extras: string[] = [];
    if (this.isInteractive) extras.push("interactive");
    if (this.isTopElement) extras.push("top");
    if (this.shadowRoot) extras.push("shadow-root");
    if (this.highlightIndex !== null)
      extras.push(`highlight:${this.highlightIndex}`);
    if (this.isInViewport) extras.push("in-viewport");

    if (extras.length > 0) {
      tagStr += ` [${extras.join(", ")}]`;
    }

    return tagStr;
  }

  get hash(): HashedDomElement {
    // Simplified hash implementation based on original HistoryTreeProcessor
    const parentBranchPath = this.getParentBranchPath();
    const branchPathHash = this.parentBranchPathHash(parentBranchPath);
    const attributesHash = this.attributesHash(this.attributes);
    const xpathHash = this.xpathHash(this.xpath);

    return {
      branch_path_hash: branchPathHash,
      attributes_hash: attributesHash,
      xpath_hash: xpathHash,
    };
  }

  private getParentBranchPath(): string[] {
    const parents: DOMElementNode[] = [];
    let currentElement: DOMElementNode | null = this;
    while (currentElement.parent !== null) {
      parents.push(currentElement);
      currentElement = currentElement.parent;
    }
    parents.reverse();
    return parents.map((parent) => parent.tagName);
  }

  private parentBranchPathHash(parentBranchPath: string[]): string {
    return Buffer.from(parentBranchPath.join("/"))
      .toString("base64")
      .slice(0, 16);
  }

  private attributesHash(attributes: Record<string, string>): string {
    const sortedAttrs = Object.keys(attributes)
      .sort()
      .map((key) => `${key}=${attributes[key]}`);
    return Buffer.from(sortedAttrs.join("&")).toString("base64").slice(0, 16);
  }

  private xpathHash(xpath: string): string {
    return Buffer.from(xpath).toString("base64").slice(0, 16);
  }

  getAllTextTillNextClickableElement(maxDepth: number = -1): string {
    const textParts: string[] = [];

    const collectText = (node: DOMBaseNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) return;

      // Stop if we encounter another interactive element (but not the current element)
      if (
        node instanceof DOMElementNode &&
        node !== this &&
        node.highlightIndex !== null
      )
        return;

      if (node instanceof DOMTextNode) {
        // Only collect text from visible text nodes
        if (node.isVisible) {
          textParts.push(node.text);
        }
      } else if (node instanceof DOMElementNode) {
        // For element nodes, collect text from their children
        node.children.forEach((child) => collectText(child, currentDepth + 1));
      }
    };

    collectText(this, 0);

    // If no text was found through text nodes, try to get text from the element itself
    if (textParts.length === 0) {
      const elementText = this.getDirectTextContent();
      if (elementText) {
        textParts.push(elementText);
      }
    }

    return textParts.join(" ").trim();
  }

  // Helper method to get text content directly from the element
  private getDirectTextContent(): string {
    // This method should extract text content from the element
    // Since the current DOM extraction doesn't create proper text nodes,
    // we need to work with what we have

    // Check if this element has any text-related attributes
    const textFromAttributes = Object.entries(this.attributes)
      .filter(
        ([key, value]) =>
          ["placeholder", "value", "title", "aria-label"].includes(key) &&
          value &&
          value.trim()
      )
      .map(([, value]) => value.trim());

    if (textFromAttributes.length > 0) {
      return textFromAttributes.join(" ");
    }

    // If no text found in attributes, return empty string
    return "";
  }

  clickableElementsToString(includeAttributes: string[] | null = null): string {
    const formattedText: string[] = [];

    const processNode = (node: DOMBaseNode, depth: number): void => {
      if (node instanceof DOMElementNode) {
        if (node.highlightIndex !== null) {
          let attributesStr = "";
          const text = node.getAllTextTillNextClickableElement();
          if (includeAttributes) {
            const attributes = Array.from(
              new Set(
                Object.entries(node.attributes)
                  .filter(
                    ([key, value]) =>
                      includeAttributes.includes(key) && value !== node.tagName
                  )
                  .map(([, value]) => value)
              )
            );
            if (attributes.includes(text))
              attributes.splice(attributes.indexOf(text), 1);
            attributesStr = attributes.join(";");
          }
          let line = `[${node.highlightIndex}]<${node.tagName} `;
          if (attributesStr) line += `${attributesStr}`;
          if (text) line += `${attributesStr ? ">" : ""}${text}`;
          line += "/>";
          formattedText.push(line);
        }

        node.children.forEach((child) => processNode(child, depth + 1));
      } else if (node instanceof DOMTextNode) {
        if (!node.hasParentWithHighlightIndex() && node.isVisible) {
          formattedText.push(node.text);
        }
      }
    };

    processNode(this, 0);
    return formattedText.join("\n");
  }

  getFileUploadElement(checkSiblings: boolean = true): DOMElementNode | null {
    if (this.tagName === "input" && this.attributes.type === "file")
      return this;

    for (const child of this.children) {
      if (child instanceof DOMElementNode) {
        const result = child.getFileUploadElement(false);
        if (result) return result;
      }
    }

    if (checkSiblings && this.parent) {
      for (const sibling of this.parent.children) {
        if (sibling !== this && sibling instanceof DOMElementNode) {
          const result = sibling.getFileUploadElement(false);
          if (result) return result;
        }
      }
    }

    return null;
  }
}

export interface SelectorMap {
  [key: number]: DOMElementNode;
}

export class DOMState {
  elementTree: DOMElementNode;
  selectorMap: SelectorMap;

  constructor(elementTree: DOMElementNode, selectorMap: SelectorMap) {
    this.elementTree = elementTree;
    this.selectorMap = selectorMap;
  }
}
