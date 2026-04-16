const { chromium } = require('playwright');

const clients = [
  { name: 'Coviella Propiedades',         handle: '@coviellapropiedades_',         url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante',       handle: '@inmobiliaria.bustamante',       url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades',      handle: '@juanbarrozopropiedades',        url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades',   handle: '@germanberrettipropiedades',     url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades',            handle: '@masonepropiedades',             url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces',     handle: '@diegomurgobienesraices',        url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural',                   handle: '@siclorural',                    url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi',              handle: '@alejandroparisi66',             url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music',                   handle: '@latammusicargentina',           url: 'https://www.instagram.com/latammusicargentina/' },
];

function parseCount(str) {
  if (!str) return 0;
  str = str.trim().replace(/\./g, '').replace(/,/g, '');
  if (/k$/i.test(str)) return Math.round(parseFloat(str) * 1000);
  if (/m$/i.test(str)) return Math.round(parseFloat(str) * 1000000);
  const n = parseInt(str.replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

async function scrapeProfile(page, client) {
  try {
    console.error(`Navegando a: ${client.url}`);
    await page.goto(client.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    const html = await page.content();

    // Detect login wall or private account
    const isLoginWall = html.includes('Log in to Instagram') || html.includes('Inicia sesión en Instagram');
    const isPrivate = html.includes('"is_private":true') || html.includes('Esta cuenta es privada') || html.includes('This Account is Private');

    if (isLoginWall) {
      console.error(`  -> Login wall detectado para ${client.name}`);
      return { ...client, posts: 0, followers: 0, following: 0, error: 'login_wall' };
    }

    // Try to extract from meta tags or structured data first
    // Instagram embeds data in a <script type="application/ld+json"> or window._sharedData
    let posts = 0, followers = 0, following = 0;
    let found = false;

    // Method 1: Extract from <meta> description tag
    const metaDescription = await page.$eval('meta[name="description"]', el => el.getAttribute('content')).catch(() => null);
    if (metaDescription) {
      console.error(`  -> Meta description: ${metaDescription}`);
      // Format: "X Followers, X Following, X Posts - See Instagram photos and videos from ..."
      const followersMatch = metaDescription.match(/([\d,.]+[KkMm]?)\s+Followers?/i) ||
                             metaDescription.match(/([\d,.]+[KkMm]?)\s+seguidores?/i);
      const followingMatch = metaDescription.match(/([\d,.]+[KkMm]?)\s+Following/i) ||
                             metaDescription.match(/([\d,.]+[KkMm]?)\s+seguidos?/i);
      const postsMatch     = metaDescription.match(/([\d,.]+[KkMm]?)\s+Posts?/i) ||
                             metaDescription.match(/([\d,.]+[KkMm]?)\s+publicaciones?/i);
      if (followersMatch) { followers = parseCount(followersMatch[1]); found = true; }
      if (followingMatch) { following = parseCount(followingMatch[1]); found = true; }
      if (postsMatch)     { posts = parseCount(postsMatch[1]); found = true; }
    }

    // Method 2: Extract from page header counters (ul > li structure)
    if (!found || (posts === 0 && followers === 0 && following === 0)) {
      const stats = await page.$$eval('header section ul li', items =>
        items.map(li => {
          const spans = li.querySelectorAll('span');
          const texts = Array.from(spans).map(s => s.textContent.trim());
          return texts;
        })
      ).catch(() => []);

      console.error(`  -> Stats from header ul: ${JSON.stringify(stats)}`);

      if (stats.length >= 3) {
        posts     = parseCount(stats[0][0] || stats[0][1] || '0');
        followers = parseCount(stats[1][0] || stats[1][1] || '0');
        following = parseCount(stats[2][0] || stats[2][1] || '0');
        found = true;
      }
    }

    // Method 3: Try JSON-LD or window.__additionalDataLoaded patterns in script tags
    if (!found || (posts === 0 && followers === 0 && following === 0)) {
      const scripts = await page.$$eval('script', els => els.map(s => s.textContent).filter(t => t && t.length > 100));
      for (const script of scripts) {
        // edge_followed_by count
        const followersMatch = script.match(/"edge_followed_by":\{"count":(\d+)\}/);
        const followingMatch = script.match(/"edge_follow":\{"count":(\d+)\}/);
        const postsMatch     = script.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);
        if (followersMatch) { followers = parseInt(followersMatch[1], 10); found = true; }
        if (followingMatch) { following = parseInt(followingMatch[1], 10); found = true; }
        if (postsMatch)     { posts = parseInt(postsMatch[1], 10); found = true; }
        if (found && (posts > 0 || followers > 0)) break;
      }
    }

    console.error(`  -> Resultado: posts=${posts}, followers=${followers}, following=${following}, private=${isPrivate}`);
    return {
      ...client,
      posts,
      followers,
      following,
      error: isPrivate ? 'private' : null,
    };
  } catch (err) {
    console.error(`  -> ERROR en ${client.name}: ${err.message}`);
    return { ...client, posts: 0, followers: 0, following: 0, error: err.message };
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-AR',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  // Block images and fonts to speed up
  await context.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf}', route => route.abort());

  const page = await context.newPage();
  const results = [];

  for (const client of clients) {
    const result = await scrapeProfile(page, client);
    results.push(result);
    await page.waitForTimeout(2000); // polite delay between requests
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
