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
function creatorPageUrl(raw) {
  const value = coerceStr(raw);
  if (!value) throw new Error("请填写创作者");
  if (value.startsWith("id:")) return "";

  if (/^https?:\/\//i.test(value)) {
    const parts = new URL(value).pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    const name = parts[0] === "c" || parts[0] === "cw" ? parts[1] : parts[0];
    if (!name) throw new Error(`无法从「${value}」解析出创作者名`);
    return `${BASE_URL}/c/${encodeURIComponent(name)}`;
  }
  return `${BASE_URL}/c/${encodeURIComponent(value)}`;
}

// ------------------------------------------------------------------ posts API

// 依据 gallery-dl patreon.py 的 _build_url。fields 少一个都可能让 attachments 不返回。
function buildPostsUrl(campaignId) {
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
    "sort=-published_at",
    "json-api-version=1.0",
  ];
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

// 三级进度模型（与 kemono 插件同构）：页 → 帖 → 文件。
// 总额度取 99 而非 100，留 1 点余量，避免因取整提前顶满。
//
// 为什么要细到文件级：一个 Patreon 压缩包可能上百 MB、单个耗时几分钟。
// 只按页推进的话，默认「第 1 页~第 1 页」会退化成"全程 0%、结束跳 100%"，
// 等于没有进度条。
function makeProgress(plannedPages) {
  // 结束页填 0（页数未知）时无法均分，给每页一个固定小额度，
  // 页多了也不会越界——addProgress 的累加由宿主侧钳制。
  const perPage = plannedPages > 0 ? 99 / plannedPages : 3;
  let perPost = 0;
  let perUnit = 0;
  return {
    // 一页里有多少个帖子会被处理。
    beginPage(postCount) {
      perPost = postCount > 0 ? perPage / postCount : perPage;
      perUnit = perPost;
    },
    // 一个帖子里有多少个下载单元（压缩包 + 正文图）。
    beginPost(unitCount) {
      perUnit = unitCount > 0 ? perPost / unitCount : perPost;
    },
    // 完成一个下载单元。
    tick() {
      if (perUnit > 0) return Kabegame.addProgress(perUnit);
      return Promise.resolve();
    },
    // 整页没有任何可下载内容时，把该页额度一次性补上，免得进度条卡住。
    skipPost() {
      if (perPost > 0) return Kabegame.addProgress(perPost);
      return Promise.resolve();
    },
  };
}

// 解析页范围。约定与 kemono 插件一致：结束页填 0 表示一直到最后一页。
function resolvePageRange(vars) {
  const start = Math.max(1, Number(vars.page_start) || 1);
  const rawEnd = Number(vars.page_end) || 0;
  const end = rawEnd <= 0 ? Number.MAX_SAFE_INTEGER : rawEnd;
  if (end < start) {
    throw new Error(`页数范围：结束页（${rawEnd}）不能小于起始页（${start}）`);
  }
  return { start, end, rawEnd };
}

// 在创作者主页上跑完整个任务：拿到 campaign id 后全部走同源 fetch，不再导航。
async function crawlFromCreatorPage(campaignId) {
  const vars = Kabegame.vars || {};
  const creator = coerceStr(vars.creator);
  const { start, end, rawEnd } = resolvePageRange(vars);

  const root = await Kabegame.fs.getRoot();
  await Kabegame.fs.mkdir(`${root}/tmp`, { recursive: true });

  const plannedPages = rawEnd > 0 ? rawEnd - start + 1 : 0;
  const progress = makeProgress(plannedPages);

  const ctx = { root, vars, creator, seq: 1, progress };
  let url = buildPostsUrl(campaignId);
  let page = 0;
  let totalOk = 0;
  let totalFailed = 0;

  await log(
    `▶ 页范围：第 ${start} 页 ~ ${rawEnd > 0 ? `第 ${rawEnd} 页` : "最后一页"}`,
  );
  if (start > 1) {
    await log(
      `  · 前 ${start - 1} 页只请求不下载（游标分页无法直接跳页，须逐页推进游标）`,
    );
  }

  while (url && page < end) {
    page += 1;
    const payload = await fetchApi(url);
    const rows = Array.isArray(payload?.data) ? payload.data : [];

    if (page < start) {
      // 跳过页：仍要发请求推进游标，但不解析 included、不下载任何东西。
      await log(`  ┄ 第 ${page} 页：${rows.length} 个帖子（未达起始页，跳过）`);
    } else {
      const included = indexIncluded(payload?.included);
      await log(`  ┌ 第 ${page} 页：${rows.length} 个帖子`);
      progress.beginPage(rows.length);

      for (const row of rows) {
        const post = processPost(row, included);
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
    }

    url = coerceStr(payload?.links?.next);
    if (!url) {
      await log(
        page < start
          ? `  · 已到最后一页（第 ${page} 页），起始页 ${start} 超出实际页数`
          : "  · 已到最后一页",
      );
      break;
    }
  }

  await log(
    `◀ 结束：处理了第 ${Math.min(start, page)}~${page} 页，成功 ${totalOk}，失败 ${totalFailed}`,
  );
  if (totalOk === 0 && totalFailed === 0) {
    if (page < start) {
      // 这一支单独拎出来：整个创作者只有 page 页，起始页填过头了，
      // 和「有帖子但没附件」是完全不同的问题，不该混在同一条提示里。
      await warn(
        `没有下载到任何文件：该创作者一共只有 ${page} 页，` +
          `而起始页填的是 ${start}。请把起始页调小。`,
      );
    } else {
      await warn(
        "没有下载到任何文件。可能原因：该创作者的帖子没有压缩包附件、当前账号未订阅、" +
          "或提取规则把包内文件全滤掉了。",
      );
    }
  }
}

async function handleInitial() {
  const vars = Kabegame.vars || {};
  const raw = coerceStr(vars.creator);

  // id:<campaign_id> 直通，跳过主页解析——主页结构最容易随改版失效，留个后门。
  if (raw.startsWith("id:")) {
    const campaignId = raw.slice(3).trim();
    if (!campaignId) throw new Error("id: 后面要跟 campaign id");
    await log(`▶ 直接使用 campaign ${campaignId}`);
    await crawlFromCreatorPage(campaignId);
    return;
  }

  // 导航到创作者主页：真浏览器才能过 Cloudflare 挑战。
  const target = creatorPageUrl(raw);
  await log(`▶ 打开创作者主页 ${target}`);
  await Kabegame.to(target, { pageLabel: "creator" });
}

async function handleCreatorPage() {
  await Kabegame.waitForDom();

  // CF 挑战页会先出现、几秒后自动跳转到真正的内容页。
  // 等 __NEXT_DATA__ 出现即认为已过挑战；一直等不到就提示用户手动过。
  let campaignId = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    campaignId = extractCampaignIdFromPage();
    if (campaignId) break;
    if (/just a moment|checking your browser/i.test(document.title || "")) {
      if (attempt === 0) {
        await log("  · 正在过 Cloudflare 挑战…");
        await Kabegame.requestShowWebview();
      }
    }
    await Kabegame.sleep(1000);
  }

  if (!campaignId) {
    throw new Error(
      "未能解析出 campaign id。若页面停在 Cloudflare challenge，请在弹出的窗口里手动完成验证；" +
        "若 Patreon 前端已改版，可在浏览器里找到 campaign id 后把「创作者」填成 id:<campaign_id>。",
    );
  }

  await log(`▶ campaign ${campaignId}`);
  await crawlFromCreatorPage(campaignId);
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
