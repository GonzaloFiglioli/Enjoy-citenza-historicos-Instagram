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

function parseCount(text) {
  if (!text) return 0;
  // Handle "1.2M", "500K", "1,234" etc.
  const clean = text.replace(/\s/g, '').toLowerCase();
  if (clean.includes('m')) {
    return Math.round(parseFloat(clean) * 1_000_000);
  } else if (clean.includes('k')) {
    return Math.round(parseFloat(clean) * 1_000);
  }
  // remove commas/dots used as thousands separators
  const num = parseInt(clean.replace(/[.,]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

async function scrapeProfile(page, client) {
  console.log(`Scraping: ${client.name} (${client.url})`);
  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to get stats from meta description first (most reliable without login)
    const metaDescription = await page.$eval(
      'meta[name="description"]',
      el => el.getAttribute('content')
    ).catch(() => null);

    console.log(`  Meta: ${metaDescription}`);

    let posts = 0, followers = 0, following = 0;

    if (metaDescription) {
      // Format: "X Followers, Y Following, Z Posts - See Instagram photos and videos from..."
      const followersMatch = metaDescription.match(/([\d,\.]+[KkMm]?)\s*Followers/i);
      const followingMatch = metaDescription.match(/([\d,\.]+[KkMm]?)\s*Following/i);
      const postsMatch = metaDescription.match(/([\d,\.]+[KkMm]?)\s*Posts/i);

      if (followersMatch) followers = parseCount(followersMatch[1]);
      if (followingMatch) following = parseCount(followingMatch[1]);
      if (postsMatch) posts = parseCount(postsMatch[1]);
    }

    // If meta didn't work, try page header stats
    if (followers === 0) {
      // Try to get stats from the page header using various selectors
      const statsText = await page.evaluate(() => {
        // Look for elements containing "seguidores" or "followers"
        const allText = document.body.innerText;
        return allText.substring(0, 3000);
      }).catch(() => '');

      console.log(`  Page text snippet: ${statsText.substring(0, 500)}`);

      // Try Spanish Instagram format
      const seguidoresMatch = statsText.match(/([\d,\.]+[KkMm]?)\s*seguidores/i);
      const siguiendoMatch = statsText.match(/([\d,\.]+[KkMm]?)\s*seguidos/i);
      const publicacionesMatch = statsText.match(/([\d,\.]+[KkMm]?)\s*publicaciones/i);

      if (seguidoresMatch) followers = parseCount(seguidoresMatch[1]);
      if (siguiendoMatch) following = parseCount(siguiendoMatch[1]);
      if (publicacionesMatch) posts = parseCount(publicacionesMatch[1]);
    }

    console.log(`  Result: posts=${posts}, followers=${followers}, following=${following}`);

    return {
      ...client,
      posts,
      followers,
      following,
      failed: false,
    };
  } catch (err) {
    console.error(`  ERROR for ${client.name}: ${err.message}`);
    return {
      ...client,
      posts: 0,
      followers: 0,
      following: 0,
      failed: true,
      error: err.message,
    };
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Block unnecessary resources to speed up
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort());

  const results = [];
  for (const client of clients) {
    const result = await scrapeProfile(page, client);
    results.push(result);
    await page.waitForTimeout(2000);
  }

  await browser.close();

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  return results;
}

main().catch(console.error);
