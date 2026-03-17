# anihonet Anime Wallpaper - Plugin Guide

This plugin fetches wallpapers from the daily ranking on `anihonetwallpaper.com` and adds them to the download queue.

## How desktop vs mobile is determined

- **Mobile wallpaper**: The image URL’s **filename** (last path segment) contains `Android` (case-insensitive).
- **Desktop wallpaper**: It does not contain `Android`.

> Example: `xxx_Android_xxx.jpg` is treated as mobile; `xxx_PC_xxx.jpg` as desktop.

## Config

- **Start page (start_page)**: First page to fetch (1–5).
- **End page (end_page)**: Last page to fetch (1–5).
- **Wallpaper type (wallpaper_type)**: Single choice — **Desktop** (imgpc) or **Mobile** (sp).
- **Ranking period (ranking_period)**: Single choice — Daily, Weekly, Monthly, or Annual.

## Tips

- Mobile only: choose **Mobile** for wallpaper type.
- Desktop only: choose **Desktop** for wallpaper type.

楽しんで～
![image](./image.jpg)
