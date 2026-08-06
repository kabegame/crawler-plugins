// Patreon WebView 爬虫。
//
// 为什么必须走 WebView 后端：patreon.com 被 Cloudflare 的**客户端指纹识别**拦截。
// 实测（2026-07-28）HTML 页返回 cf-mitigated: challenge，/api/* 返回通用 JSON 403，
// 连 /api/current_user 都拒。逐个隔离排除过 cookie 完整性（session_id / cf_clearance
// 都在畅游记录里）、User-Agent、Content-Type、sec-ch-ua / sec-fetch-* 全套浏览器头、
// HTTP/2 —— 剩下唯一变量是 TLS/HTTP 客户端指纹。V8 后端的 fetch 走宿主 reqwest，
// 和 curl 一样过不去。真实 CEF 页面用的是浏览器自己的网络栈，天然过 CF。
//
// 架构：先导航到创作者主页（真浏览器解 CF 挑战 + 带登录态），从页面里直接读
// __NEXT_DATA__ 拿 campaign id；之后**在同一次脚本执行里**用原生 fetch 打 /api/posts
// 分页，不再导航。详情接口与页面同源，fetch 不受 CORS 限制、自动携带 Cookie。
//
// 归档附件：Kabegame.fetchToFile 流式落进任务 VFS → Kabegame.archive.* 宿主解压 →
// 逐条 downloadImage 入库。全程不把包体读进页面 JS 堆。
//
// 接口结构与字段取自 gallery-dl 的 patreon.py 提取器。

const BASE_URL = "https://www.patreon.com";

// 归档附件后缀 → 交给 Kabegame.archive 的哪个函数。
// rar 不在此表：没有可用的纯 Rust 解码器，且官方 unrar 许可证禁止用于重建 RAR 压缩算法。
const ARCHIVE_KINDS = [
  { suffixes: [".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tbz", ".tar"], kind: "tar" },
  { suffixes: [".zip"], kind: "zip" },
  { suffixes: [".7z"], kind: "sevenZip" },
];

const UNSUPPORTED_ARCHIVE_SUFFIXES = [".rar", ".zst", ".zstd"];

function coerceStr(value) {
  return value == null ? "" : String(value).trim();
}

function errorMessage(error) {
  return error?.message ?? String(error);
}

function log(message) {
  return Kabegame.log(`[patreon] ${message}`);
}

function warn(message) {
  return Kabegame.warn(`[patreon] ${message}`);
}

// ---------------------------------------------------------------- campaign id

