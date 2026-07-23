// @ts-nocheck
// 小红书爬虫（V8 后端）
//
// 数据来源：作品详情页 / 首页推荐页 HTML 里的 window.__INITIAL_STATE__。
// 全程不需要 x-s / x-t 签名——这些页面未登录也返回完整 SSR 数据。
//
// 两个模式：
//   note      —— 按作品链接抓（含 xhslink 短链，靠 fetch 自动跟随重定向解析）
//   recommend —— 反复请求 /explore 抓推荐流。推荐流不能翻页，但每次刷新返回的
//                约 25 条互不重复（实测三次刷新零重叠），所以用"刷新轮数"代替分页。

const {
  addProgress,
  createImageMetadata,
  downloadImage,
  requireCookie,
  setHeader,
  warn,
} = Kabegame;

const HOST = "www.xiaohongshu.com";
const BASE_URL = `https://${HOST}`;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// 识别小红书作品链接的四种形态（含 rednote.com 同构域名）
const NOTE_LINK_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:xiaohongshu|rednote)\.com\/(?:explore|discovery\/item|user\/profile\/[A-Za-z0-9]+)\/\S+/g;
const SHORT_LINK_RE = /(?:https?:\/\/)?xhslink\.com\/[^\s"<>\\^`{|}，。；！？、【】《》]+/g;

const log = (msg: string) => console.log(`[xhs] ${msg}`);
const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** 对数正态抖动，模拟人类节奏（参考 XHS-Downloader tools.py 的做法） */
function jitter(baseMs: number): number {
  if (baseMs <= 0) return 0;
  const u1 = Math.max(Math.random(), 1e-9);
  const u2 = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const factor = Math.exp(0.45 * gauss); // sigma=0.45，中位数落在 baseMs
  return Math.max(200, Math.round(baseMs * factor));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setSiteHeaders(): void {
  setHeader("User-Agent", USER_AGENT);
  setHeader("Referer", `${BASE_URL}/`);
  setHeader("Accept-Language", "zh-CN,zh;q=0.9");
  setHeader(
    "Accept",
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  );
}

/** 带指数退避的 HTML 抓取。返回 null 表示放弃（调用方决定是否致命） */
async function fetchHtml(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      // 4xx 里只有 429 值得重试，其余是永久失败
      if (res.status !== 429 && res.status < 500) {
        warn(`请求 ${url} 返回 ${res.status}，跳过`);
        return null;
      }
      warn(`请求 ${url} 返回 ${res.status}，第 ${i + 1} 次重试`);
    } catch (err: any) {
      warn(`请求 ${url} 失败：${err?.message ?? err}，第 ${i + 1} 次重试`);
    }
    await sleep(1000 * Math.pow(2, i) + Math.random() * 500);
  }
  return null;
}

/**
 * 从 HTML 里剥出 window.__INITIAL_STATE__。
 * 这段是 JS 字面量而非严格 JSON——含 undefined，JSON.parse 会炸，先替换成 null。
 * （XHS-Downloader 是用 yaml.safe_load 绕开的，JS 侧正则替换即可。）
 */
function parseInitialState(html: string): any | null {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/);
  if (!m) return null;
  let raw = m[1].trim().replace(/;$/, "");
  raw = raw.replace(/\bundefined\b/g, "null");
  try {
    return JSON.parse(raw);
  } catch (err: any) {
    warn(`解析 __INITIAL_STATE__ 失败：${err?.message ?? err}`);
    return null;
  }
}

/** SSR 里是直接值，客户端 hydrate 后是 Vue ref 包一层 _rawValue —— 两种都兼容 */
function unwrap(v: any): any {
  return v && typeof v === "object" && "_rawValue" in v ? v._rawValue : v;
}

