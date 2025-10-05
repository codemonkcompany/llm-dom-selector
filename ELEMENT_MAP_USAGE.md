# ElementMap Feature - Usage Guide

## Overview

The library now supports indexing **ALL elements** on the page, not just interactive ones. This includes both interactive elements (buttons, inputs, etc.) and non-interactive elements (paragraphs, headings, divs, etc.).

## Key Concepts

### Two Types of Indices

1. **`highlightIndex`** - Index for interactive elements only (existing feature)
   - Only assigned to elements that are visible AND interactive
   - Used by `selectorMap`
2. **`elementIndex`** - Index for ALL elements (new feature)
   - Assigned to every element in the DOM (both interactive and non-interactive)
   - Used by `elementMap`

### Two Types of Maps

1. **`SelectorMap`** - Contains only interactive elements
   - Key: `highlightIndex`
   - Value: `DOMElementNode` (interactive only)
2. **`ElementMap`** - Contains ALL elements
   - Key: `elementIndex`
   - Value: `DOMElementNode` (interactive + non-interactive)

## API Methods

### LLM Selection from ALL Elements

```typescript
// Select an element using LLM from ALL elements (interactive + non-interactive)
const result = await selector.selectElementFromAllElements(
  "Find the main heading on the page"
);

if (result.selectedElement) {
  console.log(`Selected: ${result.selectedElement.tagName}`);
  console.log(`Element Index: ${result.selectedElement.elementIndex}`);
  console.log(`Confidence: ${result.confidence}`);
  console.log(`Reasoning: ${result.reasoning}`);
}

// Examples of what you can select with selectElementFromAllElements:
await selector.selectElementFromAllElements("Find the main heading");
await selector.selectElementFromAllElements("Find the first paragraph");
await selector.selectElementFromAllElements("Find the logo image");
await selector.selectElementFromAllElements("Find the navigation menu");
await selector.selectElementFromAllElements("Find the submit button");
```

### Get All Elements (Interactive + Non-Interactive)

```typescript
// Get all elements as an array
const allElements = await selector.getAllElements();

// Get the element map (indexed by elementIndex)
const elementMap = await selector.getElementMap();

// Get a specific element by its elementIndex
const element = await selector.getElementByElementIndex(42);
```

### Get Only Non-Interactive Elements

```typescript
// Filter and get only non-interactive elements
const nonInteractiveElements = await selector.getNonInteractiveElements();

// These include elements like: <p>, <div>, <span>, <h1>-<h6>, etc.
```

### Get Only Interactive Elements (Existing Feature)

```typescript
// Get interactive elements as an array
const interactiveElements = await selector.getInteractiveElements();

// Get a specific interactive element by its highlightIndex
const element = await selector.getElementByIndex(5);
```

## Usage Examples

### Example 1: Get All Paragraph Elements

```typescript
import { LLMDOMSelector } from "@codemonkcompany/llm-dom-selector";

// Initialize selector...
const selector = new LLMDOMSelector(page, llm);

// Get all elements
const allElements = await selector.getAllElements();

// Filter for paragraph tags
const paragraphs = allElements.filter((el) => el.tagName === "p");

console.log(`Found ${paragraphs.length} paragraph elements`);
paragraphs.forEach((p) => {
  console.log(`[${p.elementIndex}] ${p.xpath}`);
});
```

### Example 2: Get Non-Interactive Content

```typescript
// Get all non-interactive elements
const contentElements = await selector.getNonInteractiveElements();

// Filter for headings
const headings = contentElements.filter((el) =>
  ["h1", "h2", "h3", "h4", "h5", "h6"].includes(el.tagName)
);

console.log("Page headings:");
headings.forEach((h) => {
  const text = h.getAllTextTillNextClickableElement();
  console.log(`[${h.elementIndex}] ${h.tagName.toUpperCase()}: ${text}`);
});
```

### Example 3: Access Elements by Index

```typescript
// Get element map
const elementMap = await selector.getElementMap();

// Access specific elements by index
const element0 = elementMap[0]; // First element
const element42 = elementMap[42]; // Element at index 42

// Or use the helper method
const element = await selector.getElementByElementIndex(42);

if (element) {
  console.log(`Tag: ${element.tagName}`);
  console.log(`Interactive: ${element.isInteractive}`);
  console.log(`XPath: ${element.xpath}`);
}
```

