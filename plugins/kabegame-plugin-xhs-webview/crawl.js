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

// 用户可见文案跟随界面语言。zh 是基准表，其余语言必须覆盖全部 key。
// WebView 插件不经过打包，无法 import JSON，因此把五语言表内联在这里。
const MESSAGES = {
  zh: {
    statePresent: "存在",
    stateAbsent: "缺失",
    hasValue: "有",
    noValue: "无",
    listStateTimeout:
      "[xhs] 等待 20s 仍未读到列表数据 · mode={mode} · __INITIAL_STATE__={state} · feed={feed} · user={user} · search={search}",
    scrollLimitReached: "[xhs] 滚动结束 · 已达上限 {count}/{maxItems} 条",
    scrollRound: "[xhs] 滚动第 {round}/{rounds} 轮 · 当前抓到 {count} 条",
    restrictedListHint:
      "[xhs] 收藏或点赞列表为空，请在爬虫窗口中登录，并打开对应的收藏或点赞标签页。",
    restrictedItemsFound: "[xhs] 检测到 {count} 条，继续抓取",
    waitingLogin: "[xhs] 仍在等待登录/切换标签页…（{seconds}s）",
    restrictedTimeout: "[xhs] 等待 90s 后列表仍为空，放弃该模式",
    downloadFailed: "[xhs] 下载失败：{name}：{error}",
    downloadNote: "[xhs] 下载作品「{title}」({noteId}) · {count} 张图{video}",
    withVideo: " + 视频",
    processItem: "[xhs] 处理作品 {index}/{total} · {url}",
    noteParseFailed: "[xhs] 未解析到作品数据，跳过 · {url}",
    detailFailed: "[xhs] 抓取详情失败，跳过 · {url} · {error}",
    allDone: "[xhs] 全部完成 · 成功 {done}/{total}",
    initial:
      "[xhs] 初始化 · 模式={mode} · 最多 {maxItems} 条 · 滚动 {rounds} 轮",
    noNoteLinks: "[xhs] 没有识别到有效的小红书作品链接，任务结束。",
    noteLinkMode: "[xhs] 链接模式 · 识别到 {count} 条作品链接",
    authorRequired: "[xhs] 请填写作者主页 URL 或 userId，任务结束。",
    boardRequired: "[xhs] 请填写专辑 URL 或 id，任务结束。",
    keywordRequired: "[xhs] 请填写搜索关键词，任务结束。",
    unknownMode: "[xhs] 未知爬取模式：{mode}",
    openListPage: "[xhs] 打开列表页：{url}",
    waitListData: "[xhs] 列表页 · 等待数据注入（mode={mode}）…",
    emptyList:
      "[xhs] 当前列表没有可抓取的作品；请检查页面、登录状态或筛选条件。",
    listReady: "[xhs] 列表加载完成，共入队 {count} 条作品",
    pageLoaded: "[xhs] ▶ 页面加载 · 阶段={phase} · {url}",
    stageEnded: "[xhs] 阶段={phase}，结束",
    pluginFailed: "[xhs] 插件运行失败：{error}",
  },
  en: {
    statePresent: "present",
    stateAbsent: "missing",
    hasValue: "yes",
    noValue: "no",
    listStateTimeout:
      "[xhs] Still no list data after 20s · mode={mode} · __INITIAL_STATE__={state} · feed={feed} · user={user} · search={search}",
    scrollLimitReached:
      "[xhs] Scrolling finished · reached the limit of {count}/{maxItems} items",
    scrollRound:
      "[xhs] Scroll round {round}/{rounds} · {count} items collected so far",
    restrictedListHint:
      "[xhs] The favorites or likes list is empty. Sign in in the crawler window and open the matching favorites or likes tab.",
    restrictedItemsFound: "[xhs] Found {count} items; continuing",
    waitingLogin:
      "[xhs] Still waiting for sign-in or a tab switch… ({seconds}s)",
    restrictedTimeout:
      "[xhs] The list is still empty after 90s; giving up on this mode",
    downloadFailed: "[xhs] Download failed: {name}: {error}",
    downloadNote:
      "[xhs] Downloading “{title}” ({noteId}) · {count} image(s){video}",
    withVideo: " + video",
    processItem: "[xhs] Processing post {index}/{total} · {url}",
    noteParseFailed: "[xhs] No post data could be parsed; skipping · {url}",
    detailFailed:
      "[xhs] Failed to crawl the detail page; skipping · {url} · {error}",
    allDone: "[xhs] All done · {done}/{total} succeeded",
    initial:
      "[xhs] Starting · mode={mode} · up to {maxItems} items · {rounds} scroll rounds",
    noNoteLinks:
      "[xhs] No valid Xiaohongshu post links were recognized; ending the task.",
    noteLinkMode: "[xhs] Link mode · {count} post links recognized",
    authorRequired:
      "[xhs] Enter the creator profile URL or userId; ending the task.",
    boardRequired: "[xhs] Enter the board URL or id; ending the task.",
    keywordRequired: "[xhs] Enter a search keyword; ending the task.",
    unknownMode: "[xhs] Unknown crawl mode: {mode}",
    openListPage: "[xhs] Opening the list page: {url}",
    waitListData: "[xhs] List page · waiting for data injection (mode={mode})…",
    emptyList:
      "[xhs] No posts available in the current list; check the page, sign-in state, or filters.",
    listReady: "[xhs] List loaded; {count} posts queued",
    pageLoaded: "[xhs] ▶ Page load · phase={phase} · {url}",
    stageEnded: "[xhs] Phase={phase}; exiting",
    pluginFailed: "[xhs] Plugin run failed: {error}",
  },
  ja: {
    statePresent: "あり",
    stateAbsent: "なし",
    hasValue: "あり",
    noValue: "なし",
    listStateTimeout:
      "[xhs] 20 秒待ってもリストデータを取得できません · mode={mode} · __INITIAL_STATE__={state} · feed={feed} · user={user} · search={search}",
    scrollLimitReached:
      "[xhs] スクロール終了 · 上限 {count}/{maxItems} 件に到達",
    scrollRound: "[xhs] スクロール {round}/{rounds} 回目 · 現在 {count} 件取得",
    restrictedListHint:
      "[xhs] お気に入りまたはいいね一覧が空です。クローラーウィンドウでログインし、該当するお気に入り／いいねタブを開いてください。",
    restrictedItemsFound: "[xhs] {count} 件を検出しました。取得を続けます",
    waitingLogin:
      "[xhs] ログインまたはタブ切り替えを待っています…（{seconds}秒）",
    restrictedTimeout:
      "[xhs] 90 秒待っても一覧が空のため、このモードを断念します",
    downloadFailed: "[xhs] ダウンロード失敗：{name}：{error}",
    downloadNote:
      "[xhs] 投稿「{title}」をダウンロード ({noteId}) · 画像 {count} 枚{video}",
    withVideo: " + 動画",
    processItem: "[xhs] 投稿 {index}/{total} を処理 · {url}",
    noteParseFailed:
      "[xhs] 投稿データを解析できませんでした。スキップします · {url}",
    detailFailed:
      "[xhs] 詳細の取得に失敗しました。スキップします · {url} · {error}",
    allDone: "[xhs] 完了 · 成功 {done}/{total}",
    initial:
      "[xhs] 初期化 · モード={mode} · 最大 {maxItems} 件 · スクロール {rounds} 回",
    noNoteLinks:
      "[xhs] 有効な Xiaohongshu の投稿リンクが見つかりません。タスクを終了します。",
    noteLinkMode: "[xhs] リンクモード · {count} 件の投稿リンクを検出",
    authorRequired:
      "[xhs] 作者プロフィールの URL または userId を入力してください。タスクを終了します。",
    boardRequired:
      "[xhs] アルバムの URL または id を入力してください。タスクを終了します。",
    keywordRequired:
      "[xhs] 検索キーワードを入力してください。タスクを終了します。",
    unknownMode: "[xhs] 不明なクロールモード：{mode}",
    openListPage: "[xhs] 一覧ページを開きます：{url}",
    waitListData:
      "[xhs] 一覧ページ · データの注入を待っています（mode={mode}）…",
    emptyList:
      "[xhs] 現在の一覧に取得できる投稿がありません。ページ、ログイン状態、絞り込み条件を確認してください。",
    listReady: "[xhs] 一覧の読み込みが完了しました。{count} 件をキューに追加",
    pageLoaded: "[xhs] ▶ ページ読み込み · フェーズ={phase} · {url}",
    stageEnded: "[xhs] フェーズ={phase} のため終了します",
    pluginFailed: "[xhs] プラグインの実行に失敗しました：{error}",
  },
  ko: {
    statePresent: "있음",
    stateAbsent: "없음",
    hasValue: "있음",
    noValue: "없음",
    listStateTimeout:
      "[xhs] 20초가 지나도 목록 데이터를 읽지 못했습니다 · mode={mode} · __INITIAL_STATE__={state} · feed={feed} · user={user} · search={search}",
    scrollLimitReached: "[xhs] 스크롤 종료 · 최대 {count}/{maxItems}개 도달",
    scrollRound: "[xhs] 스크롤 {round}/{rounds}회 · 현재 {count}개 수집",
    restrictedListHint:
      "[xhs] 즐겨찾기 또는 좋아요 목록이 비어 있습니다. 크롤러 창에서 로그인하고 해당 즐겨찾기 또는 좋아요 탭을 열어 주세요.",
    restrictedItemsFound: "[xhs] {count}개를 감지했습니다. 계속 수집합니다",
    waitingLogin: "[xhs] 로그인 또는 탭 전환을 기다리는 중… ({seconds}초)",
    restrictedTimeout:
      "[xhs] 90초가 지나도 목록이 비어 있어 이 모드를 포기합니다",
    downloadFailed: "[xhs] 다운로드 실패: {name}: {error}",
    downloadNote:
      "[xhs] 게시물 “{title}” 다운로드 ({noteId}) · 이미지 {count}장{video}",
    withVideo: " + 동영상",
    processItem: "[xhs] 게시물 {index}/{total} 처리 · {url}",
    noteParseFailed:
      "[xhs] 게시물 데이터를 파싱하지 못했습니다. 건너뜁니다 · {url}",
    detailFailed: "[xhs] 상세 정보 수집 실패, 건너뜀 · {url} · {error}",
    allDone: "[xhs] 모두 완료 · 성공 {done}/{total}",
    initial:
      "[xhs] 초기화 · 모드={mode} · 최대 {maxItems}개 · 스크롤 {rounds}회",
    noNoteLinks:
      "[xhs] 유효한 샤오홍슈 게시물 링크를 찾지 못했습니다. 작업을 종료합니다.",
    noteLinkMode: "[xhs] 링크 모드 · 게시물 링크 {count}개 감지",
    authorRequired:
      "[xhs] 작성자 프로필 URL 또는 userId를 입력해 주세요. 작업을 종료합니다.",
    boardRequired: "[xhs] 앨범 URL 또는 id를 입력해 주세요. 작업을 종료합니다.",
    keywordRequired: "[xhs] 검색어를 입력해 주세요. 작업을 종료합니다.",
    unknownMode: "[xhs] 알 수 없는 크롤 모드: {mode}",
    openListPage: "[xhs] 목록 페이지 열기: {url}",
    waitListData: "[xhs] 목록 페이지 · 데이터 주입 대기 중(mode={mode})…",
    emptyList:
      "[xhs] 현재 목록에 수집할 게시물이 없습니다. 페이지, 로그인 상태 또는 필터를 확인해 주세요.",
    listReady: "[xhs] 목록 로드 완료, 게시물 {count}개 대기열 추가",
    pageLoaded: "[xhs] ▶ 페이지 로드 · 단계={phase} · {url}",
    stageEnded: "[xhs] 단계={phase}, 종료합니다",
    pluginFailed: "[xhs] 플러그인 실행 실패: {error}",
  },
  zhtw: {
    statePresent: "存在",
    stateAbsent: "缺失",
    hasValue: "有",
    noValue: "無",
    listStateTimeout:
      "[xhs] 等待 20s 仍未讀到列表資料 · mode={mode} · __INITIAL_STATE__={state} · feed={feed} · user={user} · search={search}",
    scrollLimitReached: "[xhs] 滾動結束 · 已達上限 {count}/{maxItems} 則",
    scrollRound: "[xhs] 滾動第 {round}/{rounds} 輪 · 目前抓到 {count} 則",
    restrictedListHint:
      "[xhs] 收藏或按讚列表為空，請在爬蟲視窗中登入，並開啟對應的收藏或按讚分頁。",
    restrictedItemsFound: "[xhs] 偵測到 {count} 則，繼續抓取",
    waitingLogin: "[xhs] 仍在等待登入／切換分頁…（{seconds}s）",
    restrictedTimeout: "[xhs] 等待 90s 後列表仍為空，放棄此模式",
    downloadFailed: "[xhs] 下載失敗：{name}：{error}",
    downloadNote: "[xhs] 下載作品「{title}」({noteId}) · {count} 張圖{video}",
    withVideo: " + 影片",
    processItem: "[xhs] 處理作品 {index}/{total} · {url}",
    noteParseFailed: "[xhs] 未解析到作品資料，跳過 · {url}",
    detailFailed: "[xhs] 抓取詳情失敗，跳過 · {url} · {error}",
    allDone: "[xhs] 全部完成 · 成功 {done}/{total}",
    initial:
      "[xhs] 初始化 · 模式={mode} · 最多 {maxItems} 則 · 滾動 {rounds} 輪",
    noNoteLinks: "[xhs] 沒有辨識到有效的小紅書作品連結，任務結束。",
    noteLinkMode: "[xhs] 連結模式 · 辨識到 {count} 則作品連結",
    authorRequired: "[xhs] 請填寫作者主頁 URL 或 userId，任務結束。",
    boardRequired: "[xhs] 請填寫專輯 URL 或 id，任務結束。",
    keywordRequired: "[xhs] 請填寫搜尋關鍵字，任務結束。",
    unknownMode: "[xhs] 未知的爬取模式：{mode}",
    openListPage: "[xhs] 開啟列表頁：{url}",
    waitListData: "[xhs] 列表頁 · 等待資料注入（mode={mode}）…",
    emptyList:
      "[xhs] 目前列表沒有可抓取的作品；請檢查頁面、登入狀態或篩選條件。",
    listReady: "[xhs] 列表載入完成，共加入 {count} 則作品",
    pageLoaded: "[xhs] ▶ 頁面載入 · 階段={phase} · {url}",
    stageEnded: "[xhs] 階段={phase}，結束",
    pluginFailed: "[xhs] 外掛執行失敗：{error}",
  },
};

