// @ts-nocheck
// 评论区拉取与精简。评论只入 metadata 供详情模板展示，上限 100 条。
import { REPLY_API } from "./consts";
import { checkBilibiliRisk, coerceStr, fetchWith509Retry } from "./util";
import { signUrl } from "./wbi";

const { warn } = Kabegame;

function buildPaginationStr(offsetToken) {
  return JSON.stringify({ offset: coerceStr(offsetToken) });
}

function signReplyUrl(cvId, offsetToken, img, sub) {
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

function simplifyEmotes(emotes) {
  const out = {};
  if (!emotes || typeof emotes !== "object") return out;
  for (const [key, value] of Object.entries(emotes)) {
    out[key] = {
      url: coerceStr(value?.url),
      size: Number(value?.meta?.size ?? 1),
    };
  }
  return out;
}

function simplifyOneReply(rep) {
  const member = rep?.member || {};
  const content = rep?.content || {};
  const rc = rep?.reply_control || {};
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

export async function fetchArticleReplies(cvId, img, sub) {
  const cap = 100;
  const collected = [];
  let total = 0;
  let offset = "";
  let isEnd = false;
  while (collected.length < cap && !isEnd) {
    const reply = await fetchWith509Retry(
      () => signReplyUrl(cvId, offset, img, sub),
      `cv ${cvId} 评论接口`,
    );
    if (reply?.code !== 0) {
      checkBilibiliRisk(reply?.code);
      warn(`评论 API 拉取失败 (cv ${cvId}): ${coerceStr(reply?.message)}`);
      break;
    }
    const cursor = reply?.data?.cursor;
    total = Number(cursor?.all_count ?? total);
    isEnd = cursor?.is_end === true;
    for (const rep of Array.isArray(reply?.data?.replies) ? reply.data.replies : []) {
      if (collected.length >= cap) break;
      collected.push(simplifyOneReply(rep));
    }
    const nextOffset = coerceStr(cursor?.pagination_reply?.next_offset);
    if (isEnd || !nextOffset) break;
    offset = nextOffset;
  }
  return { total, replies: collected };
}
