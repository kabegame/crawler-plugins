// 专栏关键词搜索（search.bilibili.com 专栏 Tab）：签名、翻页、结果解析。
import { SEARCH_API } from "./consts";
import { coerceStr, type BilibiliResponse } from "./util";
import { signUrl, type WbiPair } from "./wbi";

/** 搜索配置：GUI 字段可能有类型，CLI --var 一定是字符串，统一按 unknown 收窄。 */
export type SearchVars = {
  category_id?: unknown;
  keyword?: unknown;
  order?: unknown;
  page_size?: unknown;
};

/** 搜索结果条目：分块形态带 result_type/data，平铺形态带 type。 */
export type SearchArticleItem = {
  id?: string | number | null;
  desc?: string | null;
  type?: string | null;
  result_type?: string | null;
  data?: SearchArticleItem[] | null;
};

export type SearchData = {
  result?: SearchArticleItem[] | null;
};

export type SearchResponse = BilibiliResponse<SearchData>;

/** 搜索命中行：id 保持接口原值（数字），调用方再 coerceStr。 */
export type ArticleIdRow = {
  id: string | number;
  desc: string;
};

export function signSearchUrl(vars: SearchVars, page: number, img: string, sub: string): string {
  const pairs: WbiPair[] = [
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
export function collectArticleIds(data: SearchData | null | undefined): ArticleIdRow[] {
  const ids: ArticleIdRow[] = [];
  const rawResult = data?.result;
  const result: SearchArticleItem[] = Array.isArray(rawResult) ? rawResult : [];
  if (result[0]?.result_type != null) {
    for (const block of result) {
      if (block?.result_type !== "article") continue;
      const blockItems = block?.data;
      for (const item of Array.isArray(blockItems) ? blockItems : []) {
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
