# How to Save Images from Miyoushe to an Album

This guide explains the overall flow for saving images you like from Miyoushe into Kabegame. Follow it in order to understand what each step does, which settings to enter, and where to look when something goes wrong.

![Image preview](./banners/image-preview.jpg)

---

Select **Miyoushe** as the source.

![Select Miyoushe as the source](./source-miyoushe.jpg)

---

## 1. Choose how to find posts

Three modes are currently available. Choose one.

### 1. Search by keyword

Use this when you want to find a category of images.

1. Set **Crawl Mode** to **Keyword Search**.
2. Enter what you want to find in **Search Keyword**, such as “wallpaper,” “cosplay,” or a character name.
3. Select a **Game Section** (`gids`) as needed:
   - Select **All** to search across a wider area of the site.
   - Select a particular game section to focus the search on that community.
4. Configure **Start Page / End Page / Page Size**:
   - More pages take longer to process, so try a small range first.
   - `page_size` controls how many posts are fetched per page. Posts without images are filtered out.

### 2. Crawl one post

Use this when you already know the post URL.

1. Set **Crawl Mode** to **Single Post URL**.
2. Paste a Miyoushe article link into **Post URL**:
   - The plugin only needs to extract the `post_id` from the link.
   - Example format: `https://www.miyoushe.com/{game}/article/{id}`

### 3. Crawl by author UID

Use this when you know the author's UID.

1. Set **Crawl Mode** to **User Post List**.
2. Enter the Miyoushe user UID in **Author UID**. It is a numeric string available in the author's profile URL.

![Author profile](./user-page.png)

3. **Start Page / End Page / Page Size** work the same way as in Keyword Search:
   - By default, pages 1–3 are crawled with 20 posts per page. Adjust as needed.
   - Test with a small range, such as one page, first.

---

## 2. How images are collected after a post is found

Whether a post came from search results or was specified directly, the plugin follows this data flow:

1. **Fetch post details (`getPostFull`)**
   - Retrieve the main post information.
   - Most importantly, retrieve the body image list from `post.images` and the corresponding images in `post.content`.
2. **Fetch emoticon sets (`emoticon_set`)**
   - Metadata stores only the required emoticon mappings actually used in the body (`subject/content`).
   - When an image detail page is opened, the complete emoticon set is fetched dynamically for displaying emoticons in comments.
3. **Fetch comments (`getPostReplies`)**
   - Comment content is no longer stored in metadata.
   - The image detail page dynamically loads comments: 20 initially, with a **Load More** option.
   - During crawling, the comments API is used only for statistics and downloading comment images, continuing up to the configured comment limit.
4. **Download images into the album**
   - Body images are always downloaded, provided the post contains images.
   - Comment images are downloaded only when `fetch_comment_images = true`.
   - Progress is divided evenly across the total number of body and comment images.

---

## 3. Situations you may occasionally encounter

- **The post has no images:** the plugin skips it and processes only posts containing images.
- **Intermittent API errors:** try switching networks or waiting before retrying.
- If an API error occurs, waiting and trying again usually resolves it.

---

## 4. Settings overview

| Setting | Shown when | Purpose |
| --- | --- | --- |
| Crawl Mode | Always | Keyword Search / Single Post URL / User Post List |
| Post URL | Single-post mode | Paste a post link; `post_id` is extracted automatically |
| Author UID | User Post List | UID of the author to crawl |
| Search Keyword | Keyword Search | Keyword to search for |
| Game Section | Keyword Search | Optional `gids` section |
| Start Page (1-based) | Keyword Search / User Post List | First page to crawl |
| End Page (inclusive) | Keyword Search / User Post List | Last page to crawl, inclusive |
| Page Size | Keyword Search / User Post List | Number of posts fetched per page |
| Download Comment Images | Always | On: body and comment images; off: body images only |
| Max Comments (`max_comments`) | Always | Maximum comments fetched during crawling; default 200 |

---

Hope all your favorite Miyoushe images make it into your album smoothly!
