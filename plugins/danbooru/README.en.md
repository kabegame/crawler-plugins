# Danbooru image board — plugin guide

Crawls posts from Danbooru (by default its general-rating site `donmai.moe`) into the download queue, and **stores the full tag set from each
post page as image metadata**; the tags are also written into the app's
Labels section by category (`danbooru/<category>`), so you can browse them on the albums page and filter by them in search.

## Crawl modes

- **Tags** — tag search via `/posts?tags=...`, the common case
- **Popular** — daily / weekly / monthly ranking via `/explore/posts/popular`
- **All** — newest posts site-wide via `/posts`
- **Tag list** — browse `/tags` by a name pattern first, then crawl posts for each matched tag

## Options

- **Source site** — `donmai.moe` (default, general rating only) or `danbooru.donmai.us` (full)
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

- `tags_string` — **the full tag string**, ordered artist → copyright → character → general → meta
- `tags` — per tag: `name` / `display` / `type` / `count` / search link / wiki link
- `tags_by_type` — tag names grouped by category
- `post_id`, `rating`, `score`, `fav_count`, `status`
- `file_size`, `file_ext`, `width`, `height`, `original_href`, `sample_href`
- `uploader_name` / `uploader_href`, `posted_date_iso`, `source_href`
- `commentary` — the artist's original commentary title and body

The plugin also registers PathQL providers, so the gallery can filter downloaded images by
**score / favorites**: the list offers "at least N" buckets (`5+`, `10+` … `1000+`), and a path segment also
accepts ranges such as `100-500`, `100+` or `-50` (both ends inclusive).

## Notes

- **The site limits anonymous / basic accounts to 2 tags per search.** A third tag triggers a WARN and the
  site will most likely return nothing. Log in through Surf and upgrade your account level for more.
- **Crawl politely** — at most 100 pages per run; the end page must be ≥ the start page.
- The default source `donmai.moe` serves general-rating posts only (even `rating:e` searches return nothing);
  `danbooru.donmai.us` hosts adult content and filters it by the site's defaults for logged-out users.
- A working proxy is usually required.
- The default source `donmai.moe` sits behind a Cloudflare check (the full site `danbooru.donmai.us` does not): on first use (or once the check expires) open `donmai.moe` in Surf and pass the check; the plugin reuses Surf's cookie and browser identity, and fails with a hint when it gets blocked.
- mp4 / webm video posts are downloaded from their original file URL.

Enjoy~
