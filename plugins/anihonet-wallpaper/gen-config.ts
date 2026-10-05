// bun gen-config.ts  -> updates package.json kbBaseUrl/kbConfig
// Reads works-all.json, filters to valid work entries, stores the full URL path as variable.
import fs from "fs";
import works from "./works-all.json";

const PACKAGE_JSON = "package.json";

function writePackageConfig(config: { baseUrl: string; var: unknown[] }): void {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8")) as Record<string, unknown>;
  pkg.kbBaseUrl = config.baseUrl;
  pkg.kbConfig = config.var;
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

// Extract path after "https://anihonetwallpaper.com/" (no leading slash, no fragment/query).
function urlPath(href: string): string {
  const path = href.replace("https://anihonetwallpaper.com/", "").split("?")[0].split("#")[0];
  return path;
}

const SKIP_PATHS = new Set(["", "anime-game-wallpaper", "ranking-daily", "contact"]);

function isValidWork(href: string): boolean {
  const path = urlPath(href);
  if (SKIP_PATHS.has(path) || path.includes("#")) return false;
  return (
    path.startsWith("images/") ||
    path.startsWith("category/") ||
    path.startsWith("tag/") ||
    path.startsWith("%")  // root-level URL-encoded Japanese paths
  );
}

// Deduplicate by href.
const seen = new Set<string>();
const filtered = (works as { href: string; text: string }[]).filter((w) => {
  if (!isValidWork(w.href) || seen.has(w.href)) return false;
  seen.add(w.href);
  return true;
});

// Minimal i18n: everything defaults to the Japanese title for now.
// Run patch-translations.ts afterwards to fill in zh/en/ko/zhtw.
const workOptions = filtered.map((w) => ({
  name: w.text,
  "name.en": w.text,
  "name.ja": w.text,
  "name.ko": w.text,
  "name.zhtw": w.text,
  variable: urlPath(w.href),
}));

const config = {
  baseUrl: "https://anihonetwallpaper.com",
  selector: null,
  var: [
    {
      key: "crawl_mode",
      type: "options",
      name: "爬取模式",
      "name.en": "Crawl mode",
      "name.ja": "取得モード",
      "name.ko": "수집 모드",
      "name.zhtw": "爬取模式",
      descripts: "排行榜：按周期排行页抓取。单个作品：从固定列表选择一部作品抓取。搜索：通过站内搜索 URL 按关键词、方向、排序和页码范围抓取",
      "descripts.en": "Ranking, pick one work from the list, or use site search with configurable direction and sorting",
      "descripts.ja": "ランキング、作品リストから1作品を選択、または方向・並び順を指定してサイト内検索",
      "descripts.ko": "랭킹, 목록에서 작품 선택, 또는 방향과 정렬을 지정한 사이트 검색",
      "descripts.zhtw": "排行榜、從固定清單選取一部作品，或以可設定的方向與排序進行站內搜尋",
      default: "ranking",
      options: [
        {
          name: "排行榜",
          "name.en": "Ranking",
          "name.ja": "ランキング",
          "name.ko": "랭킹",
          "name.zhtw": "排行榜",
          variable: "ranking",
        },
        {
          name: "单个作品",
          "name.en": "Single work",
          "name.ja": "作品指定",
          "name.ko": "작품 지정",
          "name.zhtw": "單個作品",
          variable: "single_work",
        },
        {
          name: "搜索",
          "name.en": "Search",
          "name.ja": "検索",
          "name.ko": "검색",
          "name.zhtw": "搜尋",
          variable: "search",
        },
      ],
    },
    {
      key: "ranking_period",
      type: "options",
      name: "排行榜周期",
      "name.en": "Ranking period",
      "name.ja": "ランキング期間",
      "name.ko": "랭킹 기간",
      "name.zhtw": "排行榜週期",
      descripts: "选择要爬取的排行榜周期：日榜、周榜、月榜或年榜",
      "descripts.en": "Daily, weekly, monthly or annual ranking",
      "descripts.ja": "日間・週間・月間・年間ランキング",
      "descripts.ko": "일간·주간·월간·연간 랭킹",
      "descripts.zhtw": "選擇要爬取的排行榜週期：日榜、週榜、月榜或年榜",
      default: "daily",
      options: [
        { name: "日榜", "name.en": "Daily",   "name.ja": "日間", "name.ko": "일간", "name.zhtw": "日榜",  variable: "daily"   },
        { name: "周榜", "name.en": "Weekly",  "name.ja": "週間", "name.ko": "주간", "name.zhtw": "週榜",  variable: "weekly"  },
        { name: "月榜", "name.en": "Monthly", "name.ja": "月間", "name.ko": "월간", "name.zhtw": "月榜",  variable: "monthly" },
        { name: "年榜", "name.en": "Annual",  "name.ja": "年間", "name.ko": "연간", "name.zhtw": "年榜",  variable: "annual"  },
      ],
      min: null,
      max: null,
      when: { crawl_mode: ["ranking"] },
    },
    {
      key: "selected_work",
      type: "options",
      name: "作品",
      "name.en": "Work",
      "name.ja": "作品",
      "name.ko": "작품",
      "name.zhtw": "作品",
      descripts: "选择要爬取的动漫/游戏作品（固定列表，对应站点 images/、category/ 或 tag/ 路径）",
      "descripts.en": "Select the anime/game work to crawl (hardcoded list matching the site's images/, category/, or tag/ paths)",
      "descripts.ja": "爬取する作品を選択（サイトの images/・category/・tag/ パスに対応する固定リスト）",
      "descripts.ko": "수집할 애니메이션/게임 작품 선택(사이트 images/·category/·tag/ 경로에 대응하는 고정 목록)",
      "descripts.zhtw": "選擇要爬取的動漫/遊戲作品（固定清單，對應網站 images/、category/ 或 tag/ 路徑）",
      default: workOptions[0]?.variable ?? "",
      options: workOptions,
      when: { crawl_mode: ["single_work"] },
    },
    {
      key: "work_start_page",
      type: "int",
      name: "作品列表起始页",
      "name.en": "Work list start page",
      "name.ja": "作品一覧の開始ページ",
      "name.ko": "작품 목록 시작 페이지",
      "name.zhtw": "作品列表起始頁",
      descripts: "所选作品从第几页开始抓取（1 为列表第一页）；此前的页仅翻页不下载",
      "descripts.en": "1-based page to start downloading for the selected work (earlier pages are skipped)",
      "descripts.ja": "選択した作品の取得開始ページ（1 始まり）",
      "descripts.ko": "선택한 작품에서 수집을 시작할 페이지(1부터)",
      "descripts.zhtw": "所選作品從第幾頁開始爬取（1 為列表第一頁）",
      default: 1,
      options: null,
      min: 1,
      max: 9999,
      width: 1,
      when: { crawl_mode: ["single_work"] },
    },
    {
      key: "work_end_page",
      type: "int",
      name: "作品列表结束页",
      "name.en": "Work list end page",
      "name.ja": "作品一覧の終了ページ",
      "name.ko": "작품 목록 끝 페이지",
      "name.zhtw": "作品列表結束頁",
      descripts: "所选作品抓到第几页为止（含该页）；若站点无下一页则提前结束并打印警告",
      "descripts.en": "Last page to crawl for the selected work (inclusive); warns and stops at the site's last page",
      "descripts.ja": "選択した作品の終了ページ（このページを含む）。サイトの最終ページを超える場合は警告します",
      "descripts.ko": "선택한 작품에서 수집을 끝낼 페이지(포함). 사이트의 마지막 페이지를 넘으면 경고합니다",
      "descripts.zhtw": "所選作品爬取到第幾頁為止（含該頁）；超過網站末頁時會警告",
      default: 10,
      options: null,
      min: 1,
      max: 9999,
      width: 1,
      when: { crawl_mode: ["single_work"] },
    },
    {
      key: "search_query",
      type: "string",
      name: "搜索关键词",
      "name.en": "Search keyword",
      "name.ja": "検索キーワード",
      "name.ko": "검색 키워드",
      "name.zhtw": "搜尋關鍵字",
      descripts: "作为站内搜索 URL 的 s 参数；支持作品名、角色名等站点可检索内容",
      "descripts.en": "Value of the site search URL's s parameter, such as a title or character name",
      "descripts.ja": "サイト内検索 URL の s パラメータ。作品名やキャラクター名などを入力します",
      "descripts.ko": "작품명이나 캐릭터명 등 사이트 검색 URL의 s 매개변수 값",
      "descripts.zhtw": "作為站內搜尋 URL 的 s 參數，可輸入作品名、角色名等",
      default: "",
      options: null,
      min: null,
      max: null,
      width: 2,
      when: { crawl_mode: ["search"] },
    },
    {
      key: "search_order",
      type: "options",
      name: "排列方向",
      "name.en": "Direction",
      "name.ja": "並び方向",
      "name.ko": "정렬 방향",
      "name.zhtw": "排列方向",
      descripts: "对应搜索 URL 的 order 参数",
      "descripts.en": "The search URL's order parameter",
      "descripts.ja": "検索 URL の order パラメータ",
      "descripts.ko": "검색 URL의 order 매개변수",
      "descripts.zhtw": "對應搜尋 URL 的 order 參數",
      default: "DESC",
      options: [
        { name: "降序", "name.en": "Descending", "name.ja": "降順", "name.ko": "내림차순", "name.zhtw": "降冪", variable: "DESC" },
        { name: "升序", "name.en": "Ascending", "name.ja": "昇順", "name.ko": "오름차순", "name.zhtw": "升冪", variable: "ASC" },
      ],
      width: 1,
      when: { crawl_mode: ["search"] },
    },
    {
      key: "search_orderby",
      type: "options",
      name: "排序方式",
      "name.en": "Sort by",
      "name.ja": "並び順",
      "name.ko": "정렬 기준",
      "name.zhtw": "排序方式",
      descripts: "对应搜索 URL 的 orderby 参数；随机排序时方向不影响结果",
      "descripts.en": "The search URL's orderby parameter; direction does not affect random sorting",
      "descripts.ja": "検索 URL の orderby パラメータ。ランダムでは並び方向は結果に影響しません",
      "descripts.ko": "검색 URL의 orderby 매개변수. 무작위 정렬에서는 방향이 결과에 영향을 주지 않습니다",
      "descripts.zhtw": "對應搜尋 URL 的 orderby 參數；隨機排序時方向不影響結果",
      default: "post_date",
      options: [
        { name: "发布日期", "name.en": "Published date", "name.ja": "投稿日", "name.ko": "게시일", "name.zhtw": "發布日期", variable: "post_date" },
        { name: "随机", "name.en": "Random", "name.ja": "ランダム", "name.ko": "무작위", "name.zhtw": "隨機", variable: "rand" },
      ],
      width: 1,
      when: { crawl_mode: ["search"] },
    },
    {
      key: "search_start_page",
      type: "int",
      name: "搜索起始页",
      "name.en": "Search start page",
      "name.ja": "検索開始ページ",
      "name.ko": "검색 시작 페이지",
      "name.zhtw": "搜尋起始頁",
      descripts: "搜索结果从第几页开始抓取（1 为第一页）",
      "descripts.en": "1-based search results page to start downloading",
      "descripts.ja": "検索結果の取得開始ページ（1 始まり）",
      "descripts.ko": "검색 결과 수집을 시작할 페이지(1부터)",
      "descripts.zhtw": "搜尋結果從第幾頁開始爬取（1 為第一頁）",
      default: 1,
      options: null,
      min: 1,
      max: 9999,
      width: 1,
      when: { crawl_mode: ["search"] },
    },
    {
      key: "search_end_page",
      type: "int",
      name: "搜索结束页",
      "name.en": "Search end page",
      "name.ja": "検索終了ページ",
      "name.ko": "검색 끝 페이지",
      "name.zhtw": "搜尋結束頁",
      descripts: "搜索结果抓取到第几页为止（含该页）；超过站点末页的部分会跳过",
      "descripts.en": "Last search results page to crawl (inclusive); pages beyond the site's last page are skipped",
      "descripts.ja": "検索結果の終了ページ（このページを含む）。サイトの最終ページを超える部分はスキップします",
      "descripts.ko": "검색 결과 수집을 끝낼 페이지(포함). 사이트의 마지막 페이지를 넘는 부분은 건너뜁니다",
      "descripts.zhtw": "搜尋結果爬取到第幾頁為止（含該頁）；超過網站末頁的部分會略過",
      default: 10,
      options: null,
      min: 1,
      max: 9999,
      width: 1,
      when: { crawl_mode: ["search"] },
    },
    {
      key: "start_page",
      type: "int",
      name: "起始页面",
      "name.en": "Start page",
      "name.ja": "開始ページ",
      "name.ko": "시작 페이지",
      "name.zhtw": "起始頁面",
      descripts: "要拉取的起始页面",
      "descripts.en": "Start page to crawl from",
      "descripts.ja": "取得開始ページ",
      "descripts.ko": "가져올 시작 페이지",
      "descripts.zhtw": "要拉取的起始頁面",
      default: 1,
      options: null,
      min: 1,
      max: 5,
      when: { crawl_mode: ["ranking"] },
    },
    {
      key: "end_page",
      type: "int",
      name: "结束页数",
      "name.en": "End page",
      "name.ja": "終了ページ",
      "name.ko": "끝 페이지",
      "name.zhtw": "結束頁數",
      descripts: "要拉取的结束页面",
      "descripts.en": "End page to crawl to",
      "descripts.ja": "取得終了ページ",
      "descripts.ko": "가져올 끝 페이지",
      "descripts.zhtw": "要拉取的結束頁面",
      default: 5,
      options: null,
      min: 1,
      max: 5,
      when: { crawl_mode: ["ranking"] },
    },
    {
      key: "wallpaper_type",
      type: "options",
      name: "排行榜子类",
      "name.en": "Ranking category",
      "name.ja": "ランキング種別",
      "name.ko": "랭킹 하위 종류",
      "name.zhtw": "排行榜子類",
      descripts: "对应站点路径：综合为 ranking-{周期}，其余为 ranking-{周期}-{子类}（如日榜综合 ranking-daily，手机为 ranking-daily-sp）",
      "descripts.en": "Combined uses ranking-{period}; others use ranking-{period}-{slug}",
      "descripts.ja": "総合は ranking-{期間}、それ以外は ranking-{期間}-{種別}",
      "descripts.ko": "종합은 ranking-{기간}, 나머지는 ranking-{기간}-{하위}",
      "descripts.zhtw": "綜合為 ranking-{週期}，其餘為 ranking-{週期}-{子類}",
      default: "imgpc",
      options: [
        { name: "综合",           "name.en": "All",                    "name.ja": "総合",           "name.ko": "종합",          "name.zhtw": "綜合",           variable: "all"    },
        { name: "手机壁纸 (sp)",  "name.en": "Mobile (sp)",            "name.ja": "スマホ壁紙 (sp)", "name.ko": "모바일 (sp)",   "name.zhtw": "手機壁紙 (sp)",  variable: "sp"     },
        { name: "高质量图片 (image)", "name.en": "High-quality images (image)", "name.ja": "高品質画像 (image)", "name.ko": "고품질 이미지 (image)", "name.zhtw": "高品質圖片 (image)", variable: "image"  },
        { name: "高质量PC壁纸 (imgpc)", "name.en": "High-quality PC (imgpc)", "name.ja": "高品質PC壁紙 (imgpc)", "name.ko": "고품질 PC (imgpc)", "name.zhtw": "高品質PC壁紙 (imgpc)", variable: "imgpc"  },
        { name: "PC壁纸 (pc)",    "name.en": "PC wallpapers (pc)",     "name.ja": "PC壁紙 (pc)",    "name.ko": "PC 벽지 (pc)",  "name.zhtw": "PC壁紙 (pc)",    variable: "pc"     },
      ],
      when: { crawl_mode: ["ranking"] },
    },
  ],
};

writePackageConfig(config);
console.log(`Done. ${workOptions.length} works written to package.json kbConfig`);
