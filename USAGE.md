# Usage Guide

This guide provides detailed examples of how to use the LLM DOM Selector library.

> **Note**: This library is extracted from the [browser-use-typescript](https://github.com/browser-use/browser-use-typescript) project and uses the exact same method names and implementations. All functionality matches the original project up to point 8 (element location).

## Basic Setup

### 1. Install Dependencies

```bash
npm install llm-dom-selector playwright @langchain/openai
```

### 2. Install Playwright Browsers

```bash
npx playwright install chromium
```

### 3. Set Environment Variables

```bash
export OPENAI_API_KEY="your-openai-api-key"
```

## Basic Examples

### Simple Element Selection

```typescript
import { LLMDOMSelector } from "llm-dom-selector";
import { ChatOpenAI } from "@langchain/openai";
import { chromium } from "playwright";

async function basicExample() {
  // Launch browser in headless mode for better performance
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://example.com");

  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const selector = new LLMDOMSelector(page, llm);

  // Select an element
  const result = await selector.selectElement("the main heading");
  console.log("Selected:", result.reasoning);
}
```

### Form Interaction

```typescript
async function formExample() {
  const selector = new LLMDOMSelector(page, llm);

  // Fill out a form
  await selector.selectAndInputText("email input field", "user@example.com");
  await selector.selectAndInputText("password input field", "password123");
  await selector.selectAndClick("submit button");
}
```

### Navigation

```typescript
async function navigationExample() {
  const selector = new LLMDOMSelector(page, llm);

  // Navigate through a site
  await selector.selectAndClick("login link");
  await page.waitForLoadState("networkidle");
  await selector.refreshState(); // Refresh after page change

  await selector.selectAndInputText("username field", "myusername");
  await selector.selectAndClick("continue button");
}
```

## Advanced Configuration

### Custom LLM Settings

```typescript
const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.1, // Lower temperature for more consistent results
  maxTokens: 1000,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const selector = new LLMDOMSelector(page, llm, {
  llmSelector: {
    includeAttributes: ["title", "aria-label", "data-testid", "placeholder"],
    useVision: true, // Enable screenshot analysis
    maxRetries: 5,
  },
});
```

### Custom Browser Settings

```typescript
const selector = new LLMDOMSelector(page, llm, {
  browserContext: {
    highlightElements: true, // Show visual highlights
    viewportExpansion: 1000, // Expand viewport for more elements
    includeDynamicAttributes: true, // Include dynamic attributes
    waitBetweenActions: 1.0, // Wait 1 second between actions
  },
});
```

## Error Handling

### Robust Error Handling

```typescript
async function robustSelection() {
  try {
    const result = await selector.selectElement("submit button");

    if (!result.selectedElement) {
      console.log("No element found:", result.reasoning);
      return;
    }

    if (result.confidence < 0.7) {
      console.warn("Low confidence selection:", result.reasoning);
      // Maybe try a different description
      const retryResult = await selector.selectElement(
        "the button that says Submit"
      );
      if (retryResult.confidence > result.confidence) {
        await selector.clickElementByIndex(retryResult.selectedIndex!);
      } else {
        await selector.clickElementByIndex(result.selectedIndex!);
      }
    } else {
      await selector.clickElementByIndex(result.selectedIndex!);
    }
  } catch (error) {
    console.error("Selection failed:", error);
  }
}
```

### Retry Logic

```typescript
async function retrySelection(description: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await selector.selectElement(description);
      if (result.selectedElement) {
        return result;
      }
    } catch (error) {
      console.warn(`Attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
    }
  }
  throw new Error("Max retries exceeded");
}
```

## Working with Dynamic Content

### Wait for Content

```typescript
async function dynamicContentExample() {
  // Wait for specific content to load
  await page.waitForSelector('button[data-testid="submit"]', {
    timeout: 10000,
  });
  await page.waitForLoadState("networkidle");

  // Refresh the selector state after content loads
  await selector.refreshState();

  const result = await selector.selectElement("the submit button");
  // ... rest of the code
}
```

### Handle Loading States

```typescript
async function handleLoading() {
  // Wait for loading to complete
  await page.waitForFunction(() => {
    const loader = document.querySelector(".loading");
    return !loader || loader.style.display === "none";
  });

  await selector.refreshState();
  const result = await selector.selectElement("the form");
}
```

## Best Practices

### 1. Use Specific Descriptions

```typescript
// Good - specific and clear
await selector.selectElement("the login button in the header");
await selector.selectElement('input field with placeholder "Enter email"');

// Avoid - too vague
await selector.selectElement("button");
await selector.selectElement("input");
```

### 2. Handle Multiple Similar Elements

```typescript
// If there are multiple buttons, be specific
await selector.selectElement("the first submit button");
await selector.selectElement("the cancel button");
await selector.selectElement('the button with text "Save Changes"');
```

### 3. Use Context

```typescript
// Use context to disambiguate
await selector.selectElement("the submit button in the login form");
await selector.selectElement("the search input in the navigation bar");
```

### 4. Check Confidence Scores

```typescript
const result = await selector.selectElement("submit button");
if (result.confidence < 0.8) {
  console.warn("Low confidence selection, consider being more specific");
}
```

### 5. Refresh State After Page Changes

```typescript
// Always refresh after navigation or dynamic content changes
await page.goto("https://example.com/page2");
await selector.refreshState();

// Or after clicking elements that cause page changes
await selector.selectAndClick("next page button");
await selector.refreshState();
```

## Debugging

### Enable Debugging

```typescript
const selector = new LLMDOMSelector(page, llm, {
  browserContext: {
    highlightElements: true, // This will show visual highlights
  },
});

// Get all available elements
const elements = await selector.getInteractiveElements();
console.log("Available elements:");
elements.forEach((element, index) => {
  console.log(
    `[${element.highlightIndex}] ${
      element.tagName
    }: ${element.getAllTextTillNextClickableElement()}`
  );
});
```

### Log Selection Results

```typescript
const result = await selector.selectElement("submit button");
console.log("Selection result:", {
  selected: !!result.selectedElement,
  index: result.selectedIndex,
  confidence: result.confidence,
  reasoning: result.reasoning,
});
```

## Performance Tips

### 1. Reuse Selector Instances

```typescript
// Good - reuse the same selector
const selector = new LLMDOMSelector(page, llm);
await selector.selectElement("button1");
await selector.selectElement("button2");

// Avoid - creating new instances
const selector1 = new LLMDOMSelector(page, llm);
const selector2 = new LLMDOMSelector(page, llm);
```

### 2. Batch Operations

```typescript
// Good - batch related operations
await selector.selectAndInputText("username", "user");
await selector.selectAndInputText("password", "pass");
await selector.selectAndClick("submit");

// Avoid - refreshing state between each operation
```

### 3. Use Appropriate Wait Times

```typescript
const selector = new LLMDOMSelector(page, llm, {
  browserContext: {
    waitBetweenActions: 0.5, // Adjust based on your needs
  },
});
```

This guide should help you get started with the LLM DOM Selector library. For more examples, check the `example/` directory in the repository.