/** 详情页取 note 对象：noteDetailMap 的最后一个非空 key（对应 XHS-Downloader 的 [-1]） */
function pickNoteDetail(state: any): any | null {
  const map = unwrap(state?.note?.noteDetailMap);
  if (!map || typeof map !== "object") return null;
  const keys = Object.keys(map).filter((k) => k);
  if (keys.length === 0) return null;
  return unwrap(map[keys[keys.length - 1]])?.note ?? null;
}

/**
 * 从 urlDefault 提取图片 token。
 * 例：http://sns-webpic-qc.xhscdn.com/{日期}/{hash}/1040g00831!nd_dft_wgth_jpg_3
 *   → 1040g00831
 * 第 6 段起是文件名，"!" 后面是缩略图参数，必须去掉才是原图。
 */
function imageToken(urlDefault: string): string {
  const parts = str(urlDefault).split("/");
  if (parts.length < 6) return "";
  return parts.slice(5).join("/").split("!")[0];
}

function buildImageUrl(token: string, format: string): string {
  if (!token) return "";
  if (format && format !== "auto") {
    return `https://ci.xiaohongshu.com/${token}?imageView2/format/${format}`;
  }
  // auto：站点原图，实测比 urlDefault 缩略图大 4~5 倍
  return `https://sns-img-bd.xhscdn.com/${token}`;
}

/**
 * 挑视频直链。
 * 注意：XHS-Downloader 用的 video.consumer.originVideoKey 已失效（实测 consumer 为 null），
 * 现在只能走 media.stream 的编码分支。backupUrls 不带签名不会过期，优先用它。
 */
function pickVideoUrl(note: any): string {
  const stream = unwrap(note?.video?.media?.stream);
  if (!stream) return "";
  for (const codec of ["h264", "h265", "av1", "h266"]) {
    const list = unwrap(stream[codec]);
    if (!Array.isArray(list) || list.length === 0) continue;
    const s = list[0] ?? {};
    const backup = Array.isArray(s.backupUrls) ? str(s.backupUrls[0]) : "";
    const url = backup || str(s.masterUrl);
    if (url) return url;
  }
  return "";
}

/** Live 图的动态部分：imageList[i].stream.h264[0].masterUrl；stream 为空对象则是普通静图 */
function pickLiveUrl(image: any): string {
  const h264 = unwrap(unwrap(image?.stream)?.h264);
  if (!Array.isArray(h264) || h264.length === 0) return "";
  const s = h264[0] ?? {};
  const backup = Array.isArray(s.backupUrls) ? str(s.backupUrls[0]) : "";
  return backup || str(s.masterUrl);
}

/** metadata 只存白名单字段——原始 note 很大，整包入库会拖慢画册列表 */
function buildMetadata(note: any) {
  const user = unwrap(note?.user) ?? {};
  const interact = unwrap(note?.interactInfo) ?? {};
  const tags = unwrap(note?.tagList);
  return {
    schema: 1,
    noteId: str(note?.noteId),
    title: str(note?.title),
    desc: str(note?.desc),
    type: str(note?.type),
    time: note?.time ?? null,
    lastUpdateTime: note?.lastUpdateTime ?? null,
    user: {
      userId: str(user.userId),
      // 详情页是 nickname（小写 n），推荐流是 nickName，两个都兜一下
      nickname: str(user.nickname) || str(user.nickName),
    },
    tags: Array.isArray(tags) ? tags.map((t: any) => str(t?.name)).filter(Boolean) : [],
    interactInfo: {
      likedCount: str(interact.likedCount),
      collectedCount: str(interact.collectedCount),
      commentCount: str(interact.commentCount),
      shareCount: str(interact.shareCount),
    },
  };
}

interface Vars {
  imageFormat: string;
  wantVideo: boolean;
  wantLive: boolean;
  delayMs: number;
}

/**
 * 下载一个作品的全部媒体。返回实际下载的文件数。
 * onUnit 在每个媒体单元处理完后调用（无论成败），用于推进进度。
 */
