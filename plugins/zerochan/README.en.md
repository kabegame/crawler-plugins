# Zerochan anime image board — plugin guide

This plugin crawls anime images from `zerochan.net` and queues them for download. The site is
**pure server-side rendering** — listings and post pages arrive complete in the first HTML
response — so the plugin is a lightweight `fetch` + DOM parse pipeline with no WebView.

What makes Zerochan worth crawling is its **hand-curated tag system**: every tag is categorised
(mangaka / series / character / theme / source), credited to whoever added it, and each post
records where the original was published (Pixiv, Twitter, DeviantArt, …). All of it is written
into the image metadata and rebuilt in the image detail sidebar using the site's own palette.

## Crawl modes

- **Browse all (all)** — the whole site without a tag: `/?s=…&p=N`
- **Tag (tag)** — one on-site tag: `/<Tag+Name>?s=…&p=N`
- **Search (search)** — any free text: `/search?q=…`. The site jumps to the best matching tag
  and keeps filtering with the remaining words (e.g. `blue hair smile` lands on `Blue Hair`
  with the rest applied on top).

All three modes accept a **sort order**:

- **Recent (id)** — newest uploads first
- **Popular (fav)** — most favorited first

## Options

- **Crawl mode (crawl_mode)** — browse all / tag / search
- **Tag (tag)** — canonical on-site tag name, e.g. `Arknights`, `Hatsune Miku`, `Genshin Impact`
- **Search query (search_query)** — any free text
- **Sort (sort_order)** — recent / popular
- **Start page / End page (start_page / end_page)** — 48 items per page, at most 100 pages per run
- **Quality (quality)**
  - **High** — original file (`static.zerochan.net/….full.….jpg`)
  - **Medium** — the site's 1024px webp preview

## Metadata

Every image carries metadata parsed from its post page, rendered in the detail sidebar by
`description.ejs` as a faithful rebuild of the site's own right-hand column:

- `tags` — per tag: canonical `tag`, displayed `label`, `type`, sprite `icon`, on-site `url`,
  who added it (`by`), plus `fav` / `primary` flags
- `tags_string` — canonical names joined, ready for a follow-up search
- `source` — the original publication URL and its site icon name (pixiv / twitter / deviantart / …)
- `share` — the site's three share strings: direct link, BBCode thumbnail, HTML thumbnail
- `stats` — dimensions, megapixels, favorites, tag count
- `post_id`, `title`, `permalink`, `breadcrumbs`, `mangaka`, `uploader`, `uploaded_at`
- `file_size`, `file_ext`, `width`, `height`, `full_url`, `sample_url`

The sidebar's four blocks (Tags / Source URL / Share / Stats) **follow the app language**
(Simplified Chinese, Traditional Chinese, English, Japanese, Korean). Tag colours and icons come
straight from the site's own stylesheet, and light/dark tracks the app theme. Each share string
has a one-click copy button.

## Notes

- **The site has a bot check**: the first request returns 503 "Checking browser...". The plugin
  clears it automatically, obtains the `xbotcheck` cookie and retries — no manual step needed.
- **Anonymous visitors don't see everything**: listing pages say "Some images on this page are for
  members only", so a page usually yields fewer than 48 items. Log in via Surf to see them all.
- **Use canonical tag names**: the tag field is an on-site tag, not free text. When unsure, use
  **search** mode and let the site do the matching.
- **Please crawl politely**: at most 100 pages per run (more is rejected), end page must be ≥ start
  page, and requests are throttled between posts.
- A working proxy is usually required.

Enjoy!