const LANG = Kabegame.getLang?.() ?? "zh";
const t = (key, params = {}) => {
  const table = MESSAGES[LANG] || MESSAGES.zh;
  const tpl = table[key] ?? MESSAGES.zh[key] ?? key;
  return tpl.replace(
    /\{(\w+)\}/g,
    (m, name) => params[name] != null ? String(params[name]) : m,
  );
};

function unwrap(value) {
  return value && value._rawValue !== undefined ? value._rawValue : value;
}

function errorMessage(error) {
  return error?.message ?? String(error);
}

// 统一日志出口；[xhs] 前缀放在各语言文案里，方便在任务日志里筛选、定位卡点。
function log(message) {
  return Kabegame.log(message);
}

function warn(message) {
  return Kabegame.warn(message);
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

// 把 __INITIAL_STATE__ 的 JS 字面量安全转成对象：剥尾分号、undefined→null，
// 并展开 new Map(...) / new Set(...)（详情页的 noteDetailMap 现在就是 new Map([...])）。
function safeParseState(raw) {
  try {
    const text = String(raw).trim().replace(/;$/, "").replace(
      /\bundefined\b/g,
      "null",
    );
    return JSON.parse(rewriteCollectionLiterals(text), reviveCollections);
  } catch {
    return null;
  }
}

const MAP_ENTRIES_KEY = "__kbMapEntries__";

// 只改写字符串之外的 new Map( / new Set(：Map 变成 {"__kbMapEntries__": [...]}，解析时由
// reviveCollections 还原成按 key 索引的普通对象；Set 直接变成数组。JSON 在字符串之外没有括号，
// 所以遇到的 ")" 必定是最近一个 new Map( / new Set( 的收尾。
function rewriteCollectionLiterals(text) {
  let out = "";
  const closers = [];
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (text.startsWith("new Map()", i)) {
      out += "{}";
      i += "new Map()".length - 1;
    } else if (text.startsWith("new Set()", i)) {
      out += "[]";
      i += "new Set()".length - 1;
    } else if (text.startsWith("new Map(", i)) {
      out += `{"${MAP_ENTRIES_KEY}":`;
      closers.push("}");
      i += "new Map(".length - 1;
    } else if (text.startsWith("new Set(", i)) {
      closers.push("");
      i += "new Set(".length - 1;
    } else if (ch === ")" && closers.length > 0) {
      out += closers.pop();
    } else {
      out += ch;
    }
  }
  return out;
}

