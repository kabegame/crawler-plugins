# Safebooru - Plugin guide

This plugin collects posts from `safebooru.org`, Gelbooru's all-ages board. Unlike the Gelbooru plugin,
which parses web pages, it uses the site's **official API** (`index.php?page=dapi`). The API works without
an account, and one request returns a whole page of posts together with **every tag and its category**.
That is much faster and more stable than opening each post page.

## Crawl modes

- **Tags**: search by a tag combination (the usual choice)
- **All**: newest posts across the whole site
- **ID range**: search a closed post ID range with `id:>=A id:<=B sort:id:asc` and crawl the whole range in ascending ID order

## Options

- **Tag combination**: a list joined with `+` at runtime; spaces inside a tag become `_`.
  Site metatags work too, for example:
  - `width:>=1920`, `height:<=1200`: filter by resolution, handy for wallpapers
  - `score:>=100`: highly voted posts only
  - `-1boy`: exclude a tag
- **Sort order**: newest / highest score / recently updated / random (the site's `sort:` metatag)
- **Start page / End page**: 42 posts per page, **matching the site's own listing pages**; at most 100 pages per run.
  The site (both the API and the web pages) only serves a starting offset up to 200,000 posts, so direct paging stops at page 4762:
  - **Newest** order: past that page the plugin switches to an `id:<` cursor, and the results continue seamlessly from direct paging.
    Starting deeper first locates the page in jumps of about 200,000 posts; page 20000, for example, takes about 5 requests.
  - **Highest score / Recently updated / Random** orders cannot be cut by id. Past that page the task fails with a message
    suggesting the Newest order, or narrower tags so the result count stays under the limit.
- **Start ID / End ID**: used by the ID range mode; a closed range of post IDs (the number after `id=` in the post URL),
  **at most 5000 apart**, otherwise the run is refused. No page numbers are needed; deleted posts are not in the results and are skipped. The tag combination and sort order do not apply to this mode.
- **Quality**: High = the original file; Medium = the site's resized sample (~850px). Small posts without a sample always use the original.
- **Fetch comments**: posts that have comments get one extra request to their post page, and the comments are stored in metadata. Most posts have no comments, so this rarely adds any requests.

## Metadata

Each image carries the following data. The plugin detail panel renders it in the layout of Safebooru's post sidebar.

- `tags`: each tag's canonical name, category (copyright / character / artist / general / metadata) and post count
- `tags_string`: the **full tag string** ordered copyright → character → artist → general → metadata, ready to use as an AI image prompt
- `post_id`, `rating`, `score`, `width`, `height`, `md5`, `file_ext`, `source`
- `owner` (uploader), `created_at` (post time with the site's timezone)
- `comments`: author, comment id, posted time, comment score and text

Tags are also added to the app's Labels section under `safebooru/<category>/<tag>`.
