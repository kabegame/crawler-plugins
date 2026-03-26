# anihonet Anime Wallpaper - Plugin Guide

This plugin fetches wallpapers from [anihonetwallpaper.com](https://anihonetwallpaper.com) and adds them to the download queue. It supports **Ranking** and **Anime/game title index** modes. The default is **Ranking** for backward compatibility.

## Crawl mode (`crawl_mode`)

| Value | Description |
|-------|-------------|
| **ranking** (default) | Crawl ranking list pages by period, then open each item’s detail page to download |
| **anime_game** | Start from the [anime/game title index](https://anihonetwallpaper.com/anime-game-wallpaper), pick kana rows, then: theme list → work detail → original image links |

In **anime_game** mode, **anime_game_rows** lets you choose rows (あ/か/さ/…/わ), matching `h3` ids `a`, `ka`, `sa`, … on the site.

## Ranking mode

1. Opens ranking URLs from **start/end page** and **ranking period** (e.g. `ranking-daily-imgpc/1`).
2. The list page collects **every** `<a href>` on the page and visits them in order (may include nav links depending on the HTML).
3. On the detail page, download links are taken from **`a.button:not(.add)`** (excludes anchors with the token class `add`, distinct from `add-dl`).

**Progress (100% of the task)** splits as **per list page → per link on the page → per image on the detail**. Each download slot counts after handling (including skips). If a page has no `a`, that page’s share is added once; if a detail has no buttons, that item’s share is added once.

## Anime/game index mode

1. Opens the index page and parses theme entry `<a href>` values for the rows you selected.
2. On each **theme list** page, work detail URLs come from **`.itiran:last-of-type > a`** (same idea as `$$('.itiran:last-of-type > a')` in the browser).
3. On the detail page, originals use **`a.button.add-dl`**.

**Progress (100% of the task)** splits as **per theme (each list entry) → per work under the theme → per image under the work**. Skips/filters still consume that image’s slice so the bar does not stall.

## Wallpaper type and filters

- **wallpaper_type**: `imgpc` keeps desktop images only; `sp` keeps mobile only. This uses the image URL **filename** containing `Android` (case-insensitive), matching the site’s naming.
- **Originals**: URLs whose path contains **`resize`** (case-insensitive) are treated as thumbnails and **skipped**.

## Config summary

| Key | Role | Shown when |
|-----|------|------------|
| **crawl_mode** | `ranking` / `anime_game` | Always |
| **anime_game_rows** | Kana row checkboxes (a, ka, …, wa) | anime_game only |
| **start_page / end_page** | Ranking pages 1–5 | ranking only |
| **ranking_period** | daily / weekly / monthly / annual | ranking only |
| **wallpaper_type** | imgpc / sp | Always |

## Tips

- Mobile only: set wallpaper type to **Mobile**.
- Desktop only: set wallpaper type to **Desktop**.
- Index mode can be very large—narrow rows first. Logs prefixed with `[anihonet]` show pages and download attempts.

楽しんで～
![image](./image.jpg)
