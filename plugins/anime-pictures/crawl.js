// anime-pictures WebView 爬虫：基于 page_label 的 switch 流程
// API: 全局 ctx { vars, currentContext, addProgress, downloadImage, to, exit, error, requestShowWebview }

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
      // 脚本结束退出。
      await ctx.exit();
  }
}

async function handleInitial(ctx) {
  await ctx.waitForDom();
  await ensurePastChallenge(ctx);

  const state = ctx.state;

  // 获得开始页面设置，0为默认值
  const startPage = ctx.vars?.startPage ?? 0;

  // 执行初始化动作
  if (!state.page) {
    await ctx.updateState({ page: startPage, startPage });
    const endPage = ctx.vars?.endPage ?? startPage;
    if (endPage >= startPage + 100) {
      throw "在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪";
    } else if (endPage < startPage) {
      throw "结束页面需要比开始页面大";
    }
  }

  // 获取当前页面
  const page = state.page;

  // 获得结束页面，第一次来到 initial 可能尚未由 posts 页写入（undefined）
  // 注意：endPage 合法值为 0 时必须仍参与判断，不能用 if (endPage)（0 为假值会跳过退出）
  const endPage = state.endPage;

  if (typeof endPage === "number" && Number.isFinite(endPage)) {
    if (page > endPage) {
      await ctx.exit();
      return;
    }
  }

  // 准备进入下一页
  await ctx.updateState({ page: page + 1 });

  const tag = ctx.vars?.tag?.trim() ?? "";
  const tagParam = tag ? encodeURIComponent(tag) : "";
  await ctx.sleep(2000);
  ctx.log(`当前页面: ${page}, 标签: ${tag}`);
  await ctx.to(`/posts?page=${page}${tagParam ? `&search_tag=${tagParam}` : ""}`, 
    { pageLabel: "posts", pageState: { nth: 1 } }
  );
}

async function handlePosts(ctx) {
  await ctx.waitForDom();
  const state = ctx.state;

  // 不知道最后一页是多少（从分页 DOM 解析；解析失败则退回用户配置的 endPage）
  if (state.endPage === undefined) {
    const endPageConfig = ctx.vars?.endPage ?? state.startPage;
    const pageNums = ctx
      .$$(".numeric_pages > *")
      .map((e) => parseInt(String(e.textContent).trim(), 10))
      .filter((v) => Number.isFinite(v));
    const parsedMax = pageNums.length > 0 ? Math.max(...pageNums) : NaN;
    const totalPages = Number.isFinite(parsedMax) ? parsedMax : endPageConfig;
    const endPage = Math.min(endPageConfig, totalPages);
    const totalPage = endPage - state.startPage + 1;
    await ctx.updateState({ endPage, percentPerPage: totalPage > 0 ? 100 / totalPage : 100 });
    ctx.log(`最大页数: ${endPage}，总页数: ${totalPage}`);
  }

  const pageState = ctx.pageState;
  const nth = pageState.nth ?? 1;

  const items = ctx.$$('.img-block > a');

  if (nth === 1) {
    ctx.log(`本页图片数量: ${items.length}`);
  }

  const item = items[nth - 1];

  if (!item) {
    await ctx.back();
    return;
  }

  const percentPerPage = state.percentPerPage;
  const percentPerImage = (percentPerPage > 0 && items.length > 0)
    ? percentPerPage / items.length
    : 0;
  if (percentPerImage > 0) {
    await ctx.addProgress(percentPerImage);
  }

  ctx.log(`下载第${nth}张图片`);

  await ctx.updatePageState({ nth: nth + 1 });
  const href = item.getAttribute("href");
  await ctx.sleep(2000);
  await ctx.to(href, { pageLabel: "detail" });
}

async function handleDetail(ctx) {
  await ctx.waitForDom();
  const downloadIcon = ctx.$(".icon-download");
  await ctx.sleep(3000);
  if (downloadIcon) {
    const href = downloadIcon.getAttribute("href");
    ctx.log(`下载图片: ${href}`);
    await ctx.downloadImage(href, { cookie: true });
  }
  await ctx.back();
}

await run();
