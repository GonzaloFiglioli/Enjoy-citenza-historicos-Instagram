const { chromium } = require('/opt/node22/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
    ],
    ignoreHTTPSErrors: true,
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  await page.goto('https://www.instagram.com/coviellapropiedades_/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log('Title:', title);

  const url = page.url();
  console.log('Current URL:', url);

  const content = await page.content();
  // Print first 3000 chars
  console.log('\nHTML snippet:\n', content.substring(0, 3000));

  // Check for meta tags
  const metas = await page.$$eval('meta', metas => metas.map(m => ({
    name: m.getAttribute('name'),
    property: m.getAttribute('property'),
    content: m.getAttribute('content'),
  })));
  console.log('\nMeta tags:', JSON.stringify(metas.filter(m => m.name || m.property).slice(0, 20), null, 2));

  await browser.close();
})();
