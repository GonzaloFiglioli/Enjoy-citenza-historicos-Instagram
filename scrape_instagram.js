const { chromium } = require('/opt/node22/lib/node_modules/playwright');

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

function parseCount(text) {
  if (!text) return 0;
  // Remove commas and spaces
  text = text.replace(/,/g, '').replace(/\s/g, '').trim();
  // Handle K (thousands) and M (millions)
  if (text.endsWith('K') || text.endsWith('k')) {
    return Math.round(parseFloat(text) * 1000);
  }
  if (text.endsWith('M') || text.endsWith('m')) {
    return Math.round(parseFloat(text) * 1000000);
  }
  const num = parseInt(text, 10);
  return isNaN(num) ? 0 : num;
}

async function scrapeProfile(page, client) {
  try {
    console.error(`Scraping: ${client.name} (${client.url})`);
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait a bit for JS to render
    await page.waitForTimeout(3000);

    // Try to get stats from meta description first (og:description)
    const metaDesc = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content')).catch(() => null);

    let posts = 0, followers = 0, following = 0;
    let source = 'unknown';

    if (metaDesc) {
      // Format: "X Followers, Y Following, Z Posts - See Instagram photos and videos from ..."
      const followersMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Followers?/i);
      const followingMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Following/i);
      const postsMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Posts?/i);

      if (followersMatch) { followers = parseCount(followersMatch[1]); source = 'meta'; }
      if (followingMatch) { following = parseCount(followingMatch[1]); source = 'meta'; }
      if (postsMatch) { posts = parseCount(postsMatch[1]); source = 'meta'; }
    }

    // If meta didn't work, try DOM scraping
    if (followers === 0) {
      // Try to find the stats in the page DOM
      // Instagram renders stats in <span> or <li> elements
      const statsText = await page.evaluate(() => {
        // Look for the stats section - typically 3 items with counts
        // Try various selectors
        const lists = document.querySelectorAll('ul li');
        const results = [];
        for (const li of lists) {
          const spans = li.querySelectorAll('span');
          for (const span of spans) {
            const title = span.getAttribute('title');
            const text = span.innerText || span.textContent;
            if (title || (text && /^[\d.,KkMm]+$/.test(text.trim()))) {
              results.push({ title: title || null, text: text.trim() });
            }
          }
        }
        return results;
      });

      console.error(`DOM stats for ${client.name}:`, JSON.stringify(statsText));

      // Also try getting page text for debugging
      const bodyText = await page.evaluate(() => {
        // Look for aria-label attributes that contain follower counts
        const elements = document.querySelectorAll('[aria-label]');
        const found = [];
        for (const el of elements) {
          const label = el.getAttribute('aria-label');
          if (label && /follower|seguidor|publicacion|following|seguido/i.test(label)) {
            found.push(label);
          }
        }
        return found;
      });
      console.error(`aria-labels for ${client.name}:`, JSON.stringify(bodyText));

      // Try to parse from aria-labels
      for (const label of bodyText) {
        const fMatch = label.match(/([\d,.]+[KkMm]?)\s*(followers?|seguidores?)/i);
        const gMatch = label.match(/([\d,.]+[KkMm]?)\s*(following|seguidos?)/i);
        const pMatch = label.match(/([\d,.]+[KkMm]?)\s*(posts?|publicaciones?)/i);
        if (fMatch) followers = parseCount(fMatch[1]);
        if (gMatch) following = parseCount(gMatch[1]);
        if (pMatch) posts = parseCount(pMatch[1]);
      }
      source = 'aria';
    }

    // Last resort: try to get JSON data from the page script tags
    if (followers === 0) {
      const scriptData = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        const results = [];
        for (const s of scripts) {
          try { results.push(JSON.parse(s.textContent)); } catch(e) {}
        }
        return results;
      });

      for (const data of scriptData) {
        if (data.mainEntityofPage || data['@type'] === 'ProfilePage') {
          if (data.interactionStatistic) {
            for (const stat of (Array.isArray(data.interactionStatistic) ? data.interactionStatistic : [data.interactionStatistic])) {
              if (stat.interactionType && stat.interactionType.includes('Follow')) {
                followers = stat.userInteractionCount || 0;
              }
            }
          }
        }
      }
      source = 'json-ld';
    }

    console.error(`Result for ${client.name}: posts=${posts}, followers=${followers}, following=${following}, source=${source}`);

    return {
      name: client.name,
      handle: client.handle,
      posts,
      followers,
      following,
      error: null
    };

  } catch (err) {
    console.error(`ERROR for ${client.name}: ${err.message}`);
    return {
      name: client.name,
      handle: client.handle,
      posts: 0,
      followers: 0,
      following: 0,
      error: err.message
    };
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-AR',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Set extra headers to look more like a real browser
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  });

  const results = [];

  for (const client of clients) {
    const result = await scrapeProfile(page, client);
    results.push(result);
    // Small delay between requests
    await page.waitForTimeout(2000);
  }

  await browser.close();

  // Output results as JSON to stdout
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
