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

function parseCount(str) {
  if (!str) return 0;
  str = str.trim().replace(/\s/g, '').replace(',', '.');
  const lower = str.toLowerCase();
  if (lower.endsWith('m')) return Math.round(parseFloat(lower) * 1_000_000);
  if (lower.endsWith('k')) return Math.round(parseFloat(lower) * 1_000);
  return parseInt(str.replace(/\./g, '').replace(/,/g, ''), 10) || 0;
}

async function scrapeProfile(page, client) {
  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for stats to appear
    await page.waitForSelector('header section ul', { timeout: 15000 });

    const stats = await page.evaluate(() => {
      // Instagram renders stats in <ul> inside header section
      // Each <li> contains a <span> with the number and a <span> with the label
      const items = Array.from(document.querySelectorAll('header section ul li'));
      const result = {};
      for (const li of items) {
        const spans = li.querySelectorAll('span');
        let numberText = null;
        let label = null;
        // Try to find number and label
        for (const s of spans) {
          const t = s.innerText || s.textContent || '';
          if (/^[\d,\.kmKM]+$/.test(t.trim())) {
            numberText = t.trim();
          }
        }
        // Label is in the last visible text of the li
        label = li.innerText || li.textContent || '';
        result[label.toLowerCase()] = numberText;
      }

      // Alternative: look for meta description or JSON-LD
      const metaDesc = document.querySelector('meta[name="description"]');
      const metaContent = metaDesc ? metaDesc.getAttribute('content') : null;

      return { items: items.map(li => li.innerText), metaContent };
    });

    // Parse from meta description which usually has: "X Followers, Y Following, Z Posts"
    let posts = 0, followers = 0, following = 0;
    if (stats.metaContent) {
      const m = stats.metaContent.match(/([\d,\.]+[kmKM]?)\s*(?:publicaciones?|posts?)/i);
      const f = stats.metaContent.match(/([\d,\.]+[kmKM]?)\s*(?:seguidores?|followers?)/i);
      const fg = stats.metaContent.match(/([\d,\.]+[kmKM]?)\s*(?:seguidos?|following)/i);
      if (m) posts = parseCount(m[1]);
      if (f) followers = parseCount(f[1]);
      if (fg) following = parseCount(fg[1]);
    }

    // If not found in meta, try from the list items
    if (!followers && stats.items) {
      for (const item of stats.items) {
        const lower = item.toLowerCase();
        const numMatch = item.match(/([\d,\.]+[kmKM]?)/i);
        if (!numMatch) continue;
        const val = parseCount(numMatch[1]);
        if (lower.includes('publicacion') || lower.includes('post')) posts = val;
        else if (lower.includes('seguidor') || lower.includes('follower')) followers = val;
        else if (lower.includes('seguido') || lower.includes('following')) following = val;
      }
    }

    return {
      name: client.name,
      handle: client.handle,
      posts,
      followers,
      following,
      success: true,
      rawMeta: stats.metaContent,
      rawItems: stats.items,
    };
  } catch (err) {
    return {
      name: client.name,
      handle: client.handle,
      posts: 0,
      followers: 0,
      following: 0,
      success: false,
      error: err.message,
    };
  }
}

async function main() {
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

  const page = await context.newPage();

  // Remove automation detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const results = [];
  for (const client of clients) {
    console.log(`Scraping: ${client.name} ...`);
    const result = await scrapeProfile(page, client);
    results.push(result);
    console.log(JSON.stringify(result));
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();
  console.log('=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
