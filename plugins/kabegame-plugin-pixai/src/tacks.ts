// 标签（tack）解析与 plugin_data 缓存。
//
// 用户填的是 codeName（如 genshin_impact），listArtworks 要的是 tackId，
// 中间这层 getTack 结果按 id / codeName 双索引缓存进 plugin_data，避免每轮重查。
import { GET_TACK_QUERY, OPERATION_GET_TACK, TAG_CACHE_BY_CODE_NAME, TAG_CACHE_BY_ID } from "./consts";
import { fetchGraphql } from "./api";
import type { GetTackResponse, PixaiTack } from "./types";
import { t } from "./i18n";
import { coerceStr, log } from "./util";

const { pluginData, setPluginData } = Kabegame;

function readPluginDataOrEmpty(): Record<string, KabegameJsonValue> {
  try {
    const data = pluginData();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function trySetPluginData(data: Record<string, KabegameJsonValue>): void {
  try {
    setPluginData(data);
  } catch {
    // Older runtimes may not expose plugin_data. Cache failure must not stop crawling.
  }
}

/** plugin_data 里的缓存节点：站点的 JSON 对象（数组与其它标量都不算缓存）。 */
function asCacheRecord(value: KabegameJsonValue | undefined): Record<string, KabegameJsonValue> | null {
  return value && typeof value === "object" ? (value as Record<string, KabegameJsonValue>) : null;
}

function readCachedTackByCodeName(codeName: unknown): PixaiTack | null {
  const cache = asCacheRecord(readPluginDataOrEmpty()[TAG_CACHE_BY_CODE_NAME]);
  if (!cache) return null;
  const cached = cache[coerceStr(codeName)];
  // 缓存来自 plugin_data 的 JSON，读回时在这个边界上还原成 tack 结构
  return cached ? (cached as PixaiTack) : null;
}

function writeCachedTack(tackId: unknown, tack: PixaiTack): void {
  if (!tack || typeof tack !== "object") return;
  const data = readPluginDataOrEmpty();
  const byId = asCacheRecord(data[TAG_CACHE_BY_ID]) ?? {};
  byId[coerceStr(tackId)] = tack;
  data[TAG_CACHE_BY_ID] = byId;

  const codeName = coerceStr(tack.codeName);
  if (codeName) {
    const byCode = asCacheRecord(data[TAG_CACHE_BY_CODE_NAME]) ?? {};
    byCode[codeName] = tack;
    data[TAG_CACHE_BY_CODE_NAME] = byCode;
  }
  trySetPluginData(data);
}

export async function fetchTackByCodeName(codeName: unknown): Promise<PixaiTack | null> {
  const codeNameStr = coerceStr(codeName);
  if (!codeNameStr) return null;

  const cached = readCachedTackByCodeName(codeNameStr);
  if (cached) return cached;

  try {
    const res = await fetchGraphql<GetTackResponse>(
      OPERATION_GET_TACK,
      { codeName: codeNameStr },
      GET_TACK_QUERY,
    );
    const tack = res?.data?.tack || null;
    if (tack) writeCachedTack(coerceStr(tack.id) || codeNameStr, tack);
    return tack;
  } catch {
    log(t("tackDetailFailed", { codeName: codeNameStr }), "warn");
    return null;
  }
}

export async function resolveTackId(codeName: unknown): Promise<string> {
  const codeNameStr = coerceStr(codeName);
  if (!codeNameStr) return "";

  const tack = await fetchTackByCodeName(codeNameStr);
  if (!tack) {
    log(t("tackNotFound", { codeName: codeNameStr }));
    return "";
  }
  const tackId = coerceStr(tack.id);
  if (!tackId) {
    log(t("tackIdMissing", { codeName: codeNameStr }));
    return "";
  }
  return tackId;
}
