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
  return Kabegame.log(message);
}

function warn(message) {
  return Kabegame.warn(message);
}

// 用户可见文案跟随界面语言。zh 是基准表，其余语言必须覆盖全部 key。
// WebView 插件不经过打包，无法 import JSON，因此把五语言表内联在这里。
const MESSAGES = {
  zh: {
    parseTargetRequired: "请填写创作者或合集",
    parseCampaignIdRequired: "id: 后面要跟 campaign id",
    parseCollectionIdNumeric: "合集 id 必须是数字，收到「{value}」",
    parseUrlInvalid: "无法解析链接：{value}",
    parseCollectionFromUrl: "无法从「{value}」解析出合集 id",
    parseCreatorFromUrl: "无法从「{value}」解析出创作者名",
    apiFailed: "接口请求失败({status}): {url}",
    postLabel: "「{title}」({id})",
    diagHeader: "[patreon]   ┏━ 下载失败诊断 ━━━━━━━━━━━━━━",
    diagUrl: "[patreon]   ┃ URL: {url}",
    diagPageOrigin: "[patreon]   ┃ 页面 origin: {origin}",
    diagTargetOrigin: "[patreon]   ┃ 目标 origin: {origin}（{scope}）",
    sameOrigin: "同源",
    crossOrigin: "**跨源**",
    diagTargetOriginFailed: "[patreon]   ┃ 目标 origin: (URL 解析失败)",
    diagRawError: "[patreon]   ┃ 原始错误: {name} / {ctor}：{message}",
    probeSameOrigin: "same-origin(实际用法)",
    probeCorsAnon: "cors 无凭据",
    probeCorsCred: "cors + credentials",
    probeNoCors: "no-cors",
    none: "无",
    diagProbeResult: "[patreon]   ┃ [{label}] status={status} type={type} redirected={redirected} bodyNull={bodyNull}",
    diagFinalUrl: "[patreon]   ┃     最终 URL: {url}",
    notVisible: "(不可见)",
    magicBytes: "[patreon]       魔数: {hex}",
    diagHeaders: "[patreon]   ┃     content-type={ct} content-length={cl} Access-Control-Allow-Origin={acao}",
    diagProbeError: "[patreon]   ┃ [{label}] 抛错: {name}：{message}",
    diagFooter: "[patreon]   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    downloadStart: "[patreon]     ↓ 开始下载 {name}",
    attachmentUrl: "[patreon]       URL: {url}",
    attachmentAscii: "[patreon]       ASCII: {ascii}",
    attachmentHttpFailed: "[patreon] 附件下载失败({status})：{name}",
    attachmentEmpty: "[patreon] 附件落盘 0 字节：{name}（status={status}）",
    downloadFinished: "[patreon]     ↓ {name}（{bytes} 字节，最终 URL: {url}）",
    inspectFailed: "[patreon]       落盘文件无法读取：{error}",
    notArchive: "[patreon]       ✗ 下载到的不是归档而是 {kind}——多半是被重定向到了登录页 / 错误页 / Cloudflare 挑战页。",
    archiveKindDetected: "[patreon]       判定格式: {kind}（声明为 {declared}）",
    archiveKindUnknown: "[patreon]       判定格式: 未识别（tar 的 ustar 标记在偏移 257，属正常）",
    unrecognized: "未识别",
    archiveExtracted: "[patreon]     ⇲ 解出 {count} 个文件（跳过 {skipped}，共 {bytes} 字节）",
    ingestFailed: "[patreon] 入库失败：{file}（{error}）",
    archiveFailed: "[patreon] 归档处理失败：{name}（{errorName}：{error}）",
    failedProbe: "[patreon]       失败时落盘内容：{kind} | {hex}",
    unsupportedArchive: "[patreon] 跳过不支持的归档格式：{name}",
    postSummary: "[patreon]   → {post}：{archives} 个压缩包，{images} 张正文图",
    postFinished: "[patreon]   ← {post}：成功 {ok}，失败 {failed}",
    postImageFailed: "[patreon] 正文图下载失败：{url}（{error}）",
    watermarkReadFailed: "[patreon] 读取上次爬取记录失败，本次按全量处理：{error}",
    watermarkSaved: "[patreon]   · 已记录本次爬取水位线：{value}",
    watermarkWriteFailed: "[patreon] 写入爬取记录失败（下次会重复抓取）：{error}",
    timeMinLabel: "最旧时间",
    timeMaxLabel: "最新时间",
    boundaryInvalid: "{label}「{value}」无法解析为日期。请用日期选择器，或填形如 2026-01-31 的格式。",
    timeRangeInvalid: "时间范围：最旧时间（{min}）不能晚于最新时间（{max}）",
    direction: "[patreon] ▶ 方向：{direction}",
    directionAsc: "从旧到新",
    directionDesc: "从新到旧",
    timeWindow: "[patreon] ▶ 时间窗：{min}{fromWatermark} ~ {max}",
    oldestReachable: "能扒到的最旧",
    newestReachable: "能扒到的最新",
    fromWatermark: "（来自上次爬取记录）",
    collectionOrderNote: "[patreon] ▶ 合集按合集内顺序排列，不按时间——方向与时间窗设置对它不生效",
    pageHeader: "[patreon]   ┌ 第 {page} 页：{count} 个帖子 · {span}",
    noTimeInfo: "无时间信息",
    pastNewest: "[patreon]   · 已越过最新时间（本篇 {time}），停止翻页",
    caughtWatermark: "[patreon]   · 已追上上次进度（本篇 {time}），停止翻页",
    pastOldest: "[patreon]   · 已越过最旧时间（本篇 {time}），停止翻页",
    skippedNoAccess: "[patreon]   · 无权查看，跳过 {post}",
    pageAllOutside: "[patreon]   └ 本页 {skipped} 篇都在时间窗外，尚未到达 {goal}，继续翻页…",
    pagePartlyOutside: "[patreon]   └ 本页处理 {handled} 篇，{skipped} 篇在时间窗外",
    goalAfter: "{time} 之后",
    goalBefore: "{time} 之前",
    goalEarliest: "最早的帖子",
    goalLatest: "最新的帖子",
    lastPage: "[patreon]   · 已翻到最后一页（共 {page} 页）",
    crawlFinished: "[patreon] ◀ 结束：共翻 {page} 页，成功 {ok}，失败 {failed}",
    noFilesWindowed: "[patreon] 没有下载到任何文件。先确认时间窗是否设得太窄{watermark}；其次才是该创作者没有压缩包附件、当前账号未订阅、或提取规则把包内文件全滤掉了。",
    noFilesWatermark: "（下界来自上次爬取记录，可能已经追平）",
    noFilesGeneral: "[patreon] 没有下载到任何文件。可能原因：该创作者的帖子没有压缩包附件、当前账号未订阅、或提取规则把包内文件全滤掉了。",
    targetType: "[patreon] ▶ 目标类型：{label}（{value}）",
    targetCreator: "创作者主页",
    targetCollection: "合集页",
    targetCampaign: "站内页",
    openPage: "[patreon] ▶ 打开 {url}",
    challengePassing: "[patreon]   · 正在过 Cloudflare 挑战…",
    campaignParseFailed: "未能解析出 campaign id。若页面停在 Cloudflare challenge，请在弹出的窗口里手动完成验证；若 Patreon 前端已改版，可在浏览器里找到 campaign id 后填成 id:<campaign_id>。",
    campaignLog: "[patreon] ▶ campaign {id}",
    collectionPageFailed: "合集页未能加载完成（可能卡在 Cloudflare challenge）。请在弹出的窗口里手动完成验证后重试。",
    collectionThumbMissing: "[patreon]   · 合集缩略图里没有 campaign id，改从页面解析",
    collectionApiFailed: "[patreon]   · /api/collection 读取失败（{error}），改从页面解析",
    collectionCampaignFailed: "未能解析出合集 {id} 所属的 campaign id。Patreon 的合集接口缺 campaign_id 会直接 400，所以这一步是必需的。可以改用「创作者」形式抓取，或填 id:<campaign_id>。",
    collectionLog: "[patreon] ▶ 合集 {id}{title}，campaign {campaignId}",
    collectionTitle: "「{title}」",
    campaignDirect: "[patreon] ▶ 直接使用 campaign {id}",
    homePageFailed: "关注流页面未能加载完成（可能卡在 Cloudflare challenge）。请在弹出的窗口里手动完成验证后重试。",
    homeLog: "[patreon] ▶ 关注流（你订阅的全部创作者）",
    postPageFailed: "未能从帖子页解析出内容。若停在 Cloudflare challenge 请手动完成验证；若该帖需要订阅才能查看，请确认当前账号有权限。",
    postNoAccess: "[patreon] 无权查看该帖 {post}（需要订阅对应档位）",
    singlePostLog: "[patreon] ▶ 单帖 {post}",
    singlePostFinished: "[patreon] ◀ 结束：成功 {ok}，失败 {failed}",
    postEmpty: "[patreon] 该帖没有可下载的压缩包或图片。",
    stageEnded: "[patreon] 阶段={phase}，结束",
    pluginFailed: "[patreon] 插件运行失败：{error}"
  },
  en: {
    parseTargetRequired: "Enter a creator or collection",
    parseCampaignIdRequired: "id: must be followed by a campaign id",
    parseCollectionIdNumeric: "A collection id must be numeric; received “{value}”",
    parseUrlInvalid: "Could not parse the link: {value}",
    parseCollectionFromUrl: "Could not extract a collection id from “{value}”",
    parseCreatorFromUrl: "Could not extract a creator name from “{value}”",
    apiFailed: "API request failed ({status}): {url}",
    postLabel: "“{title}” ({id})",
    diagHeader: "[patreon]   ┏━ Download failure diagnostics ━━━━━━━━━━━━━━",
    diagUrl: "[patreon]   ┃ URL: {url}",
    diagPageOrigin: "[patreon]   ┃ Page origin: {origin}",
    diagTargetOrigin: "[patreon]   ┃ Target origin: {origin} ({scope})",
    sameOrigin: "same origin",
    crossOrigin: "**cross-origin**",
    diagTargetOriginFailed: "[patreon]   ┃ Target origin: (URL parse failed)",
    diagRawError: "[patreon]   ┃ Raw error: {name} / {ctor}: {message}",
    probeSameOrigin: "same-origin (actual usage)",
    probeCorsAnon: "cors without credentials",
    probeCorsCred: "cors + credentials",
    probeNoCors: "no-cors",
    none: "none",
    diagProbeResult: "[patreon]   ┃ [{label}] status={status} type={type} redirected={redirected} bodyNull={bodyNull}",
    diagFinalUrl: "[patreon]   ┃     Final URL: {url}",
    notVisible: "(not visible)",
    magicBytes: "[patreon]       Magic bytes: {hex}",
    diagHeaders: "[patreon]   ┃     content-type={ct} content-length={cl} Access-Control-Allow-Origin={acao}",
    diagProbeError: "[patreon]   ┃ [{label}] threw: {name}: {message}",
    diagFooter: "[patreon]   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    downloadStart: "[patreon]     ↓ Downloading {name}",
    attachmentUrl: "[patreon]       URL: {url}",
    attachmentAscii: "[patreon]       ASCII: {ascii}",
    attachmentHttpFailed: "[patreon] Attachment download failed ({status}): {name}",
    attachmentEmpty: "[patreon] Attachment saved 0 bytes: {name} (status={status})",
    downloadFinished: "[patreon]     ↓ {name} ({bytes} bytes, final URL: {url})",
    inspectFailed: "[patreon]       Could not read the downloaded file: {error}",
    notArchive: "[patreon]       ✗ The download is not an archive but {kind} — it was most likely redirected to a sign-in page, an error page, or a Cloudflare challenge page.",
    archiveKindDetected: "[patreon]       Detected format: {kind} (declared as {declared})",
    archiveKindUnknown: "[patreon]       Detected format: unrecognized (tar's ustar marker sits at offset 257, so this is normal)",
    unrecognized: "unrecognized",
    archiveExtracted: "[patreon]     ⇲ Extracted {count} files ({skipped} skipped, {bytes} bytes in total)",
    ingestFailed: "[patreon] Import failed: {file} ({error})",
    archiveFailed: "[patreon] Archive processing failed: {name} ({errorName}: {error})",
    failedProbe: "[patreon]       Downloaded content at failure: {kind} | {hex}",
    unsupportedArchive: "[patreon] Skipping unsupported archive format: {name}",
    postSummary: "[patreon]   → {post}: {archives} archive(s), {images} inline image(s)",
    postFinished: "[patreon]   ← {post}: {ok} succeeded, {failed} failed",
    postImageFailed: "[patreon] Inline image download failed: {url} ({error})",
    watermarkReadFailed: "[patreon] Failed to read the previous crawl record; doing a full crawl this time: {error}",
    watermarkSaved: "[patreon]   · Saved the crawl watermark for this run: {value}",
    watermarkWriteFailed: "[patreon] Failed to save the crawl record (posts will repeat next time): {error}",
    timeMinLabel: "Oldest time",
    timeMaxLabel: "Newest time",
    boundaryInvalid: "{label} “{value}” could not be parsed as a date. Use the date picker or a format like 2026-01-31.",
    timeRangeInvalid: "Time range: the oldest time ({min}) cannot be later than the newest time ({max})",
    direction: "[patreon] ▶ Direction: {direction}",
    directionAsc: "oldest to newest",
    directionDesc: "newest to oldest",
    timeWindow: "[patreon] ▶ Time window: {min}{fromWatermark} ~ {max}",
    oldestReachable: "oldest reachable",
    newestReachable: "newest reachable",
    fromWatermark: " (from the previous crawl record)",
    collectionOrderNote: "[patreon] ▶ Collections are ordered by their internal order, not by time — direction and time window settings do not apply",
    pageHeader: "[patreon]   ┌ Page {page}: {count} posts · {span}",
    noTimeInfo: "no time information",
    pastNewest: "[patreon]   · Passed the newest time (this post: {time}); stopping pagination",
    caughtWatermark: "[patreon]   · Caught up with the previous crawl (this post: {time}); stopping pagination",
    pastOldest: "[patreon]   · Passed the oldest time (this post: {time}); stopping pagination",
    skippedNoAccess: "[patreon]   · No access; skipping {post}",
    pageAllOutside: "[patreon]   └ All {skipped} posts on this page are outside the time window; still before {goal}, continuing…",
    pagePartlyOutside: "[patreon]   └ Processed {handled} posts on this page; {skipped} are outside the time window",
    goalAfter: "after {time}",
    goalBefore: "before {time}",
    goalEarliest: "the earliest post",
    goalLatest: "the latest post",
    lastPage: "[patreon]   · Reached the last page ({page} pages in total)",
    crawlFinished: "[patreon] ◀ Finished: {page} pages, {ok} succeeded, {failed} failed",
    noFilesWindowed: "[patreon] Nothing was downloaded. First check whether the time window is too narrow{watermark}; then consider that this creator has no archive attachments, the current account is not subscribed, or the extraction rule filtered out every file in the archives.",
    noFilesWatermark: " (the lower bound comes from the previous crawl record and may already be caught up)",
    noFilesGeneral: "[patreon] Nothing was downloaded. Possible reasons: this creator's posts have no archive attachments, the current account is not subscribed, or the extraction rule filtered out every file in the archives.",
    targetType: "[patreon] ▶ Target type: {label} ({value})",
    targetCreator: "creator page",
    targetCollection: "collection page",
    targetCampaign: "on-site page",
    openPage: "[patreon] ▶ Opening {url}",
    challengePassing: "[patreon]   · Passing the Cloudflare challenge…",
    campaignParseFailed: "Could not parse the campaign id. If the page is stuck on a Cloudflare challenge, complete the check manually in the window that opened; if Patreon's frontend has changed, find the campaign id in the browser and enter it as id:<campaign_id>.",
    campaignLog: "[patreon] ▶ campaign {id}",
    collectionPageFailed: "The collection page did not finish loading (it may be stuck on a Cloudflare challenge). Complete the check manually in the window that opened and try again.",
    collectionThumbMissing: "[patreon]   · No campaign id in the collection thumbnail; parsing it from the page instead",
    collectionApiFailed: "[patreon]   · Could not read /api/collection ({error}); parsing from the page instead",
    collectionCampaignFailed: "Could not parse the campaign id for collection {id}. Patreon's collection API returns 400 without a campaign_id, so this step is required. Try crawling it as a creator instead, or enter id:<campaign_id>.",
    collectionLog: "[patreon] ▶ Collection {id}{title}, campaign {campaignId}",
    collectionTitle: " “{title}”",
    campaignDirect: "[patreon] ▶ Using campaign {id} directly",
    homePageFailed: "The following-feed page did not finish loading (it may be stuck on a Cloudflare challenge). Complete the check manually in the window that opened and try again.",
    homeLog: "[patreon] ▶ Following feed (all creators you subscribe to)",
    postPageFailed: "Could not parse content from the post page. If it is stuck on a Cloudflare challenge, complete the check manually; if the post requires a subscription, make sure the current account has access.",
    postNoAccess: "[patreon] No access to post {post} (a subscription to the matching tier is required)",
    singlePostLog: "[patreon] ▶ Single post {post}",
    singlePostFinished: "[patreon] ◀ Finished: {ok} succeeded, {failed} failed",
    postEmpty: "[patreon] This post has no downloadable archives or images.",
    stageEnded: "[patreon] Phase={phase}; exiting",
    pluginFailed: "[patreon] Plugin run failed: {error}"
  },
  ja: {
    parseTargetRequired: "クリエイターまたはコレクションを入力してください",
    parseCampaignIdRequired: "id: の後ろに campaign id を指定してください",
    parseCollectionIdNumeric: "コレクション id は数字で指定してください（入力値「{value}」）",
    parseUrlInvalid: "リンクを解析できません：{value}",
    parseCollectionFromUrl: "「{value}」からコレクション id を解析できません",
    parseCreatorFromUrl: "「{value}」からクリエイター名を解析できません",
    apiFailed: "API リクエストに失敗しました({status}): {url}",
    postLabel: "「{title}」({id})",
    diagHeader: "[patreon]   ┏━ ダウンロード失敗の診断 ━━━━━━━━━━━━━━",
    diagUrl: "[patreon]   ┃ URL: {url}",
    diagPageOrigin: "[patreon]   ┃ ページの origin: {origin}",
    diagTargetOrigin: "[patreon]   ┃ 対象の origin: {origin}（{scope}）",
    sameOrigin: "同一オリジン",
    crossOrigin: "**クロスオリジン**",
    diagTargetOriginFailed: "[patreon]   ┃ 対象の origin: (URL 解析失敗)",
    diagRawError: "[patreon]   ┃ 元のエラー: {name} / {ctor}：{message}",
    probeSameOrigin: "same-origin（実際の使用法）",
    probeCorsAnon: "cors 認証情報なし",
    probeCorsCred: "cors + credentials",
    probeNoCors: "no-cors",
    none: "なし",
    diagProbeResult: "[patreon]   ┃ [{label}] status={status} type={type} redirected={redirected} bodyNull={bodyNull}",
    diagFinalUrl: "[patreon]   ┃     最終 URL: {url}",
    notVisible: "(不可視)",
    magicBytes: "[patreon]       マジックバイト: {hex}",
    diagHeaders: "[patreon]   ┃     content-type={ct} content-length={cl} Access-Control-Allow-Origin={acao}",
    diagProbeError: "[patreon]   ┃ [{label}] 例外: {name}：{message}",
    diagFooter: "[patreon]   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    downloadStart: "[patreon]     ↓ {name} のダウンロードを開始",
    attachmentUrl: "[patreon]       URL: {url}",
    attachmentAscii: "[patreon]       ASCII: {ascii}",
    attachmentHttpFailed: "[patreon] 添付ファイルのダウンロード失敗({status})：{name}",
    attachmentEmpty: "[patreon] 添付ファイルが 0 バイトで保存されました：{name}（status={status}）",
    downloadFinished: "[patreon]     ↓ {name}（{bytes} バイト、最終 URL: {url}）",
    inspectFailed: "[patreon]       保存されたファイルを読み込めません：{error}",
    notArchive: "[patreon]       ✗ ダウンロードしたのはアーカイブではなく {kind} です。ログインページ／エラーページ／Cloudflare の認証ページにリダイレクトされた可能性が高いです。",
    archiveKindDetected: "[patreon]       判定形式: {kind}（宣言は {declared}）",
    archiveKindUnknown: "[patreon]       判定形式: 不明（tar の ustar マーカーはオフセット 257 にあるため正常です）",
    unrecognized: "不明",
    archiveExtracted: "[patreon]     ⇲ {count} 個のファイルを展開（スキップ {skipped}、合計 {bytes} バイト）",
    ingestFailed: "[patreon] 取り込み失敗：{file}（{error}）",
    archiveFailed: "[patreon] アーカイブ処理に失敗しました：{name}（{errorName}：{error}）",
    failedProbe: "[patreon]       失敗時の保存内容：{kind} | {hex}",
    unsupportedArchive: "[patreon] 未対応のアーカイブ形式をスキップします：{name}",
    postSummary: "[patreon]   → {post}：アーカイブ {archives} 個、本文画像 {images} 枚",
    postFinished: "[patreon]   ← {post}：成功 {ok}、失敗 {failed}",
    postImageFailed: "[patreon] 本文画像のダウンロード失敗：{url}（{error}）",
    watermarkReadFailed: "[patreon] 前回のクロール記録を読み込めませんでした。今回は全件取得します：{error}",
    watermarkSaved: "[patreon]   · 今回のクロール水位線を記録しました：{value}",
    watermarkWriteFailed: "[patreon] クロール記録を保存できませんでした（次回同じ投稿を再度取得します）：{error}",
    timeMinLabel: "最古時間",
    timeMaxLabel: "最新時間",
    boundaryInvalid: "{label}「{value}」を日付として解析できません。日付ピッカーを使うか、2026-01-31 のような形式で入力してください。",
    timeRangeInvalid: "時間範囲：最古時間（{min}）は最新時間（{max}）より後にできません",
    direction: "[patreon] ▶ 方向：{direction}",
    directionAsc: "古い順から新しい順",
    directionDesc: "新しい順から古い順",
    timeWindow: "[patreon] ▶ 時間帯：{min}{fromWatermark} ~ {max}",
    oldestReachable: "取得できる最古",
    newestReachable: "取得できる最新",
    fromWatermark: "（前回のクロール記録から）",
    collectionOrderNote: "[patreon] ▶ コレクションはコレクション内の順序で並び、時系列ではありません。方向と時間帯の設定は反映されません",
    pageHeader: "[patreon]   ┌ {page} ページ目：投稿 {count} 件 · {span}",
    noTimeInfo: "時間情報なし",
    pastNewest: "[patreon]   · 最新時間を超えました（この投稿 {time}）。ページ送りを停止します",
    caughtWatermark: "[patreon]   · 前回の進捗に追いつきました（この投稿 {time}）。ページ送りを停止します",
    pastOldest: "[patreon]   · 最古時間を超えました（この投稿 {time}）。ページ送りを停止します",
    skippedNoAccess: "[patreon]   · 閲覧権限がないためスキップします {post}",
    pageAllOutside: "[patreon]   └ このページの {skipped} 件はすべて時間帯の外にあり、まだ {goal} に達していません。ページ送りを続けます…",
    pagePartlyOutside: "[patreon]   └ このページで {handled} 件を処理、{skipped} 件は時間帯の外です",
    goalAfter: "{time} より後",
    goalBefore: "{time} より前",
    goalEarliest: "最も古い投稿",
    goalLatest: "最も新しい投稿",
    lastPage: "[patreon]   · 最後のページまで到達しました（全 {page} ページ）",
    crawlFinished: "[patreon] ◀ 終了：{page} ページ、成功 {ok}、失敗 {failed}",
    noFilesWindowed: "[patreon] ファイルを 1 件もダウンロードできませんでした。まず時間帯が狭すぎないか確認してください{watermark}。次に、このクリエイターにアーカイブ添付がない、現在のアカウントが未購読、または抽出ルールがアーカイブ内のファイルをすべて除外した可能性があります。",
    noFilesWatermark: "（下限は前回のクロール記録によるもので、すでに追いついている可能性があります）",
    noFilesGeneral: "[patreon] ファイルを 1 件もダウンロードできませんでした。考えられる原因：このクリエイターの投稿にアーカイブ添付がない、現在のアカウントが未購読、または抽出ルールがアーカイブ内のファイルをすべて除外した。",
    targetType: "[patreon] ▶ 対象の種類：{label}（{value}）",
    targetCreator: "クリエイターページ",
    targetCollection: "コレクションページ",
    targetCampaign: "サイト内ページ",
    openPage: "[patreon] ▶ {url} を開きます",
    challengePassing: "[patreon]   · Cloudflare の認証を通過中…",
    campaignParseFailed: "campaign id を解析できませんでした。ページが Cloudflare の認証で止まっている場合は、開いたウィンドウで手動で認証を完了してください。Patreon のフロントエンドが改版されている場合は、ブラウザで campaign id を確認して id:<campaign_id> の形式で入力してください。",
    campaignLog: "[patreon] ▶ campaign {id}",
    collectionPageFailed: "コレクションページが読み込み完了しませんでした（Cloudflare の認証で止まっている可能性があります）。開いたウィンドウで手動で認証を完了してから再試行してください。",
    collectionThumbMissing: "[patreon]   · コレクションのサムネイルに campaign id がないため、ページから解析します",
    collectionApiFailed: "[patreon]   · /api/collection の読み込みに失敗しました（{error}）。ページから解析します",
    collectionCampaignFailed: "コレクション {id} の campaign id を解析できませんでした。Patreon のコレクション API は campaign_id がないと 400 を返すため、この手順は必須です。「クリエイター」形式で取得するか、id:<campaign_id> を入力してください。",
    collectionLog: "[patreon] ▶ コレクション {id}{title}、campaign {campaignId}",
    collectionTitle: "「{title}」",
    campaignDirect: "[patreon] ▶ campaign {id} を直接使用",
    homePageFailed: "フォロー中フィードのページが読み込み完了しませんでした（Cloudflare の認証で止まっている可能性があります）。開いたウィンドウで手動で認証を完了してから再試行してください。",
    homeLog: "[patreon] ▶ フォロー中フィード（購読中のすべてのクリエイター）",
    postPageFailed: "投稿ページから内容を解析できませんでした。Cloudflare の認証で止まっている場合は手動で完了してください。購読が必要な投稿の場合は、現在のアカウントに権限があるか確認してください。",
    postNoAccess: "[patreon] この投稿を閲覧できません {post}（対応するプランの購読が必要です）",
    singlePostLog: "[patreon] ▶ 単一投稿 {post}",
    singlePostFinished: "[patreon] ◀ 終了：成功 {ok}、失敗 {failed}",
    postEmpty: "[patreon] この投稿にはダウンロードできるアーカイブや画像がありません。",
    stageEnded: "[patreon] フェーズ={phase} のため終了します",
    pluginFailed: "[patreon] プラグインの実行に失敗しました：{error}"
  },
  ko: {
    parseTargetRequired: "크리에이터 또는 컬렉션을 입력해 주세요",
    parseCampaignIdRequired: "id: 뒤에 campaign id를 입력해 주세요",
    parseCollectionIdNumeric: "컬렉션 id는 숫자여야 합니다. 입력값 “{value}”",
    parseUrlInvalid: "링크를 해석할 수 없습니다: {value}",
    parseCollectionFromUrl: "“{value}”에서 컬렉션 id를 추출할 수 없습니다",
    parseCreatorFromUrl: "“{value}”에서 크리에이터 이름을 추출할 수 없습니다",
    apiFailed: "API 요청 실패({status}): {url}",
    postLabel: "“{title}” ({id})",
    diagHeader: "[patreon]   ┏━ 다운로드 실패 진단 ━━━━━━━━━━━━━━",
    diagUrl: "[patreon]   ┃ URL: {url}",
    diagPageOrigin: "[patreon]   ┃ 페이지 origin: {origin}",
    diagTargetOrigin: "[patreon]   ┃ 대상 origin: {origin} ({scope})",
    sameOrigin: "동일 출처",
    crossOrigin: "**교차 출처**",
    diagTargetOriginFailed: "[patreon]   ┃ 대상 origin: (URL 해석 실패)",
    diagRawError: "[patreon]   ┃ 원래 오류: {name} / {ctor}: {message}",
    probeSameOrigin: "same-origin(실제 사용)",
    probeCorsAnon: "cors 자격 증명 없음",
    probeCorsCred: "cors + credentials",
    probeNoCors: "no-cors",
    none: "없음",
    diagProbeResult: "[patreon]   ┃ [{label}] status={status} type={type} redirected={redirected} bodyNull={bodyNull}",
    diagFinalUrl: "[patreon]   ┃     최종 URL: {url}",
    notVisible: "(표시되지 않음)",
    magicBytes: "[patreon]       매직 바이트: {hex}",
    diagHeaders: "[patreon]   ┃     content-type={ct} content-length={cl} Access-Control-Allow-Origin={acao}",
    diagProbeError: "[patreon]   ┃ [{label}] 예외: {name}: {message}",
    diagFooter: "[patreon]   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    downloadStart: "[patreon]     ↓ {name} 다운로드 시작",
    attachmentUrl: "[patreon]       URL: {url}",
    attachmentAscii: "[patreon]       ASCII: {ascii}",
    attachmentHttpFailed: "[patreon] 첨부 파일 다운로드 실패({status}): {name}",
    attachmentEmpty: "[patreon] 첨부 파일이 0바이트로 저장되었습니다: {name}(status={status})",
    downloadFinished: "[patreon]     ↓ {name}({bytes}바이트, 최종 URL: {url})",
    inspectFailed: "[patreon]       저장된 파일을 읽을 수 없습니다: {error}",
    notArchive: "[patreon]       ✗ 받은 파일이 아카이브가 아니라 {kind}입니다. 로그인 페이지 / 오류 페이지 / Cloudflare 인증 페이지로 리디렉션되었을 가능성이 큽니다.",
    archiveKindDetected: "[patreon]       판정 형식: {kind}(선언: {declared})",
    archiveKindUnknown: "[patreon]       판정 형식: 미확인(tar의 ustar 마커는 오프셋 257에 있어 정상입니다)",
    unrecognized: "미확인",
    archiveExtracted: "[patreon]     ⇲ 파일 {count}개 추출(건너뜀 {skipped}, 총 {bytes}바이트)",
    ingestFailed: "[patreon] 가져오기 실패: {file}({error})",
    archiveFailed: "[patreon] 아카이브 처리 실패: {name}({errorName}: {error})",
    failedProbe: "[patreon]       실패 시 저장된 내용: {kind} | {hex}",
    unsupportedArchive: "[patreon] 지원하지 않는 아카이브 형식을 건너뜁니다: {name}",
    postSummary: "[patreon]   → {post}: 아카이브 {archives}개, 본문 이미지 {images}장",
    postFinished: "[patreon]   ← {post}: 성공 {ok}, 실패 {failed}",
    postImageFailed: "[patreon] 본문 이미지 다운로드 실패: {url}({error})",
    watermarkReadFailed: "[patreon] 이전 크롤 기록을 읽지 못했습니다. 이번에는 전체를 수집합니다: {error}",
    watermarkSaved: "[patreon]   · 이번 크롤 워터마크 기록: {value}",
    watermarkWriteFailed: "[patreon] 크롤 기록을 저장하지 못했습니다(다음에 같은 게시물을 다시 수집합니다): {error}",
    timeMinLabel: "가장 오래된 시간",
    timeMaxLabel: "최신 시간",
    boundaryInvalid: "{label} “{value}”을(를) 날짜로 해석할 수 없습니다. 날짜 선택기를 사용하거나 2026-01-31 같은 형식으로 입력해 주세요.",
    timeRangeInvalid: "시간 범위: 가장 오래된 시간({min})은 최신 시간({max})보다 늦을 수 없습니다",
    direction: "[patreon] ▶ 방향: {direction}",
    directionAsc: "오래된 것부터",
    directionDesc: "최신 것부터",
    timeWindow: "[patreon] ▶ 시간 범위: {min}{fromWatermark} ~ {max}",
    oldestReachable: "수집 가능한 가장 오래된 시점",
    newestReachable: "수집 가능한 가장 최신 시점",
    fromWatermark: "(이전 크롤 기록 기준)",
    collectionOrderNote: "[patreon] ▶ 컬렉션은 컬렉션 내부 순서로 정렬되며 시간순이 아닙니다. 방향과 시간 범위 설정은 적용되지 않습니다",
    pageHeader: "[patreon]   ┌ {page}페이지: 게시물 {count}개 · {span}",
    noTimeInfo: "시간 정보 없음",
    pastNewest: "[patreon]   · 최신 시간을 지났습니다(이 게시물 {time}). 페이지 넘김을 중지합니다",
    caughtWatermark: "[patreon]   · 이전 진행 지점에 도달했습니다(이 게시물 {time}). 페이지 넘김을 중지합니다",
    pastOldest: "[patreon]   · 가장 오래된 시간을 지났습니다(이 게시물 {time}). 페이지 넘김을 중지합니다",
    skippedNoAccess: "[patreon]   · 열람 권한이 없어 건너뜁니다 {post}",
    pageAllOutside: "[patreon]   └ 이 페이지의 {skipped}개가 모두 시간 범위 밖이며 아직 {goal}에 도달하지 않았습니다. 계속 넘깁니다…",
    pagePartlyOutside: "[patreon]   └ 이 페이지에서 {handled}개 처리, {skipped}개는 시간 범위 밖",
    goalAfter: "{time} 이후",
    goalBefore: "{time} 이전",
    goalEarliest: "가장 오래된 게시물",
    goalLatest: "가장 최신 게시물",
    lastPage: "[patreon]   · 마지막 페이지까지 왔습니다(총 {page}페이지)",
    crawlFinished: "[patreon] ◀ 종료: {page}페이지, 성공 {ok}, 실패 {failed}",
    noFilesWindowed: "[patreon] 파일을 하나도 다운로드하지 못했습니다. 먼저 시간 범위가 너무 좁지 않은지 확인하세요{watermark}. 그다음으로 이 크리에이터의 게시물에 아카이브 첨부가 없는지, 현재 계정이 구독하지 않았는지, 추출 규칙이 아카이브 내 파일을 모두 걸러냈는지 확인하세요.",
    noFilesWatermark: "(하한은 이전 크롤 기록에서 왔으며 이미 따라잡았을 수 있습니다)",
    noFilesGeneral: "[patreon] 파일을 하나도 다운로드하지 못했습니다. 가능한 원인: 이 크리에이터의 게시물에 아카이브 첨부가 없음, 현재 계정 미구독, 또는 추출 규칙이 아카이브 내 파일을 모두 걸러냄.",
    targetType: "[patreon] ▶ 대상 유형: {label}({value})",
    targetCreator: "크리에이터 페이지",
    targetCollection: "컬렉션 페이지",
    targetCampaign: "사이트 내 페이지",
    openPage: "[patreon] ▶ {url} 열기",
    challengePassing: "[patreon]   · Cloudflare 인증을 통과하는 중…",
    campaignParseFailed: "campaign id를 해석하지 못했습니다. 페이지가 Cloudflare 인증에서 멈춰 있다면 열린 창에서 직접 인증을 완료해 주세요. Patreon 프런트엔드가 개편되었다면 브라우저에서 campaign id를 찾아 id:<campaign_id> 형식으로 입력하세요.",
    campaignLog: "[patreon] ▶ campaign {id}",
    collectionPageFailed: "컬렉션 페이지가 로드를 완료하지 못했습니다(Cloudflare 인증에서 멈췄을 수 있습니다). 열린 창에서 직접 인증을 완료한 뒤 다시 시도해 주세요.",
    collectionThumbMissing: "[patreon]   · 컬렉션 썸네일에 campaign id가 없어 페이지에서 파싱합니다",
    collectionApiFailed: "[patreon]   · /api/collection 읽기 실패({error}), 페이지에서 파싱합니다",
    collectionCampaignFailed: "컬렉션 {id}의 campaign id를 해석하지 못했습니다. Patreon의 컬렉션 API는 campaign_id가 없으면 400을 반환하므로 이 단계가 필요합니다. “크리에이터” 형식으로 수집하거나 id:<campaign_id>를 입력하세요.",
    collectionLog: "[patreon] ▶ 컬렉션 {id}{title}, campaign {campaignId}",
    collectionTitle: " “{title}”",
    campaignDirect: "[patreon] ▶ campaign {id} 직접 사용",
    homePageFailed: "팔로잉 피드 페이지가 로드를 완료하지 못했습니다(Cloudflare 인증에서 멈췄을 수 있습니다). 열린 창에서 직접 인증을 완료한 뒤 다시 시도해 주세요.",
    homeLog: "[patreon] ▶ 팔로잉 피드(구독 중인 모든 크리에이터)",
    postPageFailed: "게시물 페이지에서 내용을 해석하지 못했습니다. Cloudflare 인증에서 멈췄다면 직접 완료해 주세요. 구독이 필요한 게시물이라면 현재 계정에 권한이 있는지 확인하세요.",
    postNoAccess: "[patreon] 이 게시물을 볼 권한이 없습니다 {post}(해당 등급 구독 필요)",
    singlePostLog: "[patreon] ▶ 단일 게시물 {post}",
    singlePostFinished: "[patreon] ◀ 종료: 성공 {ok}, 실패 {failed}",
    postEmpty: "[patreon] 이 게시물에는 다운로드할 아카이브나 이미지가 없습니다.",
    stageEnded: "[patreon] 단계={phase}, 종료합니다",
    pluginFailed: "[patreon] 플러그인 실행 실패: {error}"
  },
  zhtw: {
    parseTargetRequired: "請填寫創作者或合集",
    parseCampaignIdRequired: "id: 後面要接 campaign id",
    parseCollectionIdNumeric: "合集 id 必須是數字，收到「{value}」",
    parseUrlInvalid: "無法解析連結：{value}",
    parseCollectionFromUrl: "無法從「{value}」解析出合集 id",
    parseCreatorFromUrl: "無法從「{value}」解析出創作者名稱",
    apiFailed: "介面請求失敗({status}): {url}",
    postLabel: "「{title}」({id})",
    diagHeader: "[patreon]   ┏━ 下載失敗診斷 ━━━━━━━━━━━━━━",
    diagUrl: "[patreon]   ┃ URL: {url}",
    diagPageOrigin: "[patreon]   ┃ 頁面 origin: {origin}",
    diagTargetOrigin: "[patreon]   ┃ 目標 origin: {origin}（{scope}）",
    sameOrigin: "同源",
    crossOrigin: "**跨源**",
    diagTargetOriginFailed: "[patreon]   ┃ 目標 origin: (URL 解析失敗)",
    diagRawError: "[patreon]   ┃ 原始錯誤: {name} / {ctor}：{message}",
    probeSameOrigin: "same-origin(實際用法)",
    probeCorsAnon: "cors 無憑證",
    probeCorsCred: "cors + credentials",
    probeNoCors: "no-cors",
    none: "無",
    diagProbeResult: "[patreon]   ┃ [{label}] status={status} type={type} redirected={redirected} bodyNull={bodyNull}",
    diagFinalUrl: "[patreon]   ┃     最終 URL: {url}",
    notVisible: "(不可見)",
    magicBytes: "[patreon]       魔數: {hex}",
    diagHeaders: "[patreon]   ┃     content-type={ct} content-length={cl} Access-Control-Allow-Origin={acao}",
    diagProbeError: "[patreon]   ┃ [{label}] 拋錯: {name}：{message}",
    diagFooter: "[patreon]   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    downloadStart: "[patreon]     ↓ 開始下載 {name}",
    attachmentUrl: "[patreon]       URL: {url}",
    attachmentAscii: "[patreon]       ASCII: {ascii}",
    attachmentHttpFailed: "[patreon] 附件下載失敗({status})：{name}",
    attachmentEmpty: "[patreon] 附件落地 0 位元組：{name}（status={status}）",
    downloadFinished: "[patreon]     ↓ {name}（{bytes} 位元組，最終 URL: {url}）",
    inspectFailed: "[patreon]       落地檔案無法讀取：{error}",
    notArchive: "[patreon]       ✗ 下載到的不是封存檔而是 {kind}——多半是被重新導向到登入頁 / 錯誤頁 / Cloudflare 驗證頁。",
    archiveKindDetected: "[patreon]       判定格式: {kind}（宣告為 {declared}）",
    archiveKindUnknown: "[patreon]       判定格式: 未識別（tar 的 ustar 標記在偏移 257，屬正常）",
    unrecognized: "未識別",
    archiveExtracted: "[patreon]     ⇲ 解出 {count} 個檔案（跳過 {skipped}，共 {bytes} 位元組）",
    ingestFailed: "[patreon] 入庫失敗：{file}（{error}）",
    archiveFailed: "[patreon] 封存檔處理失敗：{name}（{errorName}：{error}）",
    failedProbe: "[patreon]       失敗時落地內容：{kind} | {hex}",
    unsupportedArchive: "[patreon] 跳過不支援的封存格式：{name}",
    postSummary: "[patreon]   → {post}：{archives} 個壓縮檔，{images} 張正文圖",
    postFinished: "[patreon]   ← {post}：成功 {ok}，失敗 {failed}",
    postImageFailed: "[patreon] 正文圖下載失敗：{url}（{error}）",
    watermarkReadFailed: "[patreon] 讀取上次爬取紀錄失敗，本次按全量處理：{error}",
    watermarkSaved: "[patreon]   · 已記錄本次爬取水位線：{value}",
    watermarkWriteFailed: "[patreon] 寫入爬取紀錄失敗（下次會重複抓取）：{error}",
    timeMinLabel: "最舊時間",
    timeMaxLabel: "最新時間",
    boundaryInvalid: "{label}「{value}」無法解析為日期。請用日期選擇器，或填形如 2026-01-31 的格式。",
    timeRangeInvalid: "時間範圍：最舊時間（{min}）不能晚於最新時間（{max}）",
    direction: "[patreon] ▶ 方向：{direction}",
    directionAsc: "從舊到新",
    directionDesc: "從新到舊",
    timeWindow: "[patreon] ▶ 時間窗：{min}{fromWatermark} ~ {max}",
    oldestReachable: "能抓得到的最舊",
    newestReachable: "能抓得到的最新",
    fromWatermark: "（來自上次爬取紀錄）",
    collectionOrderNote: "[patreon] ▶ 合集按合集內順序排列，不按時間——方向與時間窗設定對它不生效",
    pageHeader: "[patreon]   ┌ 第 {page} 頁：{count} 個貼文 · {span}",
    noTimeInfo: "無時間資訊",
    pastNewest: "[patreon]   · 已越過最新時間（本篇 {time}），停止翻頁",
    caughtWatermark: "[patreon]   · 已追上上次進度（本篇 {time}），停止翻頁",
    pastOldest: "[patreon]   · 已越過最舊時間（本篇 {time}），停止翻頁",
    skippedNoAccess: "[patreon]   · 無權查看，跳過 {post}",
    pageAllOutside: "[patreon]   └ 本頁 {skipped} 篇都在時間窗外，尚未到達 {goal}，繼續翻頁…",
    pagePartlyOutside: "[patreon]   └ 本頁處理 {handled} 篇，{skipped} 篇在時間窗外",
    goalAfter: "{time} 之後",
    goalBefore: "{time} 之前",
    goalEarliest: "最早的貼文",
    goalLatest: "最新的貼文",
    lastPage: "[patreon]   · 已翻到最後一頁（共 {page} 頁）",
    crawlFinished: "[patreon] ◀ 結束：共翻 {page} 頁，成功 {ok}，失敗 {failed}",
    noFilesWindowed: "[patreon] 沒有下載到任何檔案。先確認時間窗是否設得太窄{watermark}；其次才是該創作者沒有壓縮檔附件、目前帳號未訂閱、或擷取規則把壓縮檔內檔案全濾掉了。",
    noFilesWatermark: "（下界來自上次爬取紀錄，可能已經追平）",
    noFilesGeneral: "[patreon] 沒有下載到任何檔案。可能原因：該創作者的貼文沒有壓縮檔附件、目前帳號未訂閱、或擷取規則把壓縮檔內檔案全濾掉了。",
    targetType: "[patreon] ▶ 目標類型：{label}（{value}）",
    targetCreator: "創作者主頁",
    targetCollection: "合集頁",
    targetCampaign: "站內頁",
    openPage: "[patreon] ▶ 開啟 {url}",
    challengePassing: "[patreon]   · 正在通過 Cloudflare 驗證…",
    campaignParseFailed: "未能解析出 campaign id。若頁面停在 Cloudflare challenge，請在彈出的視窗裡手動完成驗證；若 Patreon 前端已改版，可在瀏覽器裡找到 campaign id 後填成 id:<campaign_id>。",
    campaignLog: "[patreon] ▶ campaign {id}",
    collectionPageFailed: "合集頁未能載入完成（可能卡在 Cloudflare challenge）。請在彈出的視窗裡手動完成驗證後重試。",
    collectionThumbMissing: "[patreon]   · 合集縮圖裡沒有 campaign id，改從頁面解析",
    collectionApiFailed: "[patreon]   · /api/collection 讀取失敗（{error}），改從頁面解析",
    collectionCampaignFailed: "未能解析出合集 {id} 所屬的 campaign id。Patreon 的合集介面缺 campaign_id 會直接 400，所以這一步是必需的。可以改用「創作者」形式抓取，或填 id:<campaign_id>。",
    collectionLog: "[patreon] ▶ 合集 {id}{title}，campaign {campaignId}",
    collectionTitle: "「{title}」",
    campaignDirect: "[patreon] ▶ 直接使用 campaign {id}",
    homePageFailed: "關注流頁面未能載入完成（可能卡在 Cloudflare challenge）。請在彈出的視窗裡手動完成驗證後重試。",
    homeLog: "[patreon] ▶ 關注流（你訂閱的全部創作者）",
    postPageFailed: "未能從貼文頁解析出內容。若停在 Cloudflare challenge 請手動完成驗證；若該貼文需要訂閱才能查看，請確認目前帳號有權限。",
    postNoAccess: "[patreon] 無權查看該貼文 {post}（需要訂閱對應等級）",
    singlePostLog: "[patreon] ▶ 單篇貼文 {post}",
    singlePostFinished: "[patreon] ◀ 結束：成功 {ok}，失敗 {failed}",
    postEmpty: "[patreon] 該貼文沒有可下載的壓縮檔或圖片。",
    stageEnded: "[patreon] 階段={phase}，結束",
    pluginFailed: "[patreon] 外掛執行失敗：{error}"
  }
};

