// @ts-nocheck
// DASH 流的挑选。对应 yt-dlp `BilibiliBaseIE.extract_formats` 的选择部分——
// 区别是 yt-dlp 把所有 format 交给用户的 -f 表达式，这里必须当场定一个。
import { coerceStr } from "./util";

/** 主地址 + 备用地址，供下载时逐个尝试。 */
export function streamUrls(stream) {
  const urls = [];
  const primary = stream?.baseUrl || stream?.base_url;
  if (primary) urls.push(primary);
  for (const backup of stream?.backupUrl || stream?.backup_url || []) {
    if (backup) urls.push(backup);
  }
  return urls;
}

export function pickVideo(dash, maxQuality, preferAvc) {
  const all = Array.isArray(dash?.video) ? dash.video : [];
  if (all.length === 0) return null;

  let pool = maxQuality > 0 ? all.filter((v) => Number(v?.id ?? 0) <= maxQuality) : all;
  if (pool.length === 0) {
    // 全部高于上限——退回全集，别空手而归。
    pool = all;
  }
  if (preferAvc) {
    const avc = pool.filter((v) => coerceStr(v?.codecs).toLowerCase().startsWith("avc"));
    if (avc.length > 0) pool = avc;
  }
  return pool
    .slice()
    .sort((a, b) => (Number(b?.id ?? 0) - Number(a?.id ?? 0))
      || (Number(b?.bandwidth ?? 0) - Number(a?.bandwidth ?? 0)))[0];
}

export function pickAudio(dash) {
  // 只取普通音轨：flac / dolby 的编码 stream-copy 进 mp4 兼容性差，第一版不碰。
  const all = Array.isArray(dash?.audio) ? dash.audio : [];
  if (all.length === 0) return null;
  return all
    .slice()
    .sort((a, b) => Number(b?.bandwidth ?? 0) - Number(a?.bandwidth ?? 0))[0];
}

/** support_formats → { 质量 id: 可读名 }，仅用于日志和 metadata。 */
export function qualityLabels(playData) {
  const names = {};
  for (const format of playData?.support_formats || []) {
    names[Number(format?.quality ?? 0)] = coerceStr(format?.new_description || format?.display_desc);
  }
  return names;
}