function reviveCollections(_key, value) {
  if (
    value && typeof value === "object" && !Array.isArray(value) &&
    Array.isArray(value[MAP_ENTRIES_KEY])
  ) {
    return Object.fromEntries(value[MAP_ENTRIES_KEY]);
  }
  return value;
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
    t("listStateTimeout", {
      mode,
      state: state ? t("statePresent") : t("stateAbsent"),
      feed: state?.feed ? t("hasValue") : t("noValue"),
      user: state?.user ? t("hasValue") : t("noValue"),
      search: state?.search ? t("hasValue") : t("noValue"),
    }),
  );
  return false;
}

async function scrollList(mode, boardId, maxItems, scrollRounds) {
  for (let round = 0; round < scrollRounds; round += 1) {
    const count = listItems(mode, boardId).length;
    if (count >= maxItems) {
      await log(t("scrollLimitReached", { count, maxItems }));
      break;
    }
    await log(
      t("scrollRound", { round: round + 1, rounds: scrollRounds, count }),
    );
    window.scrollTo(0, document.body.scrollHeight);
    await Kabegame.sleep(randomInt(250, 500));
    if (Math.random() < 0.2) {
      await Kabegame.sleep(randomInt(700, 1600));
    }
  }
  await Kabegame.sleep(500);
}

