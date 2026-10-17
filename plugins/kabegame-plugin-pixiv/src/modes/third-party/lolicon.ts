// @ts-nocheck
// lolicon（https://docs.api.lolicon.app/#/setu）：随机返回库中的 pixiv 作品，没有分页，一次请求即结束。
// 只取 pid，图片规格与地址不用（原图由 downloadIllust 从 pixiv 取），因此不传 size / proxy。
// 实测结论（请求头 403、限流形态、r18 分类偏差、图库范围）见 docs/lolicon-api.md。
import { sleep } from "@kabegame/plugin-sdk";
import { coerceStr, ensurePixivCookie } from "../../common";
import { t } from "../../i18n";

const { warn } = Kabegame;

const API = "https://api.lolicon.app/setu/v2";
const MAX_NUM = 20;
const MAX_TAG_GROUPS = 3;
const MAX_TAG_OR = 20;
const MAX_UIDS = 20;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 15000;
// lolicon 的 r18 是库内分类：r18=0 时仍会返回 pixiv 标为 R-18 的作品，全年龄在本地按标签再筛一次。
const R18_TAGS = new Set(["R-18", "R-18G"]);
const R18_PARAM = { safe: 0, r18: 1, all: 2 };
const ASPECT_PARAM = { landscape: "gt1", portrait: "lt1" };
// 日期按 pixiv 所在的日本时区（UTC+9）取整日，与排行榜日期、元数据搜索日期一致。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function listOf(value) {
  return (Array.isArray(value) ? value : []).map((v) => coerceStr(v).trim())
    .filter(Boolean);
}

// YYYY-MM-DD → 该日 JST 0 点的毫秒时间戳；空值返回 null。
function jstDayStart(value, label) {
  const text = coerceStr(value).trim();
  if (!text) return null;
  const m = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) throw new Error(t("dateFormat", { label, value: text }));
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) -
    JST_OFFSET_MS;
}

function buildQuery(vars) {
  const params = [];
  const add = (key, value) =>
    params.push(`${key}=${encodeURIComponent(String(value))}`);

  const num = Math.min(MAX_NUM, Math.max(1, Number(vars.lolicon_count) || MAX_NUM));
  add("num", num);
  add("r18", R18_PARAM[vars.lolicon_r18] ?? 0);

  const tags = listOf(vars.lolicon_tags);
  if (tags.length > MAX_TAG_GROUPS) {
    throw new Error(t("tagGroupsTooMany", { max: MAX_TAG_GROUPS, count: tags.length }));
  }
  for (const group of tags) {
    const ors = group.split("|").map((t) => t.trim()).filter(Boolean);
    if (ors.length > MAX_TAG_OR) {
      throw new Error(t("tagOrTooMany", { max: MAX_TAG_OR, group }));
    }
    if (ors.length > 0) add("tag", ors.join("|"));
  }

  const uids = listOf(vars.lolicon_uids);
  if (uids.length > MAX_UIDS) {
    throw new Error(t("uidsTooMany", { max: MAX_UIDS, count: uids.length }));
  }
  for (const uid of uids) {
    if (!/^\d+$/.test(uid)) throw new Error(t("uidNotNumber", { uid }));
    add("uid", uid);
  }

  const aspect = ASPECT_PARAM[vars.lolicon_orientation];
  if (aspect) add("aspectRatio", aspect);
  if (vars.lolicon_exclude_ai) add("excludeAI", "true");

  const after = jstDayStart(vars.lolicon_date_after, t("labelDateAfter"));
  const beforeDay = jstDayStart(vars.lolicon_date_before, t("labelDateBefore"));
  // 结束日期含当天：取次日 JST 0 点前 1 毫秒。
  const before = beforeDay == null ? null : beforeDay + DAY_MS - 1;
  if (after != null && before != null && after > before) {
    throw new Error(t("dateRangeInvalid"));
  }
  if (after != null) add("dateAfter", after);
  if (before != null) add("dateBefore", before);

  return { url: `${API}?${params.join("&")}`, num };
}

// 限流有两种形态：HTTP 429，或 HTTP 200 且 error 非空（「请求的太快啦，休息一会吧」）。
async function requestSetu(url) {
  for (let attempt = 0;; attempt += 1) {
    const response = await fetch(url);
    let json = null;
    if (response.ok) json = await response.json();
    const limited = response.status === 429 ||
      (json && coerceStr(json.error).includes("太快"));
    if (limited && attempt < RETRY_LIMIT) {
      warn(t("loliconRateLimited", { seconds: RETRY_DELAY_MS / 1000 }));
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    if (!response.ok) throw new Error(t("loliconRequestFailed", { status: response.status }));
    if (json?.error) throw new Error(t("loliconReturnedError", { error: json.error }));
    return Array.isArray(json?.data) ? json.data : [];
  }
}

export const lolicon = {
  id: "lolicon",

  prepare(vars) {
    // R18 作品的 pixiv 详情与分页接口需要登录态。
    if ((vars.lolicon_r18 ?? "safe") !== "safe") {
      ensurePixivCookie(t("labelLoliconR18"));
    }
  },

  async fetchPage(vars) {
    const { url, num } = buildQuery(vars);
    console.log(t("loliconRequest", { url }));
    const data = await requestSetu(url);

    const safeOnly = (vars.lolicon_r18 ?? "safe") === "safe";
    const ids = [];
    let r18Skipped = 0;
    for (const item of data) {
      const pid = coerceStr(item?.pid);
      if (!pid) continue;
      if (
        safeOnly &&
        (Array.isArray(item?.tags) ? item.tags : []).some((t) => R18_TAGS.has(t))
      ) {
        r18Skipped += 1;
        continue;
      }
      // 同一作品的不同页会分别出现；按作品去重，downloadIllust 会下载全部页。
      if (!ids.includes(pid)) ids.push(pid);
    }
    if (r18Skipped > 0) {
      console.log(t("loliconR18Skipped", { count: r18Skipped }));
    }
    if (data.length < num) {
      warn(t("loliconFewResults", { count: data.length, num }));
    }
    return { ids, next: null };
  },
};
