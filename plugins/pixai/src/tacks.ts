// @ts-nocheck
// 标签（tack）解析与 plugin_data 缓存。
//
// 用户填的是 codeName（如 genshin_impact），listArtworks 要的是 tackId，
// 中间这层 getTack 结果按 id / codeName 双索引缓存进 plugin_data，避免每轮重查。
import { GET_TACK_QUERY, OPERATION_GET_TACK, TAG_CACHE_BY_CODE_NAME, TAG_CACHE_BY_ID } from "./consts";
import { fetchGraphql } from "./api";
import { coerceStr, log } from "./util";

const { pluginData, setPluginData } = Kabegame;

function readPluginDataOrEmpty() {
  try {
    const data = pluginData();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function trySetPluginData(data) {
  try {
    setPluginData(data);
  } catch {
    // Older runtimes may not expose plugin_data. Cache failure must not stop crawling.
  }
}

function readCachedTackByCodeName(codeName) {
  const cache = readPluginDataOrEmpty()[TAG_CACHE_BY_CODE_NAME];
  return cache && typeof cache === "object" ? cache[coerceStr(codeName)] : null;
}

function writeCachedTack(tackId, tack) {
  if (!tack || typeof tack !== "object") return;
  const data = readPluginDataOrEmpty();
  const byId = data[TAG_CACHE_BY_ID] && typeof data[TAG_CACHE_BY_ID] === "object"
    ? data[TAG_CACHE_BY_ID]
    : {};
  byId[coerceStr(tackId)] = tack;
  data[TAG_CACHE_BY_ID] = byId;

  const codeName = coerceStr(tack.codeName);
  if (codeName) {
    const byCode = data[TAG_CACHE_BY_CODE_NAME] &&
      typeof data[TAG_CACHE_BY_CODE_NAME] === "object"
      ? data[TAG_CACHE_BY_CODE_NAME]
      : {};
    byCode[codeName] = tack;
    data[TAG_CACHE_BY_CODE_NAME] = byCode;
  }
  trySetPluginData(data);
}

export async function fetchTackByCodeName(codeName) {
  const codeNameStr = coerceStr(codeName);
  if (!codeNameStr) return null;

  const cached = readCachedTackByCodeName(codeNameStr);
  if (cached) return cached;

  try {
    const res = await fetchGraphql(
      OPERATION_GET_TACK,
      { codeName: codeNameStr },
      GET_TACK_QUERY,
    );
    const tack = res?.data?.tack || null;
    if (tack) writeCachedTack(coerceStr(tack.id) || codeNameStr, tack);
    return tack;
  } catch {
    log(`[PixAI] 标签详情获取失败，codeName=${codeNameStr}`, "warn");
    return null;
  }
}

export async function resolveTackId(codeName) {
  const codeNameStr = coerceStr(codeName);
  if (!codeNameStr) return "";

  const tack = await fetchTackByCodeName(codeNameStr);
  if (!tack) {
    log(`[PixAI] codeName=${codeNameStr} 未解析到 tack`);
    return "";
  }
  const tackId = coerceStr(tack.id);
  if (!tackId) {
    log(`[PixAI] codeName=${codeNameStr} 的 getTack 响应缺少 tack.id`);
    return "";
  }
  return tackId;
}