// 在真实页面里取 campaign id：优先直接读 DOM 里的 __NEXT_DATA__，
// 比对 HTML 文本做正则稳得多（我们就在页面上下文里，不需要重新抓一遍）。
function extractCampaignIdFromPage() {
  const node = document.getElementById("__NEXT_DATA__");
  if (node?.textContent) {
    try {
      const data = JSON.parse(node.textContent);
      const envelope = data?.props?.pageProps?.bootstrapEnvelope;
      const bootstrap = envelope?.pageBootstrap ?? envelope?.bootstrap;
      const id = coerceStr(bootstrap?.campaign?.data?.id);
      if (id) return id;
    } catch {
      // 落到下面的兜底
    }
  }

  // 兜底：Next.js 13 把整段 bootstrap 以转义 JSON 内联在 flight payload 里。
  const html = document.documentElement?.innerHTML ?? "";
  const escaped = html.match(
    /\{\\"value\\":\{\\"campaign\\":\{\\"data\\":\{\\"id\\":\\"(\d+)/,
  );
  if (escaped) return escaped[1];

  const legacy = html.match(/window\.patreon\s*=\s*\{"bootstrap":([\s\S]*?)\},"apiServer"/);
  if (legacy) {
    try {
      const parsed = JSON.parse(`${legacy[1]}}`);
      const id = coerceStr(parsed?.campaign?.data?.id);
      if (id) return id;
    } catch {
      // 无兜底了
    }
  }
  return "";
}

// 支持直接粘完整链接，或 id:<campaign_id> 跳过主页解析。
// 单一输入框自适应：URL 本身已经无歧义地编码了类型，不需要额外的模式选择器。
// 支持的形式：
//   prprbecause31                                    → 创作者（vanity 名）
//   https://www.patreon.com/c/prprbecause31          → 创作者
//   https://www.patreon.com/prprbecause31/posts      → 创作者
//   https://www.patreon.com/collection/1936000?...   → 合集
//   collection:1936000                               → 合集（免打完整 URL）
//   1936000                                          → 纯数字一律当合集 id（vanity 名不会是纯数字）
//   id:12345678                                      → 直接给 campaign id，跳过一切解析
//
// 返回 { kind, value, pageUrl }：pageUrl 是要导航过去的真实页面
//（必须落在 patreon.com 上，后续同源 fetch 才过得了 Cloudflare）。
function parseTarget(raw) {
  const value = coerceStr(raw);
  if (!value) throw new Error("请填写创作者或合集");

  if (value.startsWith("id:")) {
    const id = value.slice(3).trim();
    if (!id) throw new Error("id: 后面要跟 campaign id");
    // 没有具体页面可去，落到创作者根域即可，只为拿到同源上下文。
    return { kind: "campaign", value: id, pageUrl: `${BASE_URL}/home` };
  }

  if (value.startsWith("collection:")) {
    const id = value.slice("collection:".length).trim();
    if (!/^\d+$/.test(id)) throw new Error(`合集 id 必须是数字，收到「${id}」`);
    return { kind: "collection", value: id, pageUrl: `${BASE_URL}/collection/${id}` };
  }

  // 关注流：你订阅的所有创作者的最新帖，一次抓完。
  if (/^(home|following)$/i.test(value)) {
    return { kind: "home", value: "home", pageUrl: `${BASE_URL}/home` };
  }

  if (/^https?:\/\//i.test(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`无法解析链接：${value}`);
    }
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

    if (parts[0] === "collection") {
      const id = coerceStr(parts[1]);
      if (!/^\d+$/.test(id)) throw new Error(`无法从「${value}」解析出合集 id`);
      // 丢掉 ?view=expanded 之类的展示参数，它们与抓取无关。
      return { kind: "collection", value: id, pageUrl: `${BASE_URL}/collection/${id}` };
    }

    // 单帖：/posts/<slug-with-id>。slug 末尾那串数字才是 post id，但这里不用拆——
    // 直接导航过去，从页面的 bootstrap 里读完整 post 对象即可。
    if (parts[0] === "posts" && parts[1]) {
      return {
        kind: "post",
        value: parts[1],
        pageUrl: `${BASE_URL}/posts/${encodeURIComponent(parts[1])}`,
      };
    }

    if (parts[0] === "home" || parts.length === 0) {
      return { kind: "home", value: "home", pageUrl: `${BASE_URL}/home` };
    }

    // /c/<name>、/cw/<name>、/<name>、/<name>/posts 都取到 name。
    const name = parts[0] === "c" || parts[0] === "cw" ? parts[1] : parts[0];
    if (!name) throw new Error(`无法从「${value}」解析出创作者名`);
    return {
      kind: "creator",
      value: name,
      pageUrl: `${BASE_URL}/c/${encodeURIComponent(name)}`,
    };
  }

  // 纯数字：Patreon 的 vanity 名不允许全数字，所以只可能是合集 id。
  if (/^\d+$/.test(value)) {
    return { kind: "collection", value, pageUrl: `${BASE_URL}/collection/${value}` };
  }

  return {
    kind: "creator",
    value,
    pageUrl: `${BASE_URL}/c/${encodeURIComponent(value)}`,
  };
}

// ------------------------------------------------------------------ posts API

// 依据 gallery-dl patreon.py 的 _build_url。fields 少一个都可能让 attachments 不返回。
function buildPostsUrl(campaignId, collectionId, ascending) {
  const query = [
    "include=campaign,access_rules,attachments,attachments_media,audio,images," +
      "media,poll.choices,user,user_defined_tags",
    "fields[campaign]=currency,avatar_photo_url,earnings_visibility,is_nsfw,is_monthly,name,url",
    "fields[post]=content,current_user_can_view,embed,image,is_paid,like_count," +
      "min_cents_pledged_to_view,post_file,post_metadata,published_at,patreon_url," +
      "post_type,pledge_url,thumbnail,thumbnail_url,teaser_text,title,upgrade_url,url",
    "fields[post_tag]=tag_type,value",
    "fields[user]=image_url,full_name,url",
    "fields[access_rule]=access_rule_type,amount_cents",
    "fields[media]=id,image_urls,download_url,metadata,file_name",
    `filter[campaign_id]=${encodeURIComponent(campaignId)}`,
    "filter[contains_exclusive_posts]=true",
    "filter[is_draft]=false",
  ];

  if (collectionId) {
    // 合集的两个坑，均由 gallery-dl patreon.py:371-396 标注并实测：
    //   1. 即便已经有 collection_id，缺 campaign_id 仍然 400；
    //   2. 排序只能用正序 collection_order，"-collection_order" 同样 400。
    query.push(`filter[collection_id]=${encodeURIComponent(collectionId)}`);
    query.push("filter[include_drops]=true");
    query.push("sort=collection_order");
  } else {
    // 从旧到新用正序 published_at，从新到旧用倒序 -published_at。
    query.push(ascending ? "sort=published_at" : "sort=-published_at");
  }
  query.push("json-api-version=1.0");
  return `${BASE_URL}/api/posts?${query.join("&")}`;
}

// 页面自己的 fetch：同源、自动带 Cookie、真浏览器指纹。
// Content-Type 只在 API 请求上带——带着它请求 HTML 页会被判 403。
async function fetchApi(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/vnd.api+json" },
  });
  if (!response.ok) {
    throw new Error(`接口请求失败(${response.status}): ${url.slice(0, 120)}`);
  }
  return response.json();
}

// 关注流：你订阅的所有创作者的最新帖。走 /api/stream 而非 /api/posts，
// 不需要 campaign_id。依据 gallery-dl patreon.py:476-485 的 PatreonUserExtractor。
function buildStreamUrl(ascending) {
  const query = [
    "include=campaign,access_rules,attachments,attachments_media,audio,images," +
      "media,poll.choices,user,user_defined_tags",
    "fields[campaign]=currency,avatar_photo_url,earnings_visibility,is_nsfw,is_monthly,name,url",
    "fields[post]=content,current_user_can_view,embed,image,is_paid,like_count," +
      "min_cents_pledged_to_view,post_file,post_metadata,published_at,patreon_url," +
      "post_type,pledge_url,thumbnail,thumbnail_url,teaser_text,title,upgrade_url,url",
    "fields[post_tag]=tag_type,value",
    "fields[user]=image_url,full_name,url",
    "fields[access_rule]=access_rule_type,amount_cents",
    "fields[media]=id,image_urls,download_url,metadata,file_name",
    "filter[is_following]=true",
    "json-api-use-default-includes=false",
    ascending ? "sort=published_at" : "sort=-published_at",
    "json-api-version=1.0",
  ];
  return `${BASE_URL}/api/stream?${query.join("&")}`;
}

// JSON:API 的 included 是扁平数组，摊成 {type: {id: attributes}} 便于按 relationships 回填。
function indexIncluded(included) {
  const result = {};
  for (const item of Array.isArray(included) ? included : []) {
    const type = coerceStr(item?.type);
    const id = coerceStr(item?.id);
    if (!type || !id) continue;
    if (!result[type]) result[type] = {};
    result[type][id] = item.attributes || {};
  }
  return result;
}

function relatedFiles(post, included, key) {
  const data = post?.relationships?.[key]?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((ref) => included?.[coerceStr(ref?.type)]?.[coerceStr(ref?.id)])
    .filter(Boolean);
}

function processPost(post, included) {
  const attr = { ...(post?.attributes || {}) };
  attr.id = coerceStr(post?.id);
  attr.images = relatedFiles(post, included, "images");
  attr.attachments = relatedFiles(post, included, "attachments");
  attr.attachmentsMedia = relatedFiles(post, included, "attachments_media");
  return attr;
}

// ------------------------------------------------------------------ 附件分类

function archiveKindOf(name) {
  const lower = coerceStr(name).toLowerCase();
  for (const { suffixes, kind } of ARCHIVE_KINDS) {
    if (suffixes.some((suffix) => lower.endsWith(suffix))) return kind;
  }
  return "";
}

function isUnsupportedArchive(name) {
  const lower = coerceStr(name).toLowerCase();
  return UNSUPPORTED_ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

// 从下载 URL 里抠 MD5：路径按 / 切开倒序找第一个长度 32 的段。
// 依据 gallery-dl patreon.py:256-264。同一个 post 里 images / post_file / content
// 经常指向同一个文件，靠这个做 URL 级预去重，省掉重复下载再靠内容 hash 去重的开销。
function fileHash(url) {
  const parts = coerceStr(url).split("?")[0].split("/").reverse();
  for (const part of parts) {
    if (part.length === 32) return part;
  }
  return "";
}

// attachments 的 url 是跳转链接（fetchToFile 会跟 302），attachments_media 直接给 download_url。
// 依据 patreon.py:115-122。
function collectAttachments(post) {
  const out = [];
  for (const item of post.attachments) {
    const url = coerceStr(item?.url);
    const name = coerceStr(item?.name);
    if (url && name) out.push({ url, name });
  }
  for (const item of post.attachmentsMedia) {
    const url = coerceStr(item?.download_url);
    const name = coerceStr(item?.file_name);
    if (url && name) out.push({ url, name });
  }

  // post_file 是帖子的**主文件**，和附件区是两个不同的位置。创作者把压缩包放主文件时，
  // 只看 attachments 会整个漏掉。依据 patreon.py:81-90 的 _postfile。
  const postFile = post.post_file;
  const postFileUrl = coerceStr(postFile?.url);
  if (postFileUrl) {
    const name = coerceStr(postFile?.name) ||
      decodeURIComponent(postFileUrl.split("?")[0].split("/").pop() || "");
    if (name) out.push({ url: postFileUrl, name });
  }
  return out;
}

// 帖子自带图片：images[].download_url、封面 image.large_url，
// 以及正文 HTML 里 <figure><img src="…"> 内嵌的图。
// 依据 patreon.py 的 _images / _image_large / _content 三个 generator。
function collectPostImages(post) {
  const out = [];
  const seen = new Set();

  const push = (url, name) => {
    const clean = coerceStr(url);
    if (!clean) return;
    const hash = fileHash(clean);
    // 有 hash 的按 hash 去重，没 hash 的按 URL 原样去重。
    const key = hash || clean;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: clean, name: coerceStr(name) });
  };

  for (const image of post.images) {
    push(image?.download_url, image?.file_name);
  }
  push(post.image?.large_url, post.image?.file_name);

  const content = coerceStr(post.content);
  if (content) {
    // 正文是一段 HTML 字符串（不是当前页面的 DOM），用 DOMParser 解析比正则稳。
    try {
      const doc = new DOMParser().parseFromString(content, "text/html");
      for (const img of doc.querySelectorAll("figure img[src]")) {
        push(img.getAttribute("src"), "");
      }
    } catch {
      // 解析失败就放弃正文内嵌图，不影响其它来源
    }
  }
  return out;
}

