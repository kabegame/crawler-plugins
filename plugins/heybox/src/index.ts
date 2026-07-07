// @ts-nocheck
// 小黑盒 (XHH) 综合搜索爬虫，V8 后端。
// XHH 签名实现保留在插件内部，避免依赖 Kabegame core/Rhai 专用接口。
const {
  addProgress,
  createImageMetadata: createImageMetadataRow,
  downloadImage,
  setHeader,
  warn,
} = Kabegame;

const API_HOST = "https://api.xiaoheihe.cn";
const PATH_SEARCH = "/bbs/app/api/general/search/v1";
const PATH_TREE = "/bbs/app/link/tree";
const PATH_ORIGINAL = "/bbs/app/api/original/image";

const COMMON_PARAMS_BASE =
  "os_type=web&app=heybox&client_type=web&version=999.0.4&web_version=2.5&x_client_type=web&x_app=heybox_website&heybox_id=&x_os_type=Windows&device_info=Chrome";

const REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "x-client-type": "web",
  "x-app": "heybox_website",
  "x-os-type": "Windows",
  "device-info": "Chrome",
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
const createImageMetadata = (metadata) =>
  Number(createImageMetadataRow(metadata, null));

const SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_TABLE = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000),
);

const XHH_CHARSET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";

function leftRotate(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function toHexLe(value) {
  return [value, value >>> 8, value >>> 16, value >>> 24]
    .map((byte) => (byte & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

function toUtf8Bytes(value) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }

  const bytes = [];
  for (const char of String(value)) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function md5(value) {
  const input = toUtf8Bytes(value);
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >>> 6) + 1) << 6;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const word = view.getUint32(offset + g * 4, true);
      const next = d;
      d = c;
      c = b;
      b = (b + leftRotate((a + f + MD5_TABLE[i] + word) >>> 0, SHIFT_AMOUNTS[i])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return `${toHexLe(a0)}${toHexLe(b0)}${toHexLe(c0)}${toHexLe(d0)}`;
}

function mapStringWithCharset(value, charsetLength) {
  const pool = Array.from(XHH_CHARSET.slice(0, charsetLength));
  return Array.from(value)
    .map((char) => pool[char.charCodeAt(0) % pool.length])
    .join("");
}

function normalizePath(urlOrPath) {
  const trimmed = String(urlOrPath || "").trim();
  const pathOnly = trimmed.includes("://")
    ? trimmed.slice(trimmed.indexOf("://") + 3).replace(/^[^/]*/, "") || "/"
    : trimmed;
  const withoutQuery = pathOnly.split("?", 1)[0] || "/";
  const segments = withoutQuery.split("/").filter(Boolean);
  return `/${segments.join("/")}/`;
}

function interleaveColumnMajor(parts) {
  const chars = parts.map((part) => Array.from(part));
  const maxLength = Math.max(...chars.map((part) => part.length), 0);
  let out = "";
  for (let row = 0; row < maxLength; row += 1) {
    for (const part of chars) {
      if (row < part.length) out += part[row];
    }
  }
  return out;
}

const gfVm = (value) => (value & 128 ? 255 & ((value << 1) ^ 27) : value << 1);
const gfQm = (value) => gfVm(value) ^ value;
const gfSm = (value) => gfQm(gfVm(value));
const gfYm = (value) => gfSm(gfQm(gfVm(value)));
const gfGm = (value) => gfYm(value) ^ gfSm(value) ^ gfQm(value);

function mixFourBytesInPlace(values) {
  const t0 = gfGm(values[0]) ^ gfYm(values[1]) ^ gfSm(values[2]) ^ gfQm(values[3]);
  const t1 = gfQm(values[0]) ^ gfGm(values[1]) ^ gfYm(values[2]) ^ gfSm(values[3]);
  const t2 = gfSm(values[0]) ^ gfQm(values[1]) ^ gfGm(values[2]) ^ gfYm(values[3]);
  const t3 = gfYm(values[0]) ^ gfSm(values[1]) ^ gfQm(values[2]) ^ gfGm(values[3]);
  values[0] = t0;
  values[1] = t1;
  values[2] = t2;
  values[3] = t3;
}

function xhhNonce(t) {
  return md5(`${Math.trunc(t)}${Math.random()}`).toUpperCase();
}

function xhhHkey(path, t, nonce) {
  const pathNorm = normalizePath(path);
  const tInner = Math.trunc(t) + 1;
  const partA = mapStringWithCharset(String(tInner), XHH_CHARSET.length - 2);
  const partB = mapStringWithCharset(pathNorm, XHH_CHARSET.length);
  const partC = mapStringWithCharset(nonce, XHH_CHARSET.length);
  const interleaved = interleaveColumnMajor([partA, partB, partC]).slice(0, 20);
  const md5Hex = md5(interleaved);
  const last6Codes = Array.from(md5Hex.slice(-6)).map((char) => char.charCodeAt(0));
  mixFourBytesInPlace(last6Codes);
  const twoDigit = String(last6Codes.reduce((sum, value) => sum + value, 0) % 100).padStart(2, "0");
  const prefix = mapStringWithCharset(md5Hex.slice(0, 5), XHH_CHARSET.length - 4);
  return `${prefix}${twoDigit}`;
}

function xhhFakeDeviceId() {
  return xhhNonce(Date.now() / 1000).toLowerCase();
}

function signedUrl(apiHost, path, commonParams, extra) {
  const t = Math.floor(Date.now() / 1000);
  const nonce = xhhNonce(t);
  const hkey = xhhHkey(path, t, nonce);
  const sign = `hkey=${hkey}&_time=${t}&nonce=${nonce}`;
  return `${apiHost}${path}?${commonParams}&${sign}&${extra}`;
}

function extractLinkId(shareUrl) {
  if (!shareUrl) return "";
  const match = String(shareUrl).match(/[?&]link_id=([^&#]+)/);
  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}

function isChallenge(status) {
  const s = String(status ?? "");
  return s === "show_captcha" || s === "need_verify" || s.includes("captcha");
}

function challengeError(where, status) {
  throw new Error(`${where} status=${status ?? "nil"}。已触发小黑盒风控/验证码，请切换网络或代理 IP 后重试。`);
}

function coerceStr(value) {
  return value == null ? "" : String(value);
}

function stripTags(html) {
  return coerceStr(html).replace(/<[^>]*>/g, "");
}

function stripUrlQuery(url) {
  return coerceStr(url).split("?", 1)[0];
}

function stripEmojiBracketTokens(value) {
  return coerceStr(value)
    .replace(/\[[a-z]+_[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tryHtmlCssPair(node) {
  if (!node || typeof node !== "object") return null;
  const html = coerceStr(node.html);
  if (!html) return null;
  return { html, css: coerceStr(node.css) };
}

function findPostRender(linkObj) {
  return (
    tryHtmlCssPair(linkObj?.image_text) ||
    tryHtmlCssPair(linkObj?.post_body) ||
    tryHtmlCssPair(linkObj?.header_render)
  );
}

function findCommentsRender(treeResult) {
  return tryHtmlCssPair(treeResult?.comments_block) || tryHtmlCssPair(treeResult?.comment_list);
}

function authorFromLink(linkObj) {
  const user = linkObj?.user;
  if (!user) {
    return { username: "", userid: "", avatar: "", avatar_decoration: "", level: 0, fan_num: 0 };
  }
  return {
    username: coerceStr(user.username),
    userid: coerceStr(user.userid),
    avatar: coerceStr(user.avatar),
    avatar_decoration: coerceStr(user.avatar_decoration?.src_url),
    level: Number(user.level_info?.level ?? 0),
    fan_num: Number(user.fan_num ?? 0),
  };
}

function topicsToTags(linkObj) {
  const topics = Array.isArray(linkObj?.topics) ? linkObj.topics : [];
  return topics.map((topic) => coerceStr(topic?.name)).filter(Boolean);
}

function flattenComments(treeResult, maxN) {
  const out = [];
  const groups = Array.isArray(treeResult?.comments) ? treeResult.comments : [];
  for (const group of groups) {
    const arr = Array.isArray(group?.comment) ? group.comment : [];
    for (const comment of arr) {
      if (out.length >= maxN) return out;
      const user = comment?.user || {};
      const imgs = Array.isArray(comment?.imgs)
        ? comment.imgs
            .map((img) => ({
              url: coerceStr(img?.url),
              thumb: coerceStr(img?.thumb),
              width: Number(img?.width ?? 0),
              height: Number(img?.height ?? 0),
            }))
            .filter((img) => img.url || img.thumb)
        : [];
      out.push({
        text: coerceStr(comment?.text),
        floor_num: Number(comment?.floor_num ?? 0),
        create_at: Number(comment?.create_at ?? 0),
        ip_location: coerceStr(comment?.ip_location),
        username: coerceStr(user.username),
        userid: coerceStr(user.userid),
        avatar: coerceStr(user.avatar),
        avatar_decoration: coerceStr(user.avatar_decoration?.src_url),
        level: Number(user.level_info?.level ?? 0),
        up: Number(comment?.up ?? 0),
        reply_to_username: coerceStr(comment?.replyuser?.username),
        is_reply: comment?.replyid != null,
        is_cy: comment?.is_cy === true || comment?.is_cy === 1,
        imgs,
      });
    }
  }
  return out;
}

async function fetchJson(url) {
  return (await fetch(url)).json();
}

function validHttpUrl(url) {
  return /^https?:\/\//i.test(coerceStr(url));
}

function firstOriginalUrl(originalResponse, fallbackInput) {
  const imgs = originalResponse?.result?.imgs;
  let finalUrl = "";
  if (typeof imgs === "string") {
    finalUrl = imgs;
  } else if (Array.isArray(imgs) && imgs.length > 0) {
    finalUrl = coerceStr(imgs[0]);
  }
  if (!validHttpUrl(finalUrl)) {
    const fallback = stripUrlQuery(fallbackInput);
    if (validHttpUrl(fallback)) finalUrl = fallback;
  }
  return validHttpUrl(finalUrl) ? finalUrl : "";
}

async function resolveOriginalUrl(inputUrl, commonParams, where) {
  const origExtra = `url=${encodeURIComponent(inputUrl)}`;
  const origUrl = signedUrl(API_HOST, PATH_ORIGINAL, commonParams, origExtra);
  const orig = await fetchJson(origUrl);
  if (isChallenge(orig?.status)) challengeError(where, orig?.status);
  if (orig?.status !== "ok") {
    log(`${where} 失败 status=${coerceStr(orig?.status)}`, "warn");
    return "";
  }
  return firstOriginalUrl(orig, inputUrl);
}

async function crawlPost(linkId, itemWeight, commonParams, fetchCommentImages) {
  const treeExtra = `link_id=${encodeURIComponent(linkId)}&is_first=1&page=1&index=1&limit=20&owner_only=0`;
  const treeUrl = signedUrl(API_HOST, PATH_TREE, commonParams, treeExtra);
  const tree = await fetchJson(treeUrl);

  if (isChallenge(tree?.status)) challengeError("帖子树接口", tree?.status);
  if (tree?.status !== "ok") {
    log(`tree 请求失败 link_id=${linkId} status=${coerceStr(tree?.status)}`, "warn");
    addProgress(itemWeight);
    return;
  }

  const treeResult = tree.result;
  const linkObj = treeResult?.link;
  if (!linkObj) {
    log(`tree 无 result.link link_id=${linkId}`, "warn");
    addProgress(itemWeight);
    return;
  }

  const textStr = coerceStr(linkObj.text);
  if (!textStr) {
    log(`帖子正文为空 link_id=${linkId}`, "warn");
    addProgress(itemWeight);
    return;
  }

  let blocks;
  try {
    blocks = JSON.parse(textStr);
  } catch {
    log(`解析帖子正文 JSON 失败 link_id=${linkId}`, "warn");
    addProgress(itemWeight);
    return;
  }
  if (!Array.isArray(blocks)) {
    log(`帖子正文 JSON 不是数组 link_id=${linkId}，跳过下载`, "warn");
    addProgress(itemWeight);
    return;
  }

  const titleHtml = coerceStr(linkObj.title);
  const titlePlain = stripTags(titleHtml).trim();
  let displayName = stripEmojiBracketTokens(titlePlain);
  if (!displayName) {
    const descHtml = coerceStr(linkObj.description) || coerceStr(linkObj.desc);
    displayName = stripEmojiBracketTokens(stripTags(descHtml).trim()) || `xhh_${linkId}`;
  }

  log(`[小黑盒] link_id=${linkId} display_name=${displayName}`);

  const author = authorFromLink(linkObj);
  const tags = topicsToTags(linkObj);
  const commentsSnapshot = flattenComments(treeResult, 120);
  const postRender = findPostRender(linkObj);
  const commentsRender = findCommentsRender(treeResult);
  const shareUrl = coerceStr(linkObj.share_url);
  const postCreateAt = Number(linkObj.create_at ?? 0);
  const postIp = coerceStr(linkObj.ip_location);

  let descriptionPlain = "";
  const thumbUrls = [];
  for (const block of blocks) {
    if (block?.type === "text" && !descriptionPlain) {
      descriptionPlain = stripEmojiBracketTokens(stripTags(block.text).trim());
    }
    if (block?.type !== "img") continue;
    const thumb = coerceStr(block.url);
    if (thumb) thumbUrls.push(thumb);
  }

  const imageTotal = thumbUrls.length;
  if (imageTotal === 0) {
    log(`已解析正文但未找到 type=img 配图缩略图 link_id=${linkId} display_name=${displayName}，跳过下载`, "warn");
    addProgress(itemWeight);
    return;
  }

  const metadata = {
    link_id: linkId,
    share_url: shareUrl,
    description: descriptionPlain,
    title_html: titleHtml,
    title_plain: titlePlain,
    link_title: coerceStr(linkObj.title),
    author,
    tags,
    comments_snapshot: commentsSnapshot,
    comments_max: 120,
    post_create_at: postCreateAt,
    post_ip: postIp,
    post_render_html: postRender?.html || "",
    post_render_css: postRender?.css || "",
    comments_render_html: commentsRender?.html || "",
    comments_render_css: commentsRender?.css || "",
    image_total: imageTotal,
  };
  const metadataId = createImageMetadata(metadata);

  const deltaPerImage = itemWeight / imageTotal;
  for (let index = 0; index < thumbUrls.length; index += 1) {
    const finalUrl = await resolveOriginalUrl(thumbUrls[index], commonParams, "原图接口");
    if (finalUrl) {
      const imageDisplayName = imageTotal > 1 ? `${displayName}(${index + 1})` : displayName;
      await downloadImage(finalUrl, {
        name: imageDisplayName,
        metadata_id: metadataId,
        url: shareUrl,
      });
    } else {
      log(`原图 URL 无效且无可用回退 link_id=${linkId} k=${index + 1}`, "warn");
    }
    addProgress(deltaPerImage);
  }

  if (!fetchCommentImages) return;

  for (const comment of commentsSnapshot) {
    const commentImages = Array.isArray(comment.imgs) ? comment.imgs : [];
    for (let index = 0; index < commentImages.length; index += 1) {
      const commentImage = commentImages[index];
      const inputUrl = commentImage.thumb || commentImage.url;
      if (!validHttpUrl(inputUrl)) continue;

      const finalUrl = await resolveOriginalUrl(inputUrl, commonParams, "原图接口(评论图)");
      if (!finalUrl) {
        log(`原图 URL 无效且无可用回退(评论图) link_id=${linkId} floor=${comment.floor_num}`, "warn");
        continue;
      }

      const baseName = `${displayName}[comment_${comment.floor_num}]`;
      const name = commentImages.length > 1 ? `${baseName}(${index + 1})` : baseName;
      await downloadImage(finalUrl, {
        name,
        metadata_id: metadataId,
        url: shareUrl,
      });
    }
  }
}

async function runSinglePost(commonParams, vars) {
  const inputUrl = coerceStr(vars?.post_share_url);
  if (!inputUrl) throw new Error("单帖子模式：请填写帖子分享 URL");

  const linkId = extractLinkId(inputUrl);
  if (!linkId) throw new Error("无法从 URL 中提取 link_id，请确认这是小黑盒帖子分享链接");

  log(`[小黑盒] 单帖子模式：link_id=${linkId}`);
  await crawlPost(linkId, 100.0, commonParams, !!vars?.fetch_comment_images);
}

async function runSearch(commonParams, vars) {
  const searchKeyword = coerceStr(vars?.search_keyword || "美图");
  const startPage = Number(vars?.start_page ?? 1);
  const endPage = Number(vars?.end_page ?? startPage);
  const pageSize = Number(vars?.page_size ?? 5);

  if (endPage < startPage) throw new Error("结束页须大于或等于起始页");
  if (startPage < 1) throw new Error("起始页须至少为 1");
  if (pageSize < 1) throw new Error("每页条数须至少为 1");

  const totalPages = endPage - startPage + 1;
  const pageWeight = 100.0 / totalPages;
  log(`[小黑盒] 开始：关键词「${searchKeyword}」，第 ${startPage}～${endPage} 页，每页 ${pageSize} 条`);

  for (let page = startPage; page <= endPage; page += 1) {
    const offset = (page - 1) * pageSize;
    const extra = `q=${encodeURIComponent(searchKeyword)}&search_type=general&offset=${offset}&limit=${pageSize}`;
    const searchUrl = signedUrl(API_HOST, PATH_SEARCH, commonParams, extra);
    const response = await fetchJson(searchUrl);

    if (isChallenge(response?.status)) challengeError("搜索接口", response?.status);
    if (response?.status !== "ok") {
      log(`搜索请求失败: ${coerceStr(response?.status)}`, "warn");
      break;
    }

    const items = Array.isArray(response?.result?.items) ? response.result.items : [];
    if (items.length === 0) {
      log(`第 ${page} 页无搜索结果`, "warn");
      addProgress(pageWeight);
      continue;
    }

    const validItems = items.filter((item) => {
      const info = item?.info;
      const linkId = extractLinkId(info?.share_url) || coerceStr(info?.linkid);
      return !!linkId;
    });

    if (validItems.length === 0) {
      log(`第 ${page} 页无含 link_id 的有效帖子`, "warn");
      addProgress(pageWeight);
      continue;
    }

    const itemWeight = pageWeight / validItems.length;
    log(`第 ${page}/${endPage} 页：共 ${validItems.length} 条有效帖子，开始解析`);
    for (const item of validItems) {
      const info = item.info || {};
      const linkId = extractLinkId(info.share_url) || coerceStr(info.linkid);
      await crawlPost(linkId, itemWeight, commonParams, !!vars?.fetch_comment_images);
    }
    log(`第 ${page} 页处理完成`);
  }
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setRequestHeaders();
  const commonParams = `${COMMON_PARAMS_BASE}&device_id=${xhhFakeDeviceId()}`;

  if (vars?.crawl_mode === "single_post") {
    await runSinglePost(commonParams, vars);
  } else {
    await runSearch(commonParams, vars);
  }

  log("[小黑盒] 任务结束");
}
