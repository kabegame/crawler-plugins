# yande.re anime wallpapers — plugin guide

This plugin crawls high-resolution anime wallpapers from `yande.re` into the download
queue. The site runs Moebooru (the same software as konachan), so its list pages,
post pages and tag table are structurally identical to the konachan plugin's.

## Crawl modes

- **All** — newest posts site-wide (`/post?page=N`)
- **Tags** — search by a tag combination (`/post?tags=a+b&page=N`)
- **Tag list** — browse the tag table by pattern (`/tag?name=...`), then crawl each tag's posts

## Options

- **Tag combination (mode_tag_value)** — list input, joined with `+` at runtime; spaces become `_`
- **Rating filter (rating)** — Any / Safe / Questionable / Explicit, implemented as the
  site's `rating:` metatag appended to the search string
- **Sort order (sort_order)** — Newest / Highest score / Largest resolution / Random,
  i.e. the site's `order:` metatag
- **Start page / End page** — at most 100 pages per run; **40 posts per page**
- **Tag pattern (tag)** — name pattern for tag list mode, `*` is the wildcard, e.g. `*genshin*`
- **Tag type (mode_tag_type)** — Any / General / Artist / Copyright / Character / Circle / Faults
- **Tag order (mode_tag_order)** — Count / Name / Date
- **Skip tag count / Tag count / Pages per tag** — breadth and depth of tag list mode
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

The plugin also registers PathQL providers, so the gallery can browse downloaded images
by **tag type → tag**.

## Notes

- **The tag type parameter only accepts numbers.** The site's `/tag?type=` takes `0`
  (general), `1` (artist), `3` (copyright), `4` (character), `5` (circle), `6` (faults).
  Passing an English name raises no error — it is silently treated as `0` (general) —
  which is why the option values are those numbers.
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
