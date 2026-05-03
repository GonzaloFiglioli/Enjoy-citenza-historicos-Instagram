#!/usr/bin/env python3
"""
Scraper diario de perfiles públicos de Instagram para Citenza.

Obtiene publicaciones, seguidores y seguidos de cada cliente
y crea una fila NUEVA en la base de datos Notion "Historico Clientes Instagram".

IMPORTANTE: Instagram requiere cookies de sesión de un usuario logueado.
Sin ellas el scraping fallará con 403 o redirección al login.

Pasos para obtener las cookies:
1. Abrir Chrome/Firefox
2. Loguearse en https://www.instagram.com
3. Abrir DevTools → Application → Cookies → https://www.instagram.com
4. Copiar los valores de sessionid, csrftoken, ds_user_id y mid
5. Crear el archivo cookies.json con el formato indicado abajo, o
   establecer las variables de entorno IG_SESSIONID, IG_CSRFTOKEN, etc.

Uso:
    python3 scrape_instagram.py [--cookies cookies.json] [--dry-run]

Dependencias:
    pip install playwright notion-client
    python -m playwright install chromium

Archivo cookies.json (ejemplo):
    {
        "sessionid": "12345678%3AaBcDeFgHiJ...",
        "csrftoken":  "abc123xyz",
        "ds_user_id": "123456789",
        "mid":        "XYZ..."
    }
"""

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

NOTION_TOKEN       = os.environ.get("NOTION_TOKEN", "YOUR_NOTION_TOKEN_HERE")
DATA_SOURCE_ID     = "3433d64a-7941-8081-b809-000bae7a20d7"
TODAY              = date.today().isoformat()

CLIENTS = [
    {"name": "Coviella Propiedades",         "handle": "@coviellapropiedades_",      "url": "https://www.instagram.com/coviellapropiedades_/"},
    {"name": "Inmobiliaria Bustamante",       "handle": "@inmobiliaria.bustamante",   "url": "https://www.instagram.com/inmobiliaria.bustamante/"},
    {"name": "Juan Barrozo Propiedades",      "handle": "@juanbarrozopropiedades",    "url": "https://www.instagram.com/juanbarrozopropiedades/"},
    {"name": "German Berretti Propiedades",   "handle": "@germanberrettipropiedades", "url": "https://www.instagram.com/germanberrettipropiedades/"},
    {"name": "Masone Propiedades",            "handle": "@masonepropiedades",         "url": "https://www.instagram.com/masonepropiedades/"},
    {"name": "Diego Murgo Bienes Raíces",     "handle": "@diegomurgobienesraices",    "url": "https://www.instagram.com/diegomurgobienesraices/"},
    {"name": "Siclo Rural",                   "handle": "@siclorural",                "url": "https://www.instagram.com/siclorural/"},
    {"name": "Alejandro Parisi",              "handle": "@alejandroparisi66",         "url": "https://www.instagram.com/alejandroparisi66/"},
    {"name": "Latam Music",                   "handle": "@latammusicargentina",       "url": "https://www.instagram.com/latammusicargentina/"},
]

IG_DOMAIN = "https://www.instagram.com"


def parse_count(text: str) -> int:
    """Convierte '1.2K', '15,3 mil', '1M', '123' a int."""
    text = text.strip().replace(",", ".").lower()
    text = re.sub(r"\s+", "", text)
    multiplier = 1
    if re.search(r"(k|mil)$", text):
        multiplier = 1_000
        text = re.sub(r"(k|mil)$", "", text)
    elif re.search(r"(m|millones)$", text):
        multiplier = 1_000_000
        text = re.sub(r"(m|millones)$", "", text)
    try:
        return int(float(text) * multiplier)
    except ValueError:
        return 0


def load_cookies(cookies_path: str | None) -> list[dict]:
    """Carga cookies desde archivo JSON o variables de entorno."""
    cookie_defs = {
        "sessionid": os.environ.get("IG_SESSIONID"),
        "csrftoken":  os.environ.get("IG_CSRFTOKEN"),
        "ds_user_id": os.environ.get("IG_DS_USER_ID"),
        "mid":        os.environ.get("IG_MID"),
    }

    if cookies_path and Path(cookies_path).exists():
        with open(cookies_path) as f:
            cookie_defs.update(json.load(f))

    cookies = []
    for name, value in cookie_defs.items():
        if value:
            cookies.append({
                "name":   name,
                "value":  value,
                "domain": ".instagram.com",
                "path":   "/",
                "httpOnly": name == "sessionid",
                "secure": True,
            })
    return cookies


