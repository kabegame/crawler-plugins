// @ts-nocheck
const {
  addProgress,
  createImageMetadata,
  downloadImage,
  requireCookie,
  setHeader,
  warn,
} = Kabegame;

// 请求实际使用的当前域名。上游 Go 源码写死的是 kemono.su，但该站已迁移到 kemono.cr。
const HOST = "kemono.cr";
const BASE_URL = `https://${HOST}`;

// 链接模式的历史域名兼容：用户书签里多是旧域名，识别后仍按 HOST 发请求。
const HOST_ALIASES = ["kemono.cr", "kemono.su", "kemono.party"];

// 缩略图主机。2026-07 实测：原图节点 n1..n5 / c1..c3 全部连接失败（TCP 层不通），
// 而 img.kemono.cr 可达，/thumbnail/data<path> 直接 200，无需重定向。
// 缩略图长边上限 800px、约 30-40 KB；非图片附件（mp4/bin/zip）没有缩略图，一律 404。
const THUMB_BASE_URL = "https://img.kemono.cr";

// 帖子列表每页条数。?o= 必须是它的整数倍，实测 o=25 返回空数组。
const PAGE_SIZE = 50;

// 依据 ignore/kemono-scraper/kemono/type.go:169-180 的 SiteMap，只取归属 kemono 的 service。
// 上游还支持 coomer 站（onlyfans / fansly），但那是成人订阅内容、不是二次元图片，本插件不移植。
const SUPPORTED_SERVICES = new Set([
  "patreon",
  "fanbox",
  "gumroad",
  "subscribestar",
  "dlsite",
  "discord",
  "fantia",
  "boosty",
  "afdian",
]);

// 依据 ignore/kemono-scraper/kemono/utils.go:3-9；用于复刻附件图片与其它文件分开编号。
const IMAGE_EXTENSIONS = new Set([
  "apng", "avif", "bmp", "gif", "ico", "cur", "jpg", "jpeg", "jfif",
  "pjpeg", "pjp", "png", "svg", "tif", "tiff", "webp", "jpe",
]);

function coerceStr(value) {
  return value == null ? "" : String(value).trim();
}

// 走 console.log → op_kabegame_log，进任务日志。warn 留给真正的异常，
// 正常的流程边界（进入/离开作者、页面、帖子）用 log，免得任务日志全是黄色。
function log(message) {
  console.log(`[kemono] ${message}`);
}

