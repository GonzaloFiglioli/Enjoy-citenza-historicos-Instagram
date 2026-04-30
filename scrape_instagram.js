const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const CLIENTS = [
  { name: 'Coviella Propiedades',        handle: 'coviellapropiedades_',        url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante',     handle: 'inmobiliaria.bustamante',     url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades',    handle: 'juanbarrozopropiedades',      url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades', handle: 'germanberrettipropiedades',   url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades',          handle: 'masonepropiedades',           url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces',   handle: 'diegomurgobienesraices',      url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural',                 handle: 'siclorural',                  url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi',            handle: 'alejandroparisi66',           url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music',                 handle: 'latammusicargentina',         url: 'https://www.instagram.com/latammusicargentina/' },
];

function parseCount(str) {
  if (!str) return 0;
  str = str.trim().replace(/\s/g, '').replace(',', '.');
  const m = str.match(/([\d.]+)\s*([KkMmBb]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') n *= 1000;
  else if (suffix === 'M') n *= 1000000;
  else if (suffix === 'B') n *= 1000000000;
  return Math.round(n);
}

async function scrapeProfile(page, client) {
  try {
    await page.goto(client.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Try meta description first — Instagram puts stats there even without login
    const metaDesc = await page.$eval(
      'meta[name="description"]',
      el => el.getAttribute('content')
    ).catch(() => null);

    if (metaDesc) {
      // Format: "X Posts, Y Followers, Z Following - Name on Instagram"
      // Also handles abbreviated: "1.2K Posts, 15.3K Followers, 432 Following"
      const postMatch   = metaDesc.match(/([\d.,]+\s*[KkMm]?)\s*[Pp]osts?/);
      const follMatch   = metaDesc.match(/([\d.,]+\s*[KkMm]?)\s*[Ff]ollowers?/);
      const followMatch = metaDesc.match(/([\d.,]+\s*[KkMm]?)\s*[Ff]ollowing/);

      if (postMatch || follMatch || followMatch) {
        return {
          name:       client.name,
          handle:     '@' + client.handle,
          posts:      parseCount(postMatch?.[1]),
          followers:  parseCount(follMatch?.[1]),
          following:  parseCount(followMatch?.[1]),
          source:     'meta',
          error:      null,
        };
      }
    }

    // Fallback: try to read the counters from visible DOM (header section)
    // Instagram renders stats in <span> or <li> elements with aria labels
    const stats = await page.evaluate(() => {
      // Try aria-label approach
      const spans = Array.from(document.querySelectorAll('span[title]'));
      if (spans.length >= 3) {
        return { posts: spans[0]?.title, followers: spans[1]?.title, following: spans[2]?.title };
      }

      // Try looking for list items with counts
      const listItems = Array.from(document.querySelectorAll('li'));
      const counters = listItems
        .map(li => li.innerText?.trim())
        .filter(t => t && /\d/.test(t))
        .slice(0, 3);
      if (counters.length === 3) {
        return { posts: counters[0], followers: counters[1], following: counters[2] };
      }

      // Try JSON-LD
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent);
          if (data.interactionStatistic) return { ld: data };
        } catch {}
      }

      return null;
    });

    if (stats && !stats.ld) {
      return {
        name:      client.name,
        handle:    '@' + client.handle,
        posts:     parseCount(stats.posts),
        followers: parseCount(stats.followers),
        following: parseCount(stats.following),
        source:    'dom',
        error:     null,
      };
    }

    // Private or failed to load
    return {
      name:      client.name,
      handle:    '@' + client.handle,
      posts:     0,
      followers: 0,
      following: 0,
      source:    'none',
      error:     'No se pudo obtener datos (perfil privado o no cargó)',
    };
  } catch (err) {
    return {
      name:      client.name,
      handle:    '@' + client.handle,
      posts:     0,
      followers: 0,
      following: 0,
      source:    'error',
      error:     err.message,
    };
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  const page = await context.newPage();

  // Hide webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const results = [];
  for (const client of CLIENTS) {
    process.stderr.write(`Scrapeando: ${client.name} (${client.url})\n`);
    const result = await scrapeProfile(page, client);
    results.push(result);
    process.stderr.write(`  -> posts=${result.posts} seguidores=${result.followers} seguidos=${result.following} [${result.source}]${result.error ? ' ERROR: ' + result.error : ''}\n`);
    await page.waitForTimeout(2000); // polite delay between requests
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
