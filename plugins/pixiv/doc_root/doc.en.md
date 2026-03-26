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

- **Rankings**: Ranking type, content type, start date, end date (inclusive; calendar UI, stored as `YYYYMMDD`).
- **Bookmarks**: User UID.
- **Artist**: User UID, artist UID.
- **Keyword**: Search keyword, search mode (safe / R18 / all), sort (by date / by popularity). **Keyword + sort lets you target exactly what you want.**

## Max artworks (`num_artworks`)

Integer **1–1000**, used in **all four modes**. The cap counts **artworks** (one illustration entry), not final image files; **multi-page works** still download each page, so **file count can exceed** `num_artworks`.

The script is **streaming**: it requests list APIs **page by page**, and for each `illust_id` it immediately calls `ajax/illust/{id}/pages` and downloads originals. When `num_artworks` is reached it **stops**—it does **not** precompute a fixed page count from the cap, avoiding empty-page **404**s.

### Behaviour summary

1. **Rankings**  
   Days from start to end; each day starts at `p=1` for `ranking.php?...&format=json`. Each `illust_id` in `contents` is **downloaded before** counting toward the cap. If a page request fails (e.g. **404**, no next page), that day’s paging stops and the next day continues if still under the cap. Fewer than **50** `contents` entries means last page for that day.

2. **Bookmarks**  
   `limit=48` per page; after each response, **download** works on that page until the cap or no more bookmarks.

3. **Artist**  
   Still one **`profile/all`** call (no list pagination); then iterate `body.illusts` keys **in order**, download until `num_artworks`.

4. **Keyword**  
   Like rankings: search pages `p=1,2,…`, download as you go until the cap or a short page.

## Example runs (what the script actually does)

Cookie and mode-specific query values come from your form; dates are **`YYYYMMDD`** (no dashes).

### Example A: Rankings (streaming, by day)

| Field | Example |
|-------|---------|
| Source | Rankings |
| Ranking mode | Daily (`daily`) |
| Content | All (`all`) |
| Start / end date | e.g. `20240101`–`20240102` |
| Max artworks | `120` |

**Flow**  
For each calendar day, request  
`https://www.pixiv.net/ranking.php?mode=daily&content=all&date=YYYYMMDD&p={p}&format=json`.  
For each `illust_id` in `contents`: **finish that artwork’s** `pages` → `urls.original`, then increment the counter; at **120** the **whole task** ends. If `p=k` errors (including 404), no more pages that day; if still under 120, move to the next day.  
This **replaces** the old “precompute `num_pages` from `num_artworks`” batch list phase.

---

### Example B: Bookmarks (paged, download as you go)

| Field | Example |
|-------|---------|
| Source | Bookmarks |
| User UID | e.g. `12345678` |
| Max artworks | `50` |

**Flow**  
From `offset=0`, `limit=48` per request; for each `body.works[].id` run the `pages` download until **50** artworks processed or the page has fewer than 48 items.

---

### Example C: Artist (one list request, streaming cap on download)

| Field | Example |
|-------|---------|
| Source | Artist works |
| Logged-in user UID (`x-user-id`) | Your account UID |
| Artist UID | e.g. `87654321` |
| Max artworks | `5` |

**Flow**  
One request to `https://www.pixiv.net/ajax/user/87654321/profile/all?lang=zh`, then download **at most 5** artworks in key order (each may be multi-image).

---

### Example D: Keyword search (streaming by search page)

| Field | Example |
|-------|---------|
| Source | Keyword |
| Keyword | e.g. `初音ミク` |
| Search mode | Safe (`safe`) |
| Sort | By date (`date_d`) |
| Max artworks | `25` |

**Flow**  
`p=1,2,…` on `ajax/search/artworks/...`; for each page, download `illustManga.data[].id` until **25** or fewer than **60** results (usually no next page).

---

These four examples map to the four `source` values. R18 / weekly / monthly only change URL semantics. **Common rule:** cap is `num_artworks`; modes with paged lists are **streaming** (the next list page is only fetched when more artworks are still needed).

## Notes

- On 403 errors, try refreshing your cookie. Occasional 403 may be rate limiting; run the task again or download manually from the Surf page.
- Refresh cookie when it expires.
- Keywords support advanced syntax, e.g. `(Lucy OR 边缘行者) AND 5000users`.
- **Sort by popularity** requires a Pixiv Premium account; use "Sort by date" otherwise.
- Set a reasonable max artwork count to avoid overloading Pixiv.
