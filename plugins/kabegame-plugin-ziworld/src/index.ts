import { t } from "./i18n";

const { addProgress, downloadImage } = Kabegame;

const DEFAULT_BASE_URL = "https://t.ziworld.top";

// 目录名大多是中文，label key 只允许 ASCII：已知目录用固定英文 key，name 保留原名；
// 站点新增的目录按码点确定性编码成 u-xxxx-…，保证同名目录永远落到同一个标签。
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  PC: "pc",
  背景: "background",
  二次元: "anime",
  移动端: "mobile",
  手机壁纸: "phone-wallpaper",
  横版壁纸: "landscape-wallpaper",
  头像: "avatar",
  萌图MP: "moe-mobile",
  萌图PC: "moe-pc",
  原神: "genshin-impact",
  崩坏: "honkai",
  鸣潮: "wuthering-waves",
  鬼刀: "ghostblade",
  初音未来: "hatsune-miku",
  video: "video",
  七濑胡桃: "nanase-kurumi",
  未归类: "uncategorized",
};

// 站点 date.json 的条目：category 是目录名，baseUrl + zids 里的每一项拼出图片地址
type ZiworldDateItem = {
  category: string;
  baseUrl?: string | null;
  zids?: unknown[];
};

// 配置字段来自 GUI（checkbox 传对象、CLI --var 只能给字符串），统一按 unknown 收窄
type ZiworldVars = {
  category?: unknown;
};

function coerceStr(value: unknown): string {
  return value == null ? "" : String(value);
}

function categoryLabelKey(category: unknown): string {
  const known = CATEGORY_LABEL_KEYS[coerceStr(category)];
  if (known) return known;
  const ascii = coerceStr(category).toLowerCase().replace(/\s+/g, " ");
  const key = /^[a-z0-9_\-() ]+$/.test(ascii)
    ? ascii
    : "u-" + Array.from(coerceStr(category), (ch) => ch.codePointAt(0)?.toString(16) ?? "").join("-");
  return key.length <= 64 ? key : "";
}

function labelsOfCategory(category: unknown): KabegameLabelInput[] {
  const name = String(category || "").trim();
  const key = name ? categoryLabelKey(name) : "";
  return key ? [{ key, category: "ziworld/category", name }] : [];
}

// checkbox 配置是 { 目录名: true }；只认对象上的 true，与原来的 categoryMap[key] === true 一致
function selected(categoryMap: unknown, key: unknown): boolean {
  if (!categoryMap || typeof categoryMap !== "object") return false;
  return (categoryMap as Record<string, unknown>)[coerceStr(key)] === true;
}

// 站点现在直接返回顶层数组，旧版包在 { data: [...] } 里，两种都认
function dateListOf(res: unknown): ZiworldDateItem[] {
  if (Array.isArray(res)) return res as ZiworldDateItem[];
  if (res && typeof res === "object") {
    const data = (res as { data?: unknown }).data;
    if (Array.isArray(data)) return data as ZiworldDateItem[];
  }
  return [];
}

export async function crawl(
  common: unknown,
  custom: Record<string, unknown> | null | undefined,
): Promise<void> {
  const cfg = (common || {}) as { baseUrl?: unknown };
  const vars = (custom || {}) as ZiworldVars;
  const baseUrl = coerceStr(cfg.baseUrl || DEFAULT_BASE_URL);
  const res: unknown = await (await fetch(`${baseUrl}/date.json`)).json();
  const list = dateListOf(res);
  if (list.length === 0) {
    throw new Error(t("dataListEmpty", { url: `${baseUrl}/date.json` }));
  }
  const category = vars.category || {};

  let total = 0;
  for (const item of list) {
    if (selected(category, item?.category)) {
      total += Array.isArray(item?.zids) ? item.zids.length : 0;
    }
  }

  const percentPerImage = total > 0 ? 100.0 / total : 0.0;
  for (const item of list) {
    if (!selected(category, item?.category)) continue;
    const itemBase = String(item?.baseUrl || "");
    for (const zid of Array.isArray(item?.zids) ? item.zids : []) {
      await downloadImage(`${itemBase}${zid}`, {
        metadata: { category: item.category },
        labels: labelsOfCategory(item.category),
      });
      if (total > 0) addProgress(percentPerImage);
    }
  }
}