async function downloadNote(
  note: any,
  vars: Vars,
  onUnit: (total: number) => void,
): Promise<number> {
  const noteId = str(note?.noteId);
  const images = unwrap(note?.imageList);
  const imageList = Array.isArray(images) ? images : [];
  const isVideo = str(note?.type) === "video";
  const videoUrl = isVideo && vars.wantVideo ? pickVideoUrl(note) : "";

  // 先算清楚要下几个单元，进度才好分配
  const units: Array<{ url: string; suffix: string }> = [];
  if (videoUrl) {
    units.push({ url: videoUrl, suffix: "" });
  } else {
    for (let i = 0; i < imageList.length; i += 1) {
      const token = imageToken(str(unwrap(imageList[i])?.urlDefault));
      const url = buildImageUrl(token, vars.imageFormat);
      if (url) units.push({ url, suffix: imageList.length > 1 ? `(${i + 1})` : "" });
      if (vars.wantLive) {
        const live = pickLiveUrl(unwrap(imageList[i]));
        if (live) units.push({ url: live, suffix: `${imageList.length > 1 ? `(${i + 1})` : ""}_live` });
      }
    }
  }

  if (units.length === 0) {
    warn(`作品 ${noteId} 没有可下载的媒体，跳过`);
    onUnit(0);
    return 0;
  }

  // 确认有媒体之后再建 metadata，避免留下没有图片引用的孤儿行
  const metadataId = Number(createImageMetadata(buildMetadata(note), null));
  const user = unwrap(note?.user) ?? {};
  const author = str(user.nickname) || str(user.nickName);
  const title = str(note?.title) || str(note?.desc).slice(0, 40) || noteId;
  const baseName = author ? `${author}_${title}` : title;
  const pageUrl = `${BASE_URL}/explore/${noteId}`;

  let ok = 0;
  for (const unit of units) {
    try {
      await downloadImage(unit.url, {
        name: `${baseName}${unit.suffix}`,
        metadata_id: metadataId,
        url: pageUrl,
      });
      ok += 1;
    } catch (err: any) {
      warn(`下载失败 ${unit.url}：${err?.message ?? err}`);
    }
    onUnit(units.length);
  }
  return ok;
}

/** 抓一个作品详情页并下载。url 可以是任意一种作品链接形态，包括短链 */
async function crawlNoteUrl(
  url: string,
  vars: Vars,
  onUnit: (total: number) => void,
): Promise<number> {
  const html = await fetchHtml(url);
  if (!html) {
    onUnit(0);
    return 0;
  }
  const state = parseInitialState(html);
  const note = state ? pickNoteDetail(state) : null;
  if (!note) {
    warn(`未能从 ${url} 解析出作品数据（可能已删除、仅登录可见，或链接无效）`);
    onUnit(0);
    return 0;
  }
  return downloadNote(note, vars, onUnit);
}

/** 模式一：按链接抓 */
async function crawlByLinks(rawInput: string, vars: Vars): Promise<void> {
  const text = str(rawInput);
  const links = [
    ...(text.match(NOTE_LINK_RE) ?? []),
    ...(text.match(SHORT_LINK_RE) ?? []),
  ];
  const unique = [...new Set(links)];
  if (unique.length === 0) {
    throw new Error(
      "没有识别到有效的小红书作品链接。支持 explore / discovery/item / user/profile 作品链接与 xhslink.com 短链。",
    );
  }

  log(`共 ${unique.length} 个作品链接`);
  const perNote = 100 / unique.length;
  let done = 0;

  for (const link of unique) {
    let unitStep = 0;
    const ok = await crawlNoteUrl(link, vars, (total) => {
      // 首次回调时才知道这个作品有几个单元，据此细分该作品的额度
      if (unitStep === 0) unitStep = total > 0 ? perNote / total : perNote;
      addProgress(unitStep);
    });
    done += ok;
    log(`[${done}] ${link} → ${ok} 个文件`);
    await sleep(jitter(vars.delayMs));
  }
  log(`完成，共下载 ${done} 个文件`);
}

