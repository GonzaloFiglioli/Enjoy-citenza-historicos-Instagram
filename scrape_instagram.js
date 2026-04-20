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
  text = text.trim().replace(/\s/g, '').replace(',', '.');
  const lower = text.toLowerCase();
  if (lower.includes('m')) {
    return Math.round(parseFloat(lower) * 1000000);
  }
  if (lower.includes('k')) {
    return Math.round(parseFloat(lower) * 1000);
  }
  return parseInt(text.replace(/\./g, '').replace(/,/g, ''), 10) || 0;
}

async function scrapeProfile(page, client) {
  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Try to get stats from meta tags or page content
    const pageContent = await page.content();

    // Try structured data approach via meta description
    const metaDesc = await page.$eval('meta[name="description"]', el => el.getAttribute('content')).catch(() => null);
    console.error(`[${client.name}] meta description: ${metaDesc}`);

    // Try to find the stats via accessible elements
    // Instagram renders stats in <li> elements with specific structure
    const stats = await page.evaluate(() => {
      // Try to find stats from the page
      const result = { posts: 0, followers: 0, following: 0, found: false };

      // Look for list items containing stats
      const listItems = document.querySelectorAll('li');
      for (const li of listItems) {
        const text = li.innerText || '';
        if (text.includes('publicaciones') || text.includes('posts')) {
          const match = text.match(/^([\d,.]+[kKmM]?)/);
          if (match) result.posts = match[1];
        }
        if (text.includes('seguidores') || text.includes('followers')) {
          const match = text.match(/^([\d,.]+[kKmM]?)/);
          if (match) { result.followers = match[1]; result.found = true; }
        }
        if (text.includes('seguidos') || text.includes('following')) {
          const match = text.match(/^([\d,.]+[kKmM]?)/);
          if (match) result.following = match[1];
        }
      }

      // Try span elements with specific content
      if (!result.found) {
        const spans = document.querySelectorAll('span');
        let foundFollowers = false;
        for (let i = 0; i < spans.length; i++) {
          const span = spans[i];
          const title = span.getAttribute('title');
          if (title && /^[\d,\.]+$/.test(title.replace(/\./g, '').replace(/,/g, ''))) {
            // Check next sibling or parent text for label
            const parentText = span.parentElement ? span.parentElement.innerText : '';
            if (parentText.includes('seguidores') || parentText.includes('followers')) {
              result.followers = title;
              result.found = true;
            }
            if (parentText.includes('publicaciones') || parentText.includes('posts')) {
              result.posts = title;
            }
            if (parentText.includes('seguidos') || parentText.includes('following')) {
              result.following = title;
            }
          }
        }
      }

      // Try to extract from JSON-LD or window.__additionalData
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data.interactionStatistic) {
            for (const stat of data.interactionStatistic) {
              if (stat.interactionType && stat.interactionType.includes('FollowAction')) {
                result.followers = String(stat.userInteractionCount);
                result.found = true;
              }
            }
          }
        } catch(e) {}
      }

      return result;
    });

    console.error(`[${client.name}] raw stats: ${JSON.stringify(stats)}`);

    // Parse meta description as fallback
    if (!stats.found && metaDesc) {
      const postsMatch = metaDesc.match(/([\d,.]+[kKmM]?)\s*(?:publicaciones|posts)/i);
      const followersMatch = metaDesc.match(/([\d,.]+[kKmM]?)\s*(?:seguidores|followers)/i);
      const followingMatch = metaDesc.match(/([\d,.]+[kKmM]?)\s*(?:seguidos|following)/i);
      if (postsMatch) stats.posts = postsMatch[1];
      if (followersMatch) { stats.followers = followersMatch[1]; stats.found = true; }
      if (followingMatch) stats.following = followingMatch[1];
    }

    return {
      name: client.name,
      handle: client.handle,
      posts: parseCount(String(stats.posts)),
      followers: parseCount(String(stats.followers)),
      following: parseCount(String(stats.following)),
      success: stats.found,
      error: null,
    };
  } catch (err) {
    console.error(`[${client.name}] ERROR: ${err.message}`);
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

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--no-proxy-server',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
    ignoreHTTPSErrors: true,
    proxy: { server: 'direct://' },
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
  });

  const results = [];

  for (const client of clients) {
    console.error(`\nScraping: ${client.name} (${client.url})`);
    const page = await context.newPage();
    const result = await scrapeProfile(page, client);
    results.push(result);
    await page.close();
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();

  // Output JSON to stdout
  console.log(JSON.stringify(results, null, 2));
})();
