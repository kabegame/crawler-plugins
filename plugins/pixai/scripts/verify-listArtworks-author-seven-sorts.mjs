#!/usr/bin/env node
/**
 * 探测 PixAI `listArtworks` 作者流：§5.2 七种官方排序 × 两种 `types`（图片 / 动图）。
 * 仅请求首屏（无翻页），用于确认服务端是否接受变量组合。
 *
 * 在 `plugins/pixai/` 下：
 *   node ./scripts/verify-listArtworks-author-seven-sorts.mjs
 *   PIXAI_AUTHOR_ID="<id>" PIXAI_AUTHORIZATION="Bearer …" node ./scripts/verify-listArtworks-author-seven-sorts.mjs
 *   PIXAI_AUTHOR_INCLUDE_SAFE_SEARCH=1  …  // 额外带上 isSafeSearch:true（与 §5.2 共性一致，对照作者页无该字段）
 *
 * 间隔约 400ms，降低 429；输出 TSV 风格行便于复制到表格。
 */

const BASE = "https://api.pixai.art/graphql";
const OP = "listArtworks";
const PQ_HASH =
  process.env.PIXAI_PQ_HASH ||
  "e0c938939452d33abf3289e74b9f9f7bebd749e065ee905e7e073aca6f05199c";

const AUTHOR_ID = process.env.PIXAI_AUTHOR_ID || "1612159028833938536";
const PAGE_SIZE = Math.min(
  48,
  Math.max(1, parseInt(process.env.PIXAI_AUTHOR_PAGE_SIZE || "20", 10))
);
const INCLUDE_SAFE =
  process.env.PIXAI_AUTHOR_INCLUDE_SAFE_SEARCH === "1" ||
  process.env.PIXAI_AUTHOR_INCLUDE_SAFE_SEARCH === "true";

const EXTENSIONS = {
  clientLibrary: { name: "@apollo/client", version: "4.1.4" },
  persistedQuery: { version: 1, sha256Hash: PQ_HASH },
};

const TYPE_SETS = [
  { label: "图片(DEFAULT+ALBUM)", types: ["DEFAULT", "ALBUM"] },
  { label: "动图(ANIMATED_ARTWORK)", types: ["ANIMATED_ARTWORK"] },
];

/** §5.2 七种排序首屏（作者流：用 authorId + types 替代 tackId/loraId） */
const SORT_CASES = [
  { id: 1, name: "趋势", vars: (base) => ({ ...base, first: PAGE_SIZE, feed: "trending1" }) },
  { id: 2, name: "日榜", vars: (base) => ({ ...base, first: PAGE_SIZE, feed: "daily_ranking_dedup" }) },
  {
    id: 3,
    name: "人气",
    vars: (base) => ({ ...base, first: PAGE_SIZE, orderBy: "-markInfo.likedCount" }),
  },
  { id: 4, name: "最新", vars: (base) => ({ ...base, last: PAGE_SIZE, feed: "latest" }) },
  {
    id: 5,
    name: "人气(逆)",
    vars: (base) => ({ ...base, first: PAGE_SIZE, orderBy: "markInfo.likedCount" }),
  },
  {
    id: 6,
    name: "创建时间升序",
    vars: (base) => ({ ...base, first: PAGE_SIZE, orderBy: "createdAt" }),
  },
  {
    id: 7,
    name: "创建时间降序",
    vars: (base) => ({ ...base, first: PAGE_SIZE, orderBy: "-createdAt" }),
  },
];

function buildUrl(variables) {
  const vars = JSON.stringify(variables);
  const ext = JSON.stringify(EXTENSIONS);
  return (
    `${BASE}?operation=${encodeURIComponent(OP)}` +
    `&operationName=${encodeURIComponent(OP)}` +
    `&variables=${encodeURIComponent(vars)}` +
    `&extensions=${encodeURIComponent(ext)}`
  );
}

async function probe(sortId, sortName, typeLabel, variables) {
  const url = buildUrl(variables);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-apollo-operation-name": OP,
    Origin: "https://pixai.art",
    Referer: "https://pixai.art/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  const auth = process.env.PIXAI_AUTHORIZATION;
  if (auth) headers.Authorization = auth;

  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _parseError: true };
  }

  const edges = body?.data?.artworks?.edges;
  const n = Array.isArray(edges) ? edges.length : null;
  const err0 = body?.errors?.[0];
  const errMsg =
    err0?.message ??
    (body?.errors?.length ? JSON.stringify(body.errors).slice(0, 120) : null);

  return {
    sortId,
    sortName,
    typeLabel,
    http: res.status,
    edges: n,
    ok: res.ok && !body?.errors?.length && n !== null,
    errMsg,
  };
}

function baseAuthor(types) {
  const o = { authorId: AUTHOR_ID, types };
  if (INCLUDE_SAFE) o.isSafeSearch = true;
  return o;
}

async function main() {
  console.error(
    `[probe] authorId=${AUTHOR_ID} pageSize=${PAGE_SIZE} pq=${PQ_HASH.slice(0, 16)}… ` +
      `auth=${process.env.PIXAI_AUTHORIZATION ? "yes" : "no"} ` +
      `isSafeSearch=${INCLUDE_SAFE}\n`
  );

  const rows = [];
  for (const tc of TYPE_SETS) {
    for (const sc of SORT_CASES) {
      const variables = sc.vars(baseAuthor(tc.types));
      const r = await probe(sc.id, sc.name, tc.label, variables);
      rows.push(r);
      const line = [
        r.sortId,
        r.sortName,
        r.typeLabel,
        r.http,
        r.edges ?? "",
        r.ok ? "OK" : "FAIL",
        r.errMsg ? String(r.errMsg).replace(/\t/g, " ") : "",
      ].join("\t");
      console.log(line);
      await new Promise((x) => setTimeout(x, 400));
    }
  }

  const okCount = rows.filter((r) => r.ok).length;
  console.error(`\n[probe] 合计 ${rows.length} 次请求，成功 ${okCount}，失败 ${rows.length - okCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