const LANG = Kabegame.getLang?.() ?? "zh";
const t = (key, params = {}) => {
  const table = MESSAGES[LANG] || MESSAGES.zh;
  const tpl = table[key] ?? MESSAGES.zh[key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (m, name) =>
    params[name] != null ? String(params[name]) : m
  );
};

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
  if (!value) throw new Error(t("parseTargetRequired"));

  if (value.startsWith("id:")) {
    const id = value.slice(3).trim();
    if (!id) throw new Error(t("parseCampaignIdRequired"));
    // 没有具体页面可去，落到创作者根域即可，只为拿到同源上下文。
    return { kind: "campaign", value: id, pageUrl: `${BASE_URL}/home` };
  }

  if (value.startsWith("collection:")) {
    const id = value.slice("collection:".length).trim();
    if (!/^\d+$/.test(id)) throw new Error(t("parseCollectionIdNumeric", { value: id }));
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
      throw new Error(t("parseUrlInvalid", { value }));
    }
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

    if (parts[0] === "collection") {
      const id = coerceStr(parts[1]);
      if (!/^\d+$/.test(id)) throw new Error(t("parseCollectionFromUrl", { value }));
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
    if (!name) throw new Error(t("parseCreatorFromUrl", { value }));
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
    throw new Error(t("apiFailed", { status: response.status, url: url.slice(0, 120) }));
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
  return t("postLabel", {
    title: coerceStr(post?.title) || coerceStr(post?.id),
    id: coerceStr(post?.id),
  });
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
  await warn(t("diagHeader"));
  await warn(t("diagUrl", { url }));
  await warn(t("diagPageOrigin", { origin: location.origin }));
  try {
    const target = new URL(url, location.href);
    await warn(t("diagTargetOrigin", {
      origin: target.origin,
      scope: target.origin === location.origin ? t("sameOrigin") : t("crossOrigin"),
    }));
  } catch {
    await warn(t("diagTargetOriginFailed"));
  }
  await warn(t("diagRawError", {
    name: error?.name || "?",
    ctor: error?.constructor?.name || "?",
    message: error?.message || String(error),
  }));

  // 探针顺序即排查顺序：先试实际用的 same-origin，再用 omit / include 的差异
  // 判断是不是"通配 ACAO 撞上 credentials"这一类（omit 成而 include 败即是）。
  const probes = [
    { label: t("probeSameOrigin"), init: { mode: "cors", credentials: "same-origin" } },
    { label: t("probeCorsAnon"), init: { mode: "cors", credentials: "omit" } },
    { label: t("probeCorsCred"), init: { mode: "cors", credentials: "include" } },
    { label: t("probeNoCors"), init: { mode: "no-cors" } },
  ];
  for (const probe of probes) {
    try {
      const response = await fetch(url, probe.init);
      const ct = response.headers.get("content-type") || "-";
      const cl = response.headers.get("content-length") || "-";
      const acao = response.headers.get("access-control-allow-origin") || t("none");
      await warn(t("diagProbeResult", {
        label: probe.label,
        status: response.status,
        type: response.type,
        redirected: response.redirected,
        bodyNull: response.body === null,
      }));
      await warn(t("diagFinalUrl", { url: response.url || t("notVisible") }));
      await warn(t("diagHeaders", { ct, cl, acao }));
    } catch (probeError) {
      await warn(t("diagProbeError", {
        label: probe.label,
        name: probeError?.name || "?",
        message: probeError?.message || String(probeError),
      }));
    }
  }
  await warn(t("diagFooter"));
}

