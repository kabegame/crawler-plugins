# yande.re anime wallpapers — plugin guide

This plugin crawls high-resolution anime wallpapers from `yande.re` into the download
queue. The site runs Moebooru (the same software as konachan), so its list pages
and post pages are structurally identical to the konachan plugin's.

## Crawl modes

- **All** — newest posts site-wide (`/post?page=N`)
- **Tags** — search by a tag combination (`/post?tags=a+b&page=N`)
- **Ranking** — the site's popular rankings. Daily / Weekly / Monthly (`/post/popular_by_day|week|month`) can look back by date; Last 24 hours / week / month / year (`/post/popular_recent`) are rolling windows with only the current period. Each period is a single page of at most 40 posts

## Options

- **Tag combination (mode_tag_value)** — list input, joined with `+` at runtime; spaces become `_`
- **Rating filter (rating)** — Any / Safe / Questionable / Explicit, implemented as the
  site's `rating:` metatag in all and tags modes; in ranking mode the plugin filters each post by its rating
- **Sort order (sort_order)** — Newest / Highest score / Largest resolution / Random,
  i.e. the site's `order:` metatag
- **Start page / End page** — at most 100 pages per run; **40 posts per page**
- **Ranking type / Ranking date / Periods** — for ranking mode. An empty date means the current period; periods is how many consecutive periods to crawl going back from that date, at most 100 per run
- **Quality**
  - **High** — the original-file link behind "View larger version"; falls back automatically
    when a post has no larger version
  - **Medium** — the site's scaled `#image` sample

## Metadata

Every image carries metadata parsed from its post page, rendered in the image detail
sidebar by `description.ejs`:

- `sidebar_tags` — each tag's `name` / `display` / `type` / `count` / search link / wiki link
- `stats` — `post_id`, `size`, `rating`, posted time (relative wording plus the absolute
  timestamp from `title`), and up to 24 favoriters (with the full count in `favorited_total`)
- `posted_by_name` / `posted_by_href`, `source_href`, `score`
- `related` — the post page's Related Posts (previous / next / random)
- **`comments`** — the comment section at the bottom of the post page: author, avatar,
  relative time (with the absolute timestamp from `title`) and body, up to 30 entries,
  with the full count in `comment_total`

Sidebar tags are also written to the app's **Labels** section by type (`yandere/artist`,
`yandere/character`, …), so you can browse them on the albums page and filter by tag in search.

The gallery's plugin extension also filters downloaded images by **score** (`5+` … `1000+`
buckets; a path segment also accepts ranges such as `100-500`, `100+` or `-50`) and by
**rating** (Safe / Questionable / Explicit).

## Notes

- **40 posts per page is fixed by the site**; there is no usable per-page parameter while
  logged out.
- **Favoriters and comments are truncated** (24 / 30). Popular posts can have thousands of
  favoriters; metadata is stored whole and participates in album list queries, so leaving
  it unbounded noticeably slows the album views down.
- **Crawl politely** — at most 100 pages per run; the end page must be ≥ the start page.
- The site mixes adult and all-ages content. Set the rating filter to Safe if you only
  want clean images.
- Originals here are often 7000px+ and tens of MB — mind your disk and bandwidth on High.
- A working proxy is usually required.

Enjoy!
