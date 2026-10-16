// @ts-nocheck
// tree 接口返回结构的解析：正文/评论渲染块、作者、话题标签、评论扁平化。
import { coerceStr } from "./util";

function tryHtmlCssPair(node) {
  if (!node || typeof node !== "object") return null;
  const html = coerceStr(node.html);
  if (!html) return null;
  return { html, css: coerceStr(node.css) };
}

export function findPostRender(linkObj) {
  return (
    tryHtmlCssPair(linkObj?.image_text) ||
    tryHtmlCssPair(linkObj?.post_body) ||
    tryHtmlCssPair(linkObj?.header_render)
  );
}

export function findCommentsRender(treeResult) {
  return tryHtmlCssPair(treeResult?.comments_block) || tryHtmlCssPair(treeResult?.comment_list);
}

export function authorFromLink(linkObj) {
  const user = linkObj?.user;
  if (!user) {
    return { username: "", userid: "", avatar: "", avatar_decoration: "", level: 0, fan_num: 0 };
  }
  return {
    username: coerceStr(user.username),
    userid: coerceStr(user.userid),
    avatar: coerceStr(user.avatar),
    avatar_decoration: coerceStr(user.avatar_decoration?.src_url),
    level: Number(user.level_info?.level ?? 0),
    fan_num: Number(user.fan_num ?? 0),
  };
}

export function topicsToTags(linkObj) {
  const topics = Array.isArray(linkObj?.topics) ? linkObj.topics : [];
  return topics.map((topic) => coerceStr(topic?.name)).filter(Boolean);
}

export function flattenComments(treeResult, maxN) {
  const out = [];
  const groups = Array.isArray(treeResult?.comments) ? treeResult.comments : [];
  for (const group of groups) {
    const arr = Array.isArray(group?.comment) ? group.comment : [];
    for (const comment of arr) {
      if (out.length >= maxN) return out;
      const user = comment?.user || {};
      const imgs = Array.isArray(comment?.imgs)
        ? comment.imgs
            .map((img) => ({
              url: coerceStr(img?.url),
              thumb: coerceStr(img?.thumb),
              width: Number(img?.width ?? 0),
              height: Number(img?.height ?? 0),
            }))
            .filter((img) => img.url || img.thumb)
        : [];
      out.push({
        text: coerceStr(comment?.text),
        floor_num: Number(comment?.floor_num ?? 0),
        create_at: Number(comment?.create_at ?? 0),
        ip_location: coerceStr(comment?.ip_location),
        username: coerceStr(user.username),
        userid: coerceStr(user.userid),
        avatar: coerceStr(user.avatar),
        avatar_decoration: coerceStr(user.avatar_decoration?.src_url),
        level: Number(user.level_info?.level ?? 0),
        up: Number(comment?.up ?? 0),
        reply_to_username: coerceStr(comment?.replyuser?.username),
        is_reply: comment?.replyid != null,
        is_cy: comment?.is_cy === true || comment?.is_cy === 1,
        imgs,
      });
    }
  }
  return out;
}
