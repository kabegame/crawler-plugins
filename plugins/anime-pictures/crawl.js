// anime-pictures WebView 爬虫：基于 page_label 的 switch 流程
// API: 全局 ctx { vars, currentContext, add_progress, download_image, to, exit, error, requestShowWebview }

/** 判断当前是否为挑战页（如 Cloudflare "Just a moment..."） */
function isChallengePage(ctx) {
  const title = (document.title || "").trim();
  const bodyText = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 2000) : "";
  const isChallenge =
    /just a moment|cloudflare|challenge|checking your browser/i.test(title) ||
    /just a moment|cloudflare|checking your browser/i.test(bodyText);
  return !!isChallenge;
}

/** 若为挑战页：请求打开 webview、等待 20 秒后再继续，并 log 相关信息 */
async function ensurePastChallenge(ctx) {
  if (!isChallengePage(ctx)) return;
  ctx.log("[anime-pictures] 检测到挑战页（如 Cloudflare 验证），请求打开 WebView 窗口并等待 20 秒");
  await ctx.requestShowWebview();
  await ctx.sleep(20000);
  ctx.log("[anime-pictures] 等待结束，重新查询页面元素");
  await ctx.waitForDom();
}

async function run() {
  const step = ctx.pageLabel;

  switch (step) {
    case "initial":
      // 首次进入（ctx.pageLabel 由 Rust 在创建任务时设为 initial）
      await handleInitial(ctx);
      break;
    case "posts":
      // 列表页：解析条目，可 to 到详情或下一页
      await handlePosts(ctx);
      break;
    case "detail":
      // 详情页：下载图片，再 to 下一项或 exit
      await handleDetail(ctx);
      break;
    case "exit":
    default:
      await ctx.sleep(100000);
      // 脚本结束退出。
      await ctx.exit();
  }
}

async function handleInitial(ctx) {
  await ctx.waitForDom();
  await ensurePastChallenge(ctx);

  // 跳转到列表页，并标记下一步为 list
  const state = ctx.pageState;
  if (!state.page) {
    await ctx.updatePageState({ page: ctx.vars?.startPage ?? 0 });
  }
  const page = state.page;
  const startPage = ctx.vars?.startPage ?? 0;
  const endPage = ctx.vars?.endPage ?? startPage;
  if (page === startPage) {
    if (endPage >= startPage + 100) {
      throw "在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪";
    } else if (endPage < startPage) {
      throw "结束页面需要比开始页面大";
    }
  } else if (page > endPage) {
    await ctx.exit();
    return;
  }
  await ctx.updatePageState({ page: page + 1 });

  const allPages = ctx.$$('.numeric-pages > *') || [];
  const totalPages = Math.max(0, ...allPages.map(p => p.textContent)
    .filter(t => t !== '')
    .map(t => parseInt(t, 10)));
  
  const maxPage = Math.min(totalPages, endPage);
  const totalPagesToCrawl = maxPage - startPage + 1;
  const percentPerPage = totalPagesToCrawl > 0 ? 100 / totalPagesToCrawl : 0;

  const tag = ctx.vars?.tag?.trim() ?? "";
  const tagParam = tag ? encodeURIComponent(tag) : "";
  ctx.sleep(5000);
  ctx.log(`当前页面: ${page}, 总页数: ${totalPages}, 最大页数: ${maxPage}, 标签: ${tag}`);
  await ctx.to(`/posts?page=${page}${tagParam ? `&search_tag=${tagParam}` : ""}`, 
    { pageLabel: "posts", pageState: { nth: 1, percentPerPage } }
  );
}

async function handlePosts(ctx) {
  await ctx.waitForDom();
  const state = ctx.pageState || {};
  const nth = state.nth ?? 1;

  const items = ctx.$$('.img-block > a');

  ctx.log(`本页图片数量: ${items.length}`);

  const item = items[nth - 1];

  if (!item) {
    await ctx.back();
    return;
  }

  const percentPerPage = state.percentPerPage ?? 0;
  const percentPerImage = (percentPerPage > 0 && items.length > 0)
    ? percentPerPage / items.length
    : 0;
  if (percentPerImage > 0) {
    await ctx.add_progress(percentPerImage);
  }

  ctx.log(`下载第${nth}张图片`);

  await ctx.updatePageState({ nth: nth + 1 });
  const href = item.getAttribute("href");
  ctx.sleep(5000);
  await ctx.to(href, { pageLabel: "detail" });
}

async function handleDetail(ctx) {
  await ctx.waitForDom();
  const downloadIcon = ctx.$(".icon-download");
  await ctx.sleep(3000);
  if (downloadIcon) {
    const href = downloadIcon.getAttribute("href");
    ctx.log(`下载图片: ${href}`);
    await ctx.download_image(href, { cookie: true });
  }
  await ctx.back();
}

await run();
