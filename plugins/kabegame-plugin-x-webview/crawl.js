// X（Twitter）媒体 WebView 爬虫：画师主页「媒体」、搜索、单条推文、书签、点赞五种模式。
//
// 架构：不自己调 GraphQL。X 的请求要带 x-client-transaction-id 签名、queryId 也会轮换，
// 这些都交给页面自己的 JS；插件只在 document-start 同步 hook XMLHttpRequest，
// 截获页面滚动时发出的时间线响应（思路同 prinsss/twitter-web-exporter），解析推文后下载。
//
// 实测（2026-10）：画师主页的「メディア / Media」标签带「照片 / 视频」下拉：
//   x.com/<user>/media?filter=photo → GraphQL UserPhotoTimeline
//     首屏 TimelineAddEntries(profile-photo-grid-0[N])，后续页 TimelineAddToModule(+N)
//   x.com/<user>/media?filter=video → GraphQL UserVideoTimeline，普通 tweet-* 条目
// 旧的 UserMedia 已退役。一页 20 条，滚到底才加载下一页；返回 0 条推文即到底。
// 原图 pbs.twimg.com/media/<id>?format=<ext>&name=orig 无需 Cookie/Referer。
// 搜索：x.com/search?q=…&f=live（最新）→ SearchTimeline product=Latest，普通 tweet-* 条目，严格按时间倒序；
//   &f=media（媒体标签）→ product=Media，search-grid-0 网格（首屏模块 + 后续 TimelineAddToModule），按热度排、
//   顺序不单调，所以只有「最新」能用水位线和最旧时间提前停。两者翻到底都返回 0 条推文 + TimelineTerminateTimeline。
// 书签：x.com/i/bookmarks → Bookmarks（data.bookmark_timeline_v2）；点赞：x.com/<自己>/likes → Likes（只能看自己的）。
//   两者按收藏 / 点赞时间排序而不是推文 id，增量改为记住上次最前面几条的 id、遇到即停；会混入无图推文，收集时跳过。
// 单条推文：x.com/i/web/status/<id> → TweetDetail，焦点推文与回复一次取到。
// 回复只在推文详情页（GraphQL TweetDetail）里有：先在时间线页收集完推文，再用 SPA 路由
// （pushState + popstate，文档不重载、在途下载不丢）逐条打开详情页截获回复，最后下载。

// ── document-start 同步安装 hook（必须在任何 await 之前，早于页面自己的请求）──
const TIMELINE_OPS = {
  photo: "UserPhotoTimeline",
  video: "UserVideoTimeline",
};
const SEARCH_OP = "SearchTimeline";
const BOOKMARKS_OP = "Bookmarks";
const LIKES_OP = "Likes";
const responses = []; // { name, status, text, url }
let notifyResponse = null;

const xhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (_method, url) {
  const name = String(url).match(/\/graphql\/[^/]+\/([A-Za-z]+)/)?.[1];
  if (name) {
    this.addEventListener("load", () => {
      try {
        const text = this.responseType === "" || this.responseType === "text" ? this.responseText : "";
        responses.push({ name, status: this.status, text, url: String(url) });
        notifyResponse?.();
      } catch {}
    });
  }
  return xhrOpen.apply(this, arguments);
};

// ── 通用工具 ───────────────────────────────────────────────────────────

const PLUGIN_ID = "x-webview";
const log = (m) => Kabegame.log(m);
const warn = (m) => Kabegame.warn(m);
const errorMessage = (e) => e?.message ?? String(e);
const str = (v) => (v === null || v === undefined ? "" : String(v));