### Example 4: Analyze Page Structure

```typescript
// Get both maps
const elementMap = await selector.getElementMap();
const selectorMap = await selector.getSelectorMap();

// Count elements
const totalElements = Object.keys(elementMap).length;
const interactiveElements = Object.keys(selectorMap).length;
const nonInteractiveElements = totalElements - interactiveElements;

console.log(`Total elements: ${totalElements}`);
console.log(`Interactive: ${interactiveElements}`);
console.log(`Non-interactive: ${nonInteractiveElements}`);

// Find all images
const allElements = Object.values(elementMap);
const images = allElements.filter((el) => el.tagName === "img");
console.log(`Images found: ${images.length}`);
```

### Example 5: Access from BrowserState

```typescript
// Get browser state
const browserState = await selector.getBrowserState();

// Access both maps
const selectorMap = browserState.selectorMap; // Interactive only
const elementMap = browserState.elementMap; // ALL elements

// Access element tree (contains all elements in hierarchical structure)
const elementTree = browserState.elementTree;

// Traverse the tree
function traverseTree(node: DOMElementNode, depth: number = 0) {
  const indent = "  ".repeat(depth);
  console.log(
    `${indent}[${node.elementIndex}] ${node.tagName} (interactive: ${node.isInteractive})`
  );

  node.children.forEach((child) => {
    if (child instanceof DOMElementNode) {
      traverseTree(child, depth + 1);
    }
  });
}

traverseTree(elementTree);
```

## Element Properties

Each `DOMElementNode` now has both indices:

```typescript
interface DOMElementNode {
  tagName: string;
  xpath: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isInteractive: boolean;

  // Indices
  highlightIndex: number | null; // Only for interactive elements
  elementIndex: number | null; // For ALL elements

  // Other properties...
}
```

## Comparison: selectElement vs selectElementFromAllElements

### selectElement (Original)

- **Searches in**: Only interactive elements (buttons, inputs, links, etc.)
- **Uses**: `selectorMap` and `highlightIndex`
- **Best for**: Finding elements to click or interact with
- **Example**: "Find the submit button", "Find the search input"

```typescript
// Only searches interactive elements
const result = await selector.selectElement("Find the submit button");
// Will find: <button>, <input type="submit">, <a>, etc.
// Will NOT find: <p>, <h1>, <div>, <img> (unless they have click handlers)
```

### selectElementFromAllElements (New)

- **Searches in**: ALL elements (interactive + non-interactive)
- **Uses**: `elementMap` and `elementIndex`
- **Best for**: Finding any element on the page
- **Example**: "Find the main heading", "Find the first paragraph", "Find the logo"

```typescript
// Searches ALL elements
const result = await selector.selectElementFromAllElements(
  "Find the main heading"
);
// Will find: <h1>, <h2>, <p>, <div>, <img>, <button>, <input>, etc.
// Searches everything!
```

### When to Use Which?

**Use `selectElement`** when:

- You want to interact with an element (click, type, etc.)
- You're looking for buttons, inputs, links, etc.
- You want faster performance (smaller search space)

**Use `selectElementFromAllElements`** when:

- You need to find non-interactive elements (headings, paragraphs, images)
- You're doing content analysis or extraction
- You want to locate any element regardless of interactivity
- You're building comprehensive page understanding

## Common Use Cases

1. **Content Extraction**: Get all paragraph, heading, or text elements
2. **Page Analysis**: Count and categorize all elements on the page
3. **Structure Mapping**: Build a complete map of the page structure
4. **Data Mining**: Extract specific information from non-interactive elements
5. **Testing**: Verify presence of all elements (not just interactive ones)
6. **LLM-Based Selection**: Use natural language to find both interactive and non-interactive elements

## Notes

- `elementIndex` is assigned to **every** element during DOM traversal
- `highlightIndex` is only assigned to **visible and interactive** elements
- Both indices start at 0 and increment sequentially
- The `elementMap` will always be larger than or equal to the `selectorMap`
- Non-interactive elements include: `<p>`, `<div>`, `<span>`, `<h1>`-`<h6>`, `<img>`, `<table>`, etc.
