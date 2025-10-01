import { LLMDOMSelector } from "../src/index";
import { ChatOpenAI } from "@langchain/openai";
import { chromium } from "playwright";

async function main() {
  // Initialize Playwright browser in headless mode
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Navigate to a test page
    await page.goto("https://app.dropredo.com/login");
    await page.waitForLoadState("networkidle");

    // Initialize LLM
    const llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY || "your-api-key-here",
    });

    // Create the selector with headless mode enabled (default)
    const selector = new LLMDOMSelector(page, llm, {
      browserContext: {
        highlightElements: true,
        viewportExpansion: 500,
        headless: true, // Explicitly set headless mode for better performance
      },
      llmSelector: {
        useVision: true,
        maxRetries: 3,
      },
    });

    console.log("🔍 Getting browser state...");
    const state = await selector.getBrowserState();
    console.log(
      `Found ${Object.keys(state.selectorMap).length} interactive elements`
    );

    // Example 1: Select an element by description
    console.log("\n🎯 Selecting element by description...");
    const result = await selector.selectElement(
      "fill email input field with 'test@test.com'"
    );

    if (result.selectedElement) {
      console.log("✅ Selected element:", result.reasoning);
      console.log("Confidence:", result.confidence);
      console.log("Element:", result.selectedElement.toString());
    } else {
      console.log("❌ No element found:", result.reasoning);
    }

    // Example 2: Get all interactive elements
    console.log("\n📋 All interactive elements:");
    const elements = await selector.getInteractiveElements();
    elements.forEach((element, index) => {
      console.log(
        `[${element.highlightIndex}] ${
          element.tagName
        }: ${element.getAllTextTillNextClickableElement()}`
      );
    });

    // Example 3: Error handling
    console.log("\n⚠️ Testing error handling...");
    const errorResult = await selector.selectElement(
      "non-existent element with very specific name"
    );
    if (!errorResult.selectedElement) {
      console.log("Expected error:", errorResult.reasoning);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}
