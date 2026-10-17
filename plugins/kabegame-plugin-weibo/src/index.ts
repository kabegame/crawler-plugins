// @ts-nocheck
// 微博插件入口。
//
// 模块分工：
//   consts   端点与常量            util     HTTP / 登录失效识别 / 输入解析
//   modes    五种模式的微博来源     post     单条微博取图、长文、评论、metadata、下载
//   derived  标签与元数据搜索词
//
// 所有模式都依赖畅游里 weibo.com 的登录态：未登录时时间线 403、m 站 432、搜索跳登录页。
import { POST_DELAY_MS, TIMELINE_FEATURES } from "./consts";
import { t } from "./i18n";
import { albumSource, resolveUser, searchSource, supertopicSource, timelineSource } from "./modes";
import { fetchPost, processPost } from "./post";
import { LoginError, parsePostInput, parseSupertopicInput, pause, str } from "./util";

const { addProgress, requireCookie, setHeader, warn } = Kabegame;

function setup() {
  const ua = Kabegame.cefUserAgent?.();
  if (ua) setHeader("User-Agent", ua);
  // 图片 CDN（sinaimg.cn）防盗链：不带 weibo.com 的 Referer 一律 403
  setHeader("Referer", "https://weibo.com/");
  setHeader("Accept", "application/json, text/plain, */*");
  if (!requireCookie("weibo.com")) {
    throw new Error(t("loginRequired"));
  }
}

async function runSingle(vars, opts) {
  const id = parsePostInput(vars.post_url);
  if (!id) throw new Error(t("postInputRequired"));
  const mblog = await fetchPost(id);
  if (mblog?.ok === 0 || !mblog?.id) {
    throw new Error(t("postNotVisible", { id, reason: str(mblog?.message) || t("deletedOrNoPermission") }));
  }
  // 单条链接指向转发时，收原帖的图
  const own = await processPost(mblog, opts);
  if (own === 0 && mblog.retweeted_status) {
    const n = await processPost(mblog.retweeted_status, opts, mblog.user);
    if (n === 0) warn(t("retweetNoImage"));
  } else if (own === 0) {
    warn(t("postNoImage"));
  }
  addProgress(100);
}

async function sourceFor(vars) {
  const mode = str(vars.mode) || "album";
  if (mode === "album" || mode === "timeline") {
    const user = await resolveUser(vars.user);
    const uid = str(user.idstr || user.id);
    console.log(t("userInfo", { name: str(user.screen_name), uid, count: user.statuses_count ?? "?" }));
    if (mode === "album") return albumSource(uid);
    const feature = TIMELINE_FEATURES[str(vars.timeline_filter)] ?? TIMELINE_FEATURES.all;
    return timelineSource(uid, feature, vars.include_retweets === true);
  }
  if (mode === "supertopic") {
    const topicId = parseSupertopicInput(vars.supertopic);
    if (!topicId) throw new Error(t("supertopicRequired"));
    return supertopicSource(topicId, str(vars.supertopic_channel) || "latest", vars.supertopic_tag);
  }
  if (mode === "search") {
    const keyword = str(vars.keyword).trim();
    if (!keyword) throw new Error(t("keywordRequired"));
    return searchSource(keyword, str(vars.search_sort), vars.search_original === true, str(vars.start_date), str(vars.end_date));
  }
  throw new Error(t("unknownMode", { mode }));
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setup();
  const opts = {
    livePhoto: vars.live_photo !== false,
    maxComments: Math.max(0, Number(vars.max_comments ?? 20)),
    commentImages: vars.comment_images !== false,
  };

  if (str(vars.mode) === "single") return runSingle(vars, opts);

  const maxPosts = Math.max(1, Number(vars.max_posts ?? 20));
  const perPost = 100 / maxPosts;
  const source = await sourceFor(vars);
  const done = new Set();
  let posts = 0;
  let files = 0;
  let failed = 0;
  for await (const { mblog, retweetedBy } of source) {
    const mid = str(mblog?.idstr || mblog?.id);
    if (!mid || done.has(mid)) continue;
    done.add(mid);
    try {
      const n = await processPost(mblog, opts, retweetedBy);
      if (n === 0) continue; // 无图微博不计数
      posts += 1;
      files += n;
      addProgress(perPost);
      console.log(t("postProgress", {
        posts, maxPosts, name: str(mblog?.user?.screen_name), mblogid: str(mblog?.mblogid), files: n,
      }));
    } catch (e) {
      if (e instanceof LoginError) throw e;
      failed += 1;
      warn(t("postFailed", { id: str(mblog?.mblogid) || mid, reason: e?.message ?? e }));
    }
    if (posts >= maxPosts) break;
    await pause(POST_DELAY_MS);
  }
  console.log(failed
    ? t("doneWithFailures", { posts, files, failed })
    : t("done", { posts, files }));
  if (posts === 0 && failed === 0) warn(t("noImagePosts"));
  addProgress(Math.max(0, 100 - posts * perPost));
}
