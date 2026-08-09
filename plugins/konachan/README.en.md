# Konachan Anime Wallpaper - Plugin Guide

This plugin fetches anime wallpapers from `konachan.net` and adds them to the download queue.

## Config

- **Start page (start_page)**: First page to crawl (min 1).
- **End page (end_page)**: Last page to crawl. **Please keep at most 100 pages per run**; over the limit will be rejected.
- **Quality (quality)**:
  - **High**: Prefer high-resolution images; falls back to medium if not available.
  - **Medium**: Medium quality (default).

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