// 用户可见文案跟随界面语言。zh 是基准表，其余语言必须覆盖全部 key。
// WebView 插件不经过打包，无法 import JSON，因此把五语言表内联在这里。
const MESSAGES = {
  zh: {
    yes: "是",
    no: "否",
    kindPhoto: "图片",
    kindVideo: "视频",
    unlimited: "不限",
    commentsOff: "不抓",
    none: "无",
    withCommentImages: "（含配图）",
    timeMinSuffix: " · 最旧={date}",
    commonLog: "类型={types} · 上限={limit} · 增量={incremental} · 评论={comments}{images}{timeMin}",
    pageLoaded: "[x] ▶ 页面加载 · 阶段={phase} · {url}",
    searchLog: "[x] 搜索「{query}」· 排序={sort} · {common}",
    tweetLog: "[x] 单条推文 {id} · 类型={types} · 评论={comments}",
    collectionLog: "[x] {label} · {common}",
    artistLog: "[x] 画师 @{name} · {common}",
    artistInfoLog: "[x] 画师信息：{name} · id={id} · 媒体推文 {count}",
    sortTop: "热门",
    sortLatest: "最新",
    photoTimeline: "{kind}时间线",
    searchTopLabel: "搜索（热门）",
    searchLatestLabel: "搜索（最新）",
    bookmarksLabel: "书签",
    likesLabel: "点赞",
    bookmarksName: "X 书签",
    likesName: "X 点赞",
    searchNoIncremental: "[x] 热门排序的结果不按时间排列，不使用增量记录",
    dateInvalid: "最旧时间「{value}」无法解析，请用形如 2026-01-31 的日期",
    watermarkReadFailed: "[x] 读取上次爬取记录失败，本次按全量处理：{error}",
    watermarkWriteFailed: "[x] 写入爬取记录失败（下次会重复翻页）：{error}",
    watermarkSaved: "[x] 已记录水位线 {key} = {value}",
    notLoggedIn: "[x] 未登录 X。请在弹出的爬虫窗口中登录（或先在「畅游」里登录 x.com），登录后会自动继续。",
    loginTimeout: "[x] 等待 3 分钟仍未登录，任务结束",
    mediaSwitched: "[x] 页面加载了 {op}，切换到{kind}",
    timelineMissing: "[x] 没有等到{kind}时间线（{op}）响应，跳过 · {url} · {title}",
    collectDone: "[x] 收集完成 · 共 {count} 条推文",
    collectDoneComments: " · 有回复的会打开详情页保存最多 {count} 条",
    allDone: "[x] 全部完成 · 共处理 {count} 条推文",
    searchRetry: "[x] 没有等到搜索结果，5 秒后重载页面再试一次",
    searchMissing: "[x] 没有等到搜索结果（{op}）响应 · 页面请求={ops} · 页面显示「{text}」",
    usernameMissing: "[x] 取不到当前账号的用户名，无法打开点赞列表 · 页面={path} · 宽度={width}",
    accountOpened: "[x] 当前账号 @{name}，打开点赞列表",
    collectionMissing: "[x] 没有等到{label}列表（{op}）响应 · {url} · {title}",
    tweetMissing: "[x] 推文 {id} 没取到：{reason}",
    tweetRateLimited: "被限流（429），稍后再试",
    tweetUnavailable: "推文不存在、已删除或当前账号看不到",
    noWantedMedia: "[x] 这条推文没有所选类型的图片 / 视频，没有可下载的媒体",
    commentsSaved: "[x] 评论：保存 {count} 条回复",
    incrementalMarkSet: "[x] 增量：遇到上次最前面的 {count} 条之一就停",
    incrementalWatermark: "[x] 增量：只抓 {id} 之后的推文",
    rateLimited: "[x] X 返回 429（请求过于频繁），停止翻页；稍后再试",
    responseAbnormal: "[x] {op} 响应异常：HTTP {status} {errors}",
    timelineAdded: "[x] {label} +{count} 条推文（累计 {total}）",
    reasonEnd: "已到时间线末尾",
    reasonWatermark: "遇到上次抓过的推文",
    reasonTimeMin: "早于最旧时间",
    reasonMax: "达到推文数上限",
    reasonRateLimit: "被限流",
    reasonIdle: "连续 3 次滚动都没有新响应",
    timelineDone: "[x] {label}收集结束（{reason}）· {count} 条推文",
    commentsRateLimited: "[x] 打开推文详情被限流（429），后面的推文不再保存评论，只下载媒体",
    commentsFetchFailed: "[x] 推文 {id} 的回复没取到：{error}",
    progressLog: "[x] 已处理 {done}/{total} 条推文",
    commentSummary: "[x] 评论：打开 {opened} 条推文详情，共保存 {saved} 条回复",
    detailWaitingMissing: "没有等到 TweetDetail · 期间请求={ops} · 页面={path}",
    detailNotJson: "TweetDetail 不是 JSON（HTTP {status}）",
    parseTweetFailed: "[x] 解析推文 {id} 失败：{error}",
    metadataFailed: "[x] 创建 metadata 失败（{id}）：{error}",
    downloadFailed: "[x] 下载失败 {url}{suffix}：{error}",
    commentImageFailed: "[x] 评论配图下载失败 {url}{suffix}：{error}",
    searchQueryRequired: "[x] 搜索模式需要填写搜索词",
    tweetInputInvalid: "[x] 无法识别推文「{value}」：请粘贴推文链接（https://x.com/<用户>/status/<数字>）或推文 id",
    artistInputInvalid: "[x] 无法识别画师「{value}」：请填 @用户名、用户名或主页链接",
    pluginFailed: "[x] 插件运行失败：{error}"
  },
  en: {
    yes: "yes",
    no: "no",
    kindPhoto: "photo",
    kindVideo: "video",
    unlimited: "unlimited",
    commentsOff: "off",
    none: "none",
    withCommentImages: " (with images)",
    timeMinSuffix: " · oldest={date}",
    commonLog: "type={types} · limit={limit} · incremental={incremental} · comments={comments}{images}{timeMin}",
    pageLoaded: "[x] ▶ Page load · phase={phase} · {url}",
    searchLog: "[x] Search “{query}” · sort={sort} · {common}",
    tweetLog: "[x] Single post {id} · type={types} · comments={comments}",
    collectionLog: "[x] {label} · {common}",
    artistLog: "[x] Artist @{name} · {common}",
    artistInfoLog: "[x] Artist info: {name} · id={id} · media posts {count}",
    sortTop: "top",
    sortLatest: "latest",
    photoTimeline: "{kind} timeline",
    searchTopLabel: "Search (top)",
    searchLatestLabel: "Search (latest)",
    bookmarksLabel: "Bookmarks",
    likesLabel: "Likes",
    bookmarksName: "X bookmarks",
    likesName: "X likes",
    searchNoIncremental: "[x] Top results are not time-ordered, so incremental tracking is not used",
    dateInvalid: "The oldest time “{value}” could not be parsed; use a date like 2026-01-31",
    watermarkReadFailed: "[x] Failed to read the previous crawl record; doing a full crawl this time: {error}",
    watermarkWriteFailed: "[x] Failed to save the crawl record (pages will repeat next time): {error}",
    watermarkSaved: "[x] Saved watermark {key} = {value}",
    notLoggedIn: "[x] Not signed in to X. Sign in in the crawler window that just opened (or sign in to x.com in Surf first); the task will continue automatically.",
    loginTimeout: "[x] Still not signed in after 3 minutes; ending the task",
    mediaSwitched: "[x] The page loaded {op}; switching to the {kind} timeline",
    timelineMissing: "[x] No {kind} timeline ({op}) response arrived; skipping · {url} · {title}",
    collectDone: "[x] Collection finished · {count} posts",
    collectDoneComments: " · posts with replies will open their detail page to save up to {count} replies",
    allDone: "[x] All done · {count} posts processed",
    searchRetry: "[x] No search results arrived; reloading the page in 5 seconds and trying again",
    searchMissing: "[x] No search results ({op}) response arrived · page requests={ops} · page shows “{text}”",
    usernameMissing: "[x] Could not get the current account's username, so the likes list cannot be opened · page={path} · width={width}",
    accountOpened: "[x] Current account @{name}; opening the likes list",
    collectionMissing: "[x] No {label} list ({op}) response arrived · {url} · {title}",
    tweetMissing: "[x] Could not fetch post {id}: {reason}",
    tweetRateLimited: "rate limited (429); try again later",
    tweetUnavailable: "the post does not exist, was deleted, or is not visible to this account",
    noWantedMedia: "[x] This post has no media of the selected type; nothing to download",
    commentsSaved: "[x] Comments: saved {count} replies",
    incrementalMarkSet: "[x] Incremental: stopping at any of the {count} posts that were first last time",
    incrementalWatermark: "[x] Incremental: only posts after {id}",
    rateLimited: "[x] X returned 429 (too many requests); stopping pagination. Try again later",
    responseAbnormal: "[x] {op} response error: HTTP {status} {errors}",
    timelineAdded: "[x] {label} +{count} posts ({total} total)",
    reasonEnd: "reached the end of the timeline",
    reasonWatermark: "hit a post from the previous crawl",
    reasonTimeMin: "older than the oldest allowed time",
    reasonMax: "reached the post limit",
    reasonRateLimit: "rate limited",
    reasonIdle: "three scrolls in a row produced no new response",
    timelineDone: "[x] {label} collection finished ({reason}) · {count} posts",
    commentsRateLimited: "[x] Opening post details was rate limited (429); no more replies will be saved, media only",
    commentsFetchFailed: "[x] Could not fetch replies for post {id}: {error}",
    progressLog: "[x] Processed {done}/{total} posts",
    commentSummary: "[x] Comments: opened {opened} post detail pages and saved {saved} replies",
    detailWaitingMissing: "TweetDetail never arrived · requests during that time={ops} · page={path}",
    detailNotJson: "TweetDetail was not JSON (HTTP {status})",
    parseTweetFailed: "[x] Failed to parse post {id}: {error}",
    metadataFailed: "[x] Failed to create metadata ({id}): {error}",
    downloadFailed: "[x] Download failed {url}{suffix}: {error}",
    commentImageFailed: "[x] Comment image download failed {url}{suffix}: {error}",
    searchQueryRequired: "[x] Search mode requires a search query",
    tweetInputInvalid: "[x] Unrecognized post “{value}”: paste a post link (https://x.com/<user>/status/<number>) or a post id",
    artistInputInvalid: "[x] Unrecognized artist “{value}”: enter an @username, a username, or a profile link",
    pluginFailed: "[x] Plugin run failed: {error}"
  },
  ja: {
    yes: "はい",
    no: "いいえ",
    kindPhoto: "画像",
    kindVideo: "動画",
    unlimited: "無制限",
    commentsOff: "取得しない",
    none: "なし",
    withCommentImages: "（画像付き）",
    timeMinSuffix: " · 最古={date}",
    commonLog: "種類={types} · 上限={limit} · 増分={incremental} · コメント={comments}{images}{timeMin}",
    pageLoaded: "[x] ▶ ページ読み込み · フェーズ={phase} · {url}",
    searchLog: "[x] 「{query}」を検索 · 並び順={sort} · {common}",
    tweetLog: "[x] 単一ポスト {id} · 種類={types} · コメント={comments}",
    collectionLog: "[x] {label} · {common}",
    artistLog: "[x] 絵師 @{name} · {common}",
    artistInfoLog: "[x] 絵師情報：{name} · id={id} · メディア投稿 {count}",
    sortTop: "人気",
    sortLatest: "最新",
    photoTimeline: "{kind}タイムライン",
    searchTopLabel: "検索（人気）",
    searchLatestLabel: "検索（最新）",
    bookmarksLabel: "ブックマーク",
    likesLabel: "いいね",
    bookmarksName: "X ブックマーク",
    likesName: "X いいね",
    searchNoIncremental: "[x] 人気順の結果は時系列ではないため、増分記録は使用しません",
    dateInvalid: "最古時間「{value}」を解析できません。2026-01-31 のような日付を指定してください",
    watermarkReadFailed: "[x] 前回のクロール記録を読み込めませんでした。今回は全件取得します：{error}",
    watermarkWriteFailed: "[x] クロール記録を保存できませんでした（次回同じページを再度取得します）：{error}",
    watermarkSaved: "[x] ウォーターマーク {key} = {value} を記録しました",
    notLoggedIn: "[x] X にログインしていません。開いたクローラーウィンドウでログインしてください（先に「サーフ」で x.com にログインしてもかまいません）。ログイン後は自動で続行します。",
    loginTimeout: "[x] 3 分待ってもログインされないため、タスクを終了します",
    mediaSwitched: "[x] ページが {op} を読み込みました。{kind}タイムラインに切り替えます",
    timelineMissing: "[x] {kind}タイムライン（{op}）の応答が来なかったためスキップします · {url} · {title}",
    collectDone: "[x] 収集完了 · ポスト {count} 件",
    collectDoneComments: " · 返信があるポストは詳細ページを開いて最大 {count} 件保存します",
    allDone: "[x] すべて完了 · ポスト {count} 件を処理",
    searchRetry: "[x] 検索結果が来なかったため、5 秒後にページを再読み込みしてもう一度試します",
    searchMissing: "[x] 検索結果（{op}）の応答が来ませんでした · ページのリクエスト={ops} · ページ表示「{text}」",
    usernameMissing: "[x] 現在のアカウントのユーザー名を取得できないため、いいね一覧を開けません · ページ={path} · 幅={width}",
    accountOpened: "[x] 現在のアカウント @{name} のいいね一覧を開きます",
    collectionMissing: "[x] {label}一覧（{op}）の応答が来ませんでした · {url} · {title}",
    tweetMissing: "[x] ポスト {id} を取得できませんでした：{reason}",
    tweetRateLimited: "レート制限（429）です。しばらくしてから再試行してください",
    tweetUnavailable: "ポストが存在しない、削除された、または現在のアカウントからは見られません",
    noWantedMedia: "[x] このポストには選択した種類の画像・動画がないため、ダウンロードできません",
    commentsSaved: "[x] コメント：返信 {count} 件を保存",
    incrementalMarkSet: "[x] 増分：前回先頭だった {count} 件のいずれかに到達したら停止",
    incrementalWatermark: "[x] 増分：{id} より後のポストのみ取得",
    rateLimited: "[x] X が 429（リクエスト過多）を返しました。ページ送りを停止します。しばらくしてから再試行してください",
    responseAbnormal: "[x] {op} の応答が異常です：HTTP {status} {errors}",
    timelineAdded: "[x] {label} +{count} 件（累計 {total} 件）",
    reasonEnd: "タイムラインの最後に到達",
    reasonWatermark: "前回取得したポストに到達",
    reasonTimeMin: "最古時間より前",
    reasonMax: "ポスト数の上限に到達",
    reasonRateLimit: "レート制限",
    reasonIdle: "3 回連続スクロールしても新しい応答なし",
    timelineDone: "[x] {label}の収集終了（{reason}）· ポスト {count} 件",
    commentsRateLimited: "[x] ポスト詳細を開く際にレート制限（429）を受けました。以降のポストは返信を保存せず、メディアのみダウンロードします",
    commentsFetchFailed: "[x] ポスト {id} の返信を取得できませんでした：{error}",
    progressLog: "[x] {done}/{total} 件のポストを処理済み",
    commentSummary: "[x] コメント：{opened} 件のポスト詳細を開き、返信 {saved} 件を保存",
    detailWaitingMissing: "TweetDetail の応答が来ません · 期間中のリクエスト={ops} · ページ={path}",
    detailNotJson: "TweetDetail が JSON ではありません（HTTP {status}）",
    parseTweetFailed: "[x] ポスト {id} の解析に失敗しました：{error}",
    metadataFailed: "[x] metadata の作成に失敗しました（{id}）：{error}",
    downloadFailed: "[x] ダウンロード失敗 {url}{suffix}：{error}",
    commentImageFailed: "[x] コメント画像のダウンロード失敗 {url}{suffix}：{error}",
    searchQueryRequired: "[x] 検索モードでは検索語の入力が必要です",
    tweetInputInvalid: "[x] ポスト「{value}」を認識できません。ポストリンク（https://x.com/<ユーザー>/status/<数字>）またはポスト id を貼り付けてください",
    artistInputInvalid: "[x] 絵師「{value}」を認識できません。@ユーザー名、ユーザー名、またはプロフィールリンクを入力してください",
    pluginFailed: "[x] プラグインの実行に失敗しました：{error}"
  },
  ko: {
    yes: "예",
    no: "아니요",
    kindPhoto: "사진",
    kindVideo: "동영상",
    unlimited: "무제한",
    commentsOff: "수집 안 함",
    none: "없음",
    withCommentImages: " (이미지 포함)",
    timeMinSuffix: " · 가장 오래된={date}",
    commonLog: "유형={types} · 상한={limit} · 증분={incremental} · 댓글={comments}{images}{timeMin}",
    pageLoaded: "[x] ▶ 페이지 로드 · 단계={phase} · {url}",
    searchLog: "[x] “{query}” 검색 · 정렬={sort} · {common}",
    tweetLog: "[x] 단일 게시물 {id} · 유형={types} · 댓글={comments}",
    collectionLog: "[x] {label} · {common}",
    artistLog: "[x] 작가 @{name} · {common}",
    artistInfoLog: "[x] 작가 정보: {name} · id={id} · 미디어 게시물 {count}",
    sortTop: "인기",
    sortLatest: "최신",
    photoTimeline: "{kind} 타임라인",
    searchTopLabel: "검색(인기)",
    searchLatestLabel: "검색(최신)",
    bookmarksLabel: "북마크",
    likesLabel: "좋아요",
    bookmarksName: "X 북마크",
    likesName: "X 좋아요",
    searchNoIncremental: "[x] 인기순 결과는 시간순이 아니므로 증분 기록을 사용하지 않습니다",
    dateInvalid: "가장 오래된 시간 “{value}”을(를) 해석할 수 없습니다. 2026-01-31 같은 날짜를 입력해 주세요",
    watermarkReadFailed: "[x] 이전 크롤 기록을 읽지 못했습니다. 이번에는 전체를 수집합니다: {error}",
    watermarkWriteFailed: "[x] 크롤 기록을 저장하지 못했습니다(다음에 같은 페이지를 다시 수집합니다): {error}",
    watermarkSaved: "[x] 워터마크 {key} = {value} 기록됨",
    notLoggedIn: "[x] X에 로그인되어 있지 않습니다. 열린 크롤러 창에서 로그인해 주세요(먼저 '서핑'에서 x.com에 로그인해도 됩니다). 로그인하면 자동으로 계속합니다.",
    loginTimeout: "[x] 3분이 지나도 로그인하지 않아 작업을 종료합니다",
    mediaSwitched: "[x] 페이지가 {op}을(를) 불러왔습니다. {kind} 타임라인으로 전환합니다",
    timelineMissing: "[x] {kind} 타임라인({op}) 응답이 오지 않아 건너뜁니다 · {url} · {title}",
    collectDone: "[x] 수집 완료 · 게시물 {count}개",
    collectDoneComments: " · 답글이 있는 게시물은 상세 페이지를 열어 최대 {count}개까지 저장합니다",
    allDone: "[x] 모두 완료 · 게시물 {count}개 처리",
    searchRetry: "[x] 검색 결과가 오지 않아 5초 후 페이지를 다시 불러와 재시도합니다",
    searchMissing: "[x] 검색 결과({op}) 응답이 오지 않았습니다 · 페이지 요청={ops} · 페이지 표시 “{text}”",
    usernameMissing: "[x] 현재 계정의 사용자 이름을 가져올 수 없어 좋아요 목록을 열 수 없습니다 · 페이지={path} · 너비={width}",
    accountOpened: "[x] 현재 계정 @{name}의 좋아요 목록을 엽니다",
    collectionMissing: "[x] {label} 목록({op}) 응답이 오지 않았습니다 · {url} · {title}",
    tweetMissing: "[x] 게시물 {id}을(를) 가져오지 못했습니다: {reason}",
    tweetRateLimited: "속도 제한(429)에 걸렸습니다. 잠시 후 다시 시도해 주세요",
    tweetUnavailable: "게시물이 없거나 삭제되었거나 현재 계정에서 볼 수 없습니다",
    noWantedMedia: "[x] 이 게시물에는 선택한 유형의 사진/동영상이 없어 다운로드할 것이 없습니다",
    commentsSaved: "[x] 댓글: 답글 {count}개 저장",
    incrementalMarkSet: "[x] 증분: 지난번 맨 앞 {count}개 중 하나를 만나면 중지",
    incrementalWatermark: "[x] 증분: {id} 이후 게시물만 수집",
    rateLimited: "[x] X가 429(요청 과다)를 반환했습니다. 페이지 넘김을 중지합니다. 잠시 후 다시 시도해 주세요",
    responseAbnormal: "[x] {op} 응답 이상: HTTP {status} {errors}",
    timelineAdded: "[x] {label} +{count}개(누적 {total}개)",
    reasonEnd: "타임라인 끝에 도달",
    reasonWatermark: "지난번에 수집한 게시물을 만남",
    reasonTimeMin: "가장 오래된 시간보다 이름",
    reasonMax: "게시물 수 상한 도달",
    reasonRateLimit: "속도 제한",
    reasonIdle: "3회 연속 스크롤에도 새 응답 없음",
    timelineDone: "[x] {label} 수집 종료({reason}) · 게시물 {count}개",
    commentsRateLimited: "[x] 게시물 상세를 여는 중 속도 제한(429)에 걸렸습니다. 이후 게시물은 답글을 저장하지 않고 미디어만 다운로드합니다",
    commentsFetchFailed: "[x] 게시물 {id}의 답글을 가져오지 못했습니다: {error}",
    progressLog: "[x] 게시물 {done}/{total}개 처리",
    commentSummary: "[x] 댓글: 게시물 상세 {opened}개를 열어 답글 {saved}개 저장",
    detailWaitingMissing: "TweetDetail 응답이 오지 않았습니다 · 기간 중 요청={ops} · 페이지={path}",
    detailNotJson: "TweetDetail이 JSON이 아닙니다(HTTP {status})",
    parseTweetFailed: "[x] 게시물 {id} 파싱 실패: {error}",
    metadataFailed: "[x] metadata 생성 실패({id}): {error}",
    downloadFailed: "[x] 다운로드 실패 {url}{suffix}: {error}",
    commentImageFailed: "[x] 댓글 이미지 다운로드 실패 {url}{suffix}: {error}",
    searchQueryRequired: "[x] 검색 모드에서는 검색어를 입력해야 합니다",
    tweetInputInvalid: "[x] 게시물 “{value}”을(를) 인식할 수 없습니다. 게시물 링크(https://x.com/<사용자>/status/<숫자>) 또는 게시물 id를 붙여 넣어 주세요",
    artistInputInvalid: "[x] 작가 “{value}”을(를) 인식할 수 없습니다. @사용자 이름, 사용자 이름 또는 프로필 링크를 입력해 주세요",
    pluginFailed: "[x] 플러그인 실행 실패: {error}"
  },
  zhtw: {
    yes: "是",
    no: "否",
    kindPhoto: "圖片",
    kindVideo: "影片",
    unlimited: "不限",
    commentsOff: "不抓取",
    none: "無",
    withCommentImages: "（含配圖）",
    timeMinSuffix: " · 最舊={date}",
    commonLog: "類型={types} · 上限={limit} · 增量={incremental} · 留言={comments}{images}{timeMin}",
    pageLoaded: "[x] ▶ 頁面載入 · 階段={phase} · {url}",
    searchLog: "[x] 搜尋「{query}」· 排序={sort} · {common}",
    tweetLog: "[x] 單則推文 {id} · 類型={types} · 留言={comments}",
    collectionLog: "[x] {label} · {common}",
    artistLog: "[x] 繪師 @{name} · {common}",
    artistInfoLog: "[x] 繪師資訊：{name} · id={id} · 媒體推文 {count}",
    sortTop: "熱門",
    sortLatest: "最新",
    photoTimeline: "{kind}時間軸",
    searchTopLabel: "搜尋（熱門）",
    searchLatestLabel: "搜尋（最新）",
    bookmarksLabel: "書籤",
    likesLabel: "按讚",
    bookmarksName: "X 書籤",
    likesName: "X 按讚",
    searchNoIncremental: "[x] 熱門排序的結果不按時間排列，不使用增量紀錄",
    dateInvalid: "最舊時間「{value}」無法解析，請用形如 2026-01-31 的日期",
    watermarkReadFailed: "[x] 讀取上次爬取紀錄失敗，本次按全量處理：{error}",
    watermarkWriteFailed: "[x] 寫入爬取紀錄失敗（下次會重複翻頁）：{error}",
    watermarkSaved: "[x] 已記錄水位線 {key} = {value}",
    notLoggedIn: "[x] 未登入 X。請在彈出的爬蟲視窗中登入（或先在「暢遊」裡登入 x.com），登入後會自動繼續。",
    loginTimeout: "[x] 等待 3 分鐘仍未登入，任務結束",
    mediaSwitched: "[x] 頁面載入了 {op}，切換到{kind}",
    timelineMissing: "[x] 沒有等到{kind}時間軸（{op}）回應，跳過 · {url} · {title}",
    collectDone: "[x] 收集完成 · 共 {count} 則推文",
    collectDoneComments: " · 有回覆的會開啟詳情頁儲存最多 {count} 則",
    allDone: "[x] 全部完成 · 共處理 {count} 則推文",
    searchRetry: "[x] 沒有等到搜尋結果，5 秒後重新載入頁面再試一次",
    searchMissing: "[x] 沒有等到搜尋結果（{op}）回應 · 頁面請求={ops} · 頁面顯示「{text}」",
    usernameMissing: "[x] 取不到目前帳號的使用者名稱，無法開啟按讚列表 · 頁面={path} · 寬度={width}",
    accountOpened: "[x] 目前帳號 @{name}，開啟按讚列表",
    collectionMissing: "[x] 沒有等到{label}列表（{op}）回應 · {url} · {title}",
    tweetMissing: "[x] 推文 {id} 沒取到：{reason}",
    tweetRateLimited: "被限流（429），請稍後再試",
    tweetUnavailable: "推文不存在、已刪除或目前帳號看不到",
    noWantedMedia: "[x] 這則推文沒有所選類型的圖片／影片，沒有可下載的媒體",
    commentsSaved: "[x] 留言：儲存 {count} 則回覆",
    incrementalMarkSet: "[x] 增量：遇到上次最前面的 {count} 則之一就停",
    incrementalWatermark: "[x] 增量：只抓 {id} 之後的推文",
    rateLimited: "[x] X 傳回 429（請求過於頻繁），停止翻頁；請稍後再試",
    responseAbnormal: "[x] {op} 回應異常：HTTP {status} {errors}",
    timelineAdded: "[x] {label} +{count} 則推文（累計 {total}）",
    reasonEnd: "已到時間軸末尾",
    reasonWatermark: "遇到上次抓過的推文",
    reasonTimeMin: "早於最舊時間",
    reasonMax: "達到推文數上限",
    reasonRateLimit: "被限流",
    reasonIdle: "連續 3 次滾動都沒有新回應",
    timelineDone: "[x] {label}收集結束（{reason}）· {count} 則推文",
    commentsRateLimited: "[x] 開啟推文詳情被限流（429），後面的推文不再儲存留言，只下載媒體",
    commentsFetchFailed: "[x] 推文 {id} 的回覆沒取到：{error}",
    progressLog: "[x] 已處理 {done}/{total} 則推文",
    commentSummary: "[x] 留言：開啟 {opened} 則推文詳情，共儲存 {saved} 則回覆",
    detailWaitingMissing: "沒有等到 TweetDetail · 期間請求={ops} · 頁面={path}",
    detailNotJson: "TweetDetail 不是 JSON（HTTP {status}）",
    parseTweetFailed: "[x] 解析推文 {id} 失敗：{error}",
    metadataFailed: "[x] 建立 metadata 失敗（{id}）：{error}",
    downloadFailed: "[x] 下載失敗 {url}{suffix}：{error}",
    commentImageFailed: "[x] 留言配圖下載失敗 {url}{suffix}：{error}",
    searchQueryRequired: "[x] 搜尋模式需要填寫搜尋詞",
    tweetInputInvalid: "[x] 無法辨識推文「{value}」：請貼上推文連結（https://x.com/<使用者>/status/<數字>）或推文 id",
    artistInputInvalid: "[x] 無法辨識繪師「{value}」：請填 @使用者名稱、使用者名稱或主頁連結",
    pluginFailed: "[x] 外掛執行失敗：{error}"
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

// 按字形截断。不能用 String#slice：它按 UTF-16 码元切，会把 emoji 劈成孤立代理项，
// 带孤立代理项的字符串经 IPC 传给宿主时 invoke 既不返回也不报错，任务会永远挂住（实测）。
function truncateGraphemes(text, max) {
  const value = str(text);
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const out = [];
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) {
      if (out.length >= max) break;
      out.push(segment);
    }
    return out.join("");
  }
  return Array.from(value).slice(0, max).join("");
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// 推文 id 是 snowflake：时间单调，高位即毫秒时间戳。比较一律走 BigInt。
const TWITTER_EPOCH = 1288834974657n;
function idToMs(id) {
  try {
    return Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
  } catch {
    return NaN;
  }
}
function idGreater(a, b) {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return false;
  }
}

