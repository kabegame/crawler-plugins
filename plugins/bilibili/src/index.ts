// @ts-nocheck
import { md5, sleep } from "@kabegame/plugin-sdk";

const {
  addProgress,
  delHeader,
  downloadImage,
  requireCookie,
  setHeader,
  warn,
} = Kabegame;

const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const SEARCH_API = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const VIEW_API = "https://api.bilibili.com/x/article/view";
const REPLY_API = "https://api.bilibili.com/x/v2/reply/wbi/main";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

function coerceStr(value) {
  return value == null ? "" : String(value);
}

// 未登录（-101）：登录态缺失或已失效 → 硬失败终止，提示去畅游登录。
// 风控（-352）：不一定与登录有关，保持告警不中断。
function checkBilibiliRisk(code) {
  if (code === -101) {
    throw new Error("B 站接口返回未登录（-101）：未获取到有效登录态，请先在畅游登录 bilibili 后重试。");
  }
  if (code === -352) {
    warn("B 站接口触发风控（-352），可稍后重试或更换网络；若持续失败请在畅游重新登录 bilibili。");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function wbiFilterValue(value) {
  return coerceStr(value).replace(/[!'()*]/g, "");
}

function getMixinKey(orig) {
  return MIXIN_TAB.map((idx) => orig[idx] || "").join("").slice(0, 32);
}

function stemFromWbiUrl(url) {
  const name = coerceStr(url).split("/").pop() || "";
  return name.split(".", 1)[0] || "";
}

function wbiKeysFromNav(nav) {
  const wbi = nav?.data?.wbi_img || {};
  return {
    img: stemFromWbiUrl(wbi.img_url),
    sub: stemFromWbiUrl(wbi.sub_url),
  };
}

function signUrl(baseUrl, pairs, img, sub) {
  const mix = getMixinKey(`${img}${sub}`);
  const q = pairs.map(([key, value]) => `${key}=${encodeURIComponent(wbiFilterValue(value))}`).join("&");
  return `${baseUrl}?${q}&w_rid=${md5(q + mix)}`;
}

function signSearchUrl(vars, page, img, sub) {
  const pairs = [
    ["category_id", coerceStr(vars.category_id || "0")],
    ["keyword", coerceStr(vars.keyword)],
  ];
  const order = coerceStr(vars.order);
  if (order) pairs.push(["order", order]);
  pairs.push(
    ["page", String(page)],
    ["page_size", String(Number(vars.page_size ?? 20))],
    ["search_type", "article"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  );
  return signUrl(SEARCH_API, pairs, img, sub);
}

function signViewUrl(cvId, img, sub) {
  return signUrl(VIEW_API, [
    ["gaia_source", "main_web"],
    ["id", coerceStr(cvId)],
    ["web_location", "333.976"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  ], img, sub);
}

function buildPaginationStr(offsetToken) {
  return JSON.stringify({ offset: coerceStr(offsetToken) });
}

function signReplyUrl(cvId, offsetToken, img, sub) {
  return signUrl(REPLY_API, [
    ["mode", "3"],
    ["oid", coerceStr(cvId)],
    ["pagination_str", buildPaginationStr(offsetToken)],
    ["plat", "1"],
    ["seek_rpid", ""],
    ["type", "12"],
    ["web_location", "1315875"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  ], img, sub);
}

async function fetchWith509Retry(makeUrl, label) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const json = await fetchJson(makeUrl());
    if (json?.code !== -509) return json;
    warn(`${label} -509 过于频繁，${attempt}/5`);
    if (attempt >= 5) return json;
    await sleep(3000);
  }
  throw new Error(label);
}

function simplifyEmotes(emotes) {
  const out = {};
  if (!emotes || typeof emotes !== "object") return out;
  for (const [key, value] of Object.entries(emotes)) {
    out[key] = {
      url: coerceStr(value?.url),
      size: Number(value?.meta?.size ?? 1),
    };
  }
  return out;
}

function simplifyOneReply(rep) {
  const member = rep?.member || {};
  const content = rep?.content || {};
  const rc = rep?.reply_control || {};
  return {
    mid: coerceStr(member.mid),
    uname: coerceStr(member.uname),
    avatar: coerceStr(member.avatar),
    level: Number(member?.level_info?.current_level ?? 0),
    message: coerceStr(content.message),
    emotes: simplifyEmotes(content.emote),
    ctime: Number(rep?.ctime ?? 0),
    like: Number(rep?.like ?? 0),
    location: coerceStr(rc.location),
    sub_count_text: coerceStr(rc.sub_reply_entry_text),
  };
}

async function fetchArticleReplies(cvId, img, sub) {
  const cap = 100;
  const collected = [];
  let total = 0;
  let offset = "";
  let isEnd = false;
  while (collected.length < cap && !isEnd) {
    const reply = await fetchWith509Retry(
      () => signReplyUrl(cvId, offset, img, sub),
      `cv ${cvId} 评论接口`,
    );
    if (reply?.code !== 0) {
      checkBilibiliRisk(reply?.code);
      warn(`评论 API 拉取失败 (cv ${cvId}): ${coerceStr(reply?.message)}`);
      break;
    }
    const cursor = reply?.data?.cursor;
    total = Number(cursor?.all_count ?? total);
    isEnd = cursor?.is_end === true;
    for (const rep of Array.isArray(reply?.data?.replies) ? reply.data.replies : []) {
      if (collected.length >= cap) break;
      collected.push(simplifyOneReply(rep));
    }
    const nextOffset = coerceStr(cursor?.pagination_reply?.next_offset);
    if (isEnd || !nextOffset) break;
    offset = nextOffset;
  }
  return { total, replies: collected };
}

function collectArticleIds(data) {
  const ids = [];
  const result = Array.isArray(data?.result) ? data.result : [];
  if (result[0]?.result_type != null) {
    for (const block of result) {
      if (block?.result_type !== "article") continue;
      for (const item of Array.isArray(block?.data) ? block.data : []) {
        if (item?.id != null) ids.push({ id: item.id, desc: coerceStr(item.desc) });
      }
    }
    return ids;
  }
  for (const item of result) {
    if (item?.type === "article" && item?.id != null) {
      ids.push({ id: item.id, desc: coerceStr(item.desc) });
    }
  }
  return ids;
}

function parseCvIdFromInput(raw) {
  const work = coerceStr(raw).trim().split(/[?#]/, 1)[0];
  if (/^\d+$/.test(work)) return work;
  return work.match(/cv(\d+)/i)?.[1] || "";
}

function parseOpusIdFromInput(raw) {
  const work = coerceStr(raw).trim().split(/[?#]/, 1)[0];
  const fromPath = work.match(/\/opus\/(\d+)/)?.[1];
  if (fromPath) return fromPath;
  return /^\d{15,}$/.test(work) ? work : "";
}

function parseCvIdFromOpusHtml(html) {
  const idx = coerceStr(html).indexOf("opus-module-copyright__right");
  const slice = idx >= 0 ? coerceStr(html).slice(idx, idx + 4000) : coerceStr(html);
  return slice.match(/cv(\d+)/i)?.[1] || "";
}

function ensureHttpsBfs(path) {
  const p = coerceStr(path);
  return p.startsWith("//") ? `https:${p}` : p;
}

function collectImageUrlsFromContent(html) {
  const out = [];
  const seen = new Set();
  const re = /\/\/i[0-2]\.hdslb\.com\/bfs\/(?:article|new_dyn)\/[^"'\s>\\)]+/g;
  let match;
  while ((match = re.exec(coerceStr(html)))) {
    const url = ensureHttpsBfs(match[0]);
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

function buildArticleMetadata(vd, cvId, searchDesc, repliesData, totalImageCount, opusId) {
  const authorRaw = vd?.author || {};
  const statsRaw = vd?.stats || {};
  const metadata = {
    source: "bilibili_article",
    cvid: cvId,
    title: coerceStr(vd?.title),
    desc: coerceStr(searchDesc) || coerceStr(vd?.summary),
    publish_time: Number(vd?.publish_time ?? 0),
    author: {
      mid: authorRaw.mid,
      name: coerceStr(authorRaw.name),
      face: coerceStr(authorRaw.face),
      fans: authorRaw.fans,
      level: authorRaw.level,
    },
    stats: {
      view: statsRaw.view,
      like: statsRaw.like,
      reply: statsRaw.reply,
      favorite: statsRaw.favorite,
      coin: statsRaw.coin,
      share: statsRaw.share,
    },
    tags: (Array.isArray(vd?.tags) ? vd.tags : []).map((tag) => ({ name: coerceStr(tag?.name) })),
    categories: (Array.isArray(vd?.categories) ? vd.categories : []).map((cat) => ({ name: coerceStr(cat?.name) })),
    reply_total: Number(repliesData?.total ?? 0),
    replies: Array.isArray(repliesData?.replies) ? repliesData.replies : [],
    total_image_count: totalImageCount,
  };
  if (opusId) metadata.opus_id = opusId;
  return metadata;
}

async function getWbiKeys() {
  delHeader("Referer");
  setHeader("Referer", "https://www.bilibili.com/");
  const nav = await fetchJson(NAV_URL);
  delHeader("Referer");
  if (nav?.code !== 0) {
    checkBilibiliRisk(nav?.code);
    throw new Error(`nav 接口异常: ${coerceStr(nav?.message)}`);
  }
  const keys = wbiKeysFromNav(nav);
  if (!keys.img || !keys.sub) throw new Error("无法从 nav 获取 WBI 密钥");
  return keys;
}

async function processOneCv(cvId, img, sub, perCv, searchDesc) {
  const view = await fetchWith509Retry(
    () => signViewUrl(cvId, img, sub),
    `cv ${cvId} view`,
  );
  if (view?.code !== 0) {
    checkBilibiliRisk(view?.code);
    warn(`cv ${cvId} view 失败: ${coerceStr(view?.message)}`);
    addProgress(perCv);
    return;
  }
  const vd = view.data;
  const imgs = collectImageUrlsFromContent(vd?.content);
  if (imgs.length === 0) {
    addProgress(perCv);
    return;
  }
  const repliesData = await fetchArticleReplies(cvId, img, sub);
  const subject = coerceStr(vd?.title);
  const metadata = buildArticleMetadata(vd, cvId, searchDesc, repliesData, imgs.length, "");
  const perImage = perCv / imgs.length;
  const cvPageUrl = `https://www.bilibili.com/read/cv${cvId}`;
  for (let index = 0; index < imgs.length; index += 1) {
    const name = imgs.length > 1
      ? `${subject || `cv${cvId}`}(${index + 1})`
      : (subject || `cv${cvId}`);
    await downloadImage(imgs[index], { name, metadata, url: cvPageUrl });
    addProgress(perImage);
  }
}

async function processOneOpus(opusId, perTotal, img, sub) {
  const pageUrl = `https://www.bilibili.com/opus/${opusId}`;
  setHeader("Referer", pageUrl);
  setHeader("Origin", "https://www.bilibili.com");
  const html = await (await fetch(pageUrl)).text();
  const imgs = collectImageUrlsFromContent(html);
  if (imgs.length === 0) {
    warn("opus 页面未解析到 bfs 图片链接，可能为壳页或结构变化；可尝试先在畅游登录 bilibili 后重试。");
    addProgress(perTotal);
    return;
  }

  const cvId = parseCvIdFromOpusHtml(html);
  let vd = null;
  let repliesData = null;
  if (cvId && img && sub) {
    const view = await fetchWith509Retry(() => signViewUrl(cvId, img, sub), `opus ${opusId} cv ${cvId} view`);
    if (view?.code === 0) vd = view.data;
    else {
      checkBilibiliRisk(view?.code);
      warn(`opus ${opusId} 关联 cv ${cvId} view 失败: ${coerceStr(view?.message)}，仍尝试拉取评论`);
    }
    repliesData = await fetchArticleReplies(cvId, img, sub);
  }

  const metadata = vd
    ? buildArticleMetadata(vd, cvId, "", repliesData, imgs.length, opusId)
    : { source: "bilibili_opus", opus_id: opusId, total_image_count: imgs.length };
  const base = coerceStr(vd?.title) || `图文 ${opusId}`;
  const perImage = perTotal / imgs.length;
  for (let index = 0; index < imgs.length; index += 1) {
    const name = imgs.length > 1 ? `${base}(${index + 1})` : base;
    await downloadImage(imgs[index], { name, metadata, url: pageUrl });
    addProgress(perImage);
  }
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setHeader("User-Agent", UA);
  setHeader("Referer", "https://www.bilibili.com/");
  setHeader("Origin", "https://www.bilibili.com");

  // 机会注入：从畅游取 B 站 Cookie（脚本拿不到明文）。取不到不阻断——
  // 公开专栏搜索等路径仍可跑；真正需要登录时会在接口返回 -101 处硬失败。
  if (!requireCookie()) {
    warn("未从畅游获取到 B 站 Cookie，将以未登录状态抓取；部分内容可能失败。如需完整结果请先在畅游登录 bilibili。");
  }

  if (vars.mode === "single") {
    const opusId = parseOpusIdFromInput(vars.cv_id_or_url);
    if (opusId) {
      let keys = { img: "", sub: "" };
      try {
        keys = await getWbiKeys();
      } catch {
        // Opus image extraction can still work without WBI metadata.
      }
      await processOneOpus(opusId, 100.0, keys.img, keys.sub);
      addProgress(100.0);
      return;
    }
  }

  const keys = await getWbiKeys();
  const allIds = [];
  if (vars.mode === "single") {
    const cvId = parseCvIdFromInput(vars.cv_id_or_url);
    if (!cvId) throw new Error("单篇模式请填写：专栏 cv 数字或 read/cv 链接，或图文帖 opus 链接（含 /opus/）");
    allIds.push({ id: cvId, desc: "" });
  } else {
    const startPage = Number(vars.start_page ?? 1);
    const endPage = Number(vars.end_page ?? startPage);
    if (endPage < startPage) throw new Error("结束页须大于等于起始页");
    for (let page = startPage; page <= endPage; page += 1) {
      const search = await fetchWith509Retry(
        () => signSearchUrl(vars, page, keys.img, keys.sub),
        "搜索接口",
      );
      if (search?.code !== 0) {
        checkBilibiliRisk(search?.code);
        warn(`搜索第 ${page} 页失败: ${coerceStr(search?.message)}`);
      } else {
        allIds.push(...collectArticleIds(search.data));
      }
    }
  }

  if (allIds.length === 0) {
    warn("未找到专栏 id，请检查关键词；若遇风控或接口异常，可先在畅游登录 bilibili 后重试。");
    addProgress(100.0);
    return;
  }

  const perCv = 100.0 / allIds.length;
  for (const row of allIds) {
    await processOneCv(coerceStr(row.id), keys.img, keys.sub, perCv, coerceStr(row.desc));
  }
  addProgress(100.0);
}
