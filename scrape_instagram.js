const { chromium } = require('playwright');

const clients = [
  { name: 'Coviella Propiedades',       handle: '@coviellapropiedades_',      url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante',    handle: '@inmobiliaria.bustamante',    url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades',   handle: '@juanbarrozopropiedades',     url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades',handle: '@germanberrettipropiedades',  url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades',         handle: '@masonepropiedades',          url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces',  handle: '@diegomurgobienesraices',     url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural',                handle: '@siclorural',                 url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi',           handle: '@alejandroparisi66',          url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music',               handle: '@latammusicargentina',         url: 'https://www.instagram.com/latammusicargentina/' },
];

function parseCount(str) {
  if (!str) return 0;
  str = str.trim().replace(/,/g, '').replace(/\./g, '');
  if (/K$/i.test(str)) return Math.round(parseFloat(str) * 1000);
  if (/M$/i.test(str)) return Math.round(parseFloat(str) * 1000000);
  const n = parseInt(str, 10);
  return isNaN(n) ? 0 : n;
}

async function scrapeProfile(page, client) {
  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Try meta description first (works without login)
    const metaDesc = await page.$eval(
      'meta[name="description"]',
      el => el.getAttribute('content')
    ).catch(() => null);

    const ogDesc = await page.$eval(
      'meta[property="og:description"]',
      el => el.getAttribute('content')
    ).catch(() => null);

    console.error(`[${client.name}] meta description: ${metaDesc}`);
    console.error(`[${client.name}] og:description: ${ogDesc}`);

    // Instagram meta description format:
    // "X Followers, Y Following, Z Posts - See Instagram photos and videos from @handle"
    // or in Spanish: "X seguidores, Y siguiendo, Z publicaciones"
    let followers = 0, following = 0, posts = 0;

    const desc = metaDesc || ogDesc || '';

    // Pattern: numbers with K/M followed by Followers/Following/Posts keywords
    const followersMatch = desc.match(/([\d,\.]+[KkMm]?)\s*(?:Followers|seguidores)/i);
    const followingMatch = desc.match(/([\d,\.]+[KkMm]?)\s*(?:Following|siguiendo)/i);
    const postsMatch     = desc.match(/([\d,\.]+[KkMm]?)\s*(?:Posts|publicaciones)/i);

    if (followersMatch) followers = parseCount(followersMatch[1]);
    if (followingMatch) following = parseCount(followingMatch[1]);
    if (postsMatch)     posts     = parseCount(postsMatch[1]);

    // If meta didn't work, try page JSON data
    if (followers === 0) {
      const jsonData = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts) {
          try { return JSON.parse(s.textContent); } catch {}
        }
        return null;
      }).catch(() => null);

      if (jsonData) {
        console.error(`[${client.name}] JSON-LD:`, JSON.stringify(jsonData).slice(0, 300));
        if (jsonData.interactionStatistic) {
          for (const stat of (Array.isArray(jsonData.interactionStatistic) ? jsonData.interactionStatistic : [jsonData.interactionStatistic])) {
            if (stat.interactionType && stat.interactionType.includes('FollowAction')) followers = stat.userInteractionCount || 0;
          }
        }
      }
    }

    // Try visible counters on the page as last resort
    if (followers === 0) {
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const lines = pageText.split('\n').slice(0, 50).join(' ');
      console.error(`[${client.name}] page text (first 500):`, lines.slice(0, 500));

      const m = lines.match(/([\d,\.]+[KkMm]?)\s*seguidores/i) || lines.match(/([\d,\.]+[KkMm]?)\s*followers/i);
      if (m) followers = parseCount(m[1]);
      const mf = lines.match(/([\d,\.]+[KkMm]?)\s*siguiendo/i) || lines.match(/([\d,\.]+[KkMm]?)\s*following/i);
      if (mf) following = parseCount(mf[1]);
      const mp = lines.match(/([\d,\.]+[KkMm]?)\s*publicaciones/i) || lines.match(/([\d,\.]+[KkMm]?)\s*posts/i);
      if (mp) posts = parseCount(mp[1]);
    }

    return { ...client, followers, following, posts, error: null };
  } catch (err) {
    console.error(`[${client.name}] ERROR:`, err.message);
    return { ...client, followers: 0, following: 0, posts: 0, error: err.message };
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  // Block images/fonts to speed up
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

  const page = await context.newPage();
  const results = [];

  for (const client of clients) {
    console.error(`\nScraping: ${client.name} (${client.url})`);
    const result = await scrapeProfile(page, client);
    results.push(result);
    console.error(`  -> posts=${result.posts}, followers=${result.followers}, following=${result.following}`);
    await page.waitForTimeout(2000);
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
