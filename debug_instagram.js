const { chromium } = require('/opt/node22/lib/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto('https://www.instagram.com/coviellapropiedades_/', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  const title = await page.title();
  const url = page.url();
  const content = await page.content();

  console.log('Title:', title);
  console.log('URL:', url);
  console.log('Content length:', content.length);

  // Check for meta tags
  const meta = await page.evaluate(() => {
    const metas = Array.from(document.querySelectorAll('meta')).map(m => ({
      name: m.name || m.getAttribute('property'),
      content: m.content,
    }));
    return metas.filter(m => m.name && m.content && m.content.length < 500);
  });
  console.log('Meta tags:', JSON.stringify(meta, null, 2));

  // Check for JSON-LD
  const jsonld = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    return scripts.map(s => s.textContent);
  });
  console.log('JSON-LD:', jsonld);

  // Dump first 3000 chars of body text
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log('Body text:', bodyText);

  await browser.close();
}

main().catch(console.error);
