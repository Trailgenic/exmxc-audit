import { chromium } from "playwright";

export async function fetchPage(url: string) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000
    });

    // Extract raw HTML
    const html = await page.content();

    // Extract minimal metadata for diagnostics + signals
    const metadata = await page.evaluate(() => {
      const title = document.querySelector("title")?.innerText || null;
      const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href") || null;

      const descEl =
        document.querySelector("meta[name='description']") ||
        document.querySelector("meta[property='og:description']");

      const description = descEl?.getAttribute("content") || null;

      return {
        title,
        canonical,
        description
      };
    });

    return {
      html,
      metadata
    };

  } catch (err) {
    console.error(`fetchPage error for ${url}:`, err);

    return {
      html: "",
      metadata: {
        error: String(err)
      }
    };

  } finally {
    await browser.close();
  }
}
