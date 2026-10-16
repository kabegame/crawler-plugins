// @ts-nocheck
// 单条微博：取图（含 GIF / LivePhoto）、补长文、拉评论、建 metadata、下载。
// 五种模式最后都汇到 processPost，入参是 statuses/show、mymblog、超话 feed 共用的 mblog 结构。
import { COMMENTS_API, LONGTEXT_API, POST_DELAY_MS, SHOW_API, SUPERTOPIC_PREFIX } from "./consts";
import { labelsFromMetadata, searchTextsFromMetadata } from "./derived";
import { LoginError, fetchJson, https, isoTime, pause, record, str } from "./util";

const { createImageMetadata, downloadImage, warn } = Kabegame;

export async function fetchPost(id) {
  return fetchJson(`${SHOW_API}?id=${encodeURIComponent(id)}&locale=zh-CN`);
}

/** 单张图的信息 → { pid, type, url, width, height, liveUrl }。 */
function picFromInfo(pid, info) {
  const p = record(info);
  const best = record(p.largest?.url ? p.largest : p.original?.url ? p.original : p.mw2000);
  const type = str(p.type) || "pic";
  const id = str(pid || p.pic_id);
  if (!id && !best.url) return null;
  // GIF 的 largest 就是 .gif 原图；兜底按 pid 拼 large 原图地址
  // wx1～wx4 是同一批文件的镜像，统一到 wx1，让跨接口、跨任务的 URL 去重能命中
  const url = (https(best.url) || `https://wx1.sinaimg.cn/large/${id}.${type === "gif" ? "gif" : "jpg"}`).replace(
    /^https:\/\/wx[1-4]\.sinaimg\.cn\//,
    "https://wx1.sinaimg.cn/",
  );
  return {
    pid: id,
    type,
    url,
    width: Number(best.width) || 0,
    height: Number(best.height) || 0,
    liveUrl: type === "livephoto" ? https(p.video) : "",
  };
}

/** 按 pic_ids 顺序收图；图文混排的帖子图在 mix_media_info 里。视频不收。 */
export function collectPics(mblog) {
  const m = record(mblog);
  const out = [];
  const seen = new Set();
  const push = (pic) => {
    if (!pic || seen.has(pic.pid || pic.url)) return;
    seen.add(pic.pid || pic.url);
    out.push(pic);
  };
  const infos = record(m.pic_infos);
  const ids = Array.isArray(m.pic_ids) && m.pic_ids.length ? m.pic_ids : Object.keys(infos);
  for (const pid of ids) {
    if (infos[pid]) push(picFromInfo(pid, infos[pid]));
  }
  for (const item of Array.isArray(m.mix_media_info?.items) ? m.mix_media_info.items : []) {
    if (item?.type === "pic") push(picFromInfo(item?.data?.pic_id || item?.id, item?.data));
  }
  return out;
}

