// @ts-nocheck
// anime-pictures V8 crawler: parse host HTML with DOMParser and store schema 1 metadata.
import { resolveUrl as resolveSdkUrl, sleep } from "@kabegame/plugin-sdk";

const {
  addProgress,
  currentHtml,
  downloadImage,
  setHeader,
  to,
  warn,
} = Kabegame;

const DEFAULT_BASE_URL = "https://anime-pictures.net";

const REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Cookie:
    "aigentx=cookie6bf08fcb6cb63ebe32c194e694883f45; sitelang=zh-cn; time_zone=Asia/Tokyo",
};

function setRequestHeaders() {
  for (const [key, value] of Object.entries(REQUEST_HEADERS)) {
    setHeader(key, value);
  }
}

function log(message, level) {
  if (level === "warn") {
    warn(String(message ?? ""));
    return;
  }
  console.log(String(message ?? ""));
}

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function resolveUrl(url, baseUrl) {
  const raw = coerceStr(url).trim();
  if (!raw) return "";
  return resolveSdkUrl(raw, baseUrl);
}

function parseHtml(html) {
  return new DOMParser().parseFromString(coerceStr(html), "text/html");
}

function isChallengePage(document) {
  const title = (document.title || "").trim();
  const bodyText =
    document.body && document.body.textContent
      ? document.body.textContent.slice(0, 2000)
      : "";
  return /just a moment|cloudflare|challenge|checking your browser/i.test(title) ||
    /just a moment|cloudflare|checking your browser/i.test(bodyText);
}

async function openDocument(url) {
  const finalUrl = await to(url);
  const html = await currentHtml();
  const document = parseHtml(html);
  if (isChallengePage(document)) {
    throw new Error(
      "[anime-pictures] 检测到挑战页，V8 后端无法处理浏览器验证，请稍后重试或切换网络。",
    );
  }
  return { finalUrl, document };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function extractPostLinks(document, pageUrl) {
  const links = Array.from(document.querySelectorAll(".img-block > a[href]"))
    .map((a) => resolveUrl(a.getAttribute("href"), pageUrl));
  if (links.length) return unique(links);

  return unique(
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const href = resolveUrl(a.getAttribute("href"), pageUrl);
        const className = a.getAttribute("class") || "";
        if (
          /\/posts\/\d+/i.test(href) ||
          /\/pictures\/view_post\//i.test(href) ||
          (/\bimg-block\b/i.test(className) && /\/posts/i.test(href))
        ) {
          return href;
        }
        return "";
      }),
  );
}

function findDownloadUrl(document, pageUrl) {
  const downloadIcon = document.querySelector(".icon-download[href]");
  if (downloadIcon) {
    return resolveUrl(downloadIcon.getAttribute("href"), pageUrl);
  }

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") || "";
    if (/download|image_original|full/i.test(href)) {
      return resolveUrl(href, pageUrl);
    }
  }
  return "";
}

function pickAnimePicturesDisplayName(document) {
  const tagsUl = document.querySelector(
    "ul.tags, .page-tags ul.tags, .wrapper.page-tags ul.tags",
  );
  if (tagsUl) {
    const work = textOf(tagsUl.querySelector("a.copyright"));
    const character = textOf(tagsUl.querySelector("a.character"));
    const artist = textOf(tagsUl.querySelector("a.artist"));
    const titleSeg = [work, character].filter(Boolean).join(" / ");
    const name = [titleSeg, artist].filter(Boolean).join(" / ");
    if (name) {
      log(
        `[anime-pictures] pickName: title/author 作品=${JSON.stringify(work || null)} 角色=${JSON.stringify(character || null)} 作家=${JSON.stringify(artist || null)} => ${JSON.stringify(name)}`,
      );
      return name;
    }
    log("[anime-pictures] pickName: ul.tags 内未找到 copyright/character/artist 链接");
  } else {
    log("[anime-pictures] pickName: 未找到 ul.tags，走回退");
  }

  const illustRe = /^(イラスト|illustration|illustrations|арт|插画|圖片|图片)/i;
  const h1A = document.querySelector(
    ".post_content.head-info h1 a.copyright, .post-block h1 a.copyright",
  );
  const h1One = textOf(h1A);
  if (h1One) {
    log(`[anime-pictures] pickName: 回退 h1.copyright -> ${JSON.stringify(h1One)}`);
    return h1One;
  }

  const titleRaw = (document.title || "").trim();
  const lines = titleRaw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length >= 2 && illustRe.test(lines[0])) {
    log(
      `[anime-pictures] pickName: 回退 title 换行第2段 -> ${JSON.stringify(lines[1])}`,
    );
    return lines[1];
  }

  const oneLine = titleRaw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const tokens = oneLine.split(" ").filter(Boolean);
  if (tokens.length >= 2 && illustRe.test(tokens[0])) {
    log(
      `[anime-pictures] pickName: 回退 title 分词第2词 -> ${JSON.stringify(tokens[1])}`,
    );
    return tokens[1];
  }

  log(
    `[anime-pictures] pickName: 仍为空 title=${JSON.stringify(oneLine.slice(0, 200))}`,
  );
  return "";
}

