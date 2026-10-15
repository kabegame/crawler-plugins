# AIBooru

[AIBooru](https://aibooru.online) is a Danbooru-based board for AI-generated art. Every post is tagged by the community, and many also carry the generation parameters (prompt, negative prompt, sampler, seed, model). This plugin uses the site's public JSON API and needs no login.

## Crawl modes

- **All**: newest uploads first, page by page.
- **Tags**: search by a tag combination. The site allows at most 4 tags per search, and `order:` counts as one; `rating:`, `status:` and `id:` do not count.
- **Popular**: daily, weekly or monthly ranking. The site counts days in US Eastern time; right after midnight today's daily ranking is empty, so the plugin falls back to the previous day.
- **ID range**: crawl a range of post IDs in ascending order, at most 5000 apart.

## Rating

A large share of the site is R-18 (often over half of the popular ranking), so the rating filter defaults to **General** only. The popular endpoint cannot filter by rating, so the plugin filters each post itself and a page of 100 may yield only a few matches.

## Quality

- **High**: the original file. Original PNGs usually still contain the full generation parameters.
- **Medium**: the site's resized sample (JPEG / WebP), much smaller.

## Metadata

When previewing an image in the app, the plugin details panel follows the layout of an AIBooru post page: grouped tags with post counts, Information, Original Commentary, AI Metadata and comments. All of it is a snapshot taken at download time.

Tags go into the label albums `aibooru/artist`, `aibooru/model`, `aibooru/copyright`, `aibooru/character`, `aibooru/general` and `aibooru/meta`. Prompts, negative prompts and model names are also searchable with the metadata search scope.
