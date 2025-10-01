# LLM DOM Selector

A powerful TypeScript library that uses Large Language Models (LLMs) to intelligently select DOM elements from web pages using Playwright. This library extracts the core functionality from the browser-use-typescript project, focusing specifically on LLM-based element selection and interaction.

## Features

- **🤖 LLM-Powered Selection**: Use natural language descriptions to select DOM elements
- **🎯 Smart Element Detection**: Automatically identifies interactive elements on web pages
- **👁️ Visual Context**: Supports both text and visual (screenshot) context for better selection
- **🔍 Advanced Element Location**: Handles iframes, shadow DOM, and complex page structures
- **⚡ TypeScript Support**: Full type safety and IntelliSense support
- **🎨 Element Highlighting**: Visual highlighting of selectable elements
- **🔄 Flexible Configuration**: Customizable attributes, retry logic, and selection criteria
- **✅ Original Implementation**: All methods and interfaces exactly match the browser-use-typescript project

## Installation

```bash
npm install llm-dom-selector
```

## Quick Start

```typescript
import { LLMDOMSelector } from "llm-dom-selector";
import { ChatOpenAI } from "@langchain/openai";
import { chromium } from "playwright";

async function example() {
  // Initialize Playwright browser
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://example.com");

  // Initialize LLM
  const llm = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
    openAIApiKey: "your-api-key",
  });

  // Create the selector
  const selector = new LLMDOMSelector(page, llm);

  // Select an element using natural language
  const result = await selector.selectElement("the submit button");

  if (result.selectedElement) {
    console.log("Selected element:", result.reasoning);
    console.log("Confidence:", result.confidence);

    // Click the selected element
    await selector.clickElementByIndex(result.selectedIndex!);
  }

  await browser.close();
}
```

## Core Concepts

### 1. DOM Element Extraction

The library automatically extracts all interactive elements from a web page and assigns them numeric indices for easy reference.

```typescript
// Get all interactive elements
const elements = await selector.getInteractiveElements();
console.log(`Found ${elements.length} interactive elements`);

// Get a specific element by index
const element = await selector.getElementByIndex(5);
console.log("Element:", element?.toString());
```

### 2. LLM-Based Selection

Use natural language descriptions to select elements:

```typescript
// Select by description
const result = await selector.selectElement("the login button");
const result2 = await selector.selectElement("input field for email address");
const result3 = await selector.selectElement(
  "the first link in the navigation menu"
);
```

### 3. Element Interaction

Once you have selected an element, you can interact with it:

```typescript
// Click an element
await selector.clickElementByIndex(selectedIndex);

// Input text to an element
await selector.inputTextToElementByIndex(selectedIndex, "hello@example.com");

// Or use the combined methods
await selector.selectAndClick("the submit button");
await selector.selectAndInputText("email input", "user@example.com");
```

## API Reference

### LLMDOMSelector

Main class that combines all functionality.

#### Constructor

```typescript
constructor(
  page: Page,
  llm: BaseChatModel,
  config?: LLMDOMSelectorConfig
)
```

#### Methods

##### `getBrowserState(): Promise<BrowserState>`

Get the current browser state with all interactive elements.

##### `selectElement(prompt: string): Promise<ElementSelectionResult>`

Select an element using LLM based on a text description.

##### `getElementByIndex(index: number): Promise<DOMElementNode | null>`

Get a specific element by its index.

##### `getInteractiveElements(): Promise<DOMElementNode[]>`

Get all available interactive elements.

##### `clickElementByIndex(index: number): Promise<void>`

Click an element by its index. Uses the original `_click_element_node()` method.

##### `inputTextToElementByIndex(index: number, text: string): Promise<void>`

Input text to an element by its index. Uses the original `_input_text_element_node()` method.

##### `selectAndClick(prompt: string): Promise<ElementSelectionResult>`

Select and click an element using LLM.

##### `selectAndInputText(prompt: string, text: string): Promise<ElementSelectionResult>`

Select and input text to an element using LLM.

##### `refreshState(): Promise<BrowserState>`

Refresh the browser state (useful after page changes).

##### `removeHighlights(): Promise<void>`

Remove element highlights from the page.

### Configuration

#### LLMDOMSelectorConfig

```typescript
interface LLMDOMSelectorConfig {
  browserContext?: Partial<BrowserState>;
  llmSelector?: Partial<{
    includeAttributes: string[];
    useVision: boolean;
    maxRetries: number;
  }>;
}
```

#### BrowserContextConfig

