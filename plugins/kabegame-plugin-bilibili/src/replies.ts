// 评论区拉取与精简。评论只入 metadata 供详情模板展示，上限 100 条。
import { REPLY_API } from "./consts";
import { t } from "./i18n";
import {
  checkBilibiliRisk, coerceStr, fetchWith509Retry, isRecord, type BilibiliResponse,
} from "./util";
import { signUrl } from "./wbi";

const { warn } = Kabegame;

// 接口 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。
type ReplyEmote = {
  url?: string | null;
  meta?: { size?: number | null } | null;
};

type ReplyContent = {
  message?: string | null;
  emote?: Record<string, ReplyEmote> | null;
};

type ReplyMember = {
  mid?: string | number | null;
  uname?: string | null;
  avatar?: string | null;
  level_info?: { current_level?: number | null } | null;
};

type ReplyControl = {
  location?: string | null;
  sub_reply_entry_text?: string | null;
};

type ReplyItem = {
  member?: ReplyMember | null;
  content?: ReplyContent | null;
  reply_control?: ReplyControl | null;
  ctime?: number | null;
  like?: number | null;
};

type ReplyCursor = {
  all_count?: number | null;
  is_end?: boolean | null;
  pagination_reply?: { next_offset?: string | null } | null;
};

type ReplyData = {
  cursor?: ReplyCursor | null;
  replies?: ReplyItem[] | null;
};

type ReplyResponse = BilibiliResponse<ReplyData>;

/** 精简后的表情：只留 URL 与尺寸。 */
export type ReplyEmoteSummary = {
  url: string;
  size: number;
};

/** 精简后的单条评论（写入 metadata）。 */
export type ReplySummary = {
  mid: string;
  uname: string;
  avatar: string;
  level: number;
  message: string;
  emotes: Record<string, ReplyEmoteSummary>;
  ctime: number;
  like: number;
  location: string;
  sub_count_text: string;
};

/** 评论拉取结果：总计与已收集条目。 */
export type ArticleReplies = {
  total: number;
  replies: ReplySummary[];
};

function buildPaginationStr(offsetToken: string): string {
  return JSON.stringify({ offset: coerceStr(offsetToken) });
}

function signReplyUrl(cvId: string, offsetToken: string, img: string, sub: string): string {
  return signUrl(REPLY_API, [
    ["mode", "3"],
    ["oid", coerceStr(cvId)],
    ["pagination_str", buildPaginationStr(offsetToken)],
    ["plat", "1"],
    ["seek_rpid", ""],
    ["type", "12"],
    ["web_location", "1315875"],
    ["wts", String(Math.floor(Date.now() / 1000))],
  ], img, sub);
}

function simplifyEmotes(emotes: unknown): Record<string, ReplyEmoteSummary> {
  const out: Record<string, ReplyEmoteSummary> = {};
  if (!isRecord(emotes)) return out;
  for (const [key, value] of Object.entries(emotes)) {
    const emote = isRecord(value) ? value : {};
    const meta = isRecord(emote.meta) ? emote.meta : {};
    out[key] = {
      url: coerceStr(emote.url),
      size: Number(meta.size ?? 1),
    };
  }
  return out;
}

function simplifyOneReply(rep: ReplyItem): ReplySummary {
  const member: ReplyMember = rep?.member || {};
  const content: ReplyContent = rep?.content || {};
  const rc: ReplyControl = rep?.reply_control || {};
  return {
    mid: coerceStr(member.mid),
    uname: coerceStr(member.uname),
    avatar: coerceStr(member.avatar),
    level: Number(member?.level_info?.current_level ?? 0),
    message: coerceStr(content.message),
    emotes: simplifyEmotes(content.emote),
    ctime: Number(rep?.ctime ?? 0),
    like: Number(rep?.like ?? 0),
    location: coerceStr(rc.location),
    sub_count_text: coerceStr(rc.sub_reply_entry_text),
  };
}

export async function fetchArticleReplies(cvId: string, img: string, sub: string): Promise<ArticleReplies> {
  const cap = 100;
  const collected: ReplySummary[] = [];
  let total = 0;
  let offset = "";
  let isEnd = false;
  while (collected.length < cap && !isEnd) {
    const reply = await fetchWith509Retry<ReplyResponse>(
      () => signReplyUrl(cvId, offset, img, sub),
      t("commentApiLabel", { cvId }),
    );
    if (reply?.code !== 0) {
      checkBilibiliRisk(reply?.code);
      warn(t("commentsFetchFailed", { cvId, message: coerceStr(reply?.message) }));
      break;
    }
    const cursor = reply?.data?.cursor;
    total = Number(cursor?.all_count ?? total);
    isEnd = cursor?.is_end === true;
    const rawReplies = reply?.data?.replies;
    for (const rep of Array.isArray(rawReplies) ? rawReplies : []) {
      if (collected.length >= cap) break;
      collected.push(simplifyOneReply(rep));
    }
    const nextOffset = coerceStr(cursor?.pagination_reply?.next_offset);
    if (isEnd || !nextOffset) break;
    offset = nextOffset;
  }
  return { total, replies: collected };
}
