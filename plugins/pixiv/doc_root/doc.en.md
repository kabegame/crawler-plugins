# Pixiv Crawler - Plugin Guide

This plugin fetches illustrations from Pixiv. It supports four modes: rankings, bookmarks, artist works, and keyword search.

## HTTP Headers (Required)

Pixiv API requires authentication and Referer. **You must set Cookie under "Advanced settings → HTTP headers"**; it is not injected as a plugin variable.

### How to Get Cookie

#### Method 1: Copy from browser

1. **Log in** (or register) at [pixiv.net](https://www.pixiv.net) in your browser.

![home](./images/home.png)

2. Open Developer Tools (F12), switch to the Network tab (red box in the image).

![console](./images/console.png)

3. Copy your cookie as shown in the image.

![cookie](./images/cookie.png)

4. Open Kabegame.
5. Add the HTTP header in the config that requires cookie.

![header](./images/header-config.png)

#### Method 2: Copy from Kabegame Surf (easier, desktop only)

1. Open Kabegame and go to the Surf tab.

![kabegame-surf](./images/kabegame-surf.png)

2. Quick entry → select Pixiv → click "Start surfing". A Pixiv window will open; log in if prompted.

![surf-pixiv](./images/surf-pixiv.png)

3. After logging in, click "View site cookie" (keep the window open). A dialog will show the cookie; copy it.

![cookie-dialog](./images/cookie-dialog.png)

4. You're all set!

### How to Get User ID (yours or an artist’s)

Open the user’s profile on Pixiv. The numeric part in the URL (middle or end) is the user ID.

![user](./images/user.png)

### When Cookie Is Required

| Mode | Cookie |
|------|--------|
| Rankings (non-R18) | Optional |
| Rankings (R18) | Required |
| Bookmarks | Required |
| Artist works (non-R18) | Optional |
| Artist works (R18) | Required |
| Keyword search (non-R18) | Optional |
| Keyword search (R18) | Required |

## Crawl Types

- **Rankings**: Download works by daily/weekly/monthly ranking for a given date.
- **Bookmarks**: Download your public bookmarks.
- **Artist works**: Download public works of a given artist.
- **Keyword search**: Search by keyword and download.

## Config Fields

Fields depend on the selected mode:

- **Rankings**: Ranking type, content type, start date (YYYYMMDD), date range, max count.
- **Bookmarks**: User UID, max count.
- **Artist**: User UID, artist UID, max count.
- **Keyword**: Search keyword, search mode (safe / R18 / all), sort (by date / by popularity), max count. **Keyword + sort lets you target exactly what you want.**

## Notes

- On 403 errors, try refreshing your cookie. Occasional 403 may be rate limiting; run the task again or download manually from the Surf page.
- Refresh cookie when it expires.
- Keywords support advanced syntax, e.g. `(Lucy OR 边缘行者) AND 5000users`.
- **Sort by popularity** requires a Pixiv Premium account; use "Sort by date" otherwise.
- Set a reasonable max count to avoid overloading Pixiv.
