const { chromium } = require('playwright');

const clients = [
  { name: 'Coviella Propiedades', handle: '@coviellapropiedades_', url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante', handle: '@inmobiliaria.bustamante', url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades', handle: '@juanbarrozopropiedades', url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades', handle: '@germanberrettipropiedades', url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades', handle: '@masonepropiedades', url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces', handle: '@diegomurgobienesraices', url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural', handle: '@siclorural', url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi', handle: '@alejandroparisi66', url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music', handle: '@latammusicargentina', url: 'https://www.instagram.com/latammusicargentina/' },
];

function parseCount(str) {
  if (!str) return 0;
  str = str.trim().replace(/\s/g, '');
  const lower = str.toLowerCase();
  if (lower.endsWith('m')) return Math.round(parseFloat(str) * 1000000);
  if (lower.endsWith('k')) return Math.round(parseFloat(str) * 1000);
  const cleaned = str.replace(/\./g, '').replace(/,/g, '');
  return parseInt(cleaned, 10) || 0;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  const results = [];

  for (const client of clients) {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'es-AR',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    try {
      process.stderr.write(`[SCRAPING] ${client.name} ...\n`);
      await page.goto(client.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      let posts = 0, followers = 0, following = 0;
      let method = 'none';

      // Method 1: meta description (most reliable, works without login)
      const metaDesc = await page.getAttribute('meta[name="description"]', 'content').catch(() => null);
      process.stderr.write(`[META] ${client.name}: ${metaDesc}\n`);

      if (metaDesc) {
        const followersMatch = metaDesc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowers?/);
        const followingMatch = metaDesc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowing/);
        const postsMatch    = metaDesc.match(/([\d,\.]+[KkMm]?)\s*[Pp]osts?/);
        if (followersMatch || followingMatch || postsMatch) {
          followers = followersMatch ? parseCount(followersMatch[1]) : 0;
          following = followingMatch ? parseCount(followingMatch[1]) : 0;
          posts     = postsMatch     ? parseCount(postsMatch[1])     : 0;
          method = 'meta';
        }
      }

      // Method 2: Scan for JSON data embedded in page
      if (method === 'none') {
        const html = await page.content();
        const fbMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
        const ffMatch = html.match(/"edge_follow":\{"count":(\d+)\}/);
        const fpMatch = html.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);
        if (fbMatch || ffMatch) {
          followers = fbMatch ? parseInt(fbMatch[1]) : 0;
          following = ffMatch ? parseInt(ffMatch[1]) : 0;
          posts     = fpMatch ? parseInt(fpMatch[1]) : 0;
          method = 'json';
        }
      }

      // Method 3: visible stat list items
      if (method === 'none') {
        const listItems = await page.$$eval('header section ul li', els =>
          els.map(el => el.innerText.trim())
        ).catch(() => []);
        process.stderr.write(`[LIST] ${client.name}: ${JSON.stringify(listItems)}\n`);
        if (listItems.length >= 3) {
          const nums = listItems.map(t => {
            const m = t.match(/([\d,\.]+[KkMm]?)/);
            return m ? m[1] : '0';
          });
          posts     = parseCount(nums[0] || '0');
          followers = parseCount(nums[1] || '0');
          following = parseCount(nums[2] || '0');
          method = 'list';
        }
      }

      results.push({ name: client.name, handle: client.handle, posts, followers, following, status: method === 'none' ? 'no_data' : 'ok', method });
      process.stderr.write(`[OK] ${client.name}: posts=${posts} followers=${followers} following=${following} method=${method}\n`);

    } catch (err) {
      process.stderr.write(`[ERROR] ${client.name}: ${err.message}\n`);
      results.push({ name: client.name, handle: client.handle, posts: 0, followers: 0, following: 0, status: 'error', error: err.message });
    } finally {
      await context.close();
    }
  }

  await browser.close();
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  process.stdout.write('DONE\n');
})();