function setSiteHeaders() {
  setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");
  setHeader("Referer", `${BASE_URL}/`);
  setHeader("Origin", BASE_URL);
  // 必须是 text/css，不能是 application/json。kemono 的 403 响应体原文：
  // "If you want to scrape, use \"Accept: text/css\" header in your requests for now.
  //  For whatever reason DDG does not like SPA and JSON, so we have to be funny."
  // 站点挂在 DDoS-Guard 后面，JSON Accept 会被直接 403（2026-07 实测）。
  setHeader("Accept", "text/css");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${url}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function rethrowIfLoginFailed(error, reason) {
  if (error?.status === 401 || error?.status === 403) {
    throw new Error(`${reason}失败：${HOST} 登录态失效（${error.status}），请在畅游重新登录后重试`);
  }
  throw error;
}

function ensureFavoriteCookie() {
  if (!requireCookie(HOST)) {
    throw new Error(`收藏模式需要登录：未从畅游获取到 ${HOST} 的 Cookie，请先在畅游登录该站点后重试`);
  }
}

// 上游 Go 用 /api/v1/creators 拉全站作者列表再按 id 查找（fetch.go:16-38），
// 但那是 3.4 MB 的全量响应，只为拿一个显示名。现站点有单作者 profile 接口，改用它。
// 2026-07 实测：/api/v1/<service>/user/<id>/profile → 200，约 200 字节。
async function fetchCreatorProfile(service, creatorId, loginRequired) {
  setSiteHeaders();
  try {
    const body = await fetchJson(`${BASE_URL}/api/v1/${encodeURIComponent(service)}/user/${encodeURIComponent(creatorId)}/profile`);
    return body && typeof body === "object" ? body : null;
  } catch (error) {
    if (error?.status === 404) return null;
    if (loginRequired) rethrowIfLoginFailed(error, "获取作者信息");
    throw error;
  }
}

// 单帖接口，上游 Go 时代还没有，故它只能拉全量列表再过滤（kemono.go:252-259）。
// 2026-07 实测：/api/v1/<service>/user/<id>/post/<pid> → 200，返回 { post, attachments, ... }，
// 其中 post 与列表项同构（同样带 file / attachments）。
async function fetchSinglePost(service, creatorId, postId, loginRequired) {
  setSiteHeaders();
  try {
    const body = await fetchJson(`${BASE_URL}/api/v1/${encodeURIComponent(service)}/user/${encodeURIComponent(creatorId)}/post/${encodeURIComponent(postId)}`);
    return body?.post && typeof body.post === "object" ? body.post : null;
  } catch (error) {
    if (error?.status === 404) return null;
    if (loginRequired) rethrowIfLoginFailed(error, "获取帖子");
    throw error;
  }
}

// ?o= 仍是 50 的倍数偏移、空页到底（沿用 fetch.go:41-104 的语义，2026-07 实测 o=25 返回空）。
// 但路径变了：上游的 /api/v1/<service>/user/<id> 现在 404，必须带 /posts 后缀。
// 取单页帖子列表。page 从 1 开始，对应 ?o=(page-1)*50。
// 返回 null 表示偏移越过了该作者的帖子总数（接口返回 400 而非空数组，2026-07 实测）。
async function fetchPostPage(service, creatorId, page, loginRequired) {
  setSiteHeaders();
  const offset = (page - 1) * PAGE_SIZE;
  const url = `${BASE_URL}/api/v1/${encodeURIComponent(service)}/user/${encodeURIComponent(creatorId)}/posts?o=${offset}`;
  try {
    const body = await fetchJson(url);
    if (!Array.isArray(body)) throw new Error(`${service}:${creatorId} 的帖子列表格式无效`);
    return body;
  } catch (error) {
    if (error?.status === 400) return null;
    if (loginRequired) rethrowIfLoginFailed(error, "获取帖子列表");
    throw error;
  }
}

// 依据 ignore/kemono-scraper/main/main.go:674-746 的两个收藏接口。
async function fetchFavorites(type) {
  setSiteHeaders();
  try {
    const body = await fetchJson(`${BASE_URL}/api/v1/account/favorites?type=${type}`);
    if (!Array.isArray(body)) throw new Error(`${HOST} 收藏列表格式无效`);
    return body;
  } catch (error) {
    rethrowIfLoginFailed(error, "获取收藏列表");
  }
}

function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`链接路径包含无效编码：${value}`);
  }
}

// 依据 ignore/kemono-scraper/main/main.go:496-527：4 段为作者，6 段为单帖。
function parseLink(rawLink) {
  let url;
  try {
    url = new URL(rawLink);
  } catch {
    throw new Error("链接模式请填写有效的 kemono.cr URL");
  }

  const hostname = url.hostname.toLowerCase();
  const known = HOST_ALIASES.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!known) throw new Error(`不支持的链接站点：${hostname}（本插件只支持 ${HOST}）`);

  const parts = url.pathname.split("/");
  if ((parts.length !== 4 && parts.length !== 6) || parts[0] !== "" || parts[2] !== "user") {
    throw new Error("链接路径应为 /<service>/user/<uid> 或 /<service>/user/<uid>/post/<pid>");
  }
  if (parts.length === 6 && parts[4] !== "post") {
    throw new Error("单帖链接路径应为 /<service>/user/<uid>/post/<pid>");
  }

  const service = decodePathComponent(parts[1]);
  const creatorId = decodePathComponent(parts[3]);
  const postId = parts.length === 6 ? decodePathComponent(parts[5]) : "";
  if (!service || !creatorId || (parts.length === 6 && !postId)) {
    throw new Error("链接中的 service、作者 ID 或帖子 ID 不能为空");
  }
  if (!SUPPORTED_SERVICES.has(service)) throw new Error(`不支持的 service：${service}`);
  return { service, creatorId, postIds: postId ? new Set([postId]) : null };
}

