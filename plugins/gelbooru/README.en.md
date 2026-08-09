# Gelbooru image board - Plugin guide

This plugin crawls posts from `gelbooru.com` into the download queue **and writes the full tag list
from each post page into the image metadata** — the tag taxonomy is the most valuable part of this
site, and an AI-art prompt can be copied straight from the image detail sidebar.

## Crawl modes

- **Tags**: search by tag combination, `index.php?page=post&s=list&tags=...` — the common case
- **All**: the newest posts site-wide (`tags=all`)
- **Tag list**: browse the tag table at `index.php?page=tags&s=list` by pattern, then crawl each tag's posts

## Configuration

- **Tag combination (mode_tag_value)**: a list; joined with `+` at runtime, and spaces inside a tag become `_`
- **Sort order (sort_order)**: Newest / Highest score / Recently updated / Random. Implemented by appending
  the site's `sort:` metatag (e.g. `sort:score:desc`) to the search query like an ordinary tag
- **Start page / End page (start_page / end_page)**: at most 100 pages per run, **42 posts per page**
- **Tag pattern (tag)**: name match for tag list mode, `*` is a wildcard, e.g. `*genshin*`
- **Tag category (mode_tag_type)**: Any / General / Artist / Copyright / Character / Metadata
- **Tag order (mode_tag_order)**: Count / Name / Date
- **Skip tag count / Tag count / Pages per tag**: control the breadth and depth of tag list mode
- **Quality (quality)**:
  - **High**: the original file. Under tags like `absurdres`, PNG originals are often 20-40MB and may not
    finish over a proxy, surfacing as a failed download ("unsupported file format (infer)") — that means the
    transfer was cut short, not that parsing broke; retry or switch to medium
  - **Medium**: the site's resized sample
  - Video posts always take the **mp4** source from `<video>` (the site also serves webm, but desktop
    compatibility copies are H.264 MP4 anyway)

## Metadata

Every image carries metadata parsed from its post page, rendered in the detail sidebar by `description.ejs`:

- `tags_string`: the **full tag string**, ordered artist → character → copyright → metadata → general, copyable in one click
- `tags`: per-tag `name` / `display` / `type` / `count` / search link / wiki link
- `tags_by_type`: tag names grouped by category
- `post_id`, `rating`, `score`, `md5`, `file_ext`, `width`, `height`
- `uploader_name` / `uploader_href`, `posted_date_text`, `source_text` / `source_href`
- `original_href`, `sample_href`, `video_href`, `has_sound`, `has_children`

The plugin also registers PathQL providers, so the gallery can browse downloaded images by
**tag category → tag**.

## Notes

- **42 posts per page is fixed by the site.** The `limit` URL parameter is ignored while logged out
  (it is an account setting), so there is no "posts per page" option; paging uses a `pid` offset rather
  than a page number.
- **The tag table has no category filter.** Choosing a tag category fetches the whole page and filters
  it afterwards, so a narrow category needs more pages to reach the requested tag count.
- **Please crawl politely**: at most 100 pages per run, and the end page must be ≥ the start page.
- The site hosts adult content; while logged out it applies its own default filtering.
- A working proxy is usually required.
- The site has mp4 / webm video posts; the plugin downloads the original file directly.

Enjoy!