```typescript
interface BrowserContextConfig {
  highlightElements: boolean; // Enable visual highlighting
  viewportExpansion: number; // Pixels to expand viewport
  includeDynamicAttributes: boolean; // Include dynamic attributes
  waitBetweenActions: number; // Wait time between actions
}
```

## Advanced Usage

### Custom LLM Configuration

```typescript
import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.1,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

const selector = new LLMDOMSelector(page, llm, {
  llmSelector: {
    includeAttributes: ["title", "aria-label", "data-testid"],
    useVision: true,
    maxRetries: 5,
  },
});
```

### Custom Browser Configuration

```typescript
const selector = new LLMDOMSelector(page, llm, {
  browserContext: {
    highlightElements: true,
    viewportExpansion: 1000,
    includeDynamicAttributes: true,
    waitBetweenActions: 1.0,
  },
});
```

### Working with Complex Pages

```typescript
// Handle dynamic content
await page.waitForLoadState("networkidle");
await selector.refreshState();

// Select elements in specific contexts
const result = await selector.selectElement(
  "the submit button in the login form"
);
const result2 = await selector.selectElement(
  "the first item in the dropdown menu"
);

// Handle multiple selections
const loginButton = await selector.selectElement("login button");
const passwordField = await selector.selectElement("password input");

if (loginButton.selectedElement && passwordField.selectedElement) {
  await selector.inputTextToElementByIndex(
    passwordField.selectedIndex!,
    "password123"
  );
  await selector.clickElementByIndex(loginButton.selectedIndex!);
}
```

### Error Handling

```typescript
try {
  const result = await selector.selectElement("the submit button");

  if (!result.selectedElement) {
    console.log("No element found:", result.reasoning);
    return;
  }

  if (result.confidence < 0.7) {
    console.warn("Low confidence selection:", result.reasoning);
  }

  await selector.clickElementByIndex(result.selectedIndex!);
} catch (error) {
  console.error("Selection failed:", error);
}
```

## Element Selection Examples

The library can understand various types of element descriptions:

```typescript
// By text content
await selector.selectElement("Submit");
await selector.selectElement("Login");
await selector.selectElement("Cancel");

// By element type and context
await selector.selectElement("the submit button");
await selector.selectElement("the email input field");
await selector.selectElement("the first link in the navigation");

// By attributes
await selector.selectElement('button with id "submit-btn"');
await selector.selectElement('input with placeholder "Enter email"');
await selector.selectElement('link with href "/login"');

// By position
await selector.selectElement("the first button");
await selector.selectElement("the last input field");
await selector.selectElement("the second link");

// By visual context (when useVision is enabled)
await selector.selectElement("the red button at the top");
await selector.selectElement("the large blue submit button");
```

## Supported LLM Providers

The library works with any LLM that implements the `BaseChatModel` interface from LangChain:

- OpenAI (GPT-3.5, GPT-4, GPT-4o)
- Anthropic (Claude)
- Google (Gemini)
- Azure OpenAI
- Local models via Ollama
- And many more...

## Browser Support

- Chromium (recommended)
- Firefox
- WebKit

## TypeScript Support

The library is written in TypeScript and provides full type definitions:

```typescript
import {
  LLMDOMSelector,
  ElementSelectionResult,
  BrowserState,
  DOMElementNode,
} from "llm-dom-selector";
```

## Implementation Details

This library is extracted from the [browser-use-typescript](https://github.com/browser-use/browser-use-typescript) project and includes only the functionality up to point 8 (element location). All method names, interfaces, and implementations exactly match the original project:

- **BrowserContext**: Uses original `get_locate_element()`, `_click_element_node()`, `_input_text_element_node()` methods
- **DOM Service**: Extracts DOM using the original `buildDomTreeOverlay()` function
- **System Prompt**: Uses the original system prompt format from `system_prompt.md`
- **Message Formatting**: Matches the original `AgentMessagePrompt` structure
- **Element Selection**: Implements the same LLM-based selection logic

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

This project is based on the excellent work done in the [browser-use-typescript](https://github.com/yourusername/browser-use-typescript) project, specifically extracting the DOM selection and LLM integration functionality.

## Changelog

### 1.0.0

- Initial release
- LLM-based element selection
- Playwright integration
- TypeScript support
- Visual element highlighting
- Comprehensive API

## Support

- [GitHub Issues](https://github.com/yourusername/llm-dom-selector/issues)
- [Documentation](https://github.com/yourusername/llm-dom-selector#readme)
- [Discussions](https://github.com/yourusername/llm-dom-selector/discussions)
