// 小红书 WebView 爬虫。
//
// 架构：列表类模式先用真实 WebView 页面加载列表（真实浏览器才能拿到登录态 +
// 滚动加载翻页），取到作品队列后，在**同一次脚本执行**里用原生 fetch 逐个抓取
// 详情页 HTML、解析、下载——全程不再导航详情页，因此列表页只加载一次，不会
// 反复重载 / 反复重新搜索。链接模式无需列表页，直接在 initial 执行流里 fetch。
//
// 关键：详情页与列表页同源（www.xiaohongshu.com），原生 fetch 不受 CORS 限制、
// 自动携带登录 Cookie，能拿到完整 SSR 的 __INITIAL_STATE__。

const BASE_URL = "https://www.xiaohongshu.com";
const AUTHOR_MODES = ["author_post", "author_collect", "author_like"];

function unwrap(value) {
  return value && value._rawValue !== undefined ? value._rawValue : value;
}

function errorMessage(error) {
  return error?.message ?? String(error);
}

// 统一带 [xhs] 前缀的日志，方便在任务日志里筛选、定位卡点。
function log(message) {
  return Kabegame.log(`[xhs] ${message}`);
}

function warn(message) {
  return Kabegame.warn(`[xhs] ${message}`);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeName(value) {
  const cleaned = String(value ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "小红书作品";
}

// 从当前页面 DOM 里读 __INITIAL_STATE__（用于列表页）。
function parseEmbeddedInitialState() {
  const script = Array.from(document.scripts).find((item) =>
    item.textContent?.includes("window.__INITIAL_STATE__")
  );
  const match = script?.textContent?.match(
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)(?:;\s*)?$/,
  );
  if (!match) return null;
  return safeParseState(match[1]);
}

// 把 __INITIAL_STATE__ 的 JS 字面量安全转成对象：剥尾分号、undefined→null。
function safeParseState(raw) {
  try {
    return JSON.parse(
      String(raw).trim().replace(/;$/, "").replace(/\bundefined\b/g, "null"),
    );
  } catch {
    return null;
  }
}

function initialState() {
  return window.__INITIAL_STATE__ ?? parseEmbeddedInitialState();
}

function extractId(input, routeName) {
  const value = String(input ?? "").trim();
  if (!value) return "";

  try {
    const url = new URL(
      value.includes("://")
        ? value
        : `${BASE_URL}/${value.replace(/^\/+/, "")}`,
    );
    const pattern = routeName === "author"
      ? /\/user\/profile\/([^/?#]+)/i
      : /\/board\/([^/?#]+)/i;
    const matchedId = url.pathname.match(pattern)?.[1];
    if (matchedId) return decodeURIComponent(matchedId);
    return !value.includes("/") ? value : "";
  } catch {
    return value.replace(/^\/+|\/+$/g, "");
  }
}

function noteIdFromUrl(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "explore") return parts[1] ?? "";
  if (parts[0] === "discovery" && parts[1] === "item") return parts[2] ?? "";
  if (parts[0] === "user" && parts[1] === "profile") return parts[3] ?? "";
  return "";
}

function normalizeNoteUrls(value) {
  const urls = [];
  const seen = new Set();
  const tokens = String(value ?? "").split(/\s+/).filter(Boolean);

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^[（(【\[]+|[）)】\]，。；、]+$/g, "");
    let url;
    try {
      if (/^https?:\/\//i.test(token)) {
        url = new URL(token);
      } else if (
        /^(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\//i.test(token)
      ) {
        url = new URL(`https://${token}`);
      } else if (/^[a-z0-9]{12,}$/i.test(token)) {
        url = new URL(`${BASE_URL}/explore/${token}`);
      } else {
        continue;
      }
    } catch {
      continue;
    }

    const hostname = url.hostname.toLowerCase();
    if (
      !hostname.endsWith("xiaohongshu.com") && !hostname.endsWith("xhslink.com")
    ) {
      continue;
    }
    const normalized = url.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push({
        url: normalized,
        id: noteIdFromUrl(url),
        xsecToken: url.searchParams.get("xsec_token") ?? "",
      });
    }
  }
  return urls;
}

function detailUrl(entry) {
  if (entry.url) return entry.url;
  return `${BASE_URL}/explore/${encodeURIComponent(entry.id)}?xsec_token=${
    encodeURIComponent(entry.xsecToken ?? "")
  }&xsec_source=pc_feed`;
}

// ── 列表读取（在真实列表页当前上下文里，读 __INITIAL_STATE__）─────────────

function listRoot(mode, state, boardId) {
  if (!state) return undefined;
  if (mode === "recommend") return state.feed?.feeds;
  if (mode === "search") return state.search?.feeds;
  if (AUTHOR_MODES.includes(mode)) return state.user?.notes;
  if (mode === "board") {
    const boardMap = unwrap(state.board?.boardFeedsMap);
    return boardMap?.[boardId]?.notes;
  }
  return undefined;
}

function listItems(mode, boardId) {
  const state = initialState();
  if (!state) return [];

  let items;
  if (mode === "recommend") {
    items = unwrap(state.feed?.feeds);
  } else if (mode === "search") {
    items = unwrap(state.search?.feeds);
  } else if (AUTHOR_MODES.includes(mode)) {
    const tabIndex =
      { author_post: 0, author_collect: 1, author_like: 2 }[mode];
    items = unwrap(unwrap(state.user?.notes)?.[tabIndex]);
  } else if (mode === "board") {
    const boardMap = unwrap(state.board?.boardFeedsMap);
    items = unwrap(boardMap?.[boardId]?.notes);
  }

  if (!Array.isArray(items)) return [];
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const card = item?.noteCard;
    if (mode !== "board" && !card) continue;
    const id = String(item?.id ?? item?.noteId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, xsecToken: String(item?.xsecToken ?? "") });
  }
  return result;
}

