/**
 * 调用 searchPosts（关键词「壁纸」）将结果写入 json/，
 * 再取列表第一条帖子的 post_id，调用 getPostReplies（第一页 size=20，is_hot=false）写入 json/，
 * 并拉取 static 的 emoticon_set（表情套装，体积较大）写入 json/。
 *
 * 用法（在仓库内）:
 *   bun src-crawler-plugins/plugins/miyoushe/scripts/fetch-search-and-replies.mjs
 *   node src-crawler-plugins/plugins/miyoushe/scripts/fetch-search-and-replies.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_DIR = join(__dirname, "..", "json");

const BASE = "https://bbs-api.miyoushe.com";
const STATIC_BASE = "https://bbs-api-static.miyoushe.com";
const PATH_SEARCH = "/painter/wapi/searchPosts";
const PATH_REPLIES = "/post/wapi/getPostReplies";
const PATH_EMOTICON_SET = "/misc/api/emoticon_set";

const KEYWORD = "壁纸";
const SEARCH_SIZE = 20;
const REPLY_SIZE = 20;
const ORDER_TYPE = 1;

const browserHeaders = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.miyoushe.com/",
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: browserHeaders });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`非 JSON 响应 HTTP ${res.status} url=${url} 前200字: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} retcode=${data?.retcode} url=${url}`);
  }
  return data;
}

function buildSearchUrl() {
  const q = new URLSearchParams({
    keyword: KEYWORD,
    size: String(SEARCH_SIZE),
  });
  return `${BASE}${PATH_SEARCH}?${q.toString()}`;
}

function buildRepliesUrl(postId, gids) {
  const q = new URLSearchParams({
    is_hot: "false",
    order_type: String(ORDER_TYPE),
    post_id: String(postId),
    size: String(REPLY_SIZE),
  });
  if (gids != null && gids !== "") {
    q.set("gids", String(gids));
  }
  return `${BASE}${PATH_REPLIES}?${q.toString()}`;
}

/** @param {string|number|null|undefined} gids 与首帖 game_id 对齐；省略则全站同套数据（与带 gids 探测结果常一致） */
function buildEmoticonSetUrl(gids) {
  const q = new URLSearchParams();
  if (gids != null && gids !== "") {
    q.set("gids", String(gids));
  }
  const qs = q.toString();
  return `${STATIC_BASE}${PATH_EMOTICON_SET}${qs ? `?${qs}` : ""}`;
}

function main() {
  mkdirSync(JSON_DIR, { recursive: true });

  const searchUrl = buildSearchUrl();
  return fetchJson(searchUrl).then(async (searchBody) => {
    const searchOut = join(JSON_DIR, "searchPosts-keyword-壁纸.json");
    writeFileSync(searchOut, JSON.stringify(searchBody, null, 2), "utf8");
    console.log(`已写入: ${searchOut}`);

    if (searchBody.retcode !== 0) {
      throw new Error(`searchPosts retcode=${searchBody.retcode} message=${searchBody.message}`);
    }
    const list = searchBody?.data?.list;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("searchPosts data.list 为空，无法取第一条帖子");
    }
    const first = list[0];
    const postId = first?.post?.post_id;
    if (postId == null || postId === "") {
      throw new Error("第一条缺少 post.post_id");
    }
    const gids = first?.post?.game_id;
    const repliesUrl = buildRepliesUrl(postId, gids);
    const repliesBody = await fetchJson(repliesUrl);

    const safeId = String(postId).replace(/[^\w-]/g, "_");
    const repliesOut = join(JSON_DIR, `getPostReplies-post_${safeId}-p1-not-hot.json`);
    writeFileSync(repliesOut, JSON.stringify(repliesBody, null, 2), "utf8");
    console.log(`已写入: ${repliesOut}`);
    console.log(`post_id=${postId} game_id=${gids ?? "(无)"} replies retcode=${repliesBody.retcode}`);

    const emoticonUrl = buildEmoticonSetUrl(gids);
    const emoticonBody = await fetchJson(emoticonUrl);
    if (emoticonBody.retcode !== 0) {
      throw new Error(`emoticon_set retcode=${emoticonBody.retcode} message=${emoticonBody.message}`);
    }
    const gidsTag =
      gids != null && gids !== "" ? String(gids).replace(/[^\w-]/g, "_") : "none";
    const emoticonOut = join(JSON_DIR, `emoticon_set-gids-${gidsTag}.json`);
    writeFileSync(emoticonOut, JSON.stringify(emoticonBody, null, 2), "utf8");
    console.log(`已写入: ${emoticonOut}（表情数据较大，写入可能需数秒）`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
