#!/usr/bin/env node
/**
 * 验证 PixAI `listArtworks` 作者页分页：`last` + `before`，下一页 `before` = 上一页 `pageInfo.startCursor`。
 *
 * 用法（在插件目录 `plugins/pixai/` 下）：
 *   node ./scripts/verify-listArtworks-author-pagination.mjs
 *   PIXAI_AUTHORIZATION="Bearer <token>" PIXAI_AUTHOR_ID="<作者 id>" node ./scripts/verify-listArtworks-author-pagination.mjs
 *   PIXAI_AUTHOR_ORDER_BY="-markInfo.likedCount" node ./scripts/verify-listArtworks-author-pagination.mjs
 *   PIXAI_PQ_HASH=<sha256> …
 *
 * 未设置 PIXAI_AUTHORIZATION 时仍请求一次，便于确认公网是否拒绝；作者页若返回 401/403，请带抓包中的 Bearer（勿提交到仓库）。
 */

const BASE = "https://api.pixai.art/graphql";
const OP = "listArtworks";

/** 与 §6 `listArtworks` 示例一致；作者页与 §5.2 的差异在 `variables`，非必须换 PQ 哈希 */
const DEFAULT_PQ_HASH =
  process.env.PIXAI_PQ_HASH ||
  "e0c938939452d33abf3289e74b9f9f7bebd749e065ee905e7e073aca6f05199c";

const DEFAULT_AUTHOR_ID = process.env.PIXAI_AUTHOR_ID || "1612159028833938536";

/** 作者页按赞数降序（人气）等；不设则与无 orderBy 的首屏一致 */
const AUTHOR_ORDER_BY = process.env.PIXAI_AUTHOR_ORDER_BY;

const EXTENSIONS = {
  clientLibrary: { name: "@apollo/client", version: "4.1.4" },
  persistedQuery: { version: 1, sha256Hash: DEFAULT_PQ_HASH },
};

const BASE_VARS = {
  last: 20,
  authorId: DEFAULT_AUTHOR_ID,
  types: ["DEFAULT", "ALBUM"],
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

function collectIds(body) {
  const edges = body?.data?.artworks?.edges;
  if (!Array.isArray(edges)) return [];
  return edges.map((e) => e?.node?.id).filter(Boolean);
}

/** @param {unknown} body */
function collectLikedCounts(body) {
  const edges = body?.data?.artworks?.edges;
  if (!Array.isArray(edges)) return [];
  return edges.map((e) => {
    const node = e?.node;
    const n =
      typeof node?.likedCount === "number"
        ? node.likedCount
        : typeof node?.markInfo?.likedCount === "number"
          ? node.markInfo.likedCount
          : null;
    return n;
  });
}

async function main() {
  console.error(
    `[verify] OP=${OP} PQ=${EXTENSIONS.persistedQuery.sha256Hash.slice(0, 16)}… authorId=${BASE_VARS.authorId} orderBy=${AUTHOR_ORDER_BY ?? "(none)"} auth=${process.env.PIXAI_AUTHORIZATION ? "yes" : "no"}\n`
  );

  const { res: r1, body: b1 } = await fetchPage({ ...BASE_VARS });
  const p1 = b1?.data?.artworks?.pageInfo;
  const ids1 = collectIds(b1);

  console.error("--- page1 ---");
  console.error(
    JSON.stringify(
      {
        httpStatus: r1.status,
        edgeCount: ids1.length,
        hasPreviousPage: p1?.hasPreviousPage ?? null,
        startCursor: p1?.startCursor ?? null,
        endCursor: p1?.endCursor ?? null,
        errors: b1?.errors ?? null,
      },
      null,
      2
    )
  );

  if (!r1.ok || b1?.errors?.length) {
    console.error("\n[verify] 首屏失败：请检查网络、`variables` / `extensions` 或设置 PIXAI_AUTHORIZATION。");
    process.exit(1);
  }

  if (p1?.hasPreviousPage !== true) {
    console.error("\n[verify] 仅一页数据（hasPreviousPage !== true），跳过第二页与去重校验。");
    process.exit(0);
  }

  const before = p1?.startCursor;
  if (!before) {
    console.error("\n[verify] hasPreviousPage 为 true 但缺少 startCursor，无法组第二页。");
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 400));

  const { res: r2, body: b2 } = await fetchPage({ ...BASE_VARS, before });
  const p2 = b2?.data?.artworks?.pageInfo;
  const ids2 = collectIds(b2);

  console.error("\n--- page2 (before = page1.startCursor) ---");
  console.error(
    JSON.stringify(
      {
        httpStatus: r2.status,
        edgeCount: ids2.length,
        hasPreviousPage: p2?.hasPreviousPage ?? null,
        startCursor: p2?.startCursor ?? null,
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

  if (AUTHOR_ORDER_BY === "-markInfo.likedCount") {
    const c1 = collectLikedCounts(b1).filter((x) => x !== null);
    const c2 = collectLikedCounts(b2).filter((x) => x !== null);
    const min1 = c1.length ? Math.min(...c1) : null;
    const max2 = c2.length ? Math.max(...c2) : null;
    const crossOk =
      min1 !== null && max2 !== null ? max2 <= min1 : true;
    console.error(
      `[verify] 人气序粗检：page1 最小 likedCount=${min1}，page2 最大 likedCount=${max2}，page2≤page1 最小? ${crossOk}`
    );
    if (!crossOk) {
      console.error("[verify] 人气序粗检未通过（边界可能并列赞数，仅作参考）。");
    }
  }

  if (!ok) {
    console.error("[verify] 未通过：请对照 §5.3 是否应使用 startCursor / 或站点已变更。");
    process.exit(1);
  }
  console.error("[verify] 通过：下一页应使用上一响应的 pageInfo.startCursor 作为 before。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