async function waitForListState(mode, boardId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = initialState();
    if (listRoot(mode, state, boardId) !== undefined) return true;
    await Kabegame.sleep(250);
  }
  // 超时诊断：区分“页面根本没注入数据”和“数据路径不对”。
  const state = initialState();
  await warn(
    `等待 20s 仍未读到列表数据 · mode=${mode} · __INITIAL_STATE__=${
      state ? "存在" : "缺失"
    } · feed=${state?.feed ? "有" : "无"} · user=${
      state?.user ? "有" : "无"
    } · search=${state?.search ? "有" : "无"}`,
  );
  return false;
}

async function scrollList(mode, boardId, maxItems, scrollRounds) {
  for (let round = 0; round < scrollRounds; round += 1) {
    const count = listItems(mode, boardId).length;
    if (count >= maxItems) {
      await log(`滚动结束 · 已达上限 ${count}/${maxItems} 条`);
      break;
    }
    await log(`滚动第 ${round + 1}/${scrollRounds} 轮 · 当前抓到 ${count} 条`);
    window.scrollTo(0, document.body.scrollHeight);
    await Kabegame.sleep(randomInt(250, 500));
    if (Math.random() < 0.2) {
      await Kabegame.sleep(randomInt(700, 1600));
    }
  }
  await Kabegame.sleep(500);
}

async function waitForRestrictedAuthorItems(mode, boardId) {
  await warn(
    "收藏或点赞列表为空，请在爬虫窗口中登录，并打开对应的收藏或点赞标签页。",
  );
  await Kabegame.requestShowWebview();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const items = listItems(mode, boardId);
    if (items.length > 0) {
      await log(`检测到 ${items.length} 条，继续抓取`);
      return items;
    }
    if (attempt > 0 && attempt % 15 === 0) {
      await log(`仍在等待登录/切换标签页…（${attempt}s）`);
    }
    await Kabegame.sleep(1000);
  }
  await warn("等待 90s 后列表仍为空，放弃该模式");
  return [];
}

// 请求间隔：对数正态抖动，模拟人类节奏，避免固定间隔被风控识别。
async function politeDelay() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const delay = Math.exp(Math.log(2500) + 0.5 * normal);
  await Kabegame.sleep(Math.min(8000, Math.max(500, Math.round(delay))));
}

// ── 详情抓取（原生 fetch，不导航）──────────────────────────────────────

// 从 fetch 回来的整页 HTML 里抠出 note 对象。
function parseNoteFromHtml(html, wantId) {
  const match = String(html).match(
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  const state = safeParseState(match[1]);
  const map = unwrap(state?.note?.noteDetailMap);
  if (!map || typeof map !== "object") return null;

  // 优先按目标 noteId 精确取；否则回退到最后一个非空 key。
  if (wantId && map[wantId]) {
    const note = unwrap(unwrap(map[wantId])?.note);
    if (note) return note;
  }
  const keys = Object.keys(map).filter(Boolean);
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const note = unwrap(unwrap(map[keys[index]])?.note);
    if (note) return note;
  }
  return null;
}

