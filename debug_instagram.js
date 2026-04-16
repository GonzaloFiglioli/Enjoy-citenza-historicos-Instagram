const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    locale: 'es-AR',
  });

  const page = await context.newPage();
  await page.goto('https://www.instagram.com/coviellapropiedades_/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const url = page.url();
  const meta = await page.$eval('meta[name="description"]', el => el.getAttribute('content')).catch(() => 'NO META');
  const bodyText = await page.$eval('body', el => el.innerText.slice(0, 2000)).catch(() => 'NO BODY');

  console.log('=== TITLE ===');
  console.log(title);
  console.log('=== URL ===');
  console.log(url);
  console.log('=== META DESCRIPTION ===');
  console.log(meta);
  console.log('=== BODY TEXT (first 2000 chars) ===');
  console.log(bodyText);

  // Also check for login indicators
  const html = await page.content();
  console.log('=== LOGIN WALL CHECK ===');
  console.log('Has "Log in":', html.includes('Log in'));
  console.log('Has "Inicia sesión":', html.includes('Inicia sesión'));
  console.log('Has "edge_followed_by":', html.includes('edge_followed_by'));
  console.log('Has "followers":', html.includes('followers'));
  console.log('Has "seguidores":', html.includes('seguidores'));

  // Save full HTML for inspection
  const fs = require('fs');
  fs.writeFileSync('/tmp/instagram_debug.html', html);
  console.log('=== Full HTML saved to /tmp/instagram_debug.html ===');

  await browser.close();
})();
