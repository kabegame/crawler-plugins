# How to Save Images from Heybox (小黑盒) to an Album

This guide explains the overall flow for saving images you like from Heybox into Kabegame. Follow along to know what to expect. The screenshots were taken with Kabegame for Windows v3.4.3.

---

Select **Heybox** as the source.

![Select Heybox as the source](./src-xhh.png)

## 1. Choose how to find posts

Heybox supports two modes. Pick whichever fits your situation.

### 1. Search by keyword

Use this when you want to find a particular kind of image.

1. Set **Crawl Mode** to **Keyword Search**.

![Keyword Search mode](./mode-keyword.png)

2. Enter what you want to find in **Search Keyword**, such as wallpaper, a game title, or cosplay.

3. Set **Start Page**, **End Page**, and **Page Size** as needed. Larger values process more posts in one task, but also take longer. In our experience, around five posts is close to the threshold at which access controls may be triggered.

![Keyword search settings](./params.jpg)

4. After the task starts, the plugin searches page by page and processes each post it can open.

![Downloading](./downloading.png)
![Downloaded images](./banners/images.jpg)
![Image preview](./banners/image-preview.jpg)

### 2. Crawl one post

Use this when you already know the post link.

1. Set **Crawl Mode** to **Single Post URL**.
2. Paste the link copied from Heybox's **Share Post** button into **Post Share URL**. It must be a share link; copying the address directly from your browser will not work. See the screenshot below.

![Share Post button](./share-btn.png)

Paste the link:

![Paste the URL](./url-paste.png)

3. The plugin processes only this post and does not browse search pages.

![Images from one post](./url-images.png)
![Single-post image preview](./url-image-preview.png)

**A personal suggestion**  
I recommend the second mode: find a post you like in Heybox, copy its share link, and then collect the images. It is generally **less likely to be blocked**, is **more precise**, and avoids unrelated posts.

---

## 2. How images are collected after a post is found

Whether a post came from search results or a URL you provided, **every post** follows the same process:

1. **Fetch the post's content structure**  
   Text and images are arranged in blocks. The plugin scans those blocks in order.

2. **Keep only image blocks**  
   For each block representing an image, the plugin first reads a small preview to determine its order and the number of images.

3. **Request the full-size image URL**  
   The plugin asks Heybox for the full-size URL corresponding to each preview and downloads it only after obtaining that URL.

4. **Save multiple images separately**  
   Images from the same post are distinguished in their names, for example by adding a number after the title.

5. **Comments (optional)**  
   When **Download Comment Images** is enabled, images in comments are also collected by comment floor. Some posts contain most of their images in the comments. Disable it to collect only images from the post body.

---

## 3. Situations you may occasionally encounter

- If a post contains **no images at all**, it is skipped.
- Heybox may occasionally request verification or temporarily block access. Switching networks or trying again later often helps.
- The plugin **waits briefly between posts and images**, so please allow it some time.

---

## 4. Settings overview

| Setting | Shown when | Purpose | Default |
| --- | --- | --- | --- |
| Crawl Mode | Always | Keyword Search / Single Post URL | Keyword Search |
| Post Share URL | Single-post mode | Paste a share link | Empty |
| Search Keyword | Keyword Search | What to search for | 美图 |
| Auto Comment | Always | Like every crawled post and post one comment | Off |
| Comment Text | Auto Comment enabled | The comment to post | 我用 kabegame 把美图拿走喽，谢谢！ |
| Start Page (1-based) | Keyword Search | First results page to process | 1 |
| End Page (inclusive) | Keyword Search | Last results page to process | 1 |
| Page Size | Keyword Search | Number of posts fetched per page | 5 |
| Download Comment Images | Always | Post and comment images / post body only | On |

---

## 5. Important notes

**Cookie (advanced)**  
A **Cookie** is a small piece of information saved by a website in your browser, commonly used to maintain your login session. Under **Start Crawl → Advanced Settings → HTTP Headers**, select **Add Header**, enter `Cookie` as the name, and paste the value copied from your browser. You can also save default request headers for this plugin under **Settings → Plugin Defaults → Crawler Plugin Defaults** so you do not need to enter them for every task. **Using a Cookie carries risks such as account suspension or login restrictions. You are responsible for those risks.**

**Why use a Cookie?**  
The Heybox backend applies stricter checks to unauthenticated requests that resemble scripts fetching post details in bulk. Even when using the official API, requests **without a Cookie** may be challenged when retrieving the **post body or nested comments (`tree`)**, and sometimes not even one post can be opened completely. With the Cookie from an active Heybox login, requests are made as a **signed-in user**. In testing, this allowed details for multiple consecutive posts to load much more reliably than anonymous access.

Therefore, if you browse many keyword-result pages or repeatedly receive verification immediately, try configuring a Cookie in Advanced Settings. If you only collect one or two share links occasionally, it may work without one, but a Cookie is usually more reliable.

**Access controls or task errors**

![Verification challenge](./captcha.png)

Open the relevant entry under **Tasks**, then select **Logs** to view details in the **Task Logs** dialog. Do not give up—you can try one or more of the following: **switch proxy nodes** (often enough by itself), **wait and try again** (half a day, a full day, or on another network), or **add a Cookie** as described above, since authenticated access is generally more reliable than anonymous access.

---

Hope all your favorite Heybox images make it into your album smoothly!