function postPageUrl(post) {
  const relative = coerceStr(post?.patreon_url);
  if (relative) return `${BASE_URL}${relative}`;
  return coerceStr(post?.url) || `${BASE_URL}/posts/${coerceStr(post?.id)}`;
}

function postLabel(post) {
  return `「${coerceStr(post?.title) || coerceStr(post?.id)}」(${coerceStr(post?.id)})`;
}

// ------------------------------------------------------------------ 归档入库

// 失败诊断阶梯：不猜原因，用三种 fetch 模式把 CORS / 鉴权 / 网络三类区分开。
// 只在下载失败后才跑，正常路径零开销。
//
// 判读方式：
//   - cors 抛错 + no-cors 成功(type=opaque)  → 跨源 CORS 被拒（CDN 不回 CORS 头）
//   - cors 拿到 status>=400                  → 鉴权/权限问题，不是 CORS
//   - 两种模式都抛错                          → DNS/网络/证书层
//   - redirected=true 且 origin 变了          → 302 到了 CDN，跨源由此产生
async function diagnoseFetchFailure(url, error) {
  await warn(`  ┏━ 下载失败诊断 ━━━━━━━━━━━━━━`);
  await warn(`  ┃ URL: ${url}`);
  await warn(`  ┃ 页面 origin: ${location.origin}`);
  try {
    const target = new URL(url, location.href);
    await warn(
      `  ┃ 目标 origin: ${target.origin}` +
        `（${target.origin === location.origin ? "同源" : "**跨源**"}）`,
    );
  } catch {
    await warn(`  ┃ 目标 origin: (URL 解析失败)`);
  }
  await warn(
    `  ┃ 原始错误: ${error?.name || "?"} / ${error?.constructor?.name || "?"}：` +
      `${error?.message || String(error)}`,
  );

  // 探针顺序即排查顺序：先试实际用的 same-origin，再用 omit / include 的差异
  // 判断是不是"通配 ACAO 撞上 credentials"这一类（omit 成而 include 败即是）。
  const probes = [
    { label: "same-origin(实际用法)", init: { mode: "cors", credentials: "same-origin" } },
    { label: "cors 无凭据", init: { mode: "cors", credentials: "omit" } },
    { label: "cors + credentials", init: { mode: "cors", credentials: "include" } },
    { label: "no-cors", init: { mode: "no-cors" } },
  ];
  for (const probe of probes) {
    try {
      const response = await fetch(url, probe.init);
      const ct = response.headers.get("content-type") || "-";
      const cl = response.headers.get("content-length") || "-";
      const acao = response.headers.get("access-control-allow-origin") || "无";
      await warn(
        `  ┃ [${probe.label}] status=${response.status} type=${response.type} ` +
          `redirected=${response.redirected} bodyNull=${response.body === null}`,
      );
      await warn(`  ┃     最终 URL: ${response.url || "(不可见)"}`);
      await warn(
        `  ┃     content-type=${ct} content-length=${cl} ` +
          `Access-Control-Allow-Origin=${acao}`,
      );
    } catch (probeError) {
      await warn(
        `  ┃ [${probe.label}] 抛错: ${probeError?.name || "?"}：` +
          `${probeError?.message || String(probeError)}`,
      );
    }
  }
  await warn(`  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// 归档魔数表。落盘内容不是真归档时（最常见的是被写进了一张 HTML 错误页 /
// Cloudflare 挑战页 / 登录跳转），解压会报一个和真因无关的错，这里提前点破。
const MAGIC_SIGNATURES = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: "zip" },
  { bytes: [0x50, 0x4b, 0x05, 0x06], label: "zip(空)" },
  { bytes: [0x50, 0x4b, 0x07, 0x08], label: "zip(分卷)" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], label: "7z" },
  { bytes: [0x1f, 0x8b], label: "gzip" },
  { bytes: [0x42, 0x5a, 0x68], label: "bzip2" },
  { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a], label: "xz" },
  { bytes: [0x52, 0x61, 0x72, 0x21], label: "rar(不支持)" },
];

function identifyMagic(head) {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((b, i) => head[i] === b)) return sig.label;
  }
  // tar 的 "ustar" 在 offset 257，这里只读了头部，识别不到属正常。
  const ascii = String.fromCharCode(...head.slice(0, 32)).toLowerCase();
  if (ascii.includes("<!doctype") || ascii.includes("<html")) return "HTML(!!)";
  if (ascii.trimStart().startsWith("{")) return "JSON(!!)";
  return "";
}

// 读落盘文件的头 64 字节，判定它到底是不是归档。
async function inspectDownloadedFile(path) {
  let file;
  try {
    file = await Kabegame.fs.open(path, { read: true });
    const buffer = new Uint8Array(64);
    const nread = (await file.read(buffer)) || 0;
    const head = Array.from(buffer.slice(0, nread));
    const hex = head.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = head
      .slice(0, 48)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    return { nread, hex, ascii, kind: identifyMagic(head) };
  } catch (error) {
    return { error: error?.message || String(error) };
  } finally {
    try {
      await file?.close();
    } catch {
      // 忽略
    }
  }
}

async function ingestArchive(attachment, kind, ctx) {
  const { root, vars, metadataId, pageUrl, displayBase } = ctx;
  const stamp = String(ctx.seq++);
  const archivePath = `${root}/tmp/patreon-${stamp}`;
  const extractDir = `${root}/tmp/patreon-${stamp}-out`;

  let ok = 0;
  let failed = 0;
  try {
    await log(`    ↓ 开始下载 ${attachment.name}`);
    await log(`      URL: ${attachment.url}`);

    let head;
    try {
      // credentials 必须是 "same-origin"（fetch 默认值），**不能写 "include"**。
      // 附件直链指向 CDN（c10.patreonusercontent.com），它回的是通配
      // `Access-Control-Allow-Origin: *`；按规范通配 ACAO 在 credentials=include 时无效，
      // 浏览器直接 TypeError: Failed to fetch。实测（2026-07-29）：
      //   credentials:"include" → TypeError
      //   credentials:"omit"    → 200, type=cors, application/zip
      // 而 CDN URL 本身是预签名的（token-hash + token-time），认证在 URL 里，不需要 cookie。
      // 用 "same-origin" 可同时照顾同源的 patreon.com/file?... 跳转链接（需要 cookie）
      // 与跨源 CDN 直链（必须不带 cookie）。
      head = await Kabegame.fetchToFile(attachment.url, archivePath, {
        credentials: "same-origin",
      });
    } catch (fetchError) {
      await diagnoseFetchFailure(attachment.url, fetchError);
      throw fetchError;
    }

    if (head.status >= 400) {
      await warn(`附件下载失败(${head.status})：${attachment.name}`);
      await diagnoseFetchFailure(
        attachment.url,
        new Error(`HTTP ${head.status} ${head.statusText}`),
      );
      return { ok: 0, failed: 1 };
    }

    // 落盘 0 字节说明 body 是空的或不可读（比如 opaque 响应），不是正常成功。
    if (!head.bytesWritten) {
      await warn(`附件落盘 0 字节：${attachment.name}（status=${head.status}）`);
      await diagnoseFetchFailure(
        attachment.url,
        new Error(`bytesWritten=0, status=${head.status}`),
      );
      return { ok: 0, failed: 1 };
    }
    await log(`    ↓ ${attachment.name}（${head.bytesWritten} 字节，最终 URL: ${head.url}）`);

    // 落盘内容自检：确认拿到的确实是归档，而不是一张 HTML 错误页。
    const probe = await inspectDownloadedFile(archivePath);
    if (probe.error) {
      await warn(`      落盘文件无法读取：${probe.error}`);
    } else {
      await log(`      魔数: ${probe.hex}`);
      await log(`      ASCII: ${probe.ascii}`);
      if (probe.kind === "HTML(!!)" || probe.kind === "JSON(!!)") {
        await warn(
          `      ✗ 下载到的不是归档而是 ${probe.kind}——` +
            `多半是被重定向到了登录页 / 错误页 / Cloudflare 挑战页。`,
        );
      } else if (probe.kind) {
        await log(`      判定格式: ${probe.kind}（声明为 ${kind}）`);
      } else {
        await log(`      判定格式: 未识别（tar 的 ustar 标记在偏移 257，属正常）`);
      }
    }

    await Kabegame.fs.mkdir(extractDir, { recursive: true });
    const include = coerceStr(vars.archive_include);
    const password = coerceStr(vars.archive_password);
    const result = await Kabegame.archive[kind](archivePath, extractDir, {
      include: include ? [include] : [],
      password: password || undefined,
      // 压缩包里的目录结构对图库没有意义，拍平后文件名更可读。
      flatten: true,
      overwrite: true,
    });
    await log(
      `    ⇲ 解出 ${result.entries.length} 个文件（跳过 ${result.skipped}，共 ${result.totalBytes} 字节）`,
    );

    for (const entry of result.entries) {
      const leaf = entry.path.split("/").pop() || attachment.name;
      try {
        await Kabegame.downloadImage(entry.path, {
          name: `${displayBase} / ${leaf}`,
          metadata_id: metadataId,
          url: pageUrl,
        });
        ok += 1;
      } catch (error) {
        failed += 1;
        await warn(`入库失败：${leaf}（${errorMessage(error)}）`);
      }
    }
  } catch (error) {
    failed += 1;
    await warn(
      `归档处理失败：${attachment.name}` +
        `（${error?.name || "Error"}：${errorMessage(error)}）`,
    );
    // 解压阶段炸的话，落盘文件还在，把它的实际内容打出来定位真因。
    const probe = await inspectDownloadedFile(archivePath);
    if (!probe.error) {
      await warn(`      失败时落盘内容：${probe.kind || "未识别"} | ${probe.hex}`);
      await warn(`      ASCII: ${probe.ascii}`);
    }
  } finally {
    // 只删归档包本身。**不要删解压产物**——downloadImage() 是入队即返回，
    // 真正读取任务 VFS 文件发生在后台 download worker；在这里删会让 worker 读到
    // ENOENT，实测整批入库全失败。解压产物只能留给任务结束后的清理。
    try {
      await Kabegame.fs.remove(archivePath);
    } catch {
      // 下载阶段就失败时文件可能压根不存在
    }
  }
  return { ok, failed };
}

async function downloadPost(post, ctx) {
  const attachments = collectAttachments(post);
  const images = ctx.vars.include_post_images === false ? [] : collectPostImages(post);

  const archives = [];
  for (const attachment of attachments) {
    const kind = archiveKindOf(attachment.name);
    if (kind) {
      archives.push({ attachment, kind });
    } else if (isUnsupportedArchive(attachment.name)) {
      await warn(`跳过不支持的归档格式：${attachment.name}`);
    }
    // 非归档的普通附件（pdf/psd/txt）不进图库，静默跳过。
  }

  if (archives.length === 0 && images.length === 0) {
    // 纯文字帖/无可下载附件：把该帖的进度额度补上，否则进度条会停在这里。
    await ctx.progress?.skipPost();
    return { ok: 0, failed: 0 };
  }
  // 一个压缩包和一张正文图各算一个下载单元。
  ctx.progress?.beginPost(archives.length + images.length);

  await log(`  → ${postLabel(post)}：${archives.length} 个压缩包，${images.length} 张正文图`);

  // 每帖只建一行 metadata，所有图片复用同一个 metadata_id。
  // 若改成逐图传内联 metadata，宿主会每张图插一行内容完全相同的记录——
  // 一个压缩包解出 50 张图就是 50 行冗余。
  const metadataId = Number(
    await Kabegame.createImageMetadata({
      schema: 1,
      id: post.id,
      title: coerceStr(post.title),
      published_at: coerceStr(post.published_at),
      teaser_text: coerceStr(post.teaser_text),
      creator: ctx.creator,
    }),
  );

  const pageUrl = postPageUrl(post);
  const displayBase = coerceStr(post.title) || coerceStr(post.id) || "patreon-post";
  const inner = { ...ctx, metadataId, pageUrl, displayBase };

  let ok = 0;
  let failed = 0;
  for (const { attachment, kind } of archives) {
    const stat = await ingestArchive(attachment, kind, inner);
    ok += stat.ok;
    failed += stat.failed;
    // 无论成败都推进——进度反映的是"处理完了多少个单元"，不是成功率。
    await ctx.progress?.tick();
  }
  for (const image of images) {
    try {
      await Kabegame.downloadImage(image.url, {
        name: image.name ? `${displayBase} / ${image.name}` : displayBase,
        metadata_id: metadataId,
        url: pageUrl,
      });
      ok += 1;
    } catch (error) {
      failed += 1;
      await warn(`正文图下载失败：${image.url}（${errorMessage(error)}）`);
    }
    await ctx.progress?.tick();
  }
  await log(`  ← ${postLabel(post)}：成功 ${ok}，失败 ${failed}`);
  return { ok, failed };
}

// ---------------------------------------------------------------------- 主流程

// ------------------------------------------------------------ 增量爬取水位线
//
// 存在插件私有数据（Kabegame.pluginData / setPluginData，按 plugin_id 持久化）里，
// 形如 { watermarks: { "home": "2026-08-01T…Z", "campaign:12345": "…" } }。
//
// 语义：水位线 = 上次成功抓到的**最新**帖子的 published_at。
// 因为列表按 published_at 倒序返回，所以增量 = 从最新开始翻、遇到 <= 水位线的帖子即停。
// （注意：不能把水位线当游标传给 page[cursor]——那个游标是"从哪开始往回翻"的**起点**，
//  语义正好相反，传进去只会从旧帖开始翻。）
//
// 合集不支持增量：它按 collection_order 排序，不是时间序，"遇到旧的就停"不成立。

const WATERMARK_ROOT = "watermarks";

// 时间一律转成 epoch 毫秒再比较。**不要**直接按字典序比 ISO 字符串：
// Patreon 的 published_at 形如 "2026-07-28T12:34:56.000+00:00"（带偏移），
// 而用户会填 "2026-01-01" 这种短格式，两者字符串比较的结果不可靠。
// 日志里给人看的时间。完整 ISO（2026-07-28T12:34:56.000+00:00）在日志里太长，
// 一行塞两个就没法读了。
function fmtTime(ms) {
  if (!Number.isFinite(ms)) return "?";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toEpoch(value) {
  const raw = coerceStr(value);
  if (!raw) return NaN;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? NaN : ms;
}

// 解析用户填的时间边界。空值返回 null（表示"无边界"），非法值直接报错——
// 静默忽略一个填错的时间会让用户以为过滤生效了，实际全量下载。
//
// `endOfDay` 用于上界：配置里用的是日期选择器（YYYY-MM-DD，无时分），
// 而 Date.parse("2026-06-30") 得到的是当天 00:00。若直接拿它当上界，
// 6/30 白天发的帖子会被判成"超出上界"而漏掉——与"最新时间填 6/30"的直觉相反。
// 所以上界要顺延到当天末尾。带了时分的完整时间戳则原样使用。
function parseBoundary(value, label, endOfDay) {
  const raw = coerceStr(value);
  if (!raw) return null;

  // **时区陷阱**：ES 规范规定纯日期形式（YYYY-MM-DD）按 **UTC** 解析，
  // 而带时分的无偏移形式（YYYY-MM-DDTHH:mm:ss）按**本地**解析。
  // 日期选择器给的是用户心中的本地日期，若直接 Date.parse("2026-06-30")
  // 会得到 UTC 午夜——在 UTC+8 就整体偏移 8 小时，窗口边界跟着错位
  // （本地 7/1 凌晨的帖子会被算进 6/30）。所以补上 T00:00:00 强制按本地解释。
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const compact = /^\d{8}$/.test(raw);
  const normalized = dateOnly
    ? `${raw}T00:00:00`
    : compact
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00`
      : raw;

  let ms = toEpoch(normalized);
  if (Number.isNaN(ms)) {
    throw new Error(
      `${label}「${raw}」无法解析为日期。请用日期选择器，或填形如 2026-01-31 的格式。`,
    );
  }
  // 上界顺延到当天末尾（本地时区的 23:59:59.999），使「填 6/30」包含 6/30 全天。
  if (endOfDay && (dateOnly || compact)) {
    ms += 24 * 60 * 60 * 1000 - 1;
  }
  return { ms, text: fmtTime(ms), dateOnly: dateOnly || compact };
}

function watermarkKey(target, campaignId) {
  if (target.kind === "home") return "home";
  if (campaignId) return `campaign:${campaignId}`;
  return "";
}

async function readWatermark(key) {
  if (!key) return "";
  try {
    const data = (await Kabegame.pluginData()) || {};
    return coerceStr(data?.[WATERMARK_ROOT]?.[key]);
  } catch (error) {
    await warn(`读取上次爬取记录失败，本次按全量处理：${errorMessage(error)}`);
    return "";
  }
}

async function writeWatermark(key, value) {
  if (!key || !value) return;
  try {
    const data = (await Kabegame.pluginData()) || {};
    const next = { ...data };
    next[WATERMARK_ROOT] = { ...(data[WATERMARK_ROOT] || {}), [key]: value };
    await Kabegame.setPluginData(next);
    await log(`  · 已记录本次爬取水位线：${value}`);
  } catch (error) {
    await warn(`写入爬取记录失败（下次会重复抓取）：${errorMessage(error)}`);
  }
}

// 进度模型：**按时间窗位置估算**，而不是按页数。
//
// 没有页数上限之后，总页数在开始时是未知的，按页均分已不可行。但时间窗给了一把更好的尺：
// 帖子按时间排序，所以"当前帖子在窗口里的位置"就是一个天然的完成度。
//
// 窗口两端的取法：
//   下界 = 最旧时间（用户填的或水位线），没有就用本次见到的最旧帖子（边走边扩，估算会偏保守）
//   上界 = 最新时间，没有就用"现在"
// 两端都缺时退化成按页固定小额度推进。
//
// 总额度取 99 而非 100，与宿主自己的 clamp(0, 99.9) 一致，留余量避免提前顶满。
function makeProgress(minMs, maxMs, ascending) {
  const spanKnown =
    Number.isFinite(minMs) && Number.isFinite(maxMs) && maxMs > minMs;
  const span = spanKnown ? maxMs - minMs : 0;
  let reported = 0; // 已经上报出去的累计百分比
  let fallbackPerPost = 0;
  let fallbackPerUnit = 0;

  // 把"当前处在时间窗的哪个位置"换算成 0~99 的完成度。
  // 进度只增不减：时间戳偶有乱序时不至于让进度条回退。
  function absoluteFor(ms) {
    if (!spanKnown || !Number.isFinite(ms)) return NaN;
    const ratio = ascending ? (ms - minMs) / span : (maxMs - ms) / span;
    return Math.max(0, Math.min(99, ratio * 99));
  }

  async function advanceTo(target) {
    if (!Number.isFinite(target) || target <= reported) return;
    const delta = target - reported;
    reported = target;
    await Kabegame.addProgress(delta);
  }

  return {
    // 时间窗可用时，按当前帖子的发布时间直接定位；否则走按页退化路径。
    async seek(ms) {
      await advanceTo(absoluteFor(ms));
    },
    beginPage(postCount) {
      fallbackPerPost = postCount > 0 ? 3 / postCount : 3;
      fallbackPerUnit = fallbackPerPost;
    },
    beginPost(unitCount) {
      fallbackPerUnit = unitCount > 0 ? fallbackPerPost / unitCount : fallbackPerPost;
    },
    async tick() {
      // 时间窗已经在 seek() 里推进过了，这里只服务于窗口未知的退化情形。
      if (spanKnown) return;
      reported += fallbackPerUnit;
      await Kabegame.addProgress(fallbackPerUnit);
    },
    async skipPost() {
      if (spanKnown) return;
      reported += fallbackPerPost;
      await Kabegame.addProgress(fallbackPerPost);
    },
  };
}

// 在创作者主页上跑完整个任务：拿到 campaign id 后全部走同源 fetch，不再导航。
async function crawlFromCreatorPage(campaignId, collectionId, target) {
  const vars = Kabegame.vars || {};
  const creator = coerceStr(vars.creator);

  const root = await Kabegame.fs.getRoot();
  await Kabegame.fs.mkdir(`${root}/tmp`, { recursive: true });

  // 时间窗与方向。合集按 collection_order 排列、不是时间序，整套时间逻辑对它不成立。
  const timeAware = !collectionId;
  const ascending = timeAware && coerceStr(vars.direction) === "asc";
  const wantIncremental = vars.incremental !== false && timeAware;
  const wmKey = wantIncremental ? watermarkKey(target || {}, campaignId) : "";
  const watermark = await readWatermark(wmKey);

  // 上界按当天末尾算（见 parseBoundary 注释），下界按当天 00:00 —— 两端都含当天。
  const maxBound = timeAware ? parseBoundary(vars.time_max, "最新时间", true) : null;
  let minBound = timeAware ? parseBoundary(vars.time_min, "最旧时间", false) : null;
  // 最旧时间留空时回落到上次爬取记录；没有记录就不设下界（一直翻到能扒到的最旧）。
  let minFromWatermark = false;
  if (timeAware && !minBound && watermark) {
    const ms = toEpoch(watermark);
    if (!Number.isNaN(ms)) {
      minBound = { ms, text: watermark };
      minFromWatermark = true;
    }
  }
  if (minBound && maxBound && minBound.ms > maxBound.ms) {
    throw new Error(
      `时间范围：最旧时间（${minBound.text}）不能晚于最新时间（${maxBound.text}）`,
    );
  }

  // 进度按时间窗位置估算。上界缺省用"现在"，下界缺省留 NaN（首帖到手后再定）。
  const progress = makeProgress(
    minBound ? minBound.ms : NaN,
    maxBound ? maxBound.ms : Date.now(),
    ascending,
  );

  const ctx = { root, vars, creator, seq: 1, progress };
  const isStream = target?.kind === "home";
  let url = isStream
    ? buildStreamUrl(ascending)
    : buildPostsUrl(campaignId, collectionId, ascending);
  let page = 0;
  let totalOk = 0;
  let totalFailed = 0;

  // 水位线 = 本次处理过的帖子里最新的那个。两个方向用同一个 max() 累加即可自然满足：
  //   从新到旧：第一个就是最新的，后面的都比不过它 → 相当于"首个与已有对比取新"
  //   从旧到新：每个都比前一个新 → 相当于"逐个刷新"
  let newestSeen = "";

  if (timeAware) {
    await log(`▶ 方向：${ascending ? "从旧到新" : "从新到旧"}`);
    await log(
      `▶ 时间窗：${minBound ? fmtTime(minBound.ms) : "能扒到的最旧"}` +
        `${minFromWatermark ? "（来自上次爬取记录）" : ""}` +
        ` ~ ${maxBound ? fmtTime(maxBound.ms) : "能扒到的最新"}`,
    );
  } else {
    await log("▶ 合集按合集内顺序排列，不按时间——方向与时间窗设置对它不生效");
  }
  while (url) {
    page += 1;
    const payload = await fetchApi(url);
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    {
      const included = indexIncluded(payload?.included);

      // 本页覆盖的时间区间。没有页数上限之后一趟可能翻很多页，
      // 尤其"还没进入时间窗、整页都在跳过"那段没有任何下载动作——
      // 不报出当前翻到哪个时间，日志上看起来就像卡死了。
      const stamps = rows
        .map((row) => toEpoch(coerceStr(row?.attributes?.published_at)))
        .filter((ms) => !Number.isNaN(ms));
      const pageSpan = stamps.length
        ? `${fmtTime(Math.max(...stamps))} ~ ${fmtTime(Math.min(...stamps))}`
        : "无时间信息";
      await log(`  ┌ 第 ${page} 页：${rows.length} 个帖子 · ${pageSpan}`);
      progress.beginPage(rows.length);

      let hitBoundary = false;
      let pageSkipped = 0;
      let pageHandled = 0;
      for (const row of rows) {
        const post = processPost(row, included);
        const published = coerceStr(post.published_at);
        const ms = toEpoch(published);

        if (timeAware && !Number.isNaN(ms)) {
          // 列表已按时间排好序，所以每个方向都有一个"越过即可停"的边界，
          // 另一个边界只能逐帖跳过（还没进入窗口）。
          if (ascending) {
            if (maxBound && ms > maxBound.ms) {
              await log(`  · 已越过最新时间（本篇 ${fmtTime(ms)}），停止翻页`);
              hitBoundary = true;
              break;
            }
            // 下界是"跳过边"。边界本身含不含要看来源：
            //   水位线 → 排除（那一篇上次已经抓过，不该重下）
            //   用户手填 → 包含（填 2026-06-15 的人期望当天的帖子也要）
            if (minBound && (minFromWatermark ? ms <= minBound.ms : ms < minBound.ms)) {
              pageSkipped += 1;
              await progress.skipPost();
              continue;
            }
          } else {
            // 同上：水位线排除边界本身，用户手填的下界包含它。
            if (minBound && (minFromWatermark ? ms <= minBound.ms : ms < minBound.ms)) {
              await log(
                minFromWatermark
                  ? `  · 已追上上次进度（本篇 ${fmtTime(ms)}），停止翻页`
                  : `  · 已越过最旧时间（本篇 ${fmtTime(ms)}），停止翻页`,
              );
              hitBoundary = true;
              break;
            }
            if (maxBound && ms > maxBound.ms) {
              pageSkipped += 1;
              await progress.skipPost();
              continue;
            }
          }
        }
        pageHandled += 1;

        if (published && (!newestSeen || ms > toEpoch(newestSeen))) {
          newestSeen = published;
        }
        // 进度按当前帖子在时间窗里的位置推进（时间窗未知时此调用无副作用）。
        await progress.seek(ms);

        // 未订阅的帖子拿不到附件直链，提前跳过，免得刷一串 403。
        if (post.current_user_can_view === false) {
          await log(`  · 无权查看，跳过 ${postLabel(post)}`);
          await progress.skipPost();
          continue;
        }
        const stat = await downloadPost(post, ctx);
        totalOk += stat.ok;
        totalFailed += stat.failed;
      }
      if (hitBoundary) {
        break;
      }
      if (timeAware && pageSkipped > 0 && pageHandled === 0) {
        // 整页都还没进入时间窗。明确说明在往哪个方向找、目标是什么，
        // 否则用户只看到一页页滚过、没有任何下载，会以为任务卡住了。
        const goal = ascending
          ? minBound
            ? `${fmtTime(minBound.ms)} 之后`
            : "最早的帖子"
          : maxBound
            ? `${fmtTime(maxBound.ms)} 之前`
            : "最新的帖子";
        await log(`  └ 本页 ${pageSkipped} 篇都在时间窗外，尚未到达 ${goal}，继续翻页…`);
      } else if (pageSkipped > 0) {
        await log(`  └ 本页处理 ${pageHandled} 篇，${pageSkipped} 篇在时间窗外`);
      }
    }

    url = coerceStr(payload?.links?.next);
    if (!url) {
      await log(`  · 已翻到最后一页（共 ${page} 页）`);
      break;
    }
  }

  // 去掉页数上限之后，循环只会因两件事结束：撞到时间下界，或翻完最后一页。
  // 两者都意味着"窗口内该抓的都抓了"，不会再出现中间缺口，所以可以无条件写回。
  //（这正是移除分页参数带来的最大收益：原先那套"从新到旧提前停止就不能写回"的
  //  特例规则连同它的缺口风险一起消失了。）
  if (wmKey && newestSeen) {
    await writeWatermark(wmKey, newestSeen);
  }

  await log(
    `◀ 结束：共翻 ${page} 页，成功 ${totalOk}，失败 ${totalFailed}`,
  );
  if (totalOk === 0 && totalFailed === 0) {
    // 时间窗设得太窄是最常见的"什么都没下到"，单独点出来，
    // 免得用户去查附件规则或订阅状态那些不相干的方向。
    const windowed = minBound || maxBound;
    await warn(
      windowed
        ? "没有下载到任何文件。先确认时间窗是否设得太窄" +
            (minFromWatermark ? "（下界来自上次爬取记录，可能已经追平）" : "") +
            "；其次才是该创作者没有压缩包附件、当前账号未订阅、或提取规则把包内文件全滤掉了。"
        : "没有下载到任何文件。可能原因：该创作者的帖子没有压缩包附件、当前账号未订阅、" +
            "或提取规则把包内文件全滤掉了。",
    );
  }
}

async function handleInitial() {
  const target = parseTarget(Kabegame.vars?.creator);
  const labels = { creator: "创作者主页", collection: "合集页", campaign: "站内页" };
  await log(`▶ 目标类型：${labels[target.kind]}（${target.value}）`);
  // 必须先导航到 patreon.com 上：只有真浏览器能过 Cloudflare 挑战，
  // 而后续的同源 fetch 也要有这个页面上下文才不被拦。
  await log(`▶ 打开 ${target.pageUrl}`);
  await Kabegame.to(target.pageUrl, { pageLabel: target.kind });
}

// 等页面过掉 Cloudflare 挑战。返回是否成功。
async function waitPastChallenge(readyCheck) {
  await Kabegame.waitForDom();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await readyCheck()) return true;
    if (/just a moment|checking your browser/i.test(document.title || "")) {
      if (attempt === 0) {
        await log("  · 正在过 Cloudflare 挑战…");
        await Kabegame.requestShowWebview();
      }
    }
    await Kabegame.sleep(1000);
  }
  return false;
}

