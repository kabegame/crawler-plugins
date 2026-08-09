# PixAI

Batch-download publicly accessible AI images and animated artworks from [PixAI](https://pixai.art) and save them to
the Kabegame gallery. The plugin supports five crawl modes: global feed, model, tag, ranking, and author.

![The artwork feed on the PixAI home page](banners/homepage.jpg)

## Quick start

1. Make sure Kabegame's network connection or proxy can access `pixai.art` and its image domains.
2. Create a download task and select **PixAI** as the source. You can also begin by importing one of the recommended
   configurations included with the plugin.
3. Select a **Crawl Type**, then configure its sort order and pages. For a small test run, choose **Global** with
   **Trending** sort and set **Start Page / End Page** to `1 / 1`. A page usually contains about 24 artworks.
4. Start the task. The plugin reads each artwork's details and saves publicly accessible media to the gallery.

## Downloaded content

Besides the image itself, a PixAI artwork page can contain its title, author, prompts, description, tags, models and
LoRAs, like count, and comments.

![Artwork details, prompts, and model information on PixAI](banners/post.jpg)

For each download, the plugin fetches the artwork details and recent comments, and saves a link to the original PixAI
page. Animated artworks prefer the animated media resource, while static artworks use the public image resource. After
the task finishes, you can browse the results in Kabegame and return to the source page from the artwork details.

![PixAI artworks downloaded to the Kabegame gallery](banners/images.jpg)

## Crawl modes

### Global

Downloads from PixAI's global artwork feed. This mode is useful for browsing popular work or continuously adding to a
gallery.

- **Artwork Sort** supports trending, daily ranking, popularity, latest, and creation-time orders.
- **Start Page / End Page** selects an inclusive download range.
- For example, `1 / 5` downloads Pages 1–5, while `3 / 5` advances through the first two pages and downloads only
  Pages 3–5.

### By Model

Walks the model list using **Model Sort**, then downloads the artwork feed for each model.

- **Model Pages** is the upper page limit counted from Page 1. **Skip Model Pages** advances through pages without
  processing their models.
- **Artwork Pages per Model** limits the last artwork page visited for each model; **Start Page** selects the first page
  to download within each model's feed.
- **Artwork Sort** is applied separately to every model's artwork feed.

The download count can grow quickly in this mode: one model page usually contains about 24 models, and one artwork page
for each model usually contains about 24 artworks. Start with small values for **Model Pages** and
**Artwork Pages per Model**.

### By Tag

Resolves each **Tag codeName** and then downloads the artwork feed for that tag.

- A codeName is not the displayed tag name. It is the identifier in the tag page URL, such as `genshin_impact`.
- You can enter multiple codeNames at once. Invalid or unknown tags are reported and skipped.
- **Pages per Tag** is the upper page limit, while **Start Page** selects the first page to download.
- For example, with Start Page `3` and Pages per Tag `5`, the plugin downloads Pages 3–5, not Pages 3–7.

Resolved tags are cached, so later runs do not need to query the same tags again.

### Ranking

Downloads a PixAI ranking selected by **Rank Type** and **Rank Period**.

| Rank type | Behavior |
| --- | --- |
| Artwork | Downloads static artworks from the daily, weekly, or monthly ranking; requests up to the first 100 entries |
| Animated | Downloads animated artworks from the daily, weekly, or monthly ranking; requests up to the first 100 entries |
| SD Model | Walks the ranked SD models, then downloads trending artworks for each model |
| LoRA | Walks the ranked LoRAs, then downloads trending artworks for each LoRA |

Artwork and animated rankings are not paginated, so **Start Page / End Page** do not affect them. Model and LoRA
rankings may each return up to 100 models and then download the number of pages set by
**Artwork Pages per Ranked Model** for every model. This can produce a very large download.

### By Author

Downloads static or animated artworks from a specific PixAI author.

- Enter the numeric ID from the user's profile URL in **Author ID**, not the display name or `@username`.
- Use **Artwork Type** to choose images or animated artworks. Image mode includes regular artworks and albums.
- **Pages per Author** is the upper page limit and can be combined with **Start Page** and **Artwork Sort** to narrow
  the range.

## Pagination rules

PixAI artwork lists use cursor pagination and cannot jump directly to an arbitrary page. To start at Page N, the plugin
must still request Pages 1 through N−1 in order to obtain their cursors, but does not download them. This uses a small
amount of additional time and network traffic.

- Page numbers start at `1`.
- Global mode uses **End Page** as the last page.
- Model, tag, and author modes use their corresponding artwork page setting as the upper page limit.
- In By Model mode, **Skip Model Pages** applies only to the model list; **Start Page** applies to every model's artwork
  feed.
- Artwork and animated rankings do not use artwork page settings.

If the end page precedes the start page, Global mode displays a warning and downloads only the start page. In other
modes, a start page above the corresponding page limit leaves no effective pages to download; adjust the configuration
and try again.

## Recommended configurations

The plugin includes the following configurations. You can import and run them directly or edit them first.

| Configuration | Purpose |
| --- | --- |
| Global trending (5 pages) | Quickly browse popular public artworks |
| Daily global daily-ranking (5 pages) | Runs at 18:00 by default and continuously updates the gallery |
| Trending models (1 artwork page each) | Walks trending models and downloads representative work; produces many downloads |
| Ranking · today's artworks | Downloads the current daily artwork ranking |
| Tags example (Genshin / Star Rail / Stella Sora) | Demonstrates multiple tag codeNames in one configuration |

Page counts and schedules in recommended configurations can be changed in the imported run configuration.

## Notes

- The plugin downloads only media that is publicly accessible from the current network. Deleted or private artworks,
  and artworks whose details cannot be fetched, are skipped.
- Global, tag, model, and ranking modes enable safe-content filtering. Author mode uses the default filtering returned
  by PixAI's author feed.
- The same artwork may appear under multiple tags, models, or rankings. When combining ranges, watch for duplicates and
  the total download size.
- If the PixAI API or image domains cannot be reached, check the proxy and network first. If tag mode returns no results,
  also verify that each codeName exactly matches its URL.
- Follow PixAI's terms of use and the licensing terms set by each artwork's creator.
