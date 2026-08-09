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

After selecting **Single work**, choose the desired title in the **Work** setting.

### By theme (index search)

On the site's title index, the plugin matches link text against the **Theme keyword**, opens the first theme containing that string, and then crawls the specified page range.

- The theme keyword is empty by default. For the best match, enter the exact Japanese text used on the site and mind letter case.
- The theme list start page defaults to `1` and has a minimum value of `1`.
- The theme list end page defaults to `10`, has a minimum value of `1`, and is inclusive.
- If the site has no next page, the task ends early.

## Examples

### Crawl high-quality PC wallpapers from the daily ranking

1. Set **Crawl mode** to **Ranking**.
2. Set **Ranking period** to **Daily**.
3. Set **Ranking category** to **High-quality PC**.
4. Set the start and end pages, then run the task.

### Crawl a specific work

1. Set **Crawl mode** to **Single work**.
2. Select the desired anime or game in **Work**.
3. Run the task.

### Crawl by theme keyword

1. Set **Crawl mode** to **By theme (index search)**.
2. Enter a theme keyword matching the link text on the site.
3. Set the theme list start and end pages, then run the task.

## Development

```bash
npm run build
```

The build output entry point is `dist/main.js`.

Enjoy!

![anihonet anime wallpapers](./image.jpg)
