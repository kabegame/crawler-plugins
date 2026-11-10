// The Anime Gallery（theanimegallery.com）V8 爬虫：首页精选 / 分类 / 搜索三种模式。
//
// 站点是 Next.js SSG，页面 HTML 内嵌 `<script id="__NEXT_DATA__">`，一次带回全部结果、
// 无分页（`/search/<词>/2` 与 `/category/<分类>/2` 均为 404，`?page=2` 返回同一份数据）：
// - 首页 `/`：`props.pageProps.topImages`（24 条精选）；
// - 分类 `/category/<分类>`：`props.pageProps.images`（最多 80 条，分类清单来自
//   globalData.categories，共 46 个，固化在 kbConfig 的 options 里）；
// - 搜索 `/search/<关键词>`（多词用连字符）：`props.pageProps.images`（最多 80 条）。
// 每条记录自带原图 URL（imageURL，可直拉、无防盗链），所以不进详情页。
// 记录里的 size 恒为 500x500 占位值，不入 metadata；真实尺寸由应用入库时计算。

import { t } from "./i18n";

const { addProgress, downloadImage, warn } = Kabegame;

const DEFAULT_BASE_URL = "https://theanimegallery.com";

// 站点一条记录（__NEXT_DATA__.props.pageProps.images[] 元素）
type TagImage = {
  id?: string | null;
  imageURL?: string | null;
  tags?: string[] | null;
  labels?: string[] | null;
  title?: string | null;
  description?: string | null;
  timestamp?: string | null;
  collectionID?: string | null;
  categoryID?: string | null;
  srcset?: string | null;
  siteID?: string | null;
};

type TagMetadata = {
  schema: number;
  id: string;
  page_url: string;
  title: string;
  description: string;
  image_url: string;
  tags: string[];
  labels: string[];
  collection: string;
  category: string;
  timestamp: string;
};

type TagVars = {
  mode?: unknown;
  category?: unknown;
  keyword?: unknown;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message != null) return String(message);
  }
  return String(error);
}

function strList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((v) => String(v ?? "").trim()).filter(Boolean);
}

// 站点搜索路径：小写、空白折叠成连字符（源站搜索链接的规范形态，如 /search/dragon-ball）
function searchSlug(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, "-");
}

// 详情页 /image/<id>/<slug>，slug 由标题按同样规则派生（实测与源站链接一致）
function pageUrl(base: string, image: TagImage): string {
  const slug = searchSlug(String(image.title || ""));
  return `${base}/image/${encodeURIComponent(String(image.id || ""))}/${encodeURIComponent(slug)}`;
}

// label key 只允许 [a-zA-Z0-9_-]、英文括号与空格；站点标签多为 ASCII 词，
// 比例标签形如 "2:1"，冒号替换成连字符保留区分度；派生为空或超长的跳过。
function labelKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[:/]/g, "-")
    .replace(/[^a-z0-9_\-() \t\n\r]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return key && key.length <= 64 ? key : "";
}

// 站点一条记录有三类标签：tags（搜索标签）、labels（内容标签）、categoryID（分类），
// 分别映射到 theanimegallery/{tag,label,category} 三个固定目录。
function labelsFromImage(image: TagImage): KabegameLabelInput[] {
  const out: KabegameLabelInput[] = [];
  const push = (names: string[], category: string) => {
    for (const name of names) {
      const key = labelKey(name);
      if (!key) continue;
      out.push({ key, category: `theanimegallery/${category}`, name });
    }
  };
  push(strList(image.tags), "tag");
  push(strList(image.labels), "label");
  push(strList([image.categoryID]), "category");
  return out;
}

function buildMetadata(image: TagImage, page: string): TagMetadata {
  return {
    schema: 1,
    id: String(image.id || ""),
    page_url: page,
    title: String(image.title || ""),
    description: String(image.description || ""),
    image_url: String(image.imageURL || ""),
    tags: strList(image.tags),
    labels: strList(image.labels),
    collection: String(image.collectionID || ""),
    category: String(image.categoryID || ""),
    timestamp: String(image.timestamp || ""),
  };
}

