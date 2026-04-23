const { chromium } = require('playwright');

const clients = [
  { name: 'Coviella Propiedades',         handle: '@coviellapropiedades_',    url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante',       handle: '@inmobiliaria.bustamante', url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades',      handle: '@juanbarrozopropiedades',  url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades',   handle: '@germanberrettipropiedades',url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades',            handle: '@masonepropiedades',       url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces',     handle: '@diegomurgobienesraices',  url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural',                   handle: '@siclorural',              url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi',              handle: '@alejandroparisi66',       url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music',                   handle: '@latammusicargentina',     url: 'https://www.instagram.com/latammusicargentina/' },
];

function parseCount(text) {
  if (!text) return 0;
  // Remove commas and spaces
  text = text.trim().replace(/,/g, '').replace(/\./g, '').replace(/\s/g, '');
  // Handle K/M/B suffixes
  const lower = text.toLowerCase();
  if (lower.endsWith('k')) return Math.round(parseFloat(lower) * 1000);
  if (lower.endsWith('m')) return Math.round(parseFloat(lower) * 1000000);
  if (lower.endsWith('b')) return Math.round(parseFloat(lower) * 1000000000);
  const num = parseInt(text, 10);
  return isNaN(num) ? 0 : num;
}

async function scrapeProfile(page, client) {
  const result = {
    name: client.name,
    handle: client.handle,
    posts: 0,
    followers: 0,
    following: 0,
    error: null,
  };

  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check for login wall or private account
    const pageText = await page.textContent('body').catch(() => '');

    // Try to extract stats from meta description (most reliable without login)
    const metaDesc = await page.$eval('meta[name="description"]', el => el.getAttribute('content')).catch(() => null);

    if (metaDesc) {
      console.error(`[${client.name}] meta description: ${metaDesc}`);
      // Format: "X Followers, Y Following, Z Posts"
      const followersMatch = metaDesc.match(/([\d,\.]+[KMBkmb]?)\s*Followers/i);
      const followingMatch = metaDesc.match(/([\d,\.]+[KMBkmb]?)\s*Following/i);
      const postsMatch    = metaDesc.match(/([\d,\.]+[KMBkmb]?)\s*Posts/i);

      if (followersMatch) result.followers = parseCount(followersMatch[1]);
      if (followingMatch) result.following  = parseCount(followingMatch[1]);
      if (postsMatch)     result.posts      = parseCount(postsMatch[1]);

      if (result.followers > 0 || result.posts > 0) {
        return result;
      }
    }

    // Fallback: look for the stats list in the DOM
    // Instagram renders stats in <li> elements with spans
    const stats = await page.$$eval('ul li', items =>
      items.map(li => li.innerText.trim())
    ).catch(() => []);

    console.error(`[${client.name}] stats from DOM li:`, JSON.stringify(stats));

    for (const stat of stats) {
      const num = stat.replace(/[^0-9KkMmBb,.]/g, '');
      const lower = stat.toLowerCase();
      if (lower.includes('publicacion') || lower.includes('post')) {
        result.posts = parseCount(num);
      } else if (lower.includes('seguidor') || lower.includes('follower')) {
        result.followers = parseCount(num);
      } else if (lower.includes('seguido') || lower.includes('following')) {
        result.following = parseCount(num);
      }
    }

    // Try aria-label on links
    if (result.followers === 0) {
      const ariaStats = await page.$$eval('a[href*="/followers/"], a[href*="/following/"]', els =>
        els.map(el => ({ href: el.href, text: el.innerText.trim(), title: el.title, aria: el.getAttribute('aria-label') }))
      ).catch(() => []);
      console.error(`[${client.name}] aria stats:`, JSON.stringify(ariaStats));
    }

    // Try script tags for shared data
    if (result.followers === 0) {
      const scripts = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent)).catch(() => []);
      for (const s of scripts) {
        try {
          const data = JSON.parse(s);
          if (data.mainEntityofPage || data['@type'] === 'ProfilePage') {
            console.error(`[${client.name}] ld+json:`, JSON.stringify(data).substring(0, 300));
          }
        } catch (_) {}
      }
    }

    if (result.followers === 0 && result.posts === 0) {
      // Check if login wall
      if (pageText.includes('Log in') || pageText.includes('Iniciar sesión') || pageText.includes('See photos and videos')) {
        result.error = 'Login wall - datos no disponibles sin sesión';
      } else if (pageText.includes('private') || pageText.includes('privada')) {
        result.error = 'Cuenta privada';
      } else {
        result.error = 'No se pudieron extraer los datos';
      }
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-AR',
    extraHTTPHeaders: {
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  const page = await context.newPage();

  const results = [];
  for (const client of clients) {
    console.error(`\nScraping: ${client.name} (${client.url})`);
    const result = await scrapeProfile(page, client);
    results.push(result);
    console.error(`  => posts=${result.posts}, followers=${result.followers}, following=${result.following}${result.error ? ', ERROR: ' + result.error : ''}`);
    // Small delay between requests
    await page.waitForTimeout(2000);
  }

  await browser.close();
  // Output JSON to stdout
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