// 归档魔数表。落盘内容不是真归档时（最常见的是被写进了一张 HTML 错误页 /
// Cloudflare 挑战页 / 登录跳转），解压会报一个和真因无关的错，这里提前点破。
const MAGIC_SIGNATURES = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: "zip" },
  { bytes: [0x50, 0x4b, 0x05, 0x06], label: "zip (empty)" },
  { bytes: [0x50, 0x4b, 0x07, 0x08], label: "zip (spanned)" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], label: "7z" },
  { bytes: [0x1f, 0x8b], label: "gzip" },
  { bytes: [0x42, 0x5a, 0x68], label: "bzip2" },
  { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a], label: "xz" },
  { bytes: [0x52, 0x61, 0x72, 0x21], label: "rar (unsupported)" },
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
    await log(t("downloadStart", { name: attachment.name }));
    await log(t("attachmentUrl", { url: attachment.url }));

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
      await warn(t("attachmentHttpFailed", { status: head.status, name: attachment.name }));
      await diagnoseFetchFailure(
        attachment.url,
        new Error(`HTTP ${head.status} ${head.statusText}`),
      );
      return { ok: 0, failed: 1 };
    }

    // 落盘 0 字节说明 body 是空的或不可读（比如 opaque 响应），不是正常成功。
    if (!head.bytesWritten) {
      await warn(t("attachmentEmpty", { name: attachment.name, status: head.status }));
      await diagnoseFetchFailure(
        attachment.url,
        new Error(`bytesWritten=0, status=${head.status}`),
      );
      return { ok: 0, failed: 1 };
    }
    await log(t("downloadFinished", { name: attachment.name, bytes: head.bytesWritten, url: head.url }));

    // 落盘内容自检：确认拿到的确实是归档，而不是一张 HTML 错误页。
    const probe = await inspectDownloadedFile(archivePath);
    if (probe.error) {
      await warn(t("inspectFailed", { error: probe.error }));
    } else {
      await log(t("magicBytes", { hex: probe.hex }));
      await log(t("attachmentAscii", { ascii: probe.ascii }));
      if (probe.kind === "HTML(!!)" || probe.kind === "JSON(!!)") {
        await warn(t("notArchive", { kind: probe.kind }));
      } else if (probe.kind) {
        await log(t("archiveKindDetected", { kind: probe.kind, declared: kind }));
      } else {
        await log(t("archiveKindUnknown"));
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
      t("archiveExtracted", {
        count: result.entries.length,
        skipped: result.skipped,
        bytes: result.totalBytes,
      }),
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
        await warn(t("ingestFailed", { file: leaf, error: errorMessage(error) }));
      }
    }
  } catch (error) {
    failed += 1;
    await warn(t("archiveFailed", {
      name: attachment.name,
      errorName: error?.name || "Error",
      error: errorMessage(error),
    }));
    // 解压阶段炸的话，落盘文件还在，把它的实际内容打出来定位真因。
    const probe = await inspectDownloadedFile(archivePath);
    if (!probe.error) {
      await warn(t("failedProbe", { kind: probe.kind || t("unrecognized"), hex: probe.hex }));
      await warn(t("attachmentAscii", { ascii: probe.ascii }));
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
      await warn(t("unsupportedArchive", { name: attachment.name }));
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

  await log(t("postSummary", { post: postLabel(post), archives: archives.length, images: images.length }));

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
      await warn(t("postImageFailed", { url: image.url, error: errorMessage(error) }));
    }
    await ctx.progress?.tick();
  }
  await log(t("postFinished", { post: postLabel(post), ok, failed }));
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
    throw new Error(t("boundaryInvalid", { label, value: raw }));
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
    await warn(t("watermarkReadFailed", { error: errorMessage(error) }));
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
    await log(t("watermarkSaved", { value }));
  } catch (error) {
    await warn(t("watermarkWriteFailed", { error: errorMessage(error) }));
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
  const maxBound = timeAware ? parseBoundary(vars.time_max, t("timeMaxLabel"), true) : null;
  let minBound = timeAware ? parseBoundary(vars.time_min, t("timeMinLabel"), false) : null;
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
    throw new Error(t("timeRangeInvalid", { min: minBound.text, max: maxBound.text }));
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
    await log(t("direction", { direction: ascending ? t("directionAsc") : t("directionDesc") }));
    await log(
      t("timeWindow", {
        min: minBound ? fmtTime(minBound.ms) : t("oldestReachable"),
        fromWatermark: minFromWatermark ? t("fromWatermark") : "",
        max: maxBound ? fmtTime(maxBound.ms) : t("newestReachable"),
      }),
    );
  } else {
    await log(t("collectionOrderNote"));
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
        : t("noTimeInfo");
      await log(t("pageHeader", { page, count: rows.length, span: pageSpan }));
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
              await log(t("pastNewest", { time: fmtTime(ms) }));
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
                t(minFromWatermark ? "caughtWatermark" : "pastOldest", { time: fmtTime(ms) }),
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
          await log(t("skippedNoAccess", { post: postLabel(post) }));
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
            ? t("goalAfter", { time: fmtTime(minBound.ms) })
            : t("goalEarliest")
          : maxBound
            ? t("goalBefore", { time: fmtTime(maxBound.ms) })
            : t("goalLatest");
        await log(t("pageAllOutside", { skipped: pageSkipped, goal }));
      } else if (pageSkipped > 0) {
        await log(t("pagePartlyOutside", { handled: pageHandled, skipped: pageSkipped }));
      }
    }

    url = coerceStr(payload?.links?.next);
    if (!url) {
      await log(t("lastPage", { page }));
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

  await log(t("crawlFinished", { page, ok: totalOk, failed: totalFailed }));
  if (totalOk === 0 && totalFailed === 0) {
    // 时间窗设得太窄是最常见的"什么都没下到"，单独点出来，
    // 免得用户去查附件规则或订阅状态那些不相干的方向。
    const windowed = minBound || maxBound;
    await warn(
      windowed
        ? t("noFilesWindowed", {
            watermark: minFromWatermark ? t("noFilesWatermark") : "",
          })
        : t("noFilesGeneral"),
    );
  }
}