async function waitForRestrictedAuthorItems(mode, boardId) {
  await warn(t("restrictedListHint"));
  await Kabegame.requestShowWebview();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const items = listItems(mode, boardId);
    if (items.length > 0) {
      await log(t("restrictedItemsFound", { count: items.length }));
      return items;
    }
    if (attempt > 0 && attempt % 15 === 0) {
      await log(t("waitingLogin", { seconds: attempt }));
    }
    await Kabegame.sleep(1000);
  }
  await warn(t("restrictedTimeout"));
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
function parseDetailFromHtml(html, wantId) {
  const match = String(html).match(
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  const state = safeParseState(match[1]);
  const map = unwrap(state?.note?.noteDetailMap);
  if (!map || typeof map !== "object") return null;

  // 优先按目标 noteId 精确取；否则回退到最后一个非空 key。
  if (wantId && map[wantId]) {
    const detail = unwrap(map[wantId]);
    const note = unwrap(detail?.note);
    if (note) {
      return {
        note,
        comments: unwrap(detail?.comments),
        widgets: unwrap(detail?.widgets),
      };
    }
  }
  const keys = Object.keys(map).filter(Boolean);
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const detail = unwrap(map[keys[index]]);
    const note = unwrap(detail?.note);
    if (note) {
      return {
        note,
        comments: unwrap(detail?.comments),
        widgets: unwrap(detail?.widgets),
      };
    }
  }
  return null;
}

