# bilibili Videos

Download bilibili videos. Separate audio and video streams are fetched in chunks, muxed into MP4, and added to the library.

## Example: downloading a bangumi

This example downloads the first three episodes of *The Eccentric Family* Season 1 (`ss507`).

1. Open the bangumi on bilibili and make sure the episodes you want appear in the **Main Episodes** list on the right.
   Copy the bangumi URL from the browser address bar. This example uses
   [https://www.bilibili.com/bangumi/play/ss507](https://www.bilibili.com/bangumi/play/ss507).

   ![The bangumi player and main episode list on bilibili](banners/bangumi-page.jpg)

2. Create a download task in Kabegame, select **bilibili Videos** as the source, and configure the plugin:

   - Set **Mode** to **Bangumi / episodes**.
   - Paste the full URL into **Bangumi URL or id**, or enter only `ss507`.
   - Set **Start episode** to `1` and **Max videos** to `3` to download three episodes starting from Episode 1.
   - Set **Max quality** to `1080P` and leave **Prefer H.264** enabled for better playback compatibility.
   - You can leave **Interval (seconds)** and **Retries** at their defaults of `10` and `1`.

   Choose an output directory and album if needed. Leave them blank to use Kabegame's defaults.

   ![Plugin settings for downloading a bangumi](banners/bangumi-params.jpg)

3. Start the task. The plugin reads the main episode list, downloads the first three episodes in order, muxes the
   separate audio and video streams into MP4 files, and adds them to the gallery. When the task finishes, the source
   page shows the three downloaded videos.

   ![Three downloaded bangumi episodes](banners/downloads.jpg)

4. Select any video to open its details and play it. If a video only has a thumbnail and cannot be played, make sure
   **Prefer H.264** was enabled when it was downloaded. HEVC and AV1 support depends on the current platform.

   ![Playing a downloaded bangumi episode in Kabegame](banners/view.jpg)

## Modes

### Single video

Enter any of the following in **Video id or URL**:

- `BV13x41117TL`
- `av1074402`
- `https://www.bilibili.com/video/BV13x41117TL`

For a multi-part video, use **Part index** to select a part, or enter `0` to download every part.

### Uploader's videos

Enter an uploader UID such as `3985676`, or a profile URL such as `https://space.bilibili.com/3985676`, in
**Uploader UID or space URL**. Each list page contains 30 uploads; use **Start page / End page** to select a range.

**Max videos defaults to 5** as a deliberate safeguard. A page contains 30 videos, and each 1080P video can be
hundreds of megabytes, so a single page may total several gigabytes. Increase the limit only after checking the range.

This mode **always downloads P1 only** from each upload. Otherwise, one upload with 23 parts would produce 23 files.

### Collection / series / favorites

Paste a full URL into **List page URL**. The type is **detected automatically**:

| Type | URL pattern |
| --- | --- |
| Collection | `space.bilibili.com/<UID>/lists/<ID>` (or `?type=season`) |
| Collection (legacy) | `space.bilibili.com/<UID>/channel/collectiondetail?sid=<ID>` |
| Series | `space.bilibili.com/<UID>/lists/<ID>?type=series` |
| Series (legacy) | `space.bilibili.com/<UID>/channel/seriesdetail?sid=<ID>` |
| Favorites | `space.bilibili.com/<UID>/favlist?fid=<ID>` |
| Favorites (short URL) | `bilibili.com/medialist/detail/ml<ID>` |

Collections and series require a **full space URL** because the API needs both the uploader UID and the list ID.
An ID by itself is not enough.

The favorites API returns every item at once without pagination. For this mode, **Start page** is converted to a
starting offset at 30 items per page, and **Max videos** then limits the result. Non-video items such as audio and
articles are skipped with a notice. To access a private favorites list, sign in to Kabegame Surf **as its owner**.

This mode also downloads P1 only from each upload.

### Keyword search

Enter a **Search keyword**. This is equivalent to the **Videos** tab on `search.bilibili.com`. You can choose a sort
order (relevance / most views / newest / most danmaku / most favorites) and a duration filter. Each search page contains
20 results.

**Using a duration filter is recommended.** An hour of 1080P video can exceed 1 GB, and searches can easily match long
videos. Non-upload results such as live rooms and bangumi are filtered out automatically, and duplicate uploads across
pages are deduplicated.

This mode also downloads P1 only from each upload.

### Bangumi / episodes

Enter any of the following in **Bangumi URL or id**. The type is **detected automatically**:

| Type | Format |
| --- | --- |
| Single episode | `ep21495` or `bilibili.com/bangumi/play/ep21495` |
| Full season | `ss26801` or `bilibili.com/bangumi/play/ss26801` |
| Media page | `md24097891` or `bilibili.com/bangumi/media/md24097891` |

Bangumi content uses a dedicated PGC playback API, which is entirely separate from the API for regular uploads and does not
require a WBI signature.

- **Single episode (`ep`)**: downloads only that episode. Section items such as extras, promotional videos, and cast
  programs also have their own `ep` pages and are supported.
- **Full season (`ss` / `md`)**: downloads the **main episode list** in batches, excluding promotional videos and
  extras. Use **Start episode** to select the first episode and **Max videos** to set the limit. A media page (`md`) is
  resolved to its corresponding season first.

The following content is handled explicitly instead of producing unusable files:

- **Premium-member episodes**: without viewing rights, the API only returns a six-minute preview. Previews are not
  added to the library; the episode is skipped with a notice. If you have a premium membership, sign in to bilibili in
  Kabegame Surf first.
- **Region-restricted content**: content limited to Hong Kong, Macau, Taiwan, or overseas regions reports an error when
  accessed from an unsupported region.
- Free and unlocked episodes download normally and follow the same quality rules as regular videos.

## Quality and sign-in

bilibili makes quality levels available according to your sign-in status:

| Status | Available quality |
| --- | --- |
| Signed out | The preview path can usually still provide 1080P |
| Signed in | Reliable 1080P access |
| Premium member | 4K / HDR / Dolby |

Cookies are read from **Kabegame Surf**. For 4K or HDR, sign in to bilibili in Surf before running this plugin.
**Max quality** selects the highest available quality that does not exceed that setting, so the actual result may be
lower.

**Prefer H.264** is enabled by default. It prioritizes the `avc1` codec so videos can play directly in the gallery.
When disabled, quality takes priority and the result may use HEVC or AV1. Depending on the platform, such files may show
only a thumbnail after being added to the library and may not play directly.

## Interval and retries

**Interval (seconds)**, which defaults to 10, applies between videos, between list pages, and before a retry.
**Retries**, which defaults to 1, is the retry limit for one failed video; set it to `0` to disable retries.

The uploader API has much stricter anti-abuse controls than the playback API, and short intervals can easily trigger
them. If the API returns `412`, `-401`, or `-352`, the plugin stops the task immediately because retrying this kind of
block is ineffective. Try again later or sign in to bilibili in Kabegame Surf first. The collection, series, and
favorites APIs require no signature and are less restrictive.

## Limitations

- **Courses and live streams are not supported** (`/cheese/`, `live.bilibili.com`). They use different playback APIs;
  this plugin handles regular uploads and bangumi.
- **Hidden-mode collections are skipped.** The uploader list does not expose their videos, and the required collection
  API is not yet supported. The plugin logs a warning and skips them.
- Audio and video are muxed with stream copy and are not re-encoded, so processing time is mostly network transfer time.