async function handleInitial() {
  const target = parseTarget(Kabegame.vars?.creator);
  const labels = { creator: t("targetCreator"), collection: t("targetCollection"), campaign: t("targetCampaign") };
  await log(t("targetType", { label: labels[target.kind], value: target.value }));
  // 必须先导航到 patreon.com 上：只有真浏览器能过 Cloudflare 挑战，
  // 而后续的同源 fetch 也要有这个页面上下文才不被拦。
  await log(t("openPage", { url: target.pageUrl }));
  await Kabegame.to(target.pageUrl, { pageLabel: target.kind });
}

// 等页面过掉 Cloudflare 挑战。返回是否成功。
async function waitPastChallenge(readyCheck) {
  await Kabegame.waitForDom();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await readyCheck()) return true;
    if (/just a moment|checking your browser/i.test(document.title || "")) {
      if (attempt === 0) {
        await log(t("challengePassing"));
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
    throw new Error(t("campaignParseFailed"));
  }

  await log(t("campaignLog", { id: campaignId }));
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
    throw new Error(t("collectionPageFailed"));
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
      await log(t("collectionThumbMissing"));
    }
  } catch (error) {
    await log(t("collectionApiFailed", { error: errorMessage(error) }));
  }

  // 回退：合集页本身也带 __NEXT_DATA__，里面同样有 campaign。
  if (!campaignId) campaignId = extractCampaignIdFromPage();

  if (!campaignId) {
    throw new Error(t("collectionCampaignFailed", { id: collectionId }));
  }

  await log(t("collectionLog", { id: collectionId, title: title ? t("collectionTitle", { title }) : "", campaignId }));
  await crawlFromCreatorPage(campaignId, collectionId, { kind: "collection" });
}

