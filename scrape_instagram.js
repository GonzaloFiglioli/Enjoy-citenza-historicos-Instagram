const { chromium } = require('playwright');

const clients = [
  { name: 'Coviella Propiedades', handle: 'coviellapropiedades_', url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante', handle: 'inmobiliaria.bustamante', url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades', handle: 'juanbarrozopropiedades', url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades', handle: 'germanberrettipropiedades', url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades', handle: 'masonepropiedades', url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces', handle: 'diegomurgobienesraices', url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural', handle: 'siclorural', url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi', handle: 'alejandroparisi66', url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music', handle: 'latammusicargentina', url: 'https://www.instagram.com/latammusicargentina/' },
];

function parseCount(text) {
  if (!text) return 0;
  text = text.toString().trim().replace(/\s/g, '').replace(',', '.');
  if (text.endsWith('M') || text.endsWith('m')) return Math.round(parseFloat(text) * 1000000);
  if (text.endsWith('K') || text.endsWith('k')) return Math.round(parseFloat(text) * 1000);
  return parseInt(text.replace(/\./g, '').replace(',', ''), 10) || 0;
}

async function scrapeProfile(browser, client) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const pageContent = await page.content();

    // Try GraphQL/API data embedded in page
    let posts = 0, followers = 0, following = 0;

    const edgeOwner = pageContent.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);
    const edgeFollowed = pageContent.match(/"edge_followed_by":\{"count":(\d+)/);
    const edgeFollow = pageContent.match(/"edge_follow":\{"count":(\d+)/);
    if (edgeOwner) posts = parseInt(edgeOwner[1]);
    if (edgeFollowed) followers = parseInt(edgeFollowed[1]);
    if (edgeFollow) following = parseInt(edgeFollow[1]);

    // Try meta description pattern (English)
    if (!followers) {
      const metaMatch = pageContent.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
        || pageContent.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
      if (metaMatch) {
        const desc = metaMatch[1];
        process.stderr.write(`META [${client.handle}]: ${desc}\n`);
        const fMatch = desc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowers?/);
        const fgMatch = desc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowing/);
        const pMatch = desc.match(/([\d,\.]+[KkMm]?)\s*[Pp]osts?/);
        const segMatch = desc.match(/([\d,\.]+[KkMm]?)\s*seguidores/i);
        const siguMatch = desc.match(/([\d,\.]+[KkMm]?)\s*seguidos/i);
        const pubMatch = desc.match(/([\d,\.]+[KkMm]?)\s*publicaciones/i);
        if (fMatch) followers = parseCount(fMatch[1]);
        if (fgMatch) following = parseCount(fgMatch[1]);
        if (pMatch) posts = parseCount(pMatch[1]);
        if (segMatch && !followers) followers = parseCount(segMatch[1]);
        if (siguMatch && !following) following = parseCount(siguMatch[1]);
        if (pubMatch && !posts) posts = parseCount(pubMatch[1]);
      }
    }

    // Try DOM stats
    if (!followers) {
      const stats = await page.evaluate(() => {
        const result = { posts: null, followers: null, following: null };
        const listItems = Array.from(document.querySelectorAll('ul li, header section ul li'));
        for (const li of listItems) {
          const text = li.innerText || li.textContent || '';
          const lower = text.toLowerCase();
          const match = text.match(/([\d,\.]+[KkMm]?)/);
          if (!match) continue;
          if (lower.includes('publicacion') || lower.includes('post')) result.posts = result.posts || match[1];
          else if (lower.includes('seguidor') || lower.includes('follower')) result.followers = result.followers || match[1];
          else if (lower.includes('seguido') || lower.includes('following')) result.following = result.following || match[1];
        }
        // Also check for spans with specific aria titles
        document.querySelectorAll('span[title]').forEach(s => {
          const title = s.getAttribute('title');
          const inner = s.innerText || '';
          if (/^[\d,\.]+$/.test(title.replace(/\s/g,''))) {
            const parentText = (s.parentElement && s.parentElement.innerText) || '';
            const lower = parentText.toLowerCase();
            if (lower.includes('follower') || lower.includes('seguidor')) result.followers = result.followers || title;
            if ((lower.includes('following') || lower.includes('seguido')) && !lower.includes('seguidor')) result.following = result.following || title;
          }
        });
        return result;
      });
      process.stderr.write(`DOM STATS [${client.handle}]: ${JSON.stringify(stats)}\n`);
      if (stats.posts) posts = parseCount(stats.posts);
      if (stats.followers) followers = parseCount(stats.followers);
      if (stats.following) following = parseCount(stats.following);
    }

    process.stderr.write(`FINAL [${client.handle}]: posts=${posts}, followers=${followers}, following=${following}\n`);

    await context.close();
    return { ...client, posts, followers, following, error: null };
  } catch (err) {
    process.stderr.write(`ERROR [${client.handle}]: ${err.message}\n`);
    await context.close();
    return { ...client, posts: 0, followers: 0, following: 0, error: err.message };
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors', '--disable-web-security']
  });
  const results = [];

  for (const client of clients) {
    process.stderr.write(`\nScraping ${client.name}...\n`);
    const result = await scrapeProfile(browser, client);
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  process.stderr.write('Fatal error: ' + err.message + '\n');
  process.exit(1);
});
