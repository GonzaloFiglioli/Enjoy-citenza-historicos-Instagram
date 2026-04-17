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
  if (str.endsWith('M') || str.endsWith('m')) {
    return Math.round(parseFloat(str) * 1000000);
  }
  if (str.endsWith('K') || str.endsWith('k')) {
    return Math.round(parseFloat(str) * 1000);
  }
  return parseInt(str.replace(/[.,]/g, ''), 10) || 0;
}

async function scrapeProfile(page, client) {
  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try to extract counts from meta description or page content
    // Instagram profile stats are in <meta> tags or in the page JSON data
    const content = await page.content();

    // Try to get from page title / meta description
    const metaDesc = await page.$eval('meta[name="description"]', el => el.getAttribute('content')).catch(() => null);

    let posts = 0, followers = 0, following = 0;

    if (metaDesc) {
      // Format: "X Followers, X Following, X Posts"
      const followersMatch = metaDesc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowers?/);
      const followingMatch = metaDesc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowing/);
      const postsMatch = metaDesc.match(/([\d,\.]+[KkMm]?)\s*[Pp]osts?/);

      if (followersMatch) followers = parseCount(followersMatch[1]);
      if (followingMatch) following = parseCount(followingMatch[1]);
      if (postsMatch) posts = parseCount(postsMatch[1]);
    }

    // Try header stats if meta description didn't work
    if (followers === 0) {
      // Try to find stats in the page - Instagram puts stats in <ul> inside header
      const stats = await page.$$eval('header section ul li', items => {
        return items.map(item => {
          const span = item.querySelector('span[title]') || item.querySelector('span');
          const text = item.innerText || '';
          return { title: span ? span.getAttribute('title') : null, text };
        });
      }).catch(() => []);

      if (stats.length >= 3) {
        posts = parseCount(stats[0].title || stats[0].text.split('\n')[0]);
        followers = parseCount(stats[1].title || stats[1].text.split('\n')[0]);
        following = parseCount(stats[2].title || stats[2].text.split('\n')[0]);
      }
    }

    // Try JSON data embedded in page
    if (followers === 0) {
      const jsonMatch = content.match(/"edge_followed_by":\{"count":(\d+)\}/);
      const followingMatch2 = content.match(/"edge_follow":\{"count":(\d+)\}/);
      const postsMatch2 = content.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);

      if (jsonMatch) followers = parseInt(jsonMatch[1]);
      if (followingMatch2) following = parseInt(followingMatch2[1]);
      if (postsMatch2) posts = parseInt(postsMatch2[1]);
    }

    console.log(JSON.stringify({
      name: client.name,
      handle: client.handle,
      posts,
      followers,
      following,
      success: true,
      metaDesc: metaDesc ? metaDesc.substring(0, 200) : null
    }));

  } catch (err) {
    console.log(JSON.stringify({
      name: client.name,
      handle: client.handle,
      posts: 0,
      followers: 0,
      following: 0,
      success: false,
      error: err.message
    }));
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  for (const client of clients) {
    await scrapeProfile(page, client);
    await page.waitForTimeout(2000);
  }

  await browser.close();
})();
