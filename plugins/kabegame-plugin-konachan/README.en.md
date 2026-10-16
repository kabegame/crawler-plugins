# Konachan Anime Wallpaper - Plugin Guide

This plugin fetches anime wallpapers from `konachan.net` and adds them to the download queue.

## Config

- **Start page (start_page)**: First page to crawl (min 1).
- **End page (end_page)**: Last page to crawl. **Please keep at most 100 pages per run**; over the limit will be rejected.
- **Quality (quality)**:
  - **High**: Prefer high-resolution images; falls back to medium if not available.
  - **Medium**: Medium quality (default).

## Ranking mode (popular)

- **Ranking type (popular_scale)**: Daily / Weekly / Monthly follow calendar periods; Last 24 hours / week / month / year are rolling windows up to now
- **Ranking date (popular_date)**: daily, weekly and monthly rankings can look back to a given date; empty = current period
- **Periods (popular_periods)**: how many consecutive periods to crawl going back from that date, at most 100 per run. Each period on the site is a single page of at most 40 posts
- **Rating filter** is applied by the plugin per post in this mode (ranking pages take no search parameters). konachan.net only shows all-ages posts, so the same period usually has fewer posts there than on konachan.com

## ID range mode (id_range)

- **Start ID / End ID (id_start / id_end)**: inclusive post ID range — the number in the post URL `/post/show/<id>`. Both must be positive integers, the end ID must not be below the start ID, and they may differ by **at most 5000**, otherwise the run is refused
- Crawls every post in the range in ascending ID order; no page numbers needed. Deleted IDs are skipped, so the actual count is usually well below the range width
- **Rating filter** is added to the site search string, as in the All and Tags modes

## Usage

1. Set the page range (start to end).
2. Choose image quality.
3. Click "Start crawl".
4. The plugin will open list pages and then each detail page to download images.

## Notes

- **Be polite**: Max 100 pages per run; excess will be rejected.
- **End page must be ≥ start page**, or the task will error.
- If you choose "High" but no high-res version exists, it will fall back to medium.
- Set a reasonable page range to avoid overloading the server.

Enjoy～
![img](./banners/image.jpg)
