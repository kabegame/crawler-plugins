// 表情表：小黑盒会陆续上新表情，详情模板里写死的静态表会过期（新表情只能显示成 [cube_xxx] 文本）。
// 这里把官方表情列表存进 plugin_data，按需更新：帖子里出现 plugin_data 表中没有的表情时，
// 本次任务拉一次官方列表并合并写回。详情模板在 iframe 里经 __bridge.getPluginData() 读取补全。
import { API_HOST, PATH_EMOJI_LIST } from "./consts";
import { t } from "./i18n";
import { signedUrl } from "./sign";
import { coerceStr, errorMessage, fetchJson, isChallenge, log } from "./util";

const { pluginData, setPluginData } = Kabegame;

/** plugin_data 键：`{ "<group_code>_<code>": imgUrl }`，与正文里的 `[cube_鳄鱼]` / `data-emoji` 同口径。 */
export const EMOJI_MAP_KEY = "heybox_emoji_map";
const EMOJI_VERSION_KEY = "heybox_emoji_version";
const EMOJI_UPDATED_AT_KEY = "heybox_emoji_updated_at";

// 正文 / 评论里的两种表情形态：纯文本 `[cube_鳄鱼]` 与富文本 `<span data-emoji="cube_鳄鱼">`。
const BRACKET_RE = /\[([a-z]+_[^\[\]]+)\]/g;
const SPAN_RE = /data-emoji=\\?"([^"\\]+)\\?"/g;

/** 官方表情列表接口的最小响应结构（外部 JSON，字段都可能缺失）。 */
type XhhEmoji = {
  code?: unknown;
  img?: unknown;
};

type XhhEmojiGroup = {
  group_code?: unknown;
  emojis?: XhhEmoji[] | null;
};

type XhhEmojiResponse = {
  status?: unknown;
  result?: {
    emoji_groups?: XhhEmojiGroup[] | null;
    emoji_version?: unknown;
  } | null;
};

let emojiMap: Record<string, string> | null = null;
// 一次任务最多拉一次：官方列表里本来就没有的表情不该让每篇帖子都重拉。
let refreshedThisRun = false;

function readPluginData(): Record<string, KabegameJsonValue> {
  try {
    const data = pluginData();
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function currentEmojiMap(): Record<string, string> {
  if (!emojiMap) {
    const cached = readPluginData()[EMOJI_MAP_KEY];
    // plugin_data 是外部持久化 JSON：只在边界上声明表情表的形状，值仍是站点的图片 URL。
    emojiMap =
      cached && typeof cached === "object" && !Array.isArray(cached)
        ? (cached as Record<string, string>)
        : {};
  }
  return emojiMap;
}

/** 从任意可序列化值（metadata）里收集出现过的表情 key。 */
export function collectEmojiKeys(value: unknown): Set<string> {
  const text = JSON.stringify(value ?? "") ?? "";
  const keys = new Set<string>();
  for (const match of text.matchAll(BRACKET_RE)) keys.add(match[1].trim());
  for (const match of text.matchAll(SPAN_RE)) keys.add(match[1].trim());
  return keys;
}

function flattenEmojiGroups(result: XhhEmojiResponse["result"]): Record<string, string> {
  const map: Record<string, string> = {};
  const rawGroups = result?.emoji_groups;
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  for (const group of groups) {
    const groupCode = coerceStr(group?.group_code);
    const rawEmojis = group?.emojis;
    const emojis = Array.isArray(rawEmojis) ? rawEmojis : [];
    if (!groupCode) continue;
    for (const emoji of emojis) {
      const code = coerceStr(emoji?.code);
      const img = coerceStr(emoji?.img);
      if (code && /^https:\/\//.test(img)) map[`${groupCode}_${code}`] = img;
    }
  }
  return map;
}

/**
 * 帖子里出现本地表情表没有的 key 时，拉官方列表并合并写入 plugin_data。
 * 合并而非覆盖：官方下架的旧表情仍可能出现在历史评论里。失败只告警，不影响下载。
 */
export async function ensureEmojis(keys: Set<string>, commonParams: string): Promise<void> {
  if (refreshedThisRun || keys.size === 0) return;
  const known = currentEmojiMap();
  const missing = [...keys].filter((key) => !known[key]);
  if (missing.length === 0) return;
  refreshedThisRun = true;

  try {
    const response = await fetchJson<XhhEmojiResponse>(
      signedUrl(API_HOST, PATH_EMOJI_LIST, commonParams),
    );
    if (isChallenge(response?.status) || response?.status !== "ok") {
      log(t("emojiListFailed", { status: coerceStr(response?.status) }), "warn");
      return;
    }
    const fetched = flattenEmojiGroups(response.result);
    if (Object.keys(fetched).length === 0) return;

    const merged = { ...known, ...fetched };
    emojiMap = merged;
    const data = readPluginData();
    data[EMOJI_MAP_KEY] = merged;
    data[EMOJI_VERSION_KEY] = coerceStr(response.result?.emoji_version);
    data[EMOJI_UPDATED_AT_KEY] = Date.now();
    setPluginData(data);

    const stillMissing = missing.filter((key) => !merged[key]);
    const emojiCount = Object.keys(merged).length;
    log(
      stillMissing.length
        ? t("emojiUpdatedWithMissing", {
            version: data[EMOJI_VERSION_KEY],
            count: emojiCount,
            missing: stillMissing.join(", "),
          })
        : t("emojiUpdated", { version: data[EMOJI_VERSION_KEY], count: emojiCount }),
    );
  } catch (error) {
    log(t("emojiUpdateFailed", { error: errorMessage(error) }), "warn");
  }
}
