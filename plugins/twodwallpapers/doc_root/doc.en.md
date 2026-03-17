# 2dwallpaper Plugin Guide

Fetches wallpapers from [2dwallpapers.com](https://2dwallpapers.com). When creating a task you choose a **main category**, optionally set a **subcategory keyword**, and choose **sort order**.

## Main category

The main category is the site’s top-level section (e.g. anime, game, uncategorized).

| UI label    | Description |
|------------|-------------|
| Anime      | `anime-wallpapers` |
| Game       | `game-wallpapers` (e.g. Genshin, Honkai) |
| Uncategorized | `uncategorized` |

The crawler opens that category’s list page, then filters subcategories by the keyword below.

![cate](./images/cate.png)

## Subcategory keyword

The main page lists **subcategories** (e.g. Genshin, Honkai). The keyword filters which subcategory to crawl.

- **Set a keyword**: Only subcategories whose name matches (regex) are crawled. e.g. `Genshin` for Genshin only; `Genshin|Honkai` for several.
- **Leave empty**: No name filter; the script will use the first subcategory it finds. To crawl all, use a suitable keyword or run multiple tasks.

**Example**: Main category “Game”, keyword `Genshin` → only “Game → Genshin” is crawled.

![scate](./images/scate.png)

## Sort order

List order is controlled by **orderby** and affects crawl order.

| UI label   | Site value   | Description |
|------------|--------------|-------------|
| Newest     | `Newest`     | By publish time |
| Most views | `Popularity` | By view count |
| Most likes | `Likex`      | By like count |
| Most favs  | `Favorites`  | By favorite count |
| Recent update | `Update`  | By last update |
| Random     | `Random`     | Random order |

To get the most popular “Game → Genshin” wallpapers, choose “Most views” or “Most likes”.

## Other options

- **Max count**: Maximum images to download per task (1–1000).

## Examples

- “Game” + keyword `Genshin` + “Most views” + max 100 → first 100 most-viewed wallpapers in Game → Genshin.
- “Anime” + keyword for a subcategory + “Newest” + max count → latest wallpapers in that anime subcategory.