function targetKey(target) {
  return `${target.service}:${target.creatorId}`;
}

function addTarget(targets, targetByKey, target) {
  const key = targetKey(target);
  const existing = targetByKey.get(key);
  if (!existing) {
    targetByKey.set(key, target);
    targets.push(target);
    return;
  }
  if (target.postIds) {
    if (!existing.postIds) existing.postIds = new Set();
    for (const postId of target.postIds) existing.postIds.add(postId);
  }
}

async function resolveTargets(vars) {
  const targets = [];
  const targetByKey = new Map();
  const source = coerceStr(vars.source) || "link";
  if (source === "link") {
    const link = coerceStr(vars.link);
    if (!link) throw new Error("链接模式请填写作者或帖子链接");
    addTarget(targets, targetByKey, parseLink(link));
    return { targets, loginRequired: false };
  }

  if (source === "creator") {
    const service = coerceStr(vars.service);
    const creatorId = coerceStr(vars.creator_id);
    if (!SUPPORTED_SERVICES.has(service)) throw new Error(`不支持的 service：${service}`);
    if (!creatorId) throw new Error("作者模式请填写作者 ID");
    addTarget(targets, targetByKey, { service, creatorId, postIds: null });
    return { targets, loginRequired: false };
  }

  if (source !== "fav_creator" && source !== "fav_post") {
    throw new Error(`未知的爬取模式：${source}`);
  }

  ensureFavoriteCookie();
  if (source === "fav_creator") {
    const range = pageRange(vars, "fav_creator_page_start", "fav_creator_page_end", "收藏作者页数范围");
    const creators = slicePages(await fetchFavorites("user"), range);
    for (const creator of creators) {
      const service = coerceStr(creator?.service);
      const creatorId = coerceStr(creator?.id);
      // 收藏里可能混有非 kemono 站（coomer）的条目，直接跳过。
      if (!service || !creatorId || !SUPPORTED_SERVICES.has(service)) continue;
      addTarget(targets, targetByKey, { service, creatorId, postIds: null });
    }
  } else {
    // Go 实现把收藏接口结果只作为 service/user/post id，再回作者列表按 id 过滤（main.go:140-145）。
    // 与标签模式共用同一组「页数范围」变量：两者都是在一条扁平的帖子列表上翻页。
    const range = pageRange(vars, "list_page_start", "list_page_end", "页数范围");
    const posts = slicePages(await fetchFavorites("post"), range);
    for (const post of posts) {
      const service = coerceStr(post?.service);
      const creatorId = coerceStr(post?.user);
      const postId = coerceStr(post?.id);
      if (!service || !creatorId || !postId || !SUPPORTED_SERVICES.has(service)) continue;
      addTarget(targets, targetByKey, { service, creatorId, postIds: new Set([postId]) });
    }
  }
  return { targets, loginRequired: true };
}

// 标签帖子列表。与作者帖子列表不同，这里返回 { count, true_count, posts }，
// 且每个 post 自带 file / attachments，无需再逐帖请求单帖接口（2026-07 实测）。
// 该接口不需要登录。
async function fetchTagPage(tag, page) {
  setSiteHeaders();
  const offset = (page - 1) * PAGE_SIZE;
  const url = `${BASE_URL}/api/v1/posts?tag=${encodeURIComponent(tag)}&o=${offset}`;
  const body = await fetchJson(url);
  const posts = Array.isArray(body?.posts) ? body.posts : null;
  if (!posts) throw new Error(`标签 ${tag} 的帖子列表格式无效`);
  return { posts, count: positiveInteger(body?.count, 0) };
}