function colorFromInfoItem(item) {
  const color = item.querySelector("span.color-sample");
  if (!color) return null;
  const style = color.getAttribute("style") || "";
  const match = style.match(/background-color:\s*([^;]+)/i);
  return match ? match[1].trim() : null;
}

function linksFromInfoItem(item, pageUrl) {
  return Array.from(item.querySelectorAll("a[href]"))
    .map((a) => {
      const text = textOf(a);
      const url = resolveUrl(a.getAttribute("href"), pageUrl);
      if (!text && !url) return null;
      return { text: text || url, url };
    })
    .filter(Boolean);
}

function infoItemPlainText(item) {
  const clone = item.cloneNode(true);
  const doc = clone.ownerDocument || item.ownerDocument;
  clone.querySelectorAll("svg").forEach((s) => s.remove());
  clone
    .querySelectorAll("a[href]")
    .forEach((a) => a.replaceWith(doc.createTextNode(textOf(a))));
  clone.querySelectorAll("span.color-sample").forEach((sp) => {
    const st = sp.getAttribute("style") || "";
    const m = st.match(/background-color:\s*([^;]+)/i);
    sp.replaceWith(doc.createTextNode(m ? ` ${m[1].trim()}` : ""));
  });
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function detailItemFromInfoItem(item, pageUrl) {
  const text = infoItemPlainText(item);
  if (!text) return null;
  const links = linksFromInfoItem(item, pageUrl);
  const color = colorFromInfoItem(item);
  const out = { text };
  if (links.length) out.links = links;
  if (color) out.color = color;
  return out;
}

function postTitleFromHead(head) {
  const h1 = head.querySelector("h1");
  if (!h1) return "";
  return textOf(h1);
}

function tagTypeFromAnchor(anchor) {
  if (anchor.classList.contains("copyright")) return "copyright";
  if (anchor.classList.contains("character")) return "character";
  if (anchor.classList.contains("artist")) return "artist";
  if (anchor.classList.contains("object")) return "object";
  if (anchor.classList.contains("reference")) return "reference";
  return "";
}

function extractTagGroups(document, pageUrl) {
  const tagsUl =
    document.querySelector("ul.tags[itemprop='keywords']") ||
    document.querySelector(".wrapper.page-tags ul.tags") ||
    document.querySelector("ul.tags");
  if (!tagsUl) return [];

  const groups = [];
  let current = null;
  for (const child of Array.from(tagsUl.children)) {
    if (child.tagName === "SPAN") {
      const name = textOf(child);
      if (!name) continue;
      current = { name, tags: [] };
      groups.push(current);
      continue;
    }

    if (child.tagName !== "LI") continue;
    const anchor = child.querySelector("a[href]");
    if (!anchor) continue;
    if (!current) {
      current = { name: "", tags: [] };
      groups.push(current);
    }
    const count = textOf(child.querySelector(".edit_tag"));
    const tag = {
      name: textOf(anchor),
      url: resolveUrl(anchor.getAttribute("href"), pageUrl),
      type: tagTypeFromAnchor(anchor),
    };
    const by = (child.getAttribute("title") || "").replace(/^by\s+/i, "").trim();
    if (count) tag.count = count;
    if (by) tag.by = by;
    current.tags.push(tag);
  }

  return groups.filter((group) => group.name || group.tags.length);
}

function buildAnimePicturesMetadata(document, pageUrl) {
  const head = document.querySelector(".post_content.head-info");
  if (!head) return null;

  let author = null;
  const authorSec = head.querySelector(".author-section");
  if (authorSec) {
    const avatarWrap = authorSec.querySelector("a[href*='profile']");
    const img = authorSec.querySelector("img");
    const userA = authorSec.querySelector("a.user_link");
    const name = textOf(userA);
    const profileHref = userA ? resolveUrl(userA.getAttribute("href"), pageUrl) : "";
    const avSrc = img && avatarWrap ? resolveUrl(img.getAttribute("src"), pageUrl) : "";
    if (name || avSrc || profileHref) {
      author = {
        name: name || "",
        profileUrl: profileHref || "",
        avatarUrl: avSrc || "",
      };
    }
  }

  const detailItems = [];
  const detailsSection = head.querySelector(".details-section");
  if (detailsSection) {
    for (const line of Array.from(detailsSection.querySelectorAll(".info-line"))) {
      if (line.querySelector("button.metrics-toggle")) continue;
      for (const item of Array.from(line.querySelectorAll(".info-item"))) {
        const detail = detailItemFromInfoItem(item, pageUrl);
        if (detail) detailItems.push(detail);
      }
    }
  }

  let rating = null;
  const ratingEl = document.querySelector(".vote_block span.rating");
  if (ratingEl) {
    const b = ratingEl.querySelector("b");
    const countEl = Array.from(ratingEl.querySelectorAll("span")).find((s) =>
      /^\d+$/.test((s.textContent || "").trim()),
    );
    if (b && countEl) {
      rating = {
        label: (b.textContent || "").trim(),
        count: (countEl.textContent || "").trim(),
      };
    }
  }

  return {
    schema: 1,
    title: postTitleFromHead(head),
    author,
    details: detailItems,
    rating,
    tagGroups: extractTagGroups(document, pageUrl),
  };
}

async function crawlDetail(url, pageWeight) {
  const { finalUrl, document } = await openDocument(url);
  const displayName = pickAnimePicturesDisplayName(document);
  const metadata = buildAnimePicturesMetadata(document, finalUrl);
  const downloadUrl = findDownloadUrl(document, finalUrl);

  log(
    `[anime-pictures] downloadImage 展示名 name: ${displayName ? JSON.stringify(displayName) : "(空)"}`,
  );
  log(
    `[anime-pictures] metadata: ${metadata ? JSON.stringify(metadata).slice(0, 500) : "(空)"}`,
  );

  await sleep(3000);
  if (!downloadUrl) {
    log(`[anime-pictures] 未找到下载链接: ${finalUrl}`, "warn");
    addProgress(pageWeight);
    return;
  }

  const opts = {
    cookie: true,
    url: finalUrl,
  };
  if (displayName) opts.name = displayName;
  if (metadata) opts.metadata = metadata;
  if (metadata) opts.metadata_version = 1;
  await downloadImage(downloadUrl, opts);
  addProgress(pageWeight);
}

function pageUrl(baseUrl, page, tag) {
  const query = [`page=${encodeURIComponent(String(page))}`];
  if (tag) query.push(`search_tag=${encodeURIComponent(tag)}`);
  return `${resolveUrl("/posts", baseUrl)}?${query.join("&")}`;
}

export async function crawl(common, custom) {
  setRequestHeaders();

  const baseUrl = common?.base_url || DEFAULT_BASE_URL;
  const startPage = Number(custom?.startPage ?? 0);
  const endPage = Number(custom?.endPage ?? startPage);
  const tag = coerceStr(custom?.tag).trim();

  if (endPage >= startPage + 100) {
    throw new Error("在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪");
  }
  if (endPage < startPage) {
    throw new Error("结束页面需要比开始页面大");
  }

  const totalPages = endPage - startPage + 1;
  const pageProgress = totalPages > 0 ? 100 / totalPages : 100;
  log(`[anime-pictures] 开始：第 ${startPage}～${endPage} 页，标签=${tag || "(空)"}`);

  for (let page = startPage; page <= endPage; page += 1) {
    const listUrl = pageUrl(baseUrl, page, tag);
    await sleep(2000);
    const { finalUrl, document } = await openDocument(listUrl);
    const links = extractPostLinks(document, finalUrl);
    log(`[anime-pictures] 第 ${page} 页图片数量: ${links.length}`);

    if (links.length === 0) {
      addProgress(pageProgress);
      continue;
    }

    const itemProgress = pageProgress / links.length;
    for (const link of links) {
      await sleep(2000);
      await crawlDetail(link, itemProgress);
    }
  }

  log("[anime-pictures] 任务结束");
}
