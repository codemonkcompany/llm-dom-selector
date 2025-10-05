// DOM extraction script - based on jsScript.ts from original project
export function buildDomTreeOverlay(args: {
  doHighlightElements: boolean;
  focusHighlightIndex: number;
  viewportExpansion: number;
  debugMode: boolean;
}): any {
  const {
    doHighlightElements = true,
    focusHighlightIndex = -1,
    viewportExpansion = 0,
    debugMode = false,
  } = args;

  // Remove existing highlights
  const existingContainer = document.getElementById(
    "playwright-highlight-container"
  );
  if (existingContainer) {
    existingContainer.remove();
  }

  // Get viewport dimensions
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  // Create highlight container
  let highlightContainer: HTMLElement | null = null;
  if (doHighlightElements) {
    highlightContainer = document.createElement("div");
    highlightContainer.id = "playwright-highlight-container";
    highlightContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `;
    document.body.appendChild(highlightContainer);
  }

  // Node map and counters
  const nodeMap: Record<string, any> = {};
  let nodeIdCounter = 0;
  let highlightIndex = 0; // For interactive elements only
  let elementIndex = 0; // For ALL elements

  // Helper function to generate XPath
  function getXPath(element: Element): string {
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }
    if (element === document.body) {
      return "/html/body";
    }

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        selector += `[@id="${current.id}"]`;
        path.unshift(selector);
        break;
      } else {
        let sibling = current.previousElementSibling;
        let index = 1;
        while (sibling) {
          if (sibling.nodeName === current.nodeName) {
            index++;
          }
          sibling = sibling.previousElementSibling;
        }
        if (index > 1) {
          selector += `[${index}]`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }

    return "/" + path.join("/");
  }

  // Helper function to check if element is visible
  function isElementVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top < viewport.height + viewportExpansion &&
      rect.bottom > -viewportExpansion &&
      rect.left < viewport.width + viewportExpansion &&
      rect.right > -viewportExpansion
    );
  }

  // Helper function to check if element is interactive
  function isElementInteractive(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const interactiveTags = [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "option",
      "optgroup",
      "fieldset",
      "legend",
      "details",
      "summary",
    ];

    if (interactiveTags.includes(tagName)) {
      return true;
    }

    // Check for clickable attributes
    const clickableAttributes = [
      "onclick",
      "onmousedown",
      "onmouseup",
      "onmousemove",
      "onmouseover",
      "onmouseout",
    ];

    for (const attr of clickableAttributes) {
      if (element.hasAttribute(attr)) {
        return true;
      }
    }

    // Check for role attribute
    const role = element.getAttribute("role");
    if (
      role &&
      ["button", "link", "menuitem", "tab", "option"].includes(role)
    ) {
      return true;
    }

    // Check for tabindex
    const tabIndex = element.getAttribute("tabindex");
    if (tabIndex && tabIndex !== "-1") {
      return true;
    }

    return false;
  }

  // Helper function to get element attributes
  function getElementAttributes(element: Element): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      attributes[attr.name] = attr.value;
    }
    return attributes;
  }

  // Helper function to get element text content
  function getElementText(element: Element): string {
    return element.textContent?.trim() || "";
  }

  // Helper function to create highlight element
  function createHighlightElement(
    element: Element,
    index: number,
    isFocused: boolean = false
  ): HTMLElement | null {
    if (!highlightContainer) return null;

    const rect = element.getBoundingClientRect();
    const highlight = document.createElement("div");
    highlight.className = "playwright-highlight";
    highlight.style.cssText = `
      position: absolute;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid ${isFocused ? "#ff0000" : "#00ff00"};
      background-color: ${
        isFocused ? "rgba(255, 0, 0, 0.1)" : "rgba(0, 255, 0, 0.1)"
      };
      pointer-events: none;
      z-index: 2147483646;
      box-sizing: border-box;
    `;

    // Add index label
    const label = document.createElement("div");
    label.textContent = index.toString();
    label.style.cssText = `
      position: absolute;
      top: -20px;
      left: 0;
      background-color: ${isFocused ? "#ff0000" : "#00ff00"};
      color: white;
      padding: 2px 6px;
      font-size: 12px;
      font-weight: bold;
      border-radius: 3px;
      white-space: nowrap;
    `;
    highlight.appendChild(label);
    highlightContainer.appendChild(highlight);

    return highlight;
  }

  // Main traversal function
  function traverseElement(
    element: Element,
    parentId: string | null = null
  ): string {
    const nodeId = `node_${nodeIdCounter++}`;
    const isVisible = isElementVisible(element);
    const isInteractive = isElementInteractive(element);
    const xpath = getXPath(element);
    const attributes = getElementAttributes(element);
    const text = getElementText(element);

    // Determine if this element should get a highlight index (interactive only)
    let currentHighlightIndex: number | null = null;
    if (isVisible && isInteractive) {
      currentHighlightIndex = highlightIndex++;
    }

    // Assign index to ALL elements (both interactive and non-interactive)
    let currentElementIndex: number | null = null;
    if (currentHighlightIndex !== null || element.nodeType === Node.TEXT_NODE) {
      currentElementIndex = elementIndex++;
    }

    // Create highlight element if needed
    if (doHighlightElements && currentHighlightIndex !== null) {
      const isFocused = currentHighlightIndex === focusHighlightIndex;
      createHighlightElement(element, currentHighlightIndex, isFocused);
    }

    // Get children (including text nodes)
    const children: string[] = [];

    // Process child nodes (both elements and text)
    for (let i = 0; i < element.childNodes.length; i++) {
      const childNode = element.childNodes[i];

      if (childNode.nodeType === Node.TEXT_NODE) {
        // Create text node
        const textContent = childNode.textContent?.trim();
        if (textContent) {
          const textNodeId = `text_${nodeIdCounter++}`;
          nodeMap[textNodeId] = {
            type: "TEXT_NODE",
            text: textContent,
            isVisible: isVisible, // Text visibility follows parent element
          };
          children.push(textNodeId);
        }
      } else if (childNode.nodeType === Node.ELEMENT_NODE) {
        // Process element child
        const childId = traverseElement(childNode as Element, nodeId);
        children.push(childId);
      }
    }

    // Create node data
    const nodeData: any = {
      type: "ELEMENT_NODE",
      tagName: element.tagName.toLowerCase(),
      xpath,
      attributes,
      text,
      isVisible,
      isInteractive,
      isTopElement: parentId === null,
      isInViewport: isVisible,
      shadowRoot: false,
      highlightIndex: currentHighlightIndex, // For interactive elements only
      elementIndex: currentElementIndex, // For ALL elements
      viewport: viewport,
      children,
    };

    nodeMap[nodeId] = nodeData;

    return nodeId;
  }

  // Start traversal from body
  const rootId = traverseElement(document.body);

  return {
    rootId,
    map: nodeMap,
    viewport,
  };
}