// 标签模式：帖子横跨多个作者，按需拉取并缓存作者 profile
// （实测一页 50 帖只有约 10 个唯一作者，缓存命中率高）。
async function crawlTag(vars) {
  const tag = coerceStr(vars.tag);
  if (!tag) throw new Error("标签模式请填写标签");
  const { start, end } = pageRange(vars, "list_page_start", "list_page_end", "页数范围");

  const first = await fetchTagPage(tag, start);
  if (first.posts.length === 0) {
    warn(`标签「${tag}」在第 ${start} 页没有帖子（该标签可能不存在，或起始页超出范围）`);
    return;
  }

  // 页数只由页范围决定，不再依赖接口的 count 去反推总帖数——
  // count 会被站点截断（实测 nsfw 返回 50000，真实 true_count 是 373041），
  // 拿它算出来的估值一旦退化成 1，单次进度就会把进度条顶满。
  const lastPage = end === Number.MAX_SAFE_INTEGER
    ? Math.max(start, Math.ceil(Math.max(first.count, first.posts.length) / PAGE_SIZE))
    : end;
  const progress = makeProgress(1);
  progress.beginTarget(Math.max(1, lastPage - start + 1));
  log(`▶ 标签「${tag}」开始：本次爬取第 ${start}~${lastPage} 页`);

  const profiles = new Map();
  const profileFor = async (service, creatorId) => {
    const key = `${service}:${creatorId}`;
    if (!profiles.has(key)) profiles.set(key, await fetchCreatorProfile(service, creatorId, false));
    return profiles.get(key);
  };

  let page = start;
  let batch = first.posts;
  let totalPosts = 0;
  let totalImages = 0;
  let totalOk = 0;
  for (;;) {
    const usable = batch.filter((post) =>
      SUPPORTED_SERVICES.has(coerceStr(post?.service)) && coerceStr(post?.user));
    const images = countImages(usable, vars);
    progress.beginBatch(images);
    log(`  ┌ 第 ${page} 页开始：${usable.length} 个帖子，${images} 张图`);

    let pageOk = 0;
    for (const post of usable) {
      const creator = await profileFor(coerceStr(post.service), coerceStr(post.user));
      const r = await downloadPost({ creator, post }, vars, () => progress.tick());
      pageOk += r.ok;
    }
    totalPosts += usable.length;
    totalImages += images;
    totalOk += pageOk;
    log(`  └ 第 ${page} 页结束：下载 ${pageOk}/${images} 张`);

    if (batch.length < PAGE_SIZE) break;
    page += 1;
    if (page > end) break;
    batch = (await fetchTagPage(tag, page)).posts;
    if (batch.length === 0) break;
  }
  log(`◀ 标签「${tag}」结束：${totalPosts} 帖，下载 ${totalOk}/${totalImages} 张`);
}

