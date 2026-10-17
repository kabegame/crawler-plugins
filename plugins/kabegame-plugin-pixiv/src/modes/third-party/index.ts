// @ts-nocheck
// 第三方 API 模式：适配器只负责产出 pixiv 作品 id，详情、标签与原图下载全部复用 downloadIllust。
//
// 适配器约定：
//   id: string                        与 kbConfig 的 third_party_api 选项 variable 一致
//   prepare?(vars): void              请求前的准备（如按 R18 要求注入 pixiv Cookie）
//   fetchPage(vars, cursor): Promise<{ ids: string[], next: any, total?: number }>
//     cursor 首次为 null；next 为 null 表示没有下一页，否则作为下一次的 cursor。
//     total 是本次预计处理的作品总数（用于进度），缺省按当前页条数计。
//
// fetchPage 期间关闭 pixiv 请求头（见 togglePixivHeaders），第三方 API 看不到 pixiv 的来源与 Cookie。
import { addArtworkProgress, togglePixivHeaders } from "../../common";
import { t } from "../../i18n";
import { downloadIllust } from "../../illust";
import { lolicon } from "./lolicon";

const ADAPTERS = { [lolicon.id]: lolicon };

async function fetchPageWithoutPixivHeaders(adapter, vars, cursor) {
  togglePixivHeaders(false);
  try {
    return await adapter.fetchPage(vars, cursor);
  } finally {
    togglePixivHeaders(true);
  }
}

export async function runThirdParty(vars) {
  const apiId = vars.third_party_api || lolicon.id;
  const adapter = ADAPTERS[apiId];
  if (!adapter) throw new Error(t("unknownThirdParty", { apiId }));
  adapter.prepare?.(vars);

  const seen = new Set();
  let cursor = null;
  let total = 0;
  do {
    const page = await fetchPageWithoutPixivHeaders(adapter, vars, cursor);
    const ids = (Array.isArray(page?.ids) ? page.ids : []).map(String).filter(
      (id) => id && !seen.has(id),
    );
    if (!total) total = Number(page?.total) || ids.length;
    console.log(t("thirdPartyPage", { apiId, count: ids.length }));
    for (const id of ids) {
      seen.add(id);
      await downloadIllust(id);
      addArtworkProgress(total);
    }
    cursor = page?.next ?? null;
  } while (cursor != null);
}
