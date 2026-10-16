// @ts-nocheck
// 专栏关键词搜索（search.bilibili.com 专栏 Tab）：签名、翻页、结果解析。
import { SEARCH_API } from "./consts";
import { coerceStr } from "./util";
import { signUrl } from "./wbi";

export function signSearchUrl(vars, page, img, sub) {
  const pairs = [
    ["category_id", coerceStr(vars.category_id || "0")],
    ["keyword", coerceStr(vars.keyword)],
  ];
  const order = coerceStr(vars.order);
  if (order) pairs.push(["order", order]);
  pairs.push(
    ["page", String(page)],
    ["page_size", String(Number(vars.page_size ?? 20))],
    ["search_type", "article"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  );
  return signUrl(SEARCH_API, pairs, img, sub);
}

/** 搜索结果两种形态（分块 result_type / 平铺 type）都解析成 [{id, desc}]。 */
export function collectArticleIds(data) {
  const ids = [];
  const result = Array.isArray(data?.result) ? data.result : [];
  if (result[0]?.result_type != null) {
    for (const block of result) {
      if (block?.result_type !== "article") continue;
      for (const item of Array.isArray(block?.data) ? block.data : []) {
        if (item?.id != null) ids.push({ id: item.id, desc: coerceStr(item.desc) });
      }
    }
    return ids;
  }
  for (const item of result) {
    if (item?.type === "article" && item?.id != null) {
      ids.push({ id: item.id, desc: coerceStr(item.desc) });
    }
  }
  return ids;
}