async function handleCreatorPage() {
  let campaignId = "";
  const ok = await waitPastChallenge(async () => {
    campaignId = extractCampaignIdFromPage();
    return !!campaignId;
  });

  if (!ok || !campaignId) {
    throw new Error(
      "未能解析出 campaign id。若页面停在 Cloudflare challenge，请在弹出的窗口里手动完成验证；" +
        "若 Patreon 前端已改版，可在浏览器里找到 campaign id 后填成 id:<campaign_id>。",
    );
  }

  await log(`▶ campaign ${campaignId}`);
  await crawlFromCreatorPage(campaignId, "", { kind: "creator" });
}

async function handleCollectionPage() {
  const collectionId = parseTarget(Kabegame.vars?.creator).value;

  // 合集接口不需要挑战通过就能读？不确定，所以仍然先等页面 ready 再调，
  // 保证请求发出时已经在一个过了挑战的同源上下文里。
  const ok = await waitPastChallenge(async () => {
    if (/just a moment|checking your browser/i.test(document.title || "")) return false;
    return document.readyState === "complete";
  });
  if (!ok) {
    throw new Error(
      "合集页未能加载完成（可能卡在 Cloudflare challenge）。请在弹出的窗口里手动完成验证后重试。",
    );
  }

  // campaign_id 的主路径：/api/collection/<id> 的缩略图 URL 里含 /campaign/<id>/。
  // 这是 gallery-dl 的做法，但合集没有缩略图时会拿不到，故另备页面回退。
  let campaignId = "";
  let title = "";
  try {
    const payload = await fetchApi(`${BASE_URL}/api/collection/${collectionId}`);
    const attrs = payload?.data?.attributes || {};
    title = coerceStr(attrs?.title);
    const thumbUrl = coerceStr(attrs?.thumbnail?.url);
    const matched = thumbUrl.match(/\/campaign\/(\d+)\//);
    if (matched) campaignId = matched[1];
    if (!campaignId) {
      await log("  · 合集缩略图里没有 campaign id，改从页面解析");
    }
  } catch (error) {
    await log(`  · /api/collection 读取失败（${errorMessage(error)}），改从页面解析`);
  }

  // 回退：合集页本身也带 __NEXT_DATA__，里面同样有 campaign。
  if (!campaignId) campaignId = extractCampaignIdFromPage();

  if (!campaignId) {
    throw new Error(
      `未能解析出合集 ${collectionId} 所属的 campaign id。` +
        `Patreon 的合集接口缺 campaign_id 会直接 400，所以这一步是必需的。` +
        `可以改用「创作者」形式抓取，或填 id:<campaign_id>。`,
    );
  }

  await log(`▶ 合集 ${collectionId}${title ? `「${title}」` : ""}，campaign ${campaignId}`);
  await crawlFromCreatorPage(campaignId, collectionId, { kind: "collection" });
}

async function handleCampaignDirect() {
  const campaignId = parseTarget(Kabegame.vars?.creator).value;
  await log(`▶ 直接使用 campaign ${campaignId}`);
  await crawlFromCreatorPage(campaignId, "", { kind: "creator" });
}

// 关注流不需要 campaign id，直接打 /api/stream。
async function handleHomePage() {
  const ok = await waitPastChallenge(async () => {
    if (/just a moment|checking your browser/i.test(document.title || "")) return false;
    return document.readyState === "complete";
  });
  if (!ok) {
    throw new Error(
      "关注流页面未能加载完成（可能卡在 Cloudflare challenge）。请在弹出的窗口里手动完成验证后重试。",
    );
  }
  await log("▶ 关注流（你订阅的全部创作者）");
  await crawlFromCreatorPage("", "", { kind: "home" });
}

// 单帖：不走列表接口，直接从页面 bootstrap 里读完整 post 对象。
// 依据 gallery-dl patreon.py:494-516 的 PatreonPostExtractor。
function extractPostFromPage() {
  const node = document.getElementById("__NEXT_DATA__");
  if (!node?.textContent) return null;
  let bootstrap;
  try {
    const data = JSON.parse(node.textContent);
    const envelope = data?.props?.pageProps?.bootstrapEnvelope;
    bootstrap = envelope?.pageBootstrap ?? envelope?.bootstrap;
  } catch {
    return null;
  }
  const post = bootstrap?.post;
  if (!post?.data) return null;
  // 单帖的 bootstrap 自带 included，结构与列表接口一致，可直接复用同一套解析。
  const included = indexIncluded(post.included);
  return processPost(post.data, included);
}

async function handlePostPage() {
  let post = null;
  const ok = await waitPastChallenge(async () => {
    post = extractPostFromPage();
    return !!post;
  });
  if (!ok || !post) {
    throw new Error(
      "未能从帖子页解析出内容。若停在 Cloudflare challenge 请手动完成验证；" +
        "若该帖需要订阅才能查看，请确认当前账号有权限。",
    );
  }

  if (post.current_user_can_view === false) {
    await warn(`无权查看该帖 ${postLabel(post)}（需要订阅对应档位）`);
    return;
  }

  const root = await Kabegame.fs.getRoot();
  await Kabegame.fs.mkdir(`${root}/tmp`, { recursive: true });
  const progress = makeProgress(1);
  progress.beginPage(1);

  await log(`▶ 单帖 ${postLabel(post)}`);
  const ctx = {
    root,
    vars: Kabegame.vars || {},
    creator: coerceStr(Kabegame.vars?.creator),
    seq: 1,
    progress,
  };
  const stat = await downloadPost(post, ctx);
  await log(`◀ 结束：成功 ${stat.ok}，失败 ${stat.failed}`);
  if (stat.ok === 0 && stat.failed === 0) {
    await warn("该帖没有可下载的压缩包或图片。");
  }
}

async function main() {
  try {
    const pageLabel = await Kabegame.pageLabel();
    switch (pageLabel) {
      case "initial":
        await handleInitial();
        return;
      case "creator":
        await handleCreatorPage();
        await Kabegame.exit();
        return;
      case "collection":
        await handleCollectionPage();
        await Kabegame.exit();
        return;
      case "campaign":
        await handleCampaignDirect();
        await Kabegame.exit();
        return;
      case "home":
        await handleHomePage();
        await Kabegame.exit();
        return;
      case "post":
        await handlePostPage();
        await Kabegame.exit();
        return;
      default:
        await log(`阶段=${pageLabel}，结束`);
        await Kabegame.exit();
        return;
    }
  } catch (error) {
    await warn(`插件运行失败：${errorMessage(error)}`);
    await Kabegame.exit();
  }
}

await main();