/** 模式二：刷推荐流 */
async function crawlRecommend(rounds: number, maxItems: number, vars: Vars): Promise<void> {
  if (!requireCookie(HOST)) {
    // 有就更好、没有也能跑：未登录拿到的是通用推荐，登录后才是个性化推荐
    warn(
      "未从畅游获取到小红书 Cookie，将以未登录状态抓取通用推荐。若想抓取个性化推荐，请先在畅游中登录小红书。",
    );
  } else {
    log("已注入畅游 Cookie，抓取个性化推荐");
  }

  const seen = new Set<string>();
  const limit = maxItems > 0 ? maxItems : Number.MAX_SAFE_INTEGER;
  // 进度按预估总量分配：每轮实测约 25 条
  const estimate = Math.min(limit, rounds * 25);
  const perNote = estimate > 0 ? 99 / estimate : 0;
  let processed = 0;
  let files = 0;

  for (let round = 1; round <= rounds; round += 1) {
    if (processed >= limit) break;

    const html = await fetchHtml(`${BASE_URL}/explore`);
    if (!html) {
      warn(`第 ${round} 轮推荐页抓取失败，跳过`);
      continue;
    }
    const state = parseInitialState(html);
    const feeds = unwrap(state?.feed?.feeds);
    if (!Array.isArray(feeds) || feeds.length === 0) {
      warn(`第 ${round} 轮没有解析到推荐条目`);
      continue;
    }

    // 推荐流条目只有封面缩略图，没有 imageList，必须逐个进详情页才能拿全图
    const fresh = feeds.filter((it: any) => {
      const id = str(it?.id);
      return id && !seen.has(id);
    });
    log(`第 ${round}/${rounds} 轮：${feeds.length} 条，其中 ${fresh.length} 条是新的`);

    for (const item of fresh) {
      if (processed >= limit) break;
      const id = str(item?.id);
      const token = str(item?.xsecToken);
      seen.add(id);
      processed += 1;

      const url = `${BASE_URL}/explore/${id}${token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_feed` : ""}`;
      let unitStep = 0;
      const ok = await crawlNoteUrl(url, vars, (total) => {
        if (unitStep === 0) unitStep = total > 0 ? perNote / total : perNote;
        addProgress(unitStep);
      });
      files += ok;
      if (ok > 0) log(`[${processed}] ${id} → ${ok} 个文件`);
      await sleep(jitter(vars.delayMs));
    }

    if (processed < limit && round < rounds) await sleep(jitter(vars.delayMs));
  }

  log(`完成，处理 ${processed} 个作品，下载 ${files} 个文件`);
}

export async function crawl(_common: unknown, custom: Record<string, any>): Promise<void> {
  const cfg = custom || {};
  setSiteHeaders();

  const vars: Vars = {
    imageFormat: str(cfg.image_format) || "auto",
    wantVideo: cfg.download_video !== false,
    wantLive: cfg.download_live_photo === true,
    delayMs: Number(cfg.request_delay_ms ?? 2500),
  };

  const mode = str(cfg.crawl_mode) || "note";
  if (mode === "recommend") {
    const rounds = Math.max(1, Number(cfg.refresh_rounds) || 5);
    const maxItems = Math.max(0, Number(cfg.max_items) || 0);
    log(`模式：首页推荐，刷新 ${rounds} 轮，上限 ${maxItems || "不限"} 个作品`);
    await crawlRecommend(rounds, maxItems, vars);
    return;
  }

  // 单作品模式也顺带注入 Cookie：部分内容未登录看不全，取不到不影响主流程
  if (!requireCookie(HOST)) {
    warn("未从畅游获取到小红书 Cookie，将以未登录状态抓取。部分作品可能无法访问。");
  }
  log("模式：作品链接");
  await crawlByLinks(cfg.note_urls, vars);
}
