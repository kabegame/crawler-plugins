/**
 * 验证 getPostFull 接口在匿名（不带 Cookie/DS）下的最小参数情况。
 *
 * 用法：
 *   bun scripts/verify-getPostFull.mjs
 */

const BASE = "https://bbs-api.miyoushe.com";
const PATH = "/post/wapi/getPostFull";

const headers = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.miyoushe.com/",
};

function withTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { controller, t };
}

async function fetchJson(url, timeoutMs = 15000) {
  const { controller, t } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `非 JSON 响应 HTTP ${res.status} url=${url} 前200字: ${text.slice(
          0,
          200,
        )}`,
      );
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function buildUrl({ gids, post_id, read }) {
  const q = new URLSearchParams();
  if (gids != null) q.set("gids", String(gids));
  q.set("post_id", String(post_id));
  if (read != null) q.set("read", String(read));
  return `${BASE}${PATH}?${q.toString()}`;
}

async function main() {
  const post_id = 73975541;

  const cases = [
    { label: "gids=6 read=1", gids: 6, read: 1 },
    { label: "no gids read=1", gids: null, read: 1 },
    { label: "gids=6 no read", gids: 6, read: null },
    { label: "no gids no read", gids: null, read: null },
  ];

  for (const c of cases) {
    const url = buildUrl({ gids: c.gids, post_id, read: c.read });
    const body = await fetchJson(url);
    const retcode = body?.retcode;
    const message = body?.message;
    const hasDataPost = body?.data?.post?.post != null;
    const imageCount = Array.isArray(body?.data?.post?.post?.images)
      ? body.data.post.post.images.length
      : null;
    console.log(
      `${c.label}: retcode=${retcode} message=${message} has=data.post.post=${hasDataPost} images_count=${imageCount}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

