# wallspic plugin

This plugin crawls wallpaper listings on [wallspic.com](https://wallspic.com) and downloads full images, for batch collection in Kabegame by album or tag.

## When to use it

- **Album mode**: Browse by the site’s album categories (e.g. Anime, Nature, Technology).
- **Tag mode**: Crawl a tag page (same as `/tag/...` on the site).
- You can limit **sort order**, **device / resolution**, and **page range**.

## Before you start

- Rights belong to the site and creators; follow their terms and keep page counts and frequency reasonable.
- **End page** is capped by the maximum page the script reads from the site, avoiding useless requests.

## Options

### Mode

- **Album**: Uses **Album category** below; path is `/album/{slug}`. **All categories** uses the home list.
- **Tag**: Set **Tag keyword** (English slug as in the tag URL). **Empty** uses the home list (broad—limit pages).

### Album category (Album mode only)

Matches wallspic albums: Brands, Anime, Games, Nature, etc.

### Tag keyword (Tag mode only)

e.g. `anime`. Should match the tag segment in the browser URL.

### Sort

- **New**: Default (newest; no `popular` segment in the path).
- **Popular**: Popular sort (`popular` in the path).

### Resolution mode

- **All wallpapers**: No resolution filter.
- **Mobile / Desktop**: Uses the site’s mobile or desktop wallpaper paths.
- **Specific resolution**: Pick a **resolution preset group** (Ultra HD / Apple / Android / Widescreen), then an exact size; the plugin adds the right slug to the list URL.

### Start page / End page

Inclusive range. The real cap is the plugin max and the site’s pagination.

## Tips

1. First run: **Album** + a common category and a **small end page**.
2. For one tag, use **Tag** mode and match the URL slug.
3. For one resolution, use **Specific resolution** and pick group + size to cut noise.
