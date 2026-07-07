// @ts-nocheck
const { addProgress, downloadImage } = Kabegame;

const DEFAULT_BASE_URL = "https://t.ziworld.top";

function selected(categoryMap, key) {
  return categoryMap && categoryMap[key] === true;
}

export async function crawl(common, custom) {
  const vars = custom || {};
  const baseUrl = common?.baseUrl || DEFAULT_BASE_URL;
  const res = await (await fetch(`${baseUrl}/date.json`)).json();
  const list = Array.isArray(res?.data) ? res.data : [];
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
      });
      if (total > 0) addProgress(percentPerImage);
    }
  }
}