// fetch 一个详情页并解析 note。同源请求自动带 Cookie，不受 CORS 限制。
async function fetchNote(entry) {
  const res = await fetch(detailUrl(entry), {
    credentials: "include",
    headers: { "Accept-Language": "zh-CN,zh;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseNoteFromHtml(html, entry.id || "");
}

// ── 下载 ───────────────────────────────────────────────────────────────

function noteMetadata(note) {
  return {
    noteId: String(note?.noteId ?? ""),
    title: String(note?.title ?? ""),
    desc: String(note?.desc ?? ""),
    type: String(note?.type ?? ""),
    time: note?.time ?? null,
    user: {
      userId: String(note?.user?.userId ?? ""),
      nickname: String(note?.user?.nickname ?? ""),
    },
    tagList: Array.isArray(note?.tagList)
      ? note.tagList.map((tag) => ({ name: String(tag?.name ?? "") }))
      : [],
    interactInfo: note?.interactInfo ?? {},
  };
}

function imageToken(url) {
  return String(url ?? "").split("/").slice(5).join("/").split("!")[0];
}

function imageDownloadUrl(url, format) {
  const token = imageToken(url);
  if (!token) return "";
  if (format === "auto") return `https://sns-img-bd.xhscdn.com/${token}`;
  return `https://ci.xiaohongshu.com/${token}?imageView2/format/${format}`;
}

function videoDownloadUrl(note) {
  const stream = note?.video?.media?.stream ?? {};
  for (const codec of ["h264", "h265", "av1", "h266"]) {
    const source = unwrap(stream[codec])?.[0];
    if (source) return source.backupUrls?.[0] || source.masterUrl || "";
  }
  return "";
}

async function downloadMedia(url, options) {
  if (!url) return;
  try {
    await Kabegame.downloadImage(url, options);
  } catch (error) {
    await warn(`下载失败：${options.name}：${errorMessage(error)}`);
  }
  // 每次下载之间隔 500ms，压低对 xhs CDN 的突发并发，减少瞬时拒绝（宿主侧另有重试兜底）。
  await Kabegame.sleep(3000);
}

// 下载一个作品的全部媒体。sourceUrl 作为 metadata 里的来源地址；
// fallbackId 用于 note 缺 noteId 时的文件命名兜底；
// progressBudget 是该作品在总进度里占的百分比预算，按媒体条目均分逐个推进，
// 使进度条以图片（媒体）为粒度增长，而非整个作品一次跳完。
async function downloadNote(note, sourceUrl, fallbackId, progressBudget = 0) {
  const metadata = noteMetadata(note);
  const noteId = metadata.noteId || String(fallbackId || "unknown");
  const title = sanitizeName(metadata.title);
  const format =
    ["auto", "jpg", "png", "webp"].includes(Kabegame.vars?.image_format)
      ? Kabegame.vars.image_format
      : "auto";
  const imageExtension = format === "auto" ? "jpg" : format;
  const images = Array.isArray(note?.imageList) ? note.imageList : [];
  const hasVideo = String(note?.type ?? "") === "video" &&
    Kabegame.vars?.download_video !== false &&
    Boolean(videoDownloadUrl(note));

  // 先把该作品要下载的媒体条目全部收集出来，以便按条目均分进度预算。
  const mediaTasks = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const baseName = `${title}_${noteId}_${String(index + 1).padStart(2, "0")}`;
    mediaTasks.push({
      url: imageDownloadUrl(image?.urlDefault, format),
      name: `${baseName}.${imageExtension}`,
    });
    if (Kabegame.vars?.download_live_photo === true) {
      mediaTasks.push({
        url: unwrap(image?.stream?.h264)?.[0]?.masterUrl ?? "",
        name: `${baseName}.mp4`,
      });
    }
  }
  if (Kabegame.vars?.download_video !== false) {
    mediaTasks.push({
      url: videoDownloadUrl(note),
      name: `${title}_${noteId}.mp4`,
    });
  }

  await log(
    `下载作品「${title}」(${noteId}) · ${images.length} 图${
      hasVideo ? " + 视频" : ""
    }`,
  );

  // 空作品也要把预算加满，保证总进度最终到 100%。
  if (mediaTasks.length === 0) {
    if (progressBudget > 0) await Kabegame.addProgress(progressBudget);
    return;
  }

  const perMedia = progressBudget / mediaTasks.length;
  for (const task of mediaTasks) {
    await downloadMedia(task.url, {
      name: task.name,
      url: sourceUrl,
      metadata,
    });
    if (perMedia > 0) await Kabegame.addProgress(perMedia);
  }

  Kabegame.sleep(5000);
}

// ── 队列处理：在当前页面原地 fetch 抓完整个队列，全程不导航 ────────────────

async function processQueue(queue) {
  const total = queue.length;
  const perItem = total > 0 ? 100 / total : 0;
  let done = 0;

  for (let i = 0; i < total; i += 1) {
    const entry = queue[i];
    const source = detailUrl(entry);
    await log(`处理作品 ${i + 1}/${total} · ${source}`);
    try {
      const note = await fetchNote(entry);
      if (note) {
        // 进度在 downloadNote 内按图片（媒体条目）粒度均分推进这 perItem 预算。
        await downloadNote(note, source, entry.id, perItem);
        done += 1;
      } else {
        await warn(`未解析到作品数据，跳过 · ${source}`);
        await Kabegame.addProgress(perItem);
      }
    } catch (error) {
      await warn(`抓取详情失败，跳过 · ${source} · ${errorMessage(error)}`);
      await Kabegame.addProgress(perItem);
    }
    if (i < total - 1) await politeDelay();
  }

  await log(`全部完成 · 成功 ${done}/${total}`);
}

// ── 阶段处理 ───────────────────────────────────────────────────────────

async function handleInitial() {
  const mode = String(Kabegame.vars?.crawl_mode ?? "recommend");
  const maxItems = clampInt(Kabegame.vars?.max_items, 50, 1, 500);
  const scrollRounds = clampInt(Kabegame.vars?.scroll_rounds, 5, 0, 100);
  await log(
    `初始化 · 模式=${mode} · 最多 ${maxItems} 条 · 滚动 ${scrollRounds} 轮`,
  );

  // 链接模式：无需列表页，直接在当前执行流里 fetch 抓取全部链接。
  if (mode === "note") {
    const queue = normalizeNoteUrls(Kabegame.vars?.note_urls);
    if (queue.length === 0) {
      await warn("没有识别到有效的小红书作品链接，任务结束。");
      await Kabegame.exit();
      return;
    }
    await log(`链接模式 · 识别到 ${queue.length} 条作品链接`);
    await processQueue(queue);
    await Kabegame.exit();
    return;
  }

  // 列表类模式：导航到列表页（真实浏览器才能拿登录态 + 滚动加载）。
  let targetUrl;
  let boardId = "";
  if (mode === "recommend") {
    targetUrl = `${BASE_URL}/explore`;
  } else if (AUTHOR_MODES.includes(mode)) {
    const authorId = extractId(Kabegame.vars?.author_url, "author");
    if (!authorId) {
      await warn("请填写作者主页 URL 或 userId，任务结束。");
      await Kabegame.exit();
      return;
    }
    targetUrl = `${BASE_URL}/user/profile/${encodeURIComponent(authorId)}`;
  } else if (mode === "board") {
    boardId = extractId(Kabegame.vars?.board_url, "board");
    if (!boardId) {
      await warn("请填写专辑 URL 或 id，任务结束。");
      await Kabegame.exit();
      return;
    }
    targetUrl = `${BASE_URL}/board/${encodeURIComponent(boardId)}`;
  } else if (mode === "search") {
    const keyword = String(Kabegame.vars?.search_keyword ?? "").trim();
    if (!keyword) {
      await warn("请填写搜索关键词，任务结束。");
      await Kabegame.exit();
      return;
    }
    targetUrl = `${BASE_URL}/search_result?keyword=${
      encodeURIComponent(keyword)
    }`;
  } else {
    await warn(`未知爬取模式：${mode}`);
    await Kabegame.exit();
    return;
  }

  // 列表页处理需要这些参数，跨这一次导航传给 list 阶段。
  await Kabegame.updateState({ mode, maxItems, scrollRounds, boardId });
  await log(`打开列表页：${targetUrl}`);
  await Kabegame.to(targetUrl, { pageLabel: "list" });
}

async function handleList() {
  const state = await Kabegame.state();
  await Kabegame.waitForDom();
  await log(`列表页 · 等待数据注入（mode=${state.mode}）…`);
  await waitForListState(state.mode, state.boardId);
  await scrollList(
    state.mode,
    state.boardId,
    state.maxItems,
    state.scrollRounds,
  );

  let queue = listItems(state.mode, state.boardId);
  if (
    queue.length === 0 && ["author_collect", "author_like"].includes(state.mode)
  ) {
    queue = await waitForRestrictedAuthorItems(state.mode, state.boardId);
  }
  queue = queue.slice(0, state.maxItems);

  if (queue.length === 0) {
    await warn("当前列表没有可抓取的作品；请检查页面、登录状态或筛选条件。");
    await Kabegame.exit();
    return;
  }

  await log(`列表加载完成，共入队 ${queue.length} 条作品`);
  // 关键：在列表页原地 fetch 抓取所有详情，全程不再导航，页面不再重载。
  await processQueue(queue);
  await Kabegame.exit();
}

async function main() {
  try {
    const pageLabel = await Kabegame.pageLabel();
    // 每次页面加载脚本都会重跑，这条锚点是排障时判断“卡在哪个阶段”的唯一线索。
    await log(`▶ 页面加载 · 阶段=${pageLabel} · ${location.href}`);
    switch (pageLabel) {
      case "initial":
        await handleInitial();
        return;
      case "list":
        await handleList();
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