// fetch 一个详情页并解析 note。同源请求自动带 Cookie，不受 CORS 限制。
async function fetchDetail(entry) {
  const res = await fetch(detailUrl(entry), {
    credentials: "include",
    headers: { "Accept-Language": "zh-CN,zh;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseDetailFromHtml(html, entry.id || "");
}

// ── 下载 ───────────────────────────────────────────────────────────────

function publicUser(user, avatarKey = "avatar") {
  return {
    userId: String(user?.userId ?? ""),
    nickname: String(user?.nickname ?? ""),
    avatar: String(user?.[avatarKey] ?? ""),
  };
}

function publicPicture(picture) {
  return {
    url: String(picture?.urlDefault ?? picture?.urlPre ?? ""),
    width: Number(picture?.width ?? 0),
    height: Number(picture?.height ?? 0),
  };
}

function publicComment(comment) {
  const targetUser = comment?.targetComment?.userInfo;
  return {
    id: String(comment?.id ?? ""),
    content: String(comment?.content ?? ""),
    createTime: comment?.createTime ?? null,
    ipLocation: String(comment?.ipLocation ?? ""),
    likeCount: String(comment?.likeCount ?? ""),
    subCommentCount: String(comment?.subCommentCount ?? ""),
    isAuthor: Array.isArray(comment?.showTags) &&
      comment.showTags.includes("is_author"),
    user: publicUser(comment?.userInfo, "image"),
    targetUser: targetUser ? publicUser(targetUser, "image") : null,
    pictures: Array.isArray(comment?.pictures)
      ? comment.pictures.map(publicPicture).filter((picture) => picture.url)
      : [],
    subComments: Array.isArray(comment?.subComments)
      ? comment.subComments.map(publicComment)
      : [],
  };
}

function relatedSearch(widgets) {
  if (!Array.isArray(widgets)) return null;
  const model = widgets.find((widget) =>
    widget?.bizType === "image_related_search"
  )?.model;
  if (!model?.subTitle) return null;
  return {
    title: String(model.title ?? "猜你想搜"),
    keyword: String(model.subTitle),
  };
}

function noteMetadata(detail) {
  const note = detail?.note ?? {};
  const comments = detail?.comments;
  return {
    schema: 1,
    noteId: String(note?.noteId ?? ""),
    title: String(note?.title ?? ""),
    desc: String(note?.desc ?? ""),
    type: String(note?.type ?? ""),
    time: note?.time ?? null,
    lastUpdateTime: note?.lastUpdateTime ?? null,
    ipLocation: String(note?.ipLocation ?? ""),
    illegalInfo: note?.illegalInfo?.desc
      ? { desc: String(note.illegalInfo.desc) }
      : null,
    user: publicUser(note?.user),
    tagList: Array.isArray(note?.tagList)
      ? note.tagList.map((tag) => ({
        id: String(tag?.id ?? ""),
        name: String(tag?.name ?? ""),
        type: String(tag?.type ?? "topic"),
      }))
      : [],
    interactInfo: {
      likedCount: String(note?.interactInfo?.likedCount ?? ""),
      collectedCount: String(note?.interactInfo?.collectedCount ?? ""),
      commentCount: String(note?.interactInfo?.commentCount ?? ""),
      shareCount: String(note?.interactInfo?.shareCount ?? ""),
    },
    imageCount: Array.isArray(note?.imageList) ? note.imageList.length : 0,
    relatedSearch: relatedSearch(detail?.widgets),
    comments: {
      total: String(note?.interactInfo?.commentCount ?? ""),
      hasMore: comments?.hasMore === true,
      list: Array.isArray(comments?.list)
        ? comments.list.map(publicComment)
        : [],
    },
  };
}

function labelsFromMetadata(metadata) {
  return metadata.tagList
    .filter((tag) => tag.id && tag.name)
    .map((tag) => ({
      key: tag.id,
      category: "xhs-webview/topic",
      name: tag.name,
    }));
}

function searchTextsFromMetadata(metadata) {
  const comments = metadata.comments?.list ?? [];
  return [
    metadata.title,
    metadata.desc,
    metadata.user?.nickname,
    ...metadata.tagList.map((tag) => tag.name),
    ...comments.flatMap((comment) => [
      comment.user?.nickname,
      comment.content,
      ...comment.subComments.flatMap((reply) => [
        reply.user?.nickname,
        reply.content,
      ]),
    ]),
    metadata.noteId ? `xhs_note_${metadata.noteId}` : "",
    metadata.user?.userId ? `xhs_user_${metadata.user.userId}` : "",
  ].filter((text) => String(text ?? "").trim());
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
    await warn(
      t("downloadFailed", { name: options.name, error: errorMessage(error) }),
    );
  }
  // 每次下载之间隔 500ms，压低对 xhs CDN 的突发并发，减少瞬时拒绝（宿主侧另有重试兜底）。
  await Kabegame.sleep(3000);
}

// 下载一个作品的全部媒体。sourceUrl 作为 metadata 里的来源地址；
// fallbackId 用于 note 缺 noteId 时的文件命名兜底；
// progressBudget 是该作品在总进度里占的百分比预算，按媒体条目均分逐个推进，
// 使进度条以图片（媒体）为粒度增长，而非整个作品一次跳完。
async function downloadNote(detail, sourceUrl, fallbackId, progressBudget = 0) {
  const note = detail.note;
  const metadata = noteMetadata(detail);
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
    t("downloadNote", {
      title,
      noteId,
      count: images.length,
      video: hasVideo ? t("withVideo") : "",
    }),
  );

  // 空作品也要把预算加满，保证总进度最终到 100%。
  if (mediaTasks.length === 0) {
    if (progressBudget > 0) await Kabegame.addProgress(progressBudget);
    return;
  }

  const labels = labelsFromMetadata(metadata);
  const searchTexts = searchTextsFromMetadata(metadata);
  let metadataId;
  try {
    metadataId = Number(
      await Kabegame.createImageMetadata(metadata, { searchTexts }),
    );
  } catch {
    metadataId = null;
  }
  const metadataOptions = Number.isFinite(metadataId)
    ? { metadata_id: metadataId }
    : { metadata, searchTexts };

  const perMedia = progressBudget / mediaTasks.length;
  for (const task of mediaTasks) {
    await downloadMedia(task.url, {
      name: task.name,
      url: sourceUrl,
      ...metadataOptions,
      labels,
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
    await log(t("processItem", { index: i + 1, total, url: source }));
    try {
      const detail = await fetchDetail(entry);
      if (detail?.note) {
        // 进度在 downloadNote 内按图片（媒体条目）粒度均分推进这 perItem 预算。
        await downloadNote(detail, source, entry.id, perItem);
        done += 1;
      } else {
        await warn(t("noteParseFailed", { url: source }));
        await Kabegame.addProgress(perItem);
      }
    } catch (error) {
      await warn(
        t("detailFailed", { url: source, error: errorMessage(error) }),
      );
      await Kabegame.addProgress(perItem);
    }
    if (i < total - 1) await politeDelay();
  }

  await log(t("allDone", { done, total }));
}

// ── 阶段处理 ───────────────────────────────────────────────────────────

async function handleInitial() {
  const mode = String(Kabegame.vars?.crawl_mode ?? "recommend");
  const maxItems = clampInt(Kabegame.vars?.max_items, 50, 1, 500);
  const scrollRounds = clampInt(Kabegame.vars?.scroll_rounds, 5, 0, 100);
  await log(
    t("initial", { mode, maxItems, rounds: scrollRounds }),
  );

  // 链接模式：无需列表页，直接在当前执行流里 fetch 抓取全部链接。
  if (mode === "note") {
    const queue = normalizeNoteUrls(Kabegame.vars?.note_urls);
    if (queue.length === 0) {
      await warn(t("noNoteLinks"));
      await Kabegame.exit();
      return;
    }
    await log(t("noteLinkMode", { count: queue.length }));
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
      await warn(t("authorRequired"));
      await Kabegame.exit();
      return;
    }
    targetUrl = `${BASE_URL}/user/profile/${encodeURIComponent(authorId)}`;
  } else if (mode === "board") {
    boardId = extractId(Kabegame.vars?.board_url, "board");
    if (!boardId) {
      await warn(t("boardRequired"));
      await Kabegame.exit();
      return;
    }
    targetUrl = `${BASE_URL}/board/${encodeURIComponent(boardId)}`;
  } else if (mode === "search") {
    const keyword = String(Kabegame.vars?.search_keyword ?? "").trim();
    if (!keyword) {
      await warn(t("keywordRequired"));
      await Kabegame.exit();
      return;
    }
    targetUrl = `${BASE_URL}/search_result?keyword=${
      encodeURIComponent(keyword)
    }`;
  } else {
    await warn(t("unknownMode", { mode }));
    await Kabegame.exit();
    return;
  }

  // 列表页处理需要这些参数，跨这一次导航传给 list 阶段。
  await Kabegame.updateState({ mode, maxItems, scrollRounds, boardId });
  await log(t("openListPage", { url: targetUrl }));
  await Kabegame.to(targetUrl, { pageLabel: "list" });
}

async function handleList() {
  const state = await Kabegame.state();
  await Kabegame.waitForDom();
  await log(t("waitListData", { mode: state.mode }));
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
    await warn(t("emptyList"));
    await Kabegame.exit();
    return;
  }

  await log(t("listReady", { count: queue.length }));
  // 关键：在列表页原地 fetch 抓取所有详情，全程不再导航，页面不再重载。
  await processQueue(queue);
  await Kabegame.exit();
}

async function main() {
  try {
    const pageLabel = await Kabegame.pageLabel();
    // 每次页面加载脚本都会重跑，这条锚点是排障时判断“卡在哪个阶段”的唯一线索。
    await log(t("pageLoaded", { phase: pageLabel, url: location.href }));
    switch (pageLabel) {
      case "initial":
        await handleInitial();
        return;
      case "list":
        await handleList();
        return;
      default:
        await log(t("stageEnded", { phase: pageLabel }));
        await Kabegame.exit();
        return;
    }
  } catch (error) {
    await warn(t("pluginFailed", { error: errorMessage(error) }));
    await Kabegame.exit();
  }
}

await main();
