// tree 接口返回结构的解析：正文/评论渲染块、作者、话题标签、评论扁平化。
import { coerceStr } from "./util";

// 站点 JSON 的最小结构：字段都可能缺失，只在确实依赖处收窄。
// 输出侧（metadata）必须保持 JSON 可序列化，所以全部用 type 而非 interface（interface 不满足
// KabegameJsonValue 的索引签名）。
type XhhUser = {
  username?: unknown;
  userid?: unknown;
  avatar?: unknown;
  avatar_decoration?: { src_url?: unknown } | null;
  level_info?: { level?: unknown } | null;
  fan_num?: unknown;
};

type XhhRenderBlock = {
  html?: unknown;
  css?: unknown;
};

type XhhTopic = {
  name?: unknown;
};

type XhhImageRef = {
  url?: unknown;
  thumb?: unknown;
  width?: unknown;
  height?: unknown;
};

type XhhComment = {
  text?: unknown;
  floor_num?: unknown;
  create_at?: unknown;
  ip_location?: unknown;
  user?: XhhUser | null;
  imgs?: XhhImageRef[] | null;
  up?: unknown;
  replyuser?: { username?: unknown } | null;
  replyid?: unknown;
  is_cy?: unknown;
};

type XhhCommentGroup = {
  comment?: XhhComment[] | null;
};

/** tree 响应里的 `result.link`（帖子本体）。 */
export type XhhLink = {
  linkid?: unknown;
  text?: unknown;
  title?: unknown;
  description?: unknown;
  desc?: unknown;
  share_url?: unknown;
  create_at?: unknown;
  ip_location?: unknown;
  user?: XhhUser | null;
  topics?: XhhTopic[] | null;
  image_text?: XhhRenderBlock | null;
  post_body?: XhhRenderBlock | null;
  header_render?: XhhRenderBlock | null;
};

/** tree 响应里的 `result`。 */
export type XhhTreeResult = {
  link?: XhhLink | null;
  comments?: XhhCommentGroup[] | null;
  comments_block?: XhhRenderBlock | null;
  comment_list?: XhhRenderBlock | null;
};

/** 渲染块输出（进 metadata）：html/css 两个字符串字段。 */
export type XhhRenderPair = {
  html: string;
  css: string;
};

/** 评论里的图片（进 metadata）。 */
export type XhhCommentImage = {
  url: string;
  thumb: string;
  width: number;
  height: number;
};

/** 扁平化后的一条评论快照（进 metadata）。 */
export type XhhCommentSnapshot = {
  text: string;
  floor_num: number;
  create_at: number;
  ip_location: string;
  username: string;
  userid: string;
  avatar: string;
  avatar_decoration: string;
  level: number;
  up: number;
  reply_to_username: string;
  is_reply: boolean;
  is_cy: boolean;
  imgs: XhhCommentImage[];
};

/** 帖子作者（进 metadata）。 */
export type XhhAuthor = {
  username: string;
  userid: string;
  avatar: string;
  avatar_decoration: string;
  level: number;
  fan_num: number;
};

function tryHtmlCssPair(node: XhhRenderBlock | null | undefined): XhhRenderPair | null {
  if (!node || typeof node !== "object") return null;
  const html = coerceStr(node.html);
  if (!html) return null;
  return { html, css: coerceStr(node.css) };
}

export function findPostRender(linkObj: XhhLink | null | undefined): XhhRenderPair | null {
  return (
    tryHtmlCssPair(linkObj?.image_text) ||
    tryHtmlCssPair(linkObj?.post_body) ||
    tryHtmlCssPair(linkObj?.header_render)
  );
}

export function findCommentsRender(treeResult: XhhTreeResult | null | undefined): XhhRenderPair | null {
  return tryHtmlCssPair(treeResult?.comments_block) || tryHtmlCssPair(treeResult?.comment_list);
}

export function authorFromLink(linkObj: XhhLink | null | undefined): XhhAuthor {
  const user: XhhUser | null | undefined = linkObj?.user;
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

export function topicsToTags(linkObj: XhhLink | null | undefined): string[] {
  const rawTopics = linkObj?.topics;
  const topics = Array.isArray(rawTopics) ? rawTopics : [];
  return topics.map((topic) => coerceStr(topic?.name)).filter(Boolean);
}

export function flattenComments(
  treeResult: XhhTreeResult | null | undefined,
  maxN: number,
): XhhCommentSnapshot[] {
  const out: XhhCommentSnapshot[] = [];
  const rawGroups = treeResult?.comments;
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  for (const group of groups) {
    const rawComments = group?.comment;
    const arr = Array.isArray(rawComments) ? rawComments : [];
    for (const comment of arr) {
      if (out.length >= maxN) return out;
      const user: XhhUser = comment?.user || {};
      const rawImgs = comment?.imgs;
      const imgs: XhhCommentImage[] = Array.isArray(rawImgs)
        ? rawImgs
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
