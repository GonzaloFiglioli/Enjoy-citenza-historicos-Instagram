const { chromium } = require('/opt/node22/lib/node_modules/playwright');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  await page.goto('https://www.instagram.com/coviellapropiedades_/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForTimeout(5000);

  const title = await page.title();
  const url = page.url();
  const content = await page.content();

  console.log('URL:', url);
  console.log('Title:', title);
  console.log('Content length:', content.length);
  console.log('\n--- First 3000 chars of content ---');
  console.log(content.substring(0, 3000));
  console.log('\n--- Meta tags ---');
  const metas = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('meta')).map(m => ({
      name: m.getAttribute('name'),
      property: m.getAttribute('property'),
      content: m.getAttribute('content'),
    })).filter(m => m.content);
  });
  console.log(JSON.stringify(metas, null, 2));

  await browser.close();
}

main().catch(console.error);
