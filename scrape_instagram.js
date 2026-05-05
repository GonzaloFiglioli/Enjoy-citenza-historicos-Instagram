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
  str = str.trim().replace(/,/g, '').replace(/\./g, '');
  const lower = str.toLowerCase();
  const num = parseFloat(lower);
  if (lower.includes('m')) return Math.round(num * 1_000_000);
  if (lower.includes('k')) return Math.round(num * 1_000);
  return Math.round(num) || 0;
}

async function scrapeProfile(page, client) {
  console.error(`\nScraping: ${client.name} (${client.url})`);
  try {
    await page.goto(client.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to extract from meta tag first (og:description)
    const metaDesc = await page.getAttribute('meta[name="description"]', 'content').catch(() => null)
      || await page.getAttribute('meta[property="og:description"]', 'content').catch(() => null);

    console.error(`Meta description: ${metaDesc}`);

    if (metaDesc) {
      // Format: "1,234 Followers, 567 Following, 89 Posts - See Instagram photos..."
      // Or: "1.2K Followers, 567 Following, 89 Posts..."
      const followersMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Followers/i)
        || metaDesc.match(/([\d,.]+[KkMm]?)\s*seguidores/i);
      const followingMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Following/i)
        || metaDesc.match(/([\d,.]+[KkMm]?)\s*seguidos/i);
      const postsMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Posts/i)
        || metaDesc.match(/([\d,.]+[KkMm]?)\s*publicaciones/i);

      if (followersMatch || followingMatch || postsMatch) {
        return {
          name: client.name,
          handle: client.handle,
          posts: postsMatch ? parseCount(postsMatch[1]) : 0,
          followers: followersMatch ? parseCount(followersMatch[1]) : 0,
          following: followingMatch ? parseCount(followingMatch[1]) : 0,
          success: true,
        };
      }
    }

    // Try reading visible text counters from page header
    const pageContent = await page.content();

    // Look for JSON data embedded in page
    const jsonMatch = pageContent.match(/"edge_followed_by":\{"count":(\d+)\}/);
    const jsonFollowingMatch = pageContent.match(/"edge_follow":\{"count":(\d+)\}/);
    const jsonPostsMatch = pageContent.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);

    if (jsonMatch) {
      return {
        name: client.name,
        handle: client.handle,
        posts: jsonPostsMatch ? parseInt(jsonPostsMatch[1]) : 0,
        followers: parseInt(jsonMatch[1]),
        following: jsonFollowingMatch ? parseInt(jsonFollowingMatch[1]) : 0,
        success: true,
      };
    }

    // Try to find the stats section in the visible page
    // Look for aria-label or title attributes on stat elements
    const statsText = await page.evaluate(() => {
      const listItems = document.querySelectorAll('li');
      const results = [];
      listItems.forEach(li => {
        const text = li.textContent.trim();
        if (text && (text.includes('post') || text.includes('follower') || text.includes('following') ||
            text.includes('seguid') || text.includes('publicac'))) {
          results.push(text);
        }
      });
      // Also check spans with numbers
      const spans = document.querySelectorAll('span[title]');
      spans.forEach(s => results.push(`span[title=${s.title}]: ${s.textContent}`));
      return results;
    });

    console.error(`Stats text found: ${JSON.stringify(statsText)}`);

    if (statsText.length > 0) {
      let posts = 0, followers = 0, following = 0;
      for (const text of statsText) {
        const ltext = text.toLowerCase();
        const numMatch = text.match(/([\d,.]+[KkMm]?)/);
        if (!numMatch) continue;
        const val = parseCount(numMatch[1]);
        if (ltext.includes('post') || ltext.includes('publicac')) posts = val;
        else if (ltext.includes('follower') || ltext.includes('seguidor')) followers = val;
        else if (ltext.includes('following') || (ltext.includes('seguido') && !ltext.includes('seguidor'))) following = val;
      }

      // Also try title attributes
      for (const text of statsText) {
        if (text.startsWith('span[title=')) {
          const titleMatch = text.match(/span\[title=([\d,]+)\]/);
          if (titleMatch) {
            // These are usually the exact numbers for followers/following
          }
        }
      }

      if (posts > 0 || followers > 0 || following > 0) {
        return {
          name: client.name,
          handle: client.handle,
          posts,
          followers,
          following,
          success: true,
        };
      }
    }

    // Last resort: try to get the title spans with exact numbers
    const exactNumbers = await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span[title]'));
      return spans.map(s => ({ title: s.getAttribute('title'), text: s.textContent }));
    });
    console.error(`Exact number spans: ${JSON.stringify(exactNumbers)}`);

    // Try header section specifically
    const headerStats = await page.evaluate(() => {
      // Instagram profile stats are usually in a ul > li structure
      const sections = document.querySelectorAll('section');
      const results = [];
      sections.forEach(s => {
        const ul = s.querySelector('ul');
        if (ul) {
          const items = ul.querySelectorAll('li');
          items.forEach(li => results.push(li.textContent.trim().substring(0, 100)));
        }
      });
      return results;
    });
    console.error(`Header stats: ${JSON.stringify(headerStats)}`);

    // One more attempt: check if page shows login required
    const loginRequired = pageContent.includes('Log in') || pageContent.includes('Iniciar sesión');
    if (loginRequired) {
      console.error(`Login required for ${client.name}`);
    }

    return {
      name: client.name,
      handle: client.handle,
      posts: 0,
      followers: 0,
      following: 0,
      success: false,
      error: 'Could not extract data',
    };
  } catch (err) {
    console.error(`Error scraping ${client.name}: ${err.message}`);
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  const page = await context.newPage();

  // Stealth: remove webdriver property
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const results = [];

  for (const client of clients) {
    const result = await scrapeProfile(page, client);
    results.push(result);
    // Small delay between requests
    await page.waitForTimeout(2000);
  }

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