// 「画师」配置：@name、name、x.com/twitter.com 主页链接都接受。
const RESERVED_PATHS = new Set(["home", "explore", "search", "i", "settings", "notifications", "messages"]);
function parseScreenName(input) {
  const raw = str(input).trim();
  if (!raw) return "";
  let name = raw;
  const m = raw.match(/(?:x|twitter)\.com\/([^/?#]+)/i);
  if (m) name = m[1];
  name = name.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(name) || RESERVED_PATHS.has(name.toLowerCase())) return "";
  return name;
}

// 时间下界：日期选择器给的是本地日期，补 T00:00:00 按本地时区解析（纯日期会被当成 UTC）。
function parseDateFloor(value) {
  const raw = str(value).trim();
  if (!raw) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(ms)) throw new Error(t("dateInvalid", { value: raw }));
  return ms;
}

// ── 推文解析 ───────────────────────────────────────────────────────────

function unwrapTweet(result) {
  if (!result) return null;
  if (result.__typename === "TweetWithVisibilityResults") return result.tweet ?? null;
  if (result.__typename === "Tweet" || (result.__typename === undefined && result.legacy)) return result;
  return null; // TweetTombstone / TweetUnavailable
}

// 从一个时间线 / 搜索响应里按顺序取出推文（跳过推广推文）。
function extractTweets(json) {
  const instructions =
    json?.data?.user?.result?.timeline?.timeline?.instructions ??
    json?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ??
    json?.data?.bookmark_timeline_v2?.timeline?.instructions ??
    [];
  const items = [];
  for (const ins of instructions) {
    if (ins.type === "TimelineAddEntries") {
      for (const entry of ins.entries ?? []) {
        const content = entry.content ?? {};
        if (content.itemContent?.tweet_results) items.push(content.itemContent);
        if (Array.isArray(content.items)) {
          for (const it of content.items) {
            if (it.item?.itemContent?.tweet_results) items.push(it.item.itemContent);
          }
        }
      }
    } else if (ins.type === "TimelineAddToModule") {
      for (const it of ins.moduleItems ?? []) {
        if (it.item?.itemContent?.tweet_results) items.push(it.item.itemContent);
      }
    }
  }
  return items
    .filter((ic) => !ic.promotedMetadata)
    .map((ic) => unwrapTweet(ic.tweet_results?.result))
    .filter(Boolean);
}

function decodeEntities(text) {
  return str(text).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// 正文：长推文取 note_tweet；按 display_text_range 去掉末尾的媒体 t.co 链接，其余 t.co 展开。
function tweetText(tweet) {
  const note = tweet.note_tweet?.note_tweet_results?.result;
  const legacy = tweet.legacy ?? {};
  let text = note?.text ?? str(legacy.full_text);
  const urls = note?.entity_set?.urls ?? legacy.entities?.urls ?? [];
  if (!note && Array.isArray(legacy.display_text_range)) {
    const [start, end] = legacy.display_text_range;
    text = Array.from(text).slice(start, end).join("");
  }
  for (const u of urls) {
    if (u?.url && u?.expanded_url) text = text.split(u.url).join(u.expanded_url);
  }
  return decodeEntities(text).replace(/\s*https:\/\/t\.co\/\w+\s*$/, "").trim();
}

function tweetHashtags(tweet) {
  const note = tweet.note_tweet?.note_tweet_results?.result;
  const list = note?.entity_set?.hashtags ?? tweet.legacy?.entities?.hashtags ?? [];
  const seen = new Set();
  const tags = [];
  for (const h of list) {
    const tag = str(h?.text).trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

function tweetAuthor(tweet) {
  const u = tweet.core?.user_results?.result ?? {};
  return {
    id: str(u.rest_id),
    screenName: str(u.core?.screen_name ?? u.legacy?.screen_name),
    name: str(u.core?.name ?? u.legacy?.name),
    avatar: str(u.avatar?.image_url ?? u.legacy?.profile_image_url_https).replace(/_normal\.(\w+)$/, ".$1"),
    verified: Boolean(u.is_blue_verified),
    description: str(u.legacy?.description ?? u.profile_bio?.description),
  };
}

function bestVideoUrl(media) {
  let best = null;
  for (const v of media.video_info?.variants ?? []) {
    if (v.content_type !== "video/mp4") continue;
    if (!best || (v.bitrate ?? 0) > (best.bitrate ?? 0)) best = v;
  }
  return best?.url ?? "";
}

// 原图：media_url_https 形如 https://pbs.twimg.com/media/<id>.<ext> → ?format=<ext>&name=orig
function originalPhotoUrl(url) {
  const m = str(url).match(/^(https:\/\/pbs\.twimg\.com\/media\/[^.?]+)\.(\w+)/);
  return m ? `${m[1]}?format=${m[2]}&name=orig` : str(url);
}

function tweetMedia(tweet) {
  const list = tweet.legacy?.extended_entities?.media ?? tweet.legacy?.entities?.media ?? [];
  return list.map((m) => {
    const isVideo = m.type === "video" || m.type === "animated_gif";
    return {
      key: str(m.media_key),
      type: str(m.type),
      url: isVideo ? bestVideoUrl(m) : originalPhotoUrl(m.media_url_https),
      poster: str(m.media_url_https),
      width: m.original_info?.width ?? null,
      height: m.original_info?.height ?? null,
      alt: str(m.ext_alt_text),
      durationMs: m.video_info?.duration_millis ?? null,
    };
  });
}

// 推文里有没有本次要的媒体类型（书签 / 点赞会混入纯文字推文）。
function hasWantedMedia(tweet, kinds) {
  return tweetMedia(tweet).some((m) => m.url && kinds.includes(m.type === "photo" ? "photo" : "video"));
}

// 推文配置：链接（x.com / twitter.com / 带 /photo/1 等尾巴都行）或纯数字 id。
function parseTweetId(input) {
  const raw = str(input).trim();
  return raw.match(/\/status(?:es)?\/(\d{5,25})/)?.[1] ?? (/^\d{5,25}$/.test(raw) ? raw : "");
}

// 当前登录账号的 rest_id：Cookie twid=u%3D<id>。
function loggedInUserId() {
  return decodeURIComponent(document.cookie.match(/(?:^|; )twid=([^;]+)/)?.[1] ?? "").replace(/^u=/, "");
}

function buildMetadata(tweet) {
  const legacy = tweet.legacy ?? {};
  const author = tweetAuthor(tweet);
  const id = str(tweet.rest_id ?? legacy.id_str);
  const ms = idToMs(id);
  return {
    schema: 1,
    tweet: {
      id,
      url: `https://x.com/${author.screenName || "i"}/status/${id}`,
      text: tweetText(tweet),
      createdAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
      lang: str(legacy.lang),
      possiblySensitive: Boolean(legacy.possibly_sensitive),
      hashtags: tweetHashtags(tweet),
      counts: {
        reply: legacy.reply_count ?? 0,
        retweet: legacy.retweet_count ?? 0,
        quote: legacy.quote_count ?? 0,
        like: legacy.favorite_count ?? 0,
        bookmark: legacy.bookmark_count ?? 0,
        view: tweet.views?.count != null ? Number(tweet.views.count) : null,
      },
    },
    author,
    media: tweetMedia(tweet),
    comments: [],
    commentsMax: 0,
  };
}

// 一条回复：正文、作者、时间、互动数、回复对象与配图。楼中楼靠 parentId 指回上一层。
function buildComment(tweet, focalAuthorId) {
  const legacy = tweet.legacy ?? {};
  const { description: _bio, ...author } = tweetAuthor(tweet);
  const id = str(tweet.rest_id ?? legacy.id_str);
  const ms = idToMs(id);
  return {
    id,
    url: `https://x.com/${author.screenName || "i"}/status/${id}`,
    text: tweetText(tweet),
    createdAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    author,
    isAuthor: Boolean(focalAuthorId) && author.id === focalAuthorId,
    replyTo: str(legacy.in_reply_to_screen_name),
    parentId: str(legacy.in_reply_to_status_id_str),
    counts: {
      reply: legacy.reply_count ?? 0,
      retweet: legacy.retweet_count ?? 0,
      like: legacy.favorite_count ?? 0,
    },
    media: tweetMedia(tweet).map(({ type, url, poster, width, height }) => ({ type, url, poster, width, height })),
  };
}

// TweetDetail 响应：焦点推文本身（tweet-<id>）、回复串（conversationthread-*，每串 = 一级回复 + 楼中楼）、
// 懒加载追加（TimelineAddToModule），以及是否还有 Bottom 游标（滚到底能加载更多回复）。
// 焦点推文之前的 tweet-* 是它的上文（焦点本身是回复时），不算回复。
// 「スパムの可能性がある返信」藏在 ShowMoreThreads 游标后，需要点按钮才加载，有意不抓。
function extractConversation(json, focalId) {
  const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions ?? [];
  let focal = null;
  let hasBottom = false;
  const replies = [];
  const pushItem = (it) => {
    if (!str(it?.entryId).includes("-tweet-")) return;
    const reply = unwrapTweet(it.item?.itemContent?.tweet_results?.result);
    if (reply) replies.push(reply);
  };
  for (const ins of instructions) {
    if (ins.type === "TimelineAddEntries") {
      for (const entry of ins.entries ?? []) {
        const id = str(entry.entryId);
        if (id === `tweet-${focalId}`) {
          focal = unwrapTweet(entry.content?.itemContent?.tweet_results?.result);
        } else if (id.startsWith("conversationthread-")) {
          for (const it of entry.content?.items ?? []) pushItem(it);
        } else if (entry.content?.cursorType === "Bottom") {
          hasBottom = true;
        }
      }
    } else if (ins.type === "TimelineAddToModule") {
      for (const it of ins.moduleItems ?? []) pushItem(it);
    }
  }
  return { focal, replies, hasBottom };
}

// ── labels ─────────────────────────────────────────────────────────────

// ASCII 标签转小写清洗；含非 ASCII（日文等）编码成 u-<码点 base36>，超长退回双 FNV 哈希。
function labelKey(value) {
  const normalized = str(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!/[^\x00-\x7f]/.test(normalized)) {
    const key = normalized.toLowerCase().replace(/[^a-z0-9_\-() ]/g, "").replace(/\s+/g, " ").trim();
    return key && key.length <= 64 ? key : "";
  }
  const parts = [];
  let ascii = "";
  for (const ch of normalized) {
    if (/^[A-Za-z0-9_]$/.test(ch)) {
      ascii += ch.toLowerCase();
      continue;
    }
    if (ascii) {
      parts.push(ascii);
      ascii = "";
    }
    parts.push(ch.codePointAt(0).toString(36));
  }
  if (ascii) parts.push(ascii);
  const key = `u-${parts.join("-")}`;
  if (key.length <= 64) return key;
  return `u-${hashKey(normalized)}`;
}

// 双 FNV 哈希，给超长标签和搜索词用作稳定 key。
function hashKey(text) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (const ch of str(text)) {
    const cp = ch.codePointAt(0);
    a = Math.imul(a ^ cp, 0x01000193);
    b = Math.imul(b ^ cp, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

function buildLabels(meta) {
  const labels = [];
  if (/^\d+$/.test(meta.author.id)) {
    labels.push({
      key: meta.author.id,
      category: `${PLUGIN_ID}/artist`,
      name: meta.author.name ? `${meta.author.name} (@${meta.author.screenName})` : `@${meta.author.screenName}`,
    });
  }
  for (const tag of meta.tweet.hashtags) {
    const key = labelKey(tag);
    if (key) labels.push({ key, category: `${PLUGIN_ID}/hashtag`, name: `#${tag}` });
  }
  return labels;
}

// 元数据搜索片段：作者名 / @id、正文、每个话题标签（带 # 与不带）、媒体替代文本。
function buildSearchTexts(meta) {
  const texts = [`@${meta.author.screenName}`, meta.author.name, meta.tweet.text];
  for (const tag of meta.tweet.hashtags) texts.push(`#${tag}`, tag);
  for (const m of meta.media) if (m.alt) texts.push(m.alt);
  for (const c of meta.comments) texts.push(c.author.name, `@${c.author.screenName}`, c.text);
  return [...new Set(texts.map((text) => str(text).trim()).filter(Boolean))];
}

// ── 增量水位线 ──
// pluginData: { watermarks: { "<userId>:<photo|video>" | "search:<媒体类型>:<搜索词哈希>": "<最新推文 id>" } }

async function readWatermark(key) {
  try {
    const data = (await Kabegame.pluginData()) || {};
    return str(data?.watermarks?.[key]);
  } catch (e) {
    await warn(t("watermarkReadFailed", { error: errorMessage(e) }));
    return "";
  }
}

async function writeWatermark(key, value) {
  if (!key || !value) return;
  try {
    const data = (await Kabegame.pluginData()) || {};
    await Kabegame.setPluginData({ ...data, watermarks: { ...(data.watermarks || {}), [key]: value } });
    await log(t("watermarkSaved", { key, value }));
  } catch (e) {
    await warn(t("watermarkWriteFailed", { error: errorMessage(e) }));
  }
}

// ── 时间线页 ───────────────────────────────────────────────────────────

function timelineUrl(screenName, kind) {
  return `https://x.com/${encodeURIComponent(screenName)}/media?filter=${kind}`;
}

// sort: latest → f=live（按时间）；top → f=media（媒体标签，按热度）。
function searchUrl(query, sort) {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=${sort === "top" ? "media" : "live"}`;
}

// 搜索词里没写媒体过滤时按「媒体类型」补上，保证结果都带图 / 视频。
function searchQuery(raw, mediaType) {
  const query = str(raw).replace(/\s+/g, " ").trim();
  if (/(?:^|\s)filter:(?:media|images|videos|native_video|twimg)\b/i.test(query)) return query;
  return `${query} ${{ photo: "filter:images", video: "filter:videos" }[mediaType] ?? "filter:media"}`;
}

const isLoggedIn = () => /(?:^|; )twid=/.test(document.cookie);

// 未登录：显示爬虫窗口等用户登录，登录后重新打开 retryUrl。返回 false 表示本页已交棒（重进或结束）。
async function ensureLoggedIn(retryUrl, pageLabel) {
  if (isLoggedIn()) return true;
  await warn(t("notLoggedIn"));
  await Kabegame.requestShowWebview();
  for (let i = 0; i < 180 && !isLoggedIn(); i++) await Kabegame.sleep(1000);
  if (!isLoggedIn()) {
    await warn(t("loginTimeout"));
    await Kabegame.exit();
    return false;
  }
  await Kabegame.to(retryUrl, { pageLabel });
  return false;
}

// 等下一个指定操作的响应；超时返回 null。cursor 是 responses 的读指针。
async function nextResponse(reader, names, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    while (reader.index < responses.length) {
      const r = responses[reader.index++];
      if (names.includes(r.name)) return r;
    }
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await new Promise((resolve) => {
      notifyResponse = resolve;
      setTimeout(resolve, Math.min(left, 1000));
    });
    notifyResponse = null;
  }
}

// 「照片 / 视频」是下拉菜单：URL 参数没生效时，点开当前选中的媒体标签再选对应项。
async function switchMediaFilter(kind) {
  const tab = document.querySelector('a[role="tab"][aria-haspopup="menu"]');
  if (!tab) return false;
  tab.click();
  await Kabegame.sleep(1500);
  const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
  // 菜单两项的顺序实测为「動画、画像」，文案随界面语言变化，按顺序兜底。
  const re = kind === "photo" ? /画像|写真|照片|图片|圖片|Photo|Image/i : /動画|视频|影片|Video/i;
  const item = items.find((el) => re.test(el.textContent ?? "")) ?? items[kind === "photo" ? 1 : 0];
  if (!item) return false;
  item.click();
  return true;
}

// 时间线页：全程不整页导航。
// WebView 插件的下载由爬虫窗口的 CEF 发起，整页导航那一刻还在途的原生下载会丢失认领，挂满宿主
// 120 秒无进展期限后以「webview destroyed」失败（实测丢了最后 5 张）。所以：
//   1. 收集：在时间线页滚动截获推文；「全部」时用「メディア」下拉切到视频（SPA 内切换）；
//   2. 下载：逐条用 SPA 路由打开详情页截获回复（文档不重载），建 metadata 后下载。
// 不能边收集边进详情页：离开时间线后就没法继续滚动翻页。
async function handleTimeline() {
  let st = await Kabegame.state();
  await Kabegame.waitForDom();

  if (!(await ensureLoggedIn(timelineUrl(st.screenName, st.kinds[0]), "timeline"))) return;

  // 同一条推文同时有图和视频时会出现在两条时间线里，按 id 合并，记下要取哪些媒体类型。
  const queue = new Map(); // id → { tweet, kinds: Set }
  const watermarks = []; // 收集正常结束的类型，全部下载完才写
  const reader = { index: 0 };
  for (let i = 0; i < st.kinds.length; i++) {
    if (st.maxTweets > 0 && queue.size >= st.maxTweets) break;
    const kind = st.kinds[i];
    let first;
    if (i === 0) {
      // 首屏：等目标时间线；来的是另一种（下拉记住了上次选择）就手动切换。
      first = await nextResponse(reader, Object.values(TIMELINE_OPS), 25000);
      if (first && first.name !== TIMELINE_OPS[kind]) {
        await log(t("mediaSwitched", { op: first.name, kind: kindName(kind) }));
        first = (await switchMediaFilter(kind)) ? await nextResponse(reader, [TIMELINE_OPS[kind]], 15000) : null;
      }
    } else {
      window.scrollTo(0, 0);
      await Kabegame.sleep(800);
      reader.index = responses.length;
      first = (await switchMediaFilter(kind)) ? await nextResponse(reader, [TIMELINE_OPS[kind]], 15000) : null;
    }
    if (!first) {
      await warn(t("timelineMissing", { kind: kindName(kind), op: TIMELINE_OPS[kind], url: location.href, title: document.title }));
      continue;
    }
    st = await resolveUser(st);
    const limit = st.maxTweets > 0 ? st.maxTweets - queue.size : 0;
    const spec = {
      op: TIMELINE_OPS[kind],
      label: t("photoTimeline", { kind: kindName(kind) }),
      watermarkKey: st.userId ? `${st.userId}:${kind}` : "",
      ordered: true,
    };
    const result = await collectTimeline(st, spec, first, reader, limit);
    for (const tweet of result.tweets) {
      const id = str(tweet.rest_id);
      const entry = queue.get(id) ?? { tweet, kinds: new Set() };
      entry.kinds.add(kind);
      queue.set(id, entry);
    }
    if (result.watermark) watermarks.push(result.watermark);
  }

  await finish(st, [...queue.values()], watermarks);
}

// 收集结束后的共同收尾：逐条抓评论并下载，全部处理完才推进水位线。
async function finish(st, items, watermarks) {
  await log(
    t("collectDone", { count: items.length }) +
      (st.maxComments > 0 ? t("collectDoneComments", { count: st.maxComments }) : ""),
  );
  await processQueue(st, items);
  // 只有收集一路翻到「旧水位 / 末尾 / 时间下界」且全部处理完，才推进水位线；中途取消不会走到这里。
  for (const w of watermarks) await writeWatermark(w.key, w.value);
  await log(t("allDone", { count: items.length }));
  await Kabegame.exit();
}

// 搜索页：同样全程不整页导航，滚动截获 SearchTimeline，再逐条抓评论、下载。
async function handleSearch() {
  const st = await Kabegame.state();
  await Kabegame.waitForDom();
  if (!(await ensureLoggedIn(searchUrl(st.query, st.sort), "search"))) return;

  const reader = { index: 0 };
  const first = await nextResponse(reader, [SEARCH_OP], 25000);
  if (!first && !st.searchRetried) {
    // 实测连续搜索后偶尔整页加载完也不发 SearchTimeline，隔一会儿重载就恢复。此时还没有下载在途，可以整页导航。
    await log(t("searchRetry"));
    await Kabegame.updateState({ searchRetried: true });
    await Kabegame.sleep(5000);
    return Kabegame.to(searchUrl(st.query, st.sort), { pageLabel: "search" });
  }
  if (!first) {
    const ops = [...new Set(responses.map((r) => r.name))].join(",") || t("none");
    const text = (document.querySelector('[data-testid="primaryColumn"]')?.innerText ?? "").replace(/\s+/g, " ").slice(0, 160);
    await warn(t("searchMissing", { op: SEARCH_OP, ops, text }));
    return Kabegame.exit();
  }
  const spec = {
    op: SEARCH_OP,
    label: st.sort === "top" ? t("searchTopLabel") : t("searchLatestLabel"),
    watermarkKey: st.sort === "top" ? "" : `search:${st.kinds.join("+")}:${hashKey(st.query.toLowerCase())}`,
    ordered: st.sort !== "top",
    noIncrementalNote: st.sort === "top" ? t("searchNoIncremental") : "",
  };
  const result = await collectTimeline(st, spec, first, reader, st.maxTweets);
  const kinds = new Set(st.kinds);
  const items = result.tweets.map((tweet) => ({ tweet, kinds }));
  await finish(st, items, result.watermark ? [result.watermark] : []);
}

const kindName = (kind) => (kind === "photo" ? t("kindPhoto") : t("kindVideo"));

const COLLECTIONS = {
  bookmarks: { op: BOOKMARKS_OP, label: t("bookmarksLabel"), labelName: t("bookmarksName") },
  likes: { op: LIKES_OP, label: t("likesLabel"), labelName: t("likesName") },
};

// 书签 / 点赞：都只能看当前登录账号自己的。书签直接打开 /i/bookmarks；点赞的地址要用户名，
// 先打开首页从侧栏「个人资料」链接取到自己的用户名，再 SPA 跳到 /<用户名>/likes（同一文档，hook 照常截获）。
async function handleCollection() {
  const st = await Kabegame.state();
  const conf = COLLECTIONS[st.mode];
  await Kabegame.waitForDom();
  const entryUrl = st.mode === "bookmarks" ? "https://x.com/i/bookmarks" : "https://x.com/home";
  if (!(await ensureLoggedIn(entryUrl, "collection"))) return;
  const userId = loggedInUserId();

  const reader = { index: 0 };
  if (st.mode === "likes") {
    const me = await resolveOwnScreenName(userId);
    if (!me) {
      await warn(t("usernameMissing", { path: location.pathname, width: innerWidth }));
      return Kabegame.exit();
    }
    await log(t("accountOpened", { name: me }));
    reader.index = responses.length;
    spaNavigate(`/${me}/likes`);
  }
  const first = await nextResponse(reader, [conf.op], 25000);
  if (!first) {
    await warn(t("collectionMissing", { label: conf.label, op: conf.op, url: location.href, title: document.title }));
    return Kabegame.exit();
  }
  const spec = {
    op: conf.op,
    label: conf.label,
    watermarkKey: userId ? `${st.mode}:${userId}:${st.kinds.join("+")}` : "",
    ordered: false,
    markSet: true,
  };
  const result = await collectTimeline(st, spec, first, reader, st.maxTweets);
  const kinds = new Set(st.kinds);
  await finish(st, result.tweets.map((tweet) => ({ tweet, kinds })), result.watermark ? [result.watermark] : []);
}

// 当前账号的用户名，依次试：侧栏「个人资料」链接（窄窗口布局里没有）→ 页面内嵌的 __INITIAL_STATE__
// → SPA 跳到 /i/user/<id>，X 会解析后把地址换成 /<用户名>。
async function resolveOwnScreenName(userId) {
  const sel = 'a[data-testid="AppTabBar_Profile_Link"]';
  await Kabegame.waitForSelector(sel, { timeout: 5000 }).catch(() => {});
  let name = parseScreenName(document.querySelector(sel)?.getAttribute("href"));
  if (name) return name;
  try {
    name = parseScreenName(window.__INITIAL_STATE__?.entities?.users?.entities?.[userId]?.screen_name);
  } catch {}
  if (name || !userId) return name;
  spaNavigate(`/i/user/${userId}`);
  for (let i = 0; i < 30; i++) {
    await Kabegame.sleep(500);
    name = parseScreenName(location.pathname.split("/")[1]);
    if (name) return name;
  }
  return "";
}

// 单条推文：整页打开 /i/web/status/<id>，页面加载就会请求 TweetDetail，焦点推文和回复一起取。
async function handleTweet() {
  const st = await Kabegame.state();
  await Kabegame.waitForDom();
  if (!(await ensureLoggedIn(`https://x.com/i/web/status/${st.tweetId}`, "tweet"))) return;
  const r = await fetchConversation(st.tweetId, st, { navigate: false });
  if (r.rateLimited || r.error || !r.focal) {
    const why = r.rateLimited ? t("tweetRateLimited") : r.error || t("tweetUnavailable");
    await warn(t("tweetMissing", { id: st.tweetId, reason: why }));
    return Kabegame.exit();
  }
  const kinds = new Set(st.kinds);
  if (!hasWantedMedia(r.focal, st.kinds)) await warn(t("noWantedMedia"));
  if (st.maxComments > 0) await log(t("commentsSaved", { count: r.comments.length }));
  await downloadTweet(r.focal, kinds, r.comments, st);
  await Kabegame.addProgress(99);
  await Kabegame.exit();
}

// 收集一条时间线：消费已截获的响应、滚到底触发下一页，直到停止条件。
// spec: { op, label, watermarkKey, ordered, markSet?, noIncrementalNote? }。
// ordered=false（热门搜索、书签、点赞，推文 id 不单调）时最旧时间只过滤不提前停。
// 水位线两种：默认存最新推文 id、遇到不更新的 id 即停；markSet（书签 / 点赞，按收藏时间排）存上次最前面
// MARK_SET_SIZE 条的 id、遇到其中任一条即停——只记一条的话它被取消收藏后就再也遇不到了。
// 没有本次要的媒体类型的推文直接跳过，不计入上限。
// 返回收集到的推文，以及可写入的水位线（只有正常翻到头才给）。limit=0 表示不限。
const MARK_SET_SIZE = 5;
async function collectTimeline(st, spec, first, reader, limit) {
  const { op, label, ordered, markSet } = spec;
  const watermarkKey = str(spec.watermarkKey);
  const watermark = st.incremental && watermarkKey ? await readWatermark(watermarkKey) : "";
  const marks = markSet ? new Set(watermark.split(",").filter(Boolean)) : null;
  const isOld = (id) => Boolean(watermark) && (marks ? marks.has(id) : !idGreater(id, watermark));
  if (watermark) await log(markSet ? t("incrementalMarkSet", { count: marks.size }) : t("incrementalWatermark", { id: watermark }));
  if (st.incremental && spec.noIncrementalNote) await log(spec.noIncrementalNote);

  const seen = new Set();
  const collected = [];
  let newestId = "";
  let stopReason = "";
  let response = first;
  let idleRounds = 0;

  while (response || idleRounds < 3) {
    if (response) {
      if (response.status === 429) {
        await warn(t("rateLimited"));
        stopReason = "ratelimit";
        break;
      }
      let json = null;
      try {
        json = JSON.parse(response.text);
      } catch {}
      const tweets = json ? extractTweets(json) : [];
      if (!json || json.errors?.length) {
        await warn(t("responseAbnormal", { op, status: response.status, errors: JSON.stringify(json?.errors ?? null).slice(0, 200) }));
      }
      if (tweets.length === 0) {
        stopReason = "end";
        break;
      }
      const fresh = tweets.filter((t) => {
        const id = str(t.rest_id);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      await log(t("timelineAdded", { label, count: fresh.length, total: seen.size }));
      for (const tweet of fresh) {
        const id = str(tweet.rest_id);
        if (isOld(id)) {
          stopReason = "watermark";
          break;
        }
        if (st.timeMin !== null && idToMs(id) < st.timeMin) {
          if (!ordered) continue;
          stopReason = "timeMin";
          break;
        }
        if (!hasWantedMedia(tweet, st.kinds)) continue;
        if (limit > 0 && collected.length >= limit) {
          stopReason = "max";
          break;
        }
        if (!newestId || idGreater(id, newestId)) newestId = id;
        collected.push(tweet);
      }
      if (stopReason) break;
      idleRounds = 0;
    } else {
      idleRounds += 1;
    }
    // 滚到底触发下一页。没等到就先往上退一大段、再把最后一条滚进视口：实测搜索页偶尔滚到底也不发
    // 下一页请求，只抖 800px 不一定能让虚拟列表重新触发加载。
    if (idleRounds > 0) {
      window.scrollTo(0, Math.max(0, document.body.scrollHeight - 4000));
      await Kabegame.sleep(800);
      [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].at(-1)?.scrollIntoView({ block: "end" });
    }
    await Kabegame.sleep(300);
    window.scrollTo(0, document.body.scrollHeight);
    response = await nextResponse(reader, [op], 8000);
  }
  if (!stopReason) stopReason = "idle";

  const reasonText = {
    end: t("reasonEnd"),
    watermark: t("reasonWatermark"),
    timeMin: t("reasonTimeMin"),
    max: t("reasonMax"),
    ratelimit: t("reasonRateLimit"),
    idle: t("reasonIdle"),
  }[stopReason];
  await log(t("timelineDone", { label, reason: reasonText, count: collected.length }));
  // 因上限、限流或无响应提前停时不推进水位线，免得漏抓。
  const ok = st.incremental && watermarkKey && newestId && ["end", "watermark", "timeMin"].includes(stopReason);
  // markSet：本次没有新收藏就沿用旧记录；否则新的前几条不够数时用旧记录补齐。
  const value = markSet
    ? [...new Set([...collected.slice(0, MARK_SET_SIZE).map((t) => str(t.rest_id)), ...marks])].slice(0, MARK_SET_SIZE).join(",")
    : newestId;
  return { tweets: collected, watermark: ok && value ? { key: watermarkKey, value } : null };
}

// 逐条：有回复就进详情页抓回复，然后下载。进度按推文均分。
async function processQueue(st, items) {
  const perItem = items.length ? 99 / items.length : 0;
  let commentsDisabled = st.maxComments <= 0;
  let opened = 0;
  let saved = 0;
  for (const [i, { tweet, kinds }] of items.entries()) {
    let current = tweet;
    let comments = [];
    if (!commentsDisabled && (tweet.legacy?.reply_count ?? 0) > 0) {
      const r = await fetchConversation(str(tweet.rest_id), st, { tweet });
      if (r.rateLimited) {
        commentsDisabled = true;
        await warn(t("commentsRateLimited"));
      } else if (r.error) {
        await warn(t("commentsFetchFailed", { id: tweet.rest_id, error: r.error }));
      } else {
        if (r.focal) current = r.focal; // 详情页里的计数更新
        comments = r.comments;
        opened += 1;
        saved += comments.length;
      }
      await Kabegame.sleep(400 + Math.floor(Math.random() * 600));
    }
    await downloadTweet(current, kinds, comments, st);
    await Kabegame.addProgress(perItem);
    if ((i + 1) % 20 === 0) await log(t("progressLog", { done: i + 1, total: items.length }));
  }
  if (st.maxComments > 0) await log(t("commentSummary", { opened, saved }));
}

// SPA 路由跳转：文档不重载，在途下载不受影响。
function spaNavigate(path) {
  history.pushState({}, "", path);
  dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

// 打开推文详情页截获 TweetDetail；还有 Bottom 游标且未满上限就滚动加载更多。
// 走 /i/web/status/<id>，X 会自己跳到 /<用户>/status/<id>。实测直接推规范路径时，连续几条之后
// X 会只用缓存渲染焦点推文、不再请求回复（之后经主页再进、后退再进也无效），而 /i/web 路径每次都会请求。
// tweet：时间线里已有的推文（用于作者与回退路径）；单条推文模式没有，navigate=false 表示页面本身就是详情页。
async function fetchConversation(id, st, { tweet = null, navigate = true } = {}) {
  const screenName = (tweet && tweetAuthor(tweet).screenName) || st.screenName || "i";
  const reader = { index: navigate ? responses.length : 0, start: navigate ? responses.length : 0 };
  if (navigate) spaNavigate(`/i/web/status/${id}`);

  const byId = new Map();
  let focal = null;
  let response = await nextDetail(reader, id, navigate ? 10000 : 25000);
  if (!response && navigate) {
    spaNavigate(`/${screenName}/status/${id}`);
    response = await nextDetail(reader, id, 6000);
  }
  if (!response) {
    const seenOps = responses.slice(reader.start).map((r) => r.name).join(",") || t("none");
    return { error: t("detailWaitingMissing", { ops: seenOps, path: location.pathname }) };
  }
  let idle = 0;
  while (response || idle < 1) {
    if (response) {
      if (response.status === 429) return { rateLimited: true };
      let json = null;
      try {
        json = JSON.parse(response.text);
      } catch {}
      if (!json) return { error: t("detailNotJson", { status: response.status }) };
      const conv = extractConversation(json, id);
      if (conv.focal) focal = conv.focal;
      const focalAuthorId = tweetAuthor(focal ?? tweet ?? {}).id;
      for (const reply of conv.replies) {
        const rid = str(reply.rest_id);
        if (rid && rid !== id && !byId.has(rid) && byId.size < st.maxComments) byId.set(rid, buildComment(reply, focalAuthorId));
      }
      if (!conv.hasBottom || byId.size >= st.maxComments) break;
      idle = 0;
    } else {
      idle += 1;
    }
    window.scrollTo(0, document.body.scrollHeight);
    response = await nextDetail(reader, id, 4000);
  }
  return { focal, comments: [...byId.values()] };
}

async function nextDetail(reader, id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const r = await nextResponse(reader, ["TweetDetail"], left);
    if (!r) return null;
    let vars = "";
    try {
      vars = new URL(r.url, location.href).searchParams.get("variables") ?? "";
    } catch {}
    if (vars.includes(`"focalTweetId":"${id}"`)) return r;
  }
}

async function downloadTweet(tweet, kinds, comments, st) {
  let meta;
  try {
    meta = buildMetadata(tweet);
  } catch (e) {
    await warn(t("parseTweetFailed", { id: tweet?.rest_id, error: errorMessage(e) }));
    return;
  }
  meta.comments = comments;
  meta.commentsMax = st.maxComments;
  // 图片时间线来的取照片、视频时间线来的取视频/GIF；两条都来过就都取。
  const wanted = meta.media
    .map((m, index) => ({ ...m, index }))
    .filter((m) => kinds.has(m.type === "photo" ? "photo" : "video"))
    .filter((m) => m.url);
  if (wanted.length === 0) return;

  let metadataId;
  try {
    metadataId = await Kabegame.createImageMetadata(meta, { searchTexts: buildSearchTexts(meta) });
  } catch (e) {
    await warn(t("metadataFailed", { id: meta.tweet.id, error: errorMessage(e) }));
  }
  const labels = buildLabels(meta);
  if (st.extraLabel) labels.push(st.extraLabel);
  const snippet = truncateGraphemes(meta.tweet.text.replace(/\s+/g, " ").trim(), 40) || `@${meta.author.screenName}`;
  const withMeta = metadataId != null ? { metadata_id: metadataId } : { metadata: meta };
  for (const m of wanted) {
    const suffix = meta.media.length > 1 ? ` p${m.index + 1}` : "";
    try {
      await Kabegame.downloadImage(m.url, { name: `${snippet}${suffix}`, url: meta.tweet.url, ...withMeta, labels });
    } catch (e) {
      await warn(t("downloadFailed", { url: meta.tweet.url, suffix, error: errorMessage(e) }));
    }
  }

  // 评论配图：共用这条推文的 metadata，不挂画师 / 话题标签（不是画师本人的图）。
  if (!st.fetchCommentImages) return;
  for (const c of comments) {
    for (const [k, m] of c.media.entries()) {
      if (!m.url) continue;
      const suffix = c.media.length > 1 ? ` p${k + 1}` : "";
      try {
        await Kabegame.downloadImage(m.url, { name: `${snippet} [@${c.author.screenName} 的回复]${suffix}`, url: c.url, ...withMeta });
      } catch (e) {
        await warn(t("commentImageFailed", { url: c.url, suffix, error: errorMessage(e) }));
      }
    }
  }
}

// ── 初始页：解析配置、取用户信息 ────────────────────────────────────────

async function handleInitial() {
  const vars = Kabegame.vars ?? {};
  const mode = ["search", "tweet", "bookmarks", "likes"].includes(vars.mode) ? vars.mode : "artist";
  const mediaType = ["photo", "video", "all"].includes(vars.media_type) ? vars.media_type : "photo";
  const kinds = mediaType === "all" ? ["photo", "video"] : [mediaType];
  const maxTweets = clampInt(vars.max_tweets, 0, 0, 100000);
  const timeMin = parseDateFloor(vars.time_min);
  const incremental = vars.incremental !== false;
  const maxComments = clampInt(vars.max_comments, 50, 0, 1000);
  const fetchCommentImages = vars.fetch_comment_images === true;
  const common = { kinds, maxTweets, timeMin, incremental, maxComments, fetchCommentImages };
  const commonLog = t("commonLog", {
    types: kinds.map(kindName).join("+"),
    limit: maxTweets || t("unlimited"),
    incremental: incremental ? t("yes") : t("no"),
    comments: maxComments || t("commentsOff"),
    images: maxComments && fetchCommentImages ? t("withCommentImages") : "",
    timeMin: timeMin !== null
      ? t("timeMinSuffix", { date: new Date(timeMin).toLocaleDateString() })
      : "",
  });

  if (mode === "search") {
    const raw = str(vars.query).replace(/\s+/g, " ").trim();
    if (!raw) {
      await warn(t("searchQueryRequired"));
      return Kabegame.exit();
    }
    const query = searchQuery(raw, mediaType);
    const sort = vars.search_sort === "top" ? "top" : "latest";
    // 搜索结果挂一个标签，key 用搜索词哈希（原文含冒号、空格等不能当 key）。
    const extraLabel = { key: `q-${hashKey(raw.toLowerCase())}`, category: `${PLUGIN_ID}/search`, name: raw };
    await log(t("searchLog", { query, sort: sort === "top" ? t("sortTop") : t("sortLatest"), common: commonLog }));
    await Kabegame.updateState({ mode, query, sort, extraLabel, ...common });
    await Kabegame.to(searchUrl(query, sort), { pageLabel: "search" });
    return;
  }

  if (mode === "tweet") {
    const tweetId = parseTweetId(vars.tweet);
    if (!tweetId) {
      await warn(t("tweetInputInvalid", { value: str(vars.tweet) }));
      return Kabegame.exit();
    }
    await log(t("tweetLog", { id: tweetId, types: kinds.map(kindName).join("+"), comments: maxComments || t("commentsOff") }));
    await Kabegame.updateState({ mode, tweetId, ...common, maxTweets: 1, timeMin: null, incremental: false });
    await Kabegame.to(`https://x.com/i/web/status/${tweetId}`, { pageLabel: "tweet" });
    return;
  }

  if (mode === "bookmarks" || mode === "likes") {
    const conf = COLLECTIONS[mode];
    const extraLabel = { key: mode, category: `${PLUGIN_ID}/collection`, name: conf.labelName };
    await log(t("collectionLog", { label: conf.label, common: commonLog }));
    await Kabegame.updateState({ mode, extraLabel, ...common });
    await Kabegame.to(mode === "bookmarks" ? "https://x.com/i/bookmarks" : "https://x.com/home", { pageLabel: "collection" });
    return;
  }

  const screenName = parseScreenName(vars.user);
  if (!screenName) {
    await warn(t("artistInputInvalid", { value: str(vars.user) }));
    return Kabegame.exit();
  }
  await log(t("artistLog", { name: screenName, common: commonLog }));
  // userId 要等时间线页截获 UserByScreenName 后补齐（初始页是首页，拿不到）。
  await Kabegame.updateState({ mode, screenName, userId: "", ...common });
  await Kabegame.to(timelineUrl(screenName, kinds[0]), { pageLabel: "timeline" });
}

// 时间线页加载时页面会先发 UserByScreenName：从中取 rest_id 与媒体推文数（只用于日志）。
async function resolveUser(st) {
  if (st.userId) return st;
  const r = responses.find((x) => x.name === "UserByScreenName");
  let user = null;
  try {
    user = r ? JSON.parse(r.text)?.data?.user?.result : null;
  } catch {}
  // 2026-07 起 user.legacy 被拿掉，计数迁到 tweet_counts；旧字段留作兜底。
  const mediaCount = Number(user?.tweet_counts?.media_tweets ?? user?.legacy?.media_count ?? 0);
  const patch = { userId: str(user?.rest_id) };
  await log(t("artistInfoLog", { name: user?.core?.name ?? "?", id: patch.userId || "?", count: mediaCount || "?" }));
  await Kabegame.updateState(patch);
  return { ...st, ...patch };
}

async function main() {
  try {
    const label = await Kabegame.pageLabel();
    await log(t("pageLoaded", { phase: label, url: location.href }));
    if (label === "initial") return await handleInitial();
    if (label === "timeline") return await handleTimeline();
    if (label === "search") return await handleSearch();
    if (label === "collection") return await handleCollection();
    if (label === "tweet") return await handleTweet();
    await Kabegame.exit();
  } catch (e) {
    await warn(t("pluginFailed", { error: errorMessage(e) }));
    await Kabegame.exit();
  }
}

await main();
