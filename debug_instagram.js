const { chromium } = require('/opt/node22/lib/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  await page.goto('https://www.instagram.com/coviellapropiedades_/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Get title
  const title = await page.title();
  console.error('Page title:', title);

  // Get all meta tags
  const metas = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('meta')).map(m => ({
      name: m.getAttribute('name'),
      property: m.getAttribute('property'),
      content: m.getAttribute('content')
    })).filter(m => m.content);
  });
  console.error('Meta tags:', JSON.stringify(metas.slice(0, 20), null, 2));

  // Get page text (first 2000 chars)
  const bodyText = await page.evaluate(() => document.body.innerText || document.body.textContent);
  console.error('Body text (first 1000 chars):', bodyText.substring(0, 1000));

  // Take screenshot
  await page.screenshot({ path: '/tmp/instagram_debug.png' });
  console.error('Screenshot saved to /tmp/instagram_debug.png');

  // Check URL (might have redirected)
  console.error('Current URL:', page.url());

  await browser.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
