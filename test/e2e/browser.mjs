// Opens a page in Chromium and waits until an element holds every expected text.
// Usage: node browser.mjs <url> <selector> <expected text>...
// Run from a folder where `playwright` is installed (the CI installs it on the side).
import { chromium } from "playwright";

const [url, selector, ...expected] = process.argv.slice(2);
if (!url || !selector || expected.length === 0) {
  console.error("Usage: node browser.mjs <url> <selector> <expected text>...");
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(
    ([sel, texts]) => {
      const text = document.querySelector(sel)?.textContent ?? "";
      return texts.every((t) => text.includes(t));
    },
    [selector, expected],
    { timeout: 15_000 },
  );
  console.log(`${url}: ${selector} shows ${expected.map((t) => JSON.stringify(t)).join(", ")}`);
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  const text = page ? await page.locator("body").innerText().catch(() => "") : "";
  console.error(`${url}: ${selector} never showed ${JSON.stringify(expected)}\npage text: ${JSON.stringify(text)}\n${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