async function handleCampaignDirect() {
  const campaignId = parseTarget(Kabegame.vars?.creator).value;
  await log(t("campaignDirect", { id: campaignId }));
  await crawlFromCreatorPage(campaignId, "", { kind: "creator" });
}

// 关注流不需要 campaign id，直接打 /api/stream。
async function handleHomePage() {
  const ok = await waitPastChallenge(async () => {
    if (/just a moment|checking your browser/i.test(document.title || "")) return false;
    return document.readyState === "complete";
  });
  if (!ok) {
    throw new Error(t("homePageFailed"));
  }
  await log(t("homeLog"));
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
    throw new Error(t("postPageFailed"));
  }

  if (post.current_user_can_view === false) {
    await warn(t("postNoAccess", { post: postLabel(post) }));
    return;
  }

  const root = await Kabegame.fs.getRoot();
  await Kabegame.fs.mkdir(`${root}/tmp`, { recursive: true });
  const progress = makeProgress(1);
  progress.beginPage(1);

  await log(t("singlePostLog", { post: postLabel(post) }));
  const ctx = {
    root,
    vars: Kabegame.vars || {},
    creator: coerceStr(Kabegame.vars?.creator),
    seq: 1,
    progress,
  };
  const stat = await downloadPost(post, ctx);
  await log(t("singlePostFinished", { ok: stat.ok, failed: stat.failed }));
  if (stat.ok === 0 && stat.failed === 0) {
    await warn(t("postEmpty"));
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
