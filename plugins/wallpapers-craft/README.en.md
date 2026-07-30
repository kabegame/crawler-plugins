# WallpapersCraft wallpapers

This plugin fetches wallpaper lists and download links from [WallpapersCraft](https://wallpaperscraft.com) so you can browse or batch-download them in Kabegame.

## When to use it

- Browse by the site’s **category tree** (e.g. Anime, Nature).
- Filter by **tags** (same as the site’s tag pages).
- Limit **sort order** or **resolution** to reduce noise.

## Before you start

- Rights belong to the site and creators; follow their terms and keep crawl rate and page counts reasonable.
- **End page** is capped by the site’s real page count so requests stay in range.

## Options

### Mode

- **Catalog**: Pick a fixed category below; maps to `/catalog/...` on the site.
- **Tag**: Enter a tag name; maps to `/tag/...`. If **left empty**, the plugin crawls the global list (like `/all`), which is broad—use page limits.

### Catalog (Catalog mode only)

Same as the site: 3D, Abstract, Anime, Nature, Technologies (URL uses `hi-tech`), etc.

### Tag (Tag mode only)

Use the tag slug as in the tag page URL. Empty = no tag filter, `/all`.

### Sort

- **Default**: Site default order.
- **By downloads**: Popularity / download-oriented order.
- **By date**: Time-oriented order.

### Resolution category and exact size

- **Unspecified**: No resolution filter; same as the site default list.
- **Mobile / Apple / Fullscreen / Widescreen**: Pick a group, then a concrete size (e.g. 1920×1080, 3840×2160). Only that resolution path is crawled.

### Start page / End page

Inclusive page range; max values follow plugin settings. If the site has fewer pages, crawling stops at the last real page.

## Tips

1. First run: try **Catalog** + a common category (e.g. Anime) and a **small end page**.
2. For a tag, switch to **Tag** and match the URL segment from the browser.
3. For one desktop width, set **resolution category** and size to narrow results.
