# anihonet Anime Wallpapers

A Kabegame plugin that collects anime and game wallpapers from [anihonetwallpaper.com](https://anihonetwallpaper.com), with support for both mobile and desktop wallpapers.

## Crawl modes

The plugin provides three crawl modes. The default is **Ranking**. After a mode is selected, Kabegame only displays the settings required by that mode.

### Ranking

Crawl wallpapers by ranking period, ranking category, and page range.

- Ranking periods: Daily, Weekly, Monthly, and Annual.
- Ranking categories: All, Mobile, High-quality images, High-quality PC, and PC wallpapers.
- Both the start and end pages can be set from `1` to `5`. By default, pages `1` through `5` are crawled.

For example, selecting **Daily** and **Mobile** uses the path `ranking-daily-sp`.

### Single work

Select one anime or game from the list built into the plugin. Each item maps to an `images/`, `category/`, or `tag/` path on the site.

After selecting **Single work**, choose the desired title in **Work** and set the **Work list start page** and **Work list end page**. The default range is pages `1` through `10`. The plugin logs both the requested and detected ranges, and warns when the requested range extends beyond the site's last page.

### Search

Use the site's native search URL to crawl results by keyword, with configurable direction, sorting, and page range.

- The search keyword becomes the URL's `s` parameter. It can be a title, character name, or any other content supported by the site search.
- Direction maps to `order=DESC|ASC` and defaults to descending.
- Sorting maps to `orderby=post_date|rand` and defaults to published date. Direction has no effect on random sorting.
- Search start and end pages default to `1` through `10`, inclusive.
- The plugin detects the site's actual last page, skips any excess range, and writes a warning.

## Examples

### Crawl high-quality PC wallpapers from the daily ranking

1. Set **Crawl mode** to **Ranking**.
2. Set **Ranking period** to **Daily**.
3. Set **Ranking category** to **High-quality PC**.
4. Set the start and end pages, then run the task.

### Crawl a specific work

1. Set **Crawl mode** to **Single work**.
2. Select the desired anime or game in **Work**.
3. Set the work list start and end pages, then run the task.

### Search for wallpapers

1. Set **Crawl mode** to **Search**.
2. Enter a search keyword and choose the direction and sorting.
3. Set the search start and end pages, then run the task.

## Development

```bash
npm run build
```

The build output entry point is `dist/main.js`.

Enjoy!

![anihonet anime wallpapers](./image.jpg)
