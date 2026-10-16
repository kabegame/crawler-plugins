# Kemono Crawler

This plugin downloads creator posts and their attachments from `kemono.cr`. The content may include adult material. Follow your local laws, the site's rules, and the applicable content licenses.

## Five crawl modes

### Link

Enter a complete URL in either of these forms:

- All posts by a creator: `https://kemono.cr/<service>/user/<uid>`
- One post: `https://kemono.cr/<service>/user/<uid>/post/<pid>`

Links using the old `kemono.su` or `kemono.party` domains are also recognized, but requests always use the current `kemono.cr` domain. A single-post URL calls the post API directly, without browsing the creator's full post list or applying a page range.

### Creator

Select a **Creator service** and enter a **Creator ID**. Supported services are `patreon`, `fanbox`, `gumroad`, `subscribestar`, `dlsite`, `discord`, `fantia`, `boosty`, and `afdian`.

The upstream `kemono-scraper` also supports the sister site Coomer (`onlyfans` and `fansly`), but those services host adult subscription content rather than anime images and are not included in this plugin. Entries from those services are skipped automatically if they appear in a favorites list.

### Favorite creators

Load creators favorited by the current Kemono account, then fetch posts from each creator. **Two page ranges apply at the same time**: the **Favorite creators page range** selects which creators to process, while the **Creator page range** selects which pages of posts to fetch for each creator.

### Favorite posts

Load posts favorited by the current Kemono account, select them using the **page range**, and download them one by one.

### Tag

Enter a site tag such as `nsfw`, `wip`, `comic`, or `nude` to crawl posts carrying that tag across the site, subject to the **page range**. Tags are **case-sensitive** and must match the spelling used on the site. The full tag list is available at `kemono.cr/posts/tags`. This mode does not require login.

## Page ranges

All applicable modes limit crawling in pages of **50 items each**. Page numbering starts at 1. Set an end page to `0` to continue through the final page.

| Mode | Effective page range |
|---|---|
| Creator / creator URL | Creator page range (post list) |
| Favorite creators | Favorite creators page range **plus** Creator page range |
| Favorite posts | Page range |
| Tag | Page range |
| Single-post URL | Not applicable; fetches the post directly |

The plugin works in a **streaming** manner: it downloads all attachments from the current page before moving to the next page instead of building the entire list first. If a task is canceled midway, files already downloaded are retained.

The favorites API returns the entire list at once. The plugin divides that list locally into pages of 50 items so its page semantics match those of post lists.

## Favorite modes and Surf login

Favorite APIs require a login Cookie. The plugin does not read Cookie files or inspect browser Cookies. First open and sign in to `kemono.cr` through Kabegame's **Surf** feature, then run a favorite mode.

If no Cookie for the site is available in Surf, the task immediately asks you to sign in. A `401` or `403` response from a favorites or subsequent list request means the login session has expired; return to Surf and sign in again.

The Link, Creator, and Tag modes do not require login.

## Image source: thumbnails and originals

**Thumbnails are downloaded by default. This is intentional.**

Kemono stores original files on separate nodes named `n1`–`n5` and `c1`–`c3`. Testing in 2026-07 found that these nodes were **unreachable at the TCP layer** from many network environments, with or without a proxy, while the thumbnail host `img.kemono.cr` remained accessible. Therefore:

- **Thumbnail (default):** up to 800 px on the longest side, approximately 30–40 KB each, served by `img.kemono.cr`. Downloads reliably.
- **Original:** served by the file nodes above. Full quality is available if your network can reach them; otherwise every download will fail.

An 800 px image is an obvious quality reduction for wallpaper use, but when the original-file nodes are unreachable, it is the only available route. If your network environment changes, you can switch back to Original in the settings and try again.

**Thumbnail mode automatically skips archives, videos, and other attachments.** These files have no thumbnail and always return 404, so attempting them would flood the entire post with failures.

## Attachments

Post attachments are not always images. They may also be videos, audio, archives, or other file types. In Original mode, the plugin sends every attachment to Kabegame for download. Whether a file can be previewed depends on Kabegame and the media formats supported by the current platform.

**Include banner / primary file** corresponds to the original downloader's `--banner` behavior and adds the post's `file` field to its attachments. Even with this option disabled, a non-image primary file is retained. In Thumbnail mode, it is still skipped because no thumbnail exists.

All attachments from one post share the same compact post metadata. Multiple attachments have `(1)`, `(2)`, and so on appended to the post title. As in the original downloader, image and non-image attachments are numbered separately, so different file types may receive the same number.
