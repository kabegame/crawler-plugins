// @ts-nocheck
const { addProgress, downloadImage } = Kabegame;

const DEFAULT_BASE_URL = "https://t.ziworld.top";

// 目录名大多是中文，label key 只允许 ASCII：已知目录用固定英文 key，name 保留原名；
// 站点新增的目录按码点确定性编码成 u-xxxx-…，保证同名目录永远落到同一个标签。
const CATEGORY_LABEL_KEYS = {
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

function categoryLabelKey(category) {
  const known = CATEGORY_LABEL_KEYS[category];
  if (known) return known;
  const ascii = category.toLowerCase().replace(/\s+/g, " ");
  const key = /^[a-z0-9_\-() ]+$/.test(ascii)
    ? ascii
    : "u-" + Array.from(category, (ch) => ch.codePointAt(0).toString(16)).join("-");
  return key.length <= 64 ? key : "";
}

function labelsOfCategory(category) {
  const name = String(category || "").trim();
  const key = name ? categoryLabelKey(name) : "";
  return key ? [{ key, category: "ziworld/category", name }] : [];
}

function selected(categoryMap, key) {
  return categoryMap && categoryMap[key] === true;
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const res = await (await fetch(`${baseUrl}/date.json`)).json();
  // 站点现在直接返回顶层数组，旧版包在 { data: [...] } 里，两种都认
  const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
  if (list.length === 0) throw new Error(`date.json 没有可用的目录列表，站点数据结构可能又变了：${baseUrl}/date.json`);
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