// 收藏接口一次返回完整列表（上游 Go 也是一次性拉取，没有 ?o= 分页），
// 所以“页”是在客户端按 PAGE_SIZE 切出来的，语义与帖子列表的页保持一致。
function slicePages(list, range) {
  if (!Array.isArray(list)) return [];
  const from = (range.start - 1) * PAGE_SIZE;
  if (from >= list.length) {
    const total = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    warn(`起始页 ${range.start} 超出收藏列表页数（共 ${total} 页 / ${list.length} 项）`);
    return [];
  }
  const to = range.end === Number.MAX_SAFE_INTEGER ? list.length : Math.min(list.length, range.end * PAGE_SIZE);
  return list.slice(from, to);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

// 起止页，1 基，每页 PAGE_SIZE 条。结束页填 0 表示一直翻到最后一页。
function pageRange(vars, startKey, endKey, label) {
  const start = Math.max(1, positiveInteger(vars[startKey], 1));
  const rawEnd = positiveInteger(vars[endKey], 0);
  const end = rawEnd <= 0 ? Number.MAX_SAFE_INTEGER : rawEnd;
  if (end < start) throw new Error(`${label}：结束页（${rawEnd}）不能小于起始页（${start}）`);
  return { start, end };
}

// 作者帖子列表的页范围。单作者、链接、收藏的作者三种模式共用这一组。
function creatorPageRange(vars) {
  return pageRange(vars, "creator_page_start", "creator_page_end", "作者页数范围");
}

function creatorLabel(creator, target) {
  const name = coerceStr(creator?.name);
  return name
    ? `${name}（${target.service}:${target.creatorId}）`
    : `${target.service}:${target.creatorId}`;
}

// 流式：每翻一页就把该页的帖子下完，不再攒完整列表。
// 进度：整个任务的 99% 先按「批次」平分（一页 = 一批），再按该批实际图片数平分。
async function crawlTarget(target, vars, loginRequired, progress) {
  const creator = await fetchCreatorProfile(target.service, target.creatorId, loginRequired);
  if (!creator) {
    warn(`创作者不存在，已跳过：${target.service}:${target.creatorId}（${HOST}）`);
    return;
  }
  const who = creatorLabel(creator, target);

  // 显式点名的帖子（单帖链接、收藏的作品）：直接走单帖接口，作者页范围不适用。
  if (target.postIds) {
    log(`▶ 进入作者 ${who}：指定 ${target.postIds.size} 个帖子`);
    progress.beginTarget(1);
    const posts = [];
    for (const postId of target.postIds) {
      const post = await fetchSinglePost(target.service, target.creatorId, postId, loginRequired);
      if (post) posts.push(post);
      else warn(`帖子不存在，已跳过：${target.service}:${target.creatorId}:${postId}`);
    }
    const images = countImages(posts, vars);
    progress.beginBatch(images);
    log(`  取到 ${posts.length} 个帖子，共 ${images} 张图`);
    let done = 0;
    for (const post of posts) {
      const r = await downloadPost({ creator, post }, vars, () => progress.tick());
      done += r.ok;
    }
    log(`◀ 作者结束 ${who}：${posts.length} 帖，下载 ${done} 张`);
    return;
  }

  const { start, end } = creatorPageRange(vars);
  const postCount = positiveInteger(creator?.post_count, 0);
  const lastPage = postCount > 0 ? Math.ceil(postCount / PAGE_SIZE) : 0;
  if (lastPage > 0 && start > lastPage) {
    warn(`起始页 ${start} 超出该作者的页数（共 ${lastPage} 页 / ${postCount} 帖），已跳过`);
    return;
  }
  const lastWanted = end === Number.MAX_SAFE_INTEGER
    ? (lastPage > 0 ? lastPage : start)
    : (lastPage > 0 ? Math.min(end, lastPage) : end);
  log(`▶ 进入作者 ${who}：共 ${postCount} 帖 / ${lastPage || "?"} 页，本次爬取第 ${start}~${lastWanted} 页`);
  progress.beginTarget(Math.max(1, lastWanted - start + 1));

  let totalPosts = 0;
  let totalImages = 0;
  let totalOk = 0;
  for (let page = start; page <= end; page += 1) {
    const posts = await fetchPostPage(target.service, target.creatorId, page, loginRequired);
    if (posts === null) break;
    if (posts.length === 0) break;
    const images = countImages(posts, vars);
    progress.beginBatch(images);
    log(`  ┌ 第 ${page} 页开始：${posts.length} 个帖子，${images} 张图`);
    let pageOk = 0;
    for (const post of posts) {
      const r = await downloadPost({ creator, post }, vars, () => progress.tick());
      pageOk += r.ok;
    }
    totalPosts += posts.length;
    totalImages += images;
    totalOk += pageOk;
    log(`  └ 第 ${page} 页结束：下载 ${pageOk}/${images} 张`);
    if (posts.length < PAGE_SIZE) break;
  }
  log(`◀ 作者结束 ${who}：${totalPosts} 帖，下载 ${totalOk}/${totalImages} 张`);
}

// 进度分两级：先把 99% 按「批次」（一页帖子 / 一组单帖）平分，
// 再把每批的额度按该批**实际图片张数**平分，所以进度条是按图片推进的。
//
// 关键约束：单次 delta 绝不能超过所属批次的额度。之前的实现用接口返回的 count
// 估算总数，count 异常（缺失或偏小）时 estimated 会退化成 1，一次就加满 99.9。
// 现在批数只来自页范围这类确定值，且额度在 beginBatch 时才细分，不会再放大。
function makeProgress(targetCount) {
  const perTarget = targetCount > 0 ? 99.0 / targetCount : 0;
  let perBatch = 0;
  let step = 0;
  return {
    // 一个 target = 一位作者（或标签模式的整个列表），batchCount 是它要翻的页数。
    beginTarget(batchCount) { perBatch = batchCount > 0 ? perTarget / batchCount : 0; },
    // 一批 = 一页帖子，imageCount 是这页实际要下的图片张数。
    beginBatch(imageCount) { step = imageCount > 0 ? perBatch / imageCount : 0; },
    tick() { if (step > 0) addProgress(step); },
  };
}

// 一批帖子里实际会下载的图片总数，用于把该批额度按图片平分。
function countImages(posts, vars) {
  let total = 0;
  for (const post of posts) total += collectAttachments(post, vars).length;
  return total;
}

function fileExtension(file) {
  const raw = coerceStr(file?.name) || coerceStr(file?.path).split(/[?#]/, 1)[0].split("/").pop() || "";
  const dot = raw.lastIndexOf(".");
  return dot >= 0 && dot < raw.length - 1 ? raw.slice(dot + 1).toLowerCase() : "";
}

function fileName(file) {
  return coerceStr(file?.name) || coerceStr(file?.path).split(/[?#]/, 1)[0].split("/").pop() || "attachment";
}

function isImageFile(file) {
  return IMAGE_EXTENSIONS.has(fileExtension(file));
}

function collectAttachments(post, vars) {
  const attachments = Array.isArray(post?.attachments) ? [...post.attachments] : [];
  const primary = post?.file;
  // 依据 kemono/kemono.go:261-270：开启 banner 或主文件不是图片时把 post.file 前置。
  if (primary?.path && (vars.banner === true || !isImageFile(primary))) {
    attachments.unshift(primary);
  }
  const usable = attachments.filter((file) => coerceStr(file?.path));
  // 缩略图模式下非图片附件没有缩略图（实测 mp4/bin 一律 404），直接排除，避免整帖刷失败。
  return useThumbnail(vars) ? usable.filter((file) => isImageFile(file)) : usable;
}

function goQueryEscape(value) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

function useThumbnail(vars) {
  return coerceStr(vars.image_source || "thumbnail") !== "original";
}

function attachmentUrl(file, vars) {
  const path = coerceStr(file?.path);
  if (!path) throw new Error("附件缺少 path");
  // 缩略图走 img 主机的独立路径，不带 ?f=（实测不需要），也不经 kemono.cr 302 中转。
  if (useThumbnail(vars)) return `${THUMB_BASE_URL}/thumbnail/data${path}`;
  const originalName = fileName(file);
  const dot = originalName.lastIndexOf(".");
  const name = dot > 0 ? originalName.slice(0, dot) : originalName;
  const extension = dot > 0 ? originalName.slice(dot) : "";
  // 查询串沿用 kemono/type.go:68-78 的 File.GetURL()：path?f=<QueryEscape(去扩展名名)><扩展名>。
  // 但 host 部分变了：上游直接前置站点根 URL（downloader.go:289-311），现在必须加 /data 前缀，
  // 由 kemono.cr 302 重定向到实际 CDN 节点（2026-07 实测 → https://n4.kemono.cr/data/...）。
  // 不加 /data 会连接挂起。宿主 fetch/下载器会跟随重定向。
  return `${BASE_URL}/data${path}?f=${goQueryEscape(name)}${extension}`;
}

function trimCreator(creator) {
  return {
    id: creator?.id,
    name: creator?.name,
    service: creator?.service,
    indexed: creator?.indexed,
    updated: creator?.updated,
    // profile 接口的字段（/api/v1/<service>/user/<id>/profile）。
    public_id: creator?.public_id,
    post_count: creator?.post_count,
  };
}

function trimPost(post) {
  return {
    id: post?.id,
    title: post?.title,
    service: post?.service,
    user: post?.user,
    added: post?.added,
    published: post?.published,
    edited: post?.edited,
    tags: post?.tags,
    shared_file: post?.shared_file,
  };
}

function postPageUrl(post) {
  return `${BASE_URL}/${encodeURIComponent(coerceStr(post?.service))}/user/${encodeURIComponent(coerceStr(post?.user))}/post/${encodeURIComponent(coerceStr(post?.id))}`;
}

function rawAttachmentCount(post) {
  return (Array.isArray(post?.attachments) ? post.attachments.length : 0)
    + (post?.file?.path ? 1 : 0);
}

function postLabel(post) {
  const title = coerceStr(post?.title) || coerceStr(post?.id);
  return `「${title}」(${coerceStr(post?.service)}:${coerceStr(post?.user)}:${coerceStr(post?.id)})`;
}

// onImage 在每张图片下载结束后调用（无论成败），用于按图片推进进度条。
async function downloadPost(item, vars, onImage) {
  const { creator, post } = item;
  const files = collectAttachments(post, vars);
  if (files.length === 0) {
    // 纯文字帖（公告、更新说明）本来就没有附件，属于正常情况，不值得报警。
    // 只有原本有附件、却被缩略图模式滤掉时才提示。
    if (rawAttachmentCount(post) > 0) {
      warn(`帖子的附件都被过滤掉了：${post?.service}:${post?.user}:${post?.id}`);
    }
    return { images: 0, ok: 0, failed: 0 };
  }

  log(`  → 帖子开始 ${postLabel(post)}：${files.length} 张图`);

  // 必须在确认有附件之后再建 metadata，否则纯文字帖会留下没有图片引用的孤儿记录。
  const metadataId = Number(createImageMetadata({
    post: trimPost(post),
    creator: trimCreator(creator),
  }, null));

  // 依据 kemono/fetch.go:152-169：图片和其它附件分别维护索引。
  let imageIndex = 0;
  let otherIndex = 0;
  const indexedFiles = files.map((file) => {
    const image = isImageFile(file);
    const index = image ? imageIndex++ : otherIndex++;
    return { file, index };
  });
  const pageUrl = postPageUrl(post);
  const baseName = coerceStr(post?.title) || coerceStr(post?.id) || "kemono-post";
  let ok = 0;
  let failed = 0;
  for (const entry of indexedFiles) {
    const displayName = files.length > 1 ? `${baseName}(${entry.index + 1})` : baseName;
    let url = "";
    try {
      url = attachmentUrl(entry.file, vars);
      await downloadImage(url, {
        name: displayName,
        metadata_id: metadataId,
        url: pageUrl,
      });
      ok += 1;
    } catch (error) {
      failed += 1;
      warn(`附件下载失败：${url || coerceStr(entry.file?.path)}（${error?.message || error}）`);
    }
    if (onImage) onImage();
  }
  log(`  ← 帖子结束 ${postLabel(post)}：成功 ${ok}，失败 ${failed}`);
  return { images: files.length, ok, failed };
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  // 标签模式的列表是全站扁平的，不落到「作者 + 帖子」这套 target 结构上，单独走一条路径。
  if (coerceStr(vars.source) === "tag") {
    await crawlTag(vars);
    return;
  }
  const { targets, loginRequired } = await resolveTargets(vars);
  if (targets.length === 0) {
    warn("没有找到可爬取的收藏目标");
    return;
  }
  const progress = makeProgress(targets.length);
  for (const target of targets) {
    await crawlTarget(target, vars, loginRequired, progress);
  }
}
