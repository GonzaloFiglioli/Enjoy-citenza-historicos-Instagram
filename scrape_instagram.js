#!/usr/bin/env node
/**
 * Historico Clientes Instagram — Citenza
 * Scrapea los 9 perfiles con Playwright y crea una fila nueva en Notion por cada uno.
 * Diseñado para correr diariamente via cron en el VPS.
 *
 * Variables de entorno requeridas:
 *   NOTION_TOKEN   — Integration secret de Notion (secret_... o ntn_...)
 *
 * Uso:
 *   NOTION_TOKEN=ntn_xxx node scrape_instagram.js
 */

const { chromium } = require('playwright');
const https = require('https');

// ─── Configuración ─────────────────────────────────────────────────────────

const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const NOTION_DS_ID     = '3433d64a-7941-8081-b809-000bae7a20d7'; // data_source_id (collection)
const TODAY            = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD

const CLIENTS = [
  { name: 'Coviella Propiedades',       handle: '@coviellapropiedades_',       url: 'https://www.instagram.com/coviellapropiedades_/' },
  { name: 'Inmobiliaria Bustamante',     handle: '@inmobiliaria.bustamante',     url: 'https://www.instagram.com/inmobiliaria.bustamante/' },
  { name: 'Juan Barrozo Propiedades',    handle: '@juanbarrozopropiedades',      url: 'https://www.instagram.com/juanbarrozopropiedades/' },
  { name: 'German Berretti Propiedades', handle: '@germanberrettipropiedades',   url: 'https://www.instagram.com/germanberrettipropiedades/' },
  { name: 'Masone Propiedades',          handle: '@masonepropiedades',           url: 'https://www.instagram.com/masonepropiedades/' },
  { name: 'Diego Murgo Bienes Raíces',   handle: '@diegomurgobienesraices',      url: 'https://www.instagram.com/diegomurgobienesraices/' },
  { name: 'Siclo Rural',                 handle: '@siclorural',                  url: 'https://www.instagram.com/siclorural/' },
  { name: 'Alejandro Parisi',            handle: '@alejandroparisi66',           url: 'https://www.instagram.com/alejandroparisi66/' },
  { name: 'Latam Music',                 handle: '@latammusicargentina',         url: 'https://www.instagram.com/latammusicargentina/' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCount(str) {
  if (!str) return 0;
  str = str.trim().replace(/[.,\s]/g, '');
  if (/k$/i.test(str)) return Math.round(parseFloat(str) * 1000);
  if (/m$/i.test(str)) return Math.round(parseFloat(str) * 1000000);
  const n = parseInt(str.replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.error(`[${ts}] ${msg}`);
}

// ─── Scraping ───────────────────────────────────────────────────────────────

async function scrapeProfile(page, client) {
  log(`Scrapeando: ${client.name} (${client.handle})`);

  try {
    await page.goto(client.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);

    const html = await page.content();

    // Detectar login wall
    if (html.includes('Log in to Instagram') || html.includes('Inicia sesión en Instagram')) {
      log(`  → Login wall detectado`);
      return { ...client, posts: 0, followers: 0, following: 0, error: 'login_wall' };
    }

    let posts = 0, followers = 0, following = 0, found = false;

    // Método 1: meta description
    const metaDesc = await page.$eval('meta[name="description"]',
      el => el.getAttribute('content')).catch(() => null);

    if (metaDesc) {
      log(`  → meta: ${metaDesc}`);
      const fwMatch  = metaDesc.match(/([\d,. KkMm]+)\s+[Ff]ollowers?/);
      const fgMatch  = metaDesc.match(/([\d,. KkMm]+)\s+[Ff]ollowing/);
      const psMatch  = metaDesc.match(/([\d,. KkMm]+)\s+[Pp]osts?/);
      const fwMatchES = metaDesc.match(/([\d,. KkMm]+)\s+[Ss]eguidores?/);
      const fgMatchES = metaDesc.match(/([\d,. KkMm]+)\s+[Ss]eguidos?/);
      const psMatchES = metaDesc.match(/([\d,. KkMm]+)\s+[Pp]ublicaciones?/);

      if (fwMatch || fwMatchES)  { followers = parseCount((fwMatch || fwMatchES)[1]); found = true; }
      if (fgMatch || fgMatchES)  { following = parseCount((fgMatch || fgMatchES)[1]); found = true; }
      if (psMatch || psMatchES)  { posts     = parseCount((psMatch || psMatchES)[1]); found = true; }
    }

    // Método 2: header counters (ul > li)
    if (!found || followers === 0) {
      const stats = await page.$$eval('header section ul li', items =>
        items.map(li => {
          const spans = Array.from(li.querySelectorAll('span'));
          return spans.map(s => s.textContent.trim()).filter(Boolean);
        })
      ).catch(() => []);

      if (stats.length >= 3) {
        posts     = parseCount(stats[0][0] || '0');
        followers = parseCount(stats[1][0] || '0');
        following = parseCount(stats[2][0] || '0');
        found = true;
      }
    }

    // Método 3: JSON embebido en scripts
    if (!found || followers === 0) {
      const scripts = await page.$$eval('script', els =>
        els.map(s => s.textContent).filter(t => t && t.includes('edge_followed_by'))
      ).catch(() => []);

      for (const script of scripts) {
        const fw = script.match(/"edge_followed_by":\{"count":(\d+)\}/);
        const fg = script.match(/"edge_follow":\{"count":(\d+)\}/);
        const ps = script.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);
        if (fw) { followers = parseInt(fw[1], 10); found = true; }
        if (fg) { following = parseInt(fg[1], 10); }
        if (ps) { posts     = parseInt(ps[1], 10); }
        if (found) break;
      }
    }

    log(`  → posts=${posts} seguidores=${followers} seguidos=${following}`);
    return { ...client, posts, followers, following, error: null };

  } catch (err) {
    log(`  → ERROR: ${err.message.slice(0, 120)}`);
    return { ...client, posts: 0, followers: 0, following: 0, error: err.message.slice(0, 120) };
  }
}

// ─── Notion API ─────────────────────────────────────────────────────────────

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function createNotionPage(client) {
  const { name, handle, posts, followers, following } = client;

  const payload = {
    parent: { database_id: NOTION_DS_ID },
    properties: {
      'Cliente':              { title:  [{ text: { content: name } }] },
      'Usuario Instagram':    { rich_text: [{ text: { content: handle } }] },
      'Publicaciones Totales':{ number: posts },
      'Seguidores Actuales':  { number: followers },
      'Seguidos Actuales':    { number: following },
      'Seguidos':             { number: following },
      'Estado':               { status: { name: 'Activo' } },
      'Última Actualización': { date: { start: TODAY } },
    },
  };

  const res = await notionRequest('POST', '/v1/pages', payload);

  if (res.status === 200 || res.status === 201) {
    log(`  → Notion OK: ${name}`);
    return { ok: true, id: res.body.id };
  } else {
    log(`  → Notion ERROR ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    return { ok: false, error: JSON.stringify(res.body).slice(0, 200) };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  if (!NOTION_TOKEN) {
    console.error('ERROR: Variable de entorno NOTION_TOKEN no definida.');
    process.exit(1);
  }

  log('=== Inicio historico Instagram ===');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-AR',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8' },
  });

  // Bloquear imágenes y fuentes para acelerar
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot}', r => r.abort());

  const page    = await context.newPage();
  const results = [];
  const failed  = [];

  for (const client of CLIENTS) {
    const data = await scrapeProfile(page, client);

    if (data.error) failed.push({ name: data.name, reason: data.error });

    const notion = await createNotionPage(data);
    results.push({ ...data, notion });

    await page.waitForTimeout(1500); // pausa educada entre requests
  }

  await browser.close();

  // ── Resumen ──────────────────────────────────────────────────────────────
  console.log('\n========================================');
  console.log(`  RESUMEN — ${TODAY}`);
  console.log('========================================');
  console.log(`  Filas creadas en Notion: ${results.filter(r => r.notion?.ok).length} / ${CLIENTS.length}`);
  console.log('');
  console.log('  Cliente                          | Seguidores | Posts | Seguidos');
  console.log('  ---------------------------------|------------|-------|----------');

  for (const r of results) {
    const status = r.error ? '⚠' : '✓';
    const name   = r.name.padEnd(32).slice(0, 32);
    console.log(`  ${status} ${name} | ${String(r.followers).padStart(10)} | ${String(r.posts).padStart(5)} | ${r.following}`);
  }

  if (failed.length > 0) {
    console.log('\n  Clientes con error:');
    for (const f of failed) console.log(`    - ${f.name}: ${f.reason}`);
  } else {
    console.log('\n  Sin errores.');
  }

  console.log('========================================\n');

  process.exit(failed.length > 0 ? 1 : 0);
})();