// 元数据搜索片段覆盖 description.ejs 面板里的文字：标题、标签、内容标签、分类、
// 合集名与日期（年月日三词）；不含描述句尾重复的标签串。
function searchTextsFromMetadata(meta: TagMetadata): string[] {
  const out: string[] = ["theanimegallery"];
  const field = (key: string, values: unknown[]) => {
    const list = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (list.length) out.push(key, ...list);
  };
  field("title", [meta.title]);
  field("tags", meta.tags);
  field("labels", meta.labels);
  field("category", [meta.category]);
  field("collection", [meta.collection]);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.timestamp);
  if (ymd) field("date", [ymd[1], String(Number(ymd[2])), String(Number(ymd[3]))]);
  return [...new Set(out)];
}

type TagPageProps = {
  images?: TagImage[] | null;
  topImages?: TagImage[] | null;
};

// 取页面 HTML 里内嵌的 __NEXT_DATA__ pageProps
async function fetchPageProps(url: string): Promise<TagPageProps> {
  console.log(t("openPage", { url }));
  const res = await fetch(url);
  if (!res.ok) throw new Error(t("listHttpError", { status: res.status }));
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const raw = doc.querySelector("script#__NEXT_DATA__")?.textContent;
  if (!raw) throw new Error(t("noNextData"));
  const data = JSON.parse(raw) as { props?: { pageProps?: TagPageProps } };
  return data?.props?.pageProps || {};
}

function imageList(value: TagImage[] | null | undefined): TagImage[] {
  return Array.isArray(value) ? value : [];
}

async function downloadOne(base: string, image: TagImage): Promise<void> {
  const imageUrl = String(image?.imageURL || "");
  if (!imageUrl) {
    warn(t("noImageUrl", { id: String(image?.id || "?") }));
    return;
  }
  const page = pageUrl(base, image);
  const metadata = buildMetadata(image, page);
  const opts: KabegameDownloadImageOptions = {
    name: metadata.title || `theanimegallery ${metadata.id}`,
    url: page,
    metadata,
    searchTexts: searchTextsFromMetadata(metadata),
  };
  const labels = labelsFromImage(image);
  if (labels.length > 0) opts.labels = labels;
  await downloadImage(imageUrl, opts);
}

export async function crawl(common: unknown, custom: unknown): Promise<void> {
  const cfg = (common || {}) as { base_url?: unknown };
  const base = String(cfg.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const vars = (custom || {}) as TagVars;
  const mode = coerceStr(vars.mode) || "home";

  // 三种模式只差页面 URL 与 pageProps 里的字段名
  let url: string;
  let pick: (pp: TagPageProps) => TagImage[];
  let what: string;
  if (mode === "home") {
    url = `${base}/`;
    pick = (pp) => imageList(pp.topImages);
    what = t("sourceHome");
  } else if (mode === "category") {
    const category = coerceStr(vars.category).trim().toLowerCase();
    if (!category) {
      warn(t("categoryRequired"));
      addProgress(100);
      return;
    }
    url = `${base}/category/${encodeURIComponent(category)}`;
    pick = (pp) => imageList(pp.images);
    what = t("sourceCategory", { category });
  } else if (mode === "search") {
    const keyword = coerceStr(vars.keyword).trim();
    if (!keyword) {
      warn(t("keywordRequired"));
      addProgress(100);
      return;
    }
    url = `${base}/search/${encodeURIComponent(searchSlug(keyword))}`;
    pick = (pp) => imageList(pp.images);
    what = t("sourceSearch", { keyword });
  } else {
    warn(t("unknownMode", { mode }));
    addProgress(100);
    return;
  }

  let images: TagImage[];
  try {
    images = pick(await fetchPageProps(url));
  } catch (e) {
    warn(t("listReadFailed", { error: errorMessage(e) }));
    addProgress(100);
    return;
  }
  addProgress(5);
  console.log(t("listSummary", { what, count: images.length }));
  if (images.length === 0) {
    addProgress(95);
    return;
  }

  const pctPerImage = 95 / images.length;
  for (const [i, image] of images.entries()) {
    try {
      await downloadOne(base, image);
      console.log(t("itemDone", { index: i + 1, count: images.length, title: String(image?.title || image?.id || "?") }));
    } catch (e) {
      warn(t("downloadFailed", { id: String(image?.id || "?"), error: errorMessage(e) }));
    }
    addProgress(pctPerImage);
  }
  console.log(t("done"));
}
