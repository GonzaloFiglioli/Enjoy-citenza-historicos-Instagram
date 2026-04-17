const { chromium } = require('/opt/node22/lib/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  await page.goto('https://www.instagram.com/coviellapropiedades_/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(5000);

  const title = await page.title();
  const url = page.url();
  const metaDesc = await page.$eval('meta[name="description"]', el => el.getAttribute('content')).catch(() => 'NO META');

  // Get all text content from headers/sections
  const bodyText = await page.evaluate(() => {
    return document.body.innerText.substring(0, 3000);
  });

  console.log('TITLE:', title);
  console.log('URL:', url);
  console.log('META:', metaDesc);
  console.log('BODY SNIPPET:', bodyText);

  // Try header stats
  const headerHtml = await page.$eval('header', el => el.innerHTML.substring(0, 2000)).catch(() => 'NO HEADER');
  console.log('HEADER:', headerHtml);

  await browser.close();
})();
