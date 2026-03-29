#!/usr/bin/env node
/**
 * 验证 PixAI `listGenerationModels` 作者页模型列表：`first` + `authorId`（+ 可选 `orderBy`），
 * 下一页 **`after`** = 上一页 **`pageInfo.endCursor`**（与全站 `meilisearch` + `first` 流一致）。
 *
 * 用法（在插件目录 `plugins/pixai/` 下）：
 *   node ./scripts/verify-listGenerationModels-author-pagination.mjs
 *   PIXAI_AUTHORIZATION="Bearer <token>" node ./scripts/verify-listGenerationModels-author-pagination.mjs
 *   PIXAI_AUTHOR_ID="<作者 id>" PIXAI_PQ_HASH=<sha256> …
 *
 * 未设置 PIXAI_AUTHORIZATION 时仍会请求：作者模型流常返回空列表（totalCount 0），用于对照文档说明。
 */

const BASE = "https://api.pixai.art/graphql";
const OP = "listGenerationModels";

/** 与作者页「模型」Tab 近期抓包一致；若 PersistedQueryNotFound 可设 PIXAI_PQ_HASH 为 Network 中整段 */
const DEFAULT_PQ_HASH =
  process.env.PIXAI_PQ_HASH ||
  "1658f8e716184e95d3177d20fad189d8f7b250fb30e8401496ed0aaf34e4ad83";

const DEFAULT_AUTHOR_ID =
  process.env.PIXAI_AUTHOR_ID || "161215902883938536";

const AUTHOR_ORDER_BY =
  process.env.PIXAI_AUTHOR_ORDER_BY ?? "-createdAt";

const PAGE_SIZE = parseInt(process.env.PIXAI_FIRST ?? "20", 10) || 20;

const EXTENSIONS = {
  clientLibrary: { name: "@apollo/client", version: "4.1.4" },
  persistedQuery: { version: 1, sha256Hash: DEFAULT_PQ_HASH },
};

const BASE_VARS = {
  first: PAGE_SIZE,
  authorId: DEFAULT_AUTHOR_ID,
  ...(AUTHOR_ORDER_BY ? { orderBy: AUTHOR_ORDER_BY } : {}),
};

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

async function fetchPage(variables) {
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
    body = { _parseError: true, _rawPreview: text.slice(0, 400) };
  }
  return { res, body };
}

function collectModelIds(body) {
  const edges = body?.data?.generationModels?.edges;
  if (!Array.isArray(edges)) return [];
  return edges.map((e) => e?.node?.id).filter(Boolean);
}

async function main() {
  console.error(
    `[verify] OP=${OP} PQ=${EXTENSIONS.persistedQuery.sha256Hash.slice(0, 16)}… authorId=${BASE_VARS.authorId} orderBy=${AUTHOR_ORDER_BY ?? "(none)"} first=${BASE_VARS.first} auth=${process.env.PIXAI_AUTHORIZATION ? "yes" : "no"}\n`
  );

  const { res: r1, body: b1 } = await fetchPage({ ...BASE_VARS });
  const gm1 = b1?.data?.generationModels;
  const p1 = gm1?.pageInfo;
  const ids1 = collectModelIds(b1);
  const total1 = gm1?.totalCount;

  console.error("--- page1 ---");
  console.error(
    JSON.stringify(
      {
        httpStatus: r1.status,
        edgeCount: ids1.length,
        totalCount: total1 ?? null,
        hasNextPage: p1?.hasNextPage ?? null,
        endCursor: p1?.endCursor ?? null,
        errors: b1?.errors ?? null,
      },
      null,
      2
    )
  );

  if (!r1.ok) {
    console.error("\n[verify] HTTP 失败。");
    process.exit(1);
  }
  if (b1?.errors?.length) {
    console.error("\n[verify] GraphQL errors，请检查 PQ 哈希或 variables。");
    process.exit(1);
  }

  if (ids1.length === 0) {
    console.error(
      "\n[verify] 首屏无数据。作者模型流常需登录：设置 PIXAI_AUTHORIZATION=\"Bearer …\" 后重试；或核对 authorId / orderBy 与抓包一致。"
    );
    process.exit(0);
  }

  if (p1?.hasNextPage !== true || !p1?.endCursor) {
    console.error("\n[verify] hasNextPage 非 true 或无 endCursor，仅一页，跳过第二页。");
    process.exit(0);
  }

  await new Promise((r) => setTimeout(r, 400));

  const { res: r2, body: b2 } = await fetchPage({
    ...BASE_VARS,
    after: p1.endCursor,
  });
  const p2 = b2?.data?.generationModels?.pageInfo;
  const ids2 = collectModelIds(b2);

  console.error("\n--- page2 (after = page1.endCursor) ---");
  console.error(
    JSON.stringify(
      {
        httpStatus: r2.status,
        edgeCount: ids2.length,
        hasNextPage: p2?.hasNextPage ?? null,
        endCursor: p2?.endCursor ?? null,
        errors: b2?.errors ?? null,
      },
      null,
      2
    )
  );

  if (!r2.ok || b2?.errors?.length) {
    console.error("\n[verify] 第二页失败。");
    process.exit(1);
  }

  const set1 = new Set(ids1);
  const overlap = ids2.filter((id) => set1.has(id));
  const ok = ids2.length > 0 && overlap.length === 0;

  console.error(
    `\n[verify] 两页 node.id 交集数量: ${overlap.length}（期望 0）；第二页条数: ${ids2.length}`
  );

  if (!ok) {
    console.error("[verify] 未通过：请对照文档是否应使用 endCursor 作为 after。");
    process.exit(1);
  }
  console.error("[verify] 通过：下一页应使用上一响应的 pageInfo.endCursor 作为 after。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