/** 正文去掉话题、表情方括号与零宽空格后的前若干字，用作图片展示名。 */
function shortTitle(text, max = 24) {
  const clean = str(text)
    .replace(/#[^#\n]*#/g, " ")
    .replace(/\[[^\[\]\s]{1,8}\]/g, "")
    .replace(/[​ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function superTopicsOf(m) {
  const out = [];
  const seen = new Set();
  for (const u of Array.isArray(m.url_struct) ? m.url_struct : []) {
    const pageId = str(u?.page_id);
    if (!pageId.startsWith(SUPERTOPIC_PREFIX) || seen.has(pageId)) continue;
    seen.add(pageId);
    const name = str(u?.url_title).replace(/超话$/, "").trim();
    if (name) out.push({ id: pageId, name });
  }
  return out;
}

function topicsOf(m) {
  const out = [];
  for (const t of Array.isArray(m.topic_struct) ? m.topic_struct : []) {
    const name = str(t?.topic_title).trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 去掉微博正文末尾常见的零宽空格。 */
function cleanText(value) {
  return str(value).replace(/\u200b/g, "").trim();
}

function htmlToText(html) {
  return str(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

async function fullText(m) {
  if (m.text_raw == null) return cleanText(htmlToText(m.text));
  if (!m.isLongText) return cleanText(m.text_raw);
  try {
    const json = await fetchJson(`${LONGTEXT_API}?id=${encodeURIComponent(str(m.mblogid || m.id))}`);
    return cleanText(json?.data?.longTextContent || m.text_raw);
  } catch (e) {
    if (e instanceof LoginError) throw e;
    warn(`[weibo] ${m.mblogid} 长文补全失败：${e?.message ?? e}，使用截断正文`);
    return cleanText(m.text_raw);
  }
}

function slimUser(u) {
  const user = record(u);
  return {
    id: str(user.idstr || user.id),
    name: str(user.screen_name),
    // 头像链接自带会过期的签名参数；去掉后仍可无 Referer 直接访问（已实测）
    avatar: https(user.avatar_hd || user.avatar_large || user.profile_image_url).split("?", 1)[0],
  };
}

/**
 * 评论配图：挂在评论 url_struct 的「查看图片」卡片（url_type 39）里，带 pic_ids / pic_infos。
 * 只认 pic_num > 0 的评论——引用上层评论的子回复也会带同一张卡片，但它自己 pic_num 为 0。
 */
function commentPics(c) {
  if (!(Number(c?.pic_num) > 0)) return [];
  const out = [];
  for (const u of Array.isArray(c?.url_struct) ? c.url_struct : []) {
    const infos = record(u?.pic_infos);
    const ids = Array.isArray(u?.pic_ids) && u.pic_ids.length ? u.pic_ids : Object.keys(infos);
    for (const pid of ids) {
      const info = record(infos[pid]);
      const big = record(info.woriginal?.url ? info.woriginal : info.large);
      const url = (https(big.url) || `https://wx1.sinaimg.cn/large/${pid}.jpg`)
        .replace(/^https:\/\/wx[1-4]\.sinaimg\.cn\//, "https://wx1.sinaimg.cn/")
        .replace("/woriginal/", "/large/");
      if (!out.some((p) => p.pid === pid)) {
        out.push({ pid: str(pid), url, width: Number(big.width) || 0, height: Number(big.height) || 0 });
      }
    }
  }
  return out;
}

function slimComment(c) {
  return {
    id: str(c?.idstr || c?.id),
    floor: Number(c?.floor_number) || 0,
    user: slimUser(c?.user),
    text: cleanText(c?.text_raw),
    created_at: isoTime(c?.created_at),
    region: str(c?.source).replace(/^来自/, "").trim(),
    likes: Number(c?.like_counts ?? c?.like_count) || 0,
    pics: commentPics(c),
  };
}

/**
 * 按热度拉前 max 条一级评论（max_id 游标，每页 20），每条带接口附带的楼中楼预览。
 * 失败只告警，返回已拿到的部分，不影响图片下载。
 */
async function fetchComments(m, max) {
  if (max <= 0 || Number(m.comments_count) <= 0) return [];
  const uid = str(m.user?.idstr || m.user?.id);
  const out = [];
  let maxId = "";
  try {
    while (out.length < max) {
      const url = `${COMMENTS_API}?flow=0&is_reload=1&id=${m.id}&is_show_bulletin=2&is_mix=0${maxId ? `&max_id=${maxId}` : ""}&count=20&uid=${uid}&fetch_level=0&locale=zh-CN`;
      const json = await fetchJson(url);
      const list = Array.isArray(json?.data) ? json.data : [];
      for (const c of list) {
        if (out.length >= max) break;
        out.push({
          ...slimComment(c),
          reply_count: Number(c.total_number) || 0,
          replies: (Array.isArray(c.comments) ? c.comments : []).map(slimComment),
        });
      }
      maxId = str(json?.max_id);
      if (list.length === 0 || !maxId || maxId === "0") break;
      await pause(POST_DELAY_MS);
    }
  } catch (e) {
    if (e instanceof LoginError) throw e;
    warn(`[weibo] ${m.mblogid} 评论拉取中断（已取 ${out.length} 条）：${e?.message ?? e}`);
  }
  return out;
}

export function postUrlOf(m) {
  const uid = str(m.user?.idstr || m.user?.id);
  const bid = str(m.mblogid || m.id);
  return uid ? `https://weibo.com/${uid}/${bid}` : `https://weibo.com/detail/${str(m.id)}`;
}

/**
 * 处理一条微博并下载其全部图片。返回实际入队的图片数（0 = 无图跳过）。
 * retweetedBy：经由某条转发抓到原帖时，记下转发者，详情里显示「由 xx 转发」。
 */
export async function processPost(mblog, opts, retweetedBy) {
  let m = record(mblog);
  let pics = collectPics(m);
  if (pics.length === 0) return 0;
  // 超话 feed 的微博是精简结构：只有 HTML 的 text，没有 text_raw / topic_struct / region_name。
  // 有图才补拉一次 statuses/show，保证各模式 metadata 口径一致；补拉失败退回精简结构。
  if (m.text_raw == null) {
    try {
      const full = await fetchPost(str(m.mblogid || m.id));
      if (full?.id) {
        m = record(full);
        pics = collectPics(m).length ? collectPics(m) : pics;
      }
    } catch (e) {
      if (e instanceof LoginError) throw e;
      warn(`[weibo] ${m.mblogid} 详情补拉失败：${e?.message ?? e}`);
    }
  }

  const text = await fullText(m);
  const comments = await fetchComments(m, opts.maxComments);
  const user = record(m.user);
  const postUrl = postUrlOf(m);
  const metadata = {
    schema: 1,
    source: "weibo",
    mid: str(m.idstr || m.id),
    mblogid: str(m.mblogid),
    url: postUrl,
    created_at: isoTime(m.created_at),
    text,
    region: str(m.region_name).replace(/^发布于\s*/, ""),
    app_source: str(m.source).replace(/<[^>]+>/g, ""),
    user: {
      ...slimUser(user),
      verified: !!user.verified,
      verified_type: Number(user.verified_type ?? -1),
    },
    counts: {
      reposts: Number(m.reposts_count) || 0,
      comments: Number(m.comments_count) || 0,
      likes: Number(m.attitudes_count) || 0,
    },
    topics: topicsOf(m),
    super_topics: superTopicsOf(m),
    pics: pics.map((p) => ({ pid: p.pid, type: p.type, width: p.width, height: p.height })),
    comments,
  };
  if (retweetedBy) metadata.retweeted_by = slimUser(retweetedBy);

  const metadataId = Number(createImageMetadata(metadata, { searchTexts: searchTextsFromMetadata(metadata) }));
  const labels = labelsFromMetadata(metadata);
  const base = `${str(user.screen_name) || "微博"}：${shortTitle(text) || str(m.mblogid)}`;
  let queued = 0;
  for (let i = 0; i < pics.length; i += 1) {
    const name = pics.length > 1 ? `${base}(${i + 1})` : base;
    const options = { name, url: postUrl, metadata_id: metadataId };
    if (labels.length) options.labels = labels;
    await downloadImage(pics[i].url, options);
    queued += 1;
    if (opts.livePhoto && pics[i].liveUrl) {
      await downloadImage(pics[i].liveUrl, { ...options, name: `${name}(live)` });
      queued += 1;
    }
  }
  // 评论区配图：与微博共用 metadata，不挂作者/话题标签（图不是博主发的）
  if (opts.commentImages) {
    for (const c of comments) {
      for (const item of [c, ...c.replies]) {
        for (let k = 0; k < item.pics.length; k += 1) {
          const cname = `${base}[comment_${item.floor || item.id}]${item.pics.length > 1 ? `(${k + 1})` : ""}`;
          await downloadImage(item.pics[k].url, { name: cname, url: postUrl, metadata_id: metadataId });
          queued += 1;
        }
      }
    }
  }
  return queued;
}
