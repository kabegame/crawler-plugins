# Danbooru image board — plugin guide

Crawls posts from `danbooru.donmai.us` into the download queue, and **stores the full tag set from each
post page as image metadata** — the tag taxonomy is what this site is really worth, and the image detail
sidebar lets you copy it straight out as an AI prompt.

## Crawl modes

- **Tags** — tag search via `/posts?tags=...`, the common case
- **Popular** — daily / weekly / monthly ranking via `/explore/posts/popular`
- **All** — newest posts site-wide via `/posts`
- **Tag list** — browse `/tags` by a name pattern first, then crawl posts for each matched tag

## Options

- **Source site** — `danbooru.donmai.us` (full) or `safebooru.donmai.us` (general rating only)
- **Tag combination** — list input, joined with spaces at runtime; spaces inside a tag become `_`
- **Popular scale** — day / week / month
- **Start page / End page** — at most 100 pages per run
- **Posts per page** — 20 / 50 / 100 / 200
- **Tag pattern** — name pattern for the tag list mode, `*` is a wildcard (e.g. `*genshin*`)
- **Tag category** — Any / General / Artist / Copyright / Character / Meta
- **Tag order** — Count / Name / Date
- **Skip tag count / Tag count / Pages per tag** — breadth and depth of the tag list mode
- **Quality**
  - **High** — the original file (some posts are tens of MB)
  - **Medium** — the site's resized sample; video posts have no sample and fall back to the original

## Metadata

Every image carries metadata parsed from its post page, rendered in the detail sidebar by `description.ejs`:

- `tags_string` — **the full tag string**, ordered artist → copyright → character → general → meta, with a copy button
- `tags` — per tag: `name` / `display` / `type` / `count` / search link / wiki link
- `tags_by_type` — tag names grouped by category
- `post_id`, `rating`, `score`, `fav_count`, `status`
- `file_size`, `file_ext`, `width`, `height`, `original_href`, `sample_href`
- `uploader_name` / `uploader_href`, `posted_date_iso`, `source_href`
- `commentary` — the artist's original commentary title and body

The plugin also registers PathQL providers, so the gallery can browse downloaded images by
**tag category → tag**.

## Notes

- **The site limits anonymous / basic accounts to 2 tags per search.** A third tag triggers a WARN and the
  site will most likely return nothing. Log in through Surf and upgrade your account level for more.
- **Crawl politely** — at most 100 pages per run; the end page must be ≥ the start page.
- The site hosts adult content; `danbooru.donmai.us` filters it by default for logged-out users, and
  `safebooru.donmai.us` is the general-rating-only mirror.
- A working proxy is usually required.
- mp4 / webm video posts are downloaded from their original file URL.

Enjoy~
