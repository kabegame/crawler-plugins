// ziworld metadata 迁移脚本：只提供 provideLabels，按 metadata.category 给历史图片补目录标签，不改写 metadata。
// 规则与 src/index.ts 的 labelsOfCategory 一致（此处无法 import，保持两份同步）。

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

export function provideLabels(input) {
  const metadata = JSON.parse(input);
  return labelsOfCategory(metadata && metadata.category);
}