async def scrape_profile(page, client: dict) -> dict:
    """Abre el perfil de Instagram y extrae los tres contadores del header."""
    result = {
        "name":      client["name"],
        "handle":    client["handle"],
        "posts":     0,
        "followers": 0,
        "following": 0,
        "error":     None,
    }
    try:
        await page.goto(client["url"], wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(3_500)

        if "accounts/login" in page.url:
            result["error"] = "Redirigido al login — se necesitan cookies de sesión válidas"
            return result

        # Instagram muestra los contadores en <span title="1.234"> dentro del header
        stats = await page.evaluate("""() => {
            const spans = Array.from(document.querySelectorAll('header span[title]'));
            return spans.map(s => s.getAttribute('title'));
        }""")

        if len(stats) >= 3:
            result["posts"]     = parse_count(stats[0])
            result["followers"] = parse_count(stats[1])
            result["following"] = parse_count(stats[2])
            return result

        # Fallback: buscar los números directamente en el texto del header
        header_text = await page.evaluate("""() => {
            const h = document.querySelector('header section');
            return h ? h.innerText : '';
        }""")

        # Patrón: "295 publicaciones  5.429 seguidores  893 seguidos"
        matches = re.findall(
            r"([\d.,]+\s*(?:mil|k|m|millones)?)\s*(?:publicaciones?|posts?|seguidores?|followers?|seguidos?|following)",
            header_text,
            re.IGNORECASE,
        )
        if len(matches) >= 3:
            result["posts"]     = parse_count(matches[0])
            result["followers"] = parse_count(matches[1])
            result["following"] = parse_count(matches[2])
        else:
            result["error"] = f"No se pudo parsear el header. Texto: {header_text[:300]!r}"

    except Exception as exc:
        result["error"] = str(exc)

    return result


def create_notion_row(notion, data: dict, dry_run: bool = False) -> str:
    """Crea una nueva página en la base de datos Notion y devuelve su URL."""
    if dry_run:
        return "(dry-run)"

    resp = notion.pages.create(
        parent={"type": "database_id", "database_id": DATA_SOURCE_ID},
        properties={
            "Cliente": {
                "title": [{"text": {"content": data["name"]}}]
            },
            "Usuario Instagram": {
                "rich_text": [{"text": {"content": data["handle"]}}]
            },
            "Publicaciones Totales": {"number": data["posts"]},
            "Seguidores Actuales":   {"number": data["followers"]},
            "Seguidos Actuales":     {"number": data["following"]},
            "Seguidos":              {"number": data["following"]},
            "Última Actualización":  {"date": {"start": TODAY}},
            "Estado":                {"status": {"name": "Activo"}},
        },
    )
    return resp["url"]


async def main(cookies_path: str | None, dry_run: bool):
    from playwright.async_api import async_playwright
    from notion_client import Client

    notion  = Client(auth=NOTION_TOKEN)
    cookies = load_cookies(cookies_path)
    if not cookies:
        print("⚠  No se encontraron cookies de Instagram. Los perfiles probablemente fallarán.")
        print("   Ver instrucciones al inicio del script.\n")

    results = []
    failed  = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="es-AR",
        )

        if cookies:
            await context.add_cookies(cookies)

        page = await context.new_page()

        for client in CLIENTS:
            print(f"⏳ {client['name']} ({client['handle']}) …", flush=True)
            data = await scrape_profile(page, client)
            results.append(data)

            if data["error"]:
                print(f"   ⚠  Error: {data['error']}")
                failed.append(client["name"])
            else:
                print(f"   Posts={data['posts']} | Seguidores={data['followers']} | Seguidos={data['following']}")

            try:
                url = create_notion_row(notion, data, dry_run)
                print(f"   ✓  Notion: {url}")
            except Exception as exc:
                print(f"   ✗  Error en Notion: {exc}")

            await asyncio.sleep(2)

        await browser.close()

    print("\n" + "=" * 60)
    print(f"RESUMEN — {TODAY}")
    print("=" * 60)
    print(f"Filas creadas: {len(results) - len(failed)}/{len(results)}")
    if failed:
        print(f"Clientes fallidos ({len(failed)}): {', '.join(failed)}")
    else:
        print("Todos los clientes scrapeados con éxito.")
    print("=" * 60)

    return results, failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scraper Instagram → Notion para Citenza")
    parser.add_argument("--cookies", help="Ruta a archivo cookies.json (ver instrucciones)")
    parser.add_argument("--dry-run", action="store_true", help="No escribe en Notion")
    args = parser.parse_args()

    asyncio.run(main(args.cookies, args.dry_run))
