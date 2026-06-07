// bun gen-config.ts  →  overwrites config.json
// Reads works-all.json, filters to valid work entries, stores the full URL path as variable.
import works from "./works-all.json";
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
      descripts: "排行榜：按周期排行页抓取。单个作品：从固定列表选择一部作品抓取。主题模式：在一覧页按标题关键字匹配进入该主题，再抓列表指定页范围",
      "descripts.en": "Ranking, pick one work from the list, or find one theme by keyword on the index page",
      "descripts.ja": "ランキング、作品リストから1作品を選択、またはキーワードで作品を検索",
      "descripts.ko": "랭킹, 목록에서 작품 선택, 또는 키워드로 작품 검색",
      "descripts.zhtw": "排行榜、從固定清單選取一部作品、或以關鍵字進入主題",
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
          name: "主题模式（一覧检索）",
          "name.en": "By theme (index search)",
          "name.ja": "テーマ指定（一覧から検索）",
          "name.ko": "테마 지정(목록 검색)",
          "name.zhtw": "主題模式（一覽搜尋）",
          variable: "by_theme",
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
      key: "theme_search",
      type: "string",
      name: "主题关键字",
      "name.en": "Theme keyword",
      "name.ja": "作品名キーワード",
      "name.ko": "작품 키워드",
      "name.zhtw": "主題關鍵字",
      descripts: "在作品タイトル一覧页中，匹配链接文案「包含」此字符串的第一个主题（区分大小写与日语原文一致更易命中）",
      "descripts.en": "First index link whose text contains this substring (case-sensitive)",
      "descripts.ja": "一覧のリンク文言にこの文字列が含まれる最初の作品へ",
      "descripts.ko": "목록 링크 텍스트에 부분 문자열이 포함된 첫 작품",
      "descripts.zhtw": "一覽頁連結文案「包含」此字串的第一個主題",
      default: "",
      options: null,
      min: null,
      max: null,
      when: { crawl_mode: ["by_theme"] },
    },
    {
      key: "theme_start_page",
      type: "int",
      name: "主题列表起始页",
      "name.en": "Theme list start page",
      "name.ja": "テーマ一覧の開始ページ",
      "name.ko": "테마 목록 시작 페이지",
      "name.zhtw": "主題列表起始頁",
      descripts: "进入主题后，作品列表从第几页开始抓取（1 为列表第一页）；此前的页仅翻页不下载",
      "descripts.en": "1-based list page to start downloading (earlier pages are skipped)",
      "descripts.ja": "テーマ内リストの取得開始ページ（1 始まり）",
      "descripts.ko": "테마 목록에서 수집을 시작할 페이지(1부터)",
      "descripts.zhtw": "進入主題後從第幾頁開始抓（1 為第一頁）",
      default: 1,
      options: null,
      min: 1,
      max: 9999,
      when: { crawl_mode: ["by_theme"] },
    },
    {
      key: "theme_end_page",
      type: "int",
      name: "主题列表结束页",
      "name.en": "Theme list end page",
      "name.ja": "テーマ一覧の終了ページ",
      "name.ko": "테마 목록 끝 페이지",
      "name.zhtw": "主題列表結束頁",
      descripts: "作品列表抓到第几页为止（含该页）；若站点无下一页则提前结束，进度会补足",
      "descripts.en": "Last list page to crawl (inclusive); stops early if no next link",
      "descripts.ja": "テーマ内リストの終了ページ（このページを含む）",
      "descripts.ko": "테마 목록에서 수집을 끝낼 페이지(포함)",
      "descripts.zhtw": "列表抓到第幾頁為止（含該頁）",
      default: 10,
      options: null,
      min: 1,
      max: 9999,
      when: { crawl_mode: ["by_theme"] },
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

await Bun.write("config.json", JSON.stringify(config, null, 2) + "\n");
console.log(`Done. ${workOptions.length} works written to config.json`);
