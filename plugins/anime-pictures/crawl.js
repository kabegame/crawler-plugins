// anime-pictures WebView 爬虫：基于 page_label 的 switch 流程
// API: 全局 ctx { vars, currentContext, addProgress, downloadImage, to, exit, error, requestShowWebview }

/** 判断当前是否为挑战页（如 Cloudflare "Just a moment..."） */
function isChallengePage(ctx) {
  const title = (document.title || "").trim();
  const bodyText =
    document.body && document.body.innerText
      ? document.body.innerText.slice(0, 2000)
      : "";
  const isChallenge =
    /just a moment|cloudflare|challenge|checking your browser/i.test(title) ||
    /just a moment|cloudflare|checking your browser/i.test(bodyText);
  return !!isChallenge;
}

/** 若为挑战页：请求打开 webview、等待 20 秒后再继续，并 log 相关信息 */
async function ensurePastChallenge(ctx) {
  if (!isChallengePage(ctx)) return;
  ctx.log(
    "[anime-pictures] 检测到挑战页（如 Cloudflare 验证），请求打开 WebView 窗口并等待 20 秒",
  );
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
  await ctx.to(
    `/posts?page=${page}${tagParam ? `&search_tag=${tagParam}` : ""}`,
    { pageLabel: "posts", pageState: { nth: 1 } },
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
    await ctx.updateState({
      endPage,
      percentPerPage: totalPage > 0 ? 100 / totalPage : 100,
    });
    ctx.log(`最大页数: ${endPage}，总页数: ${totalPage}`);
  }

  const pageState = ctx.pageState;
  const nth = pageState.nth ?? 1;

  const items = ctx.$$(".img-block > a");

  if (nth === 1) {
    ctx.log(`本页图片数量: ${items.length}`);
  }

  const item = items[nth - 1];

  if (!item) {
    await ctx.back();
    return;
  }

  const percentPerPage = state.percentPerPage;
  const percentPerImage =
    percentPerPage > 0 && items.length > 0 ? percentPerPage / items.length : 0;
  if (percentPerImage > 0) {
    await ctx.addProgress(percentPerImage);
  }

  ctx.log(`下载第${nth}张图片`);

  await ctx.updatePageState({ nth: nth + 1 });
  const href = item.getAttribute("href");
  await ctx.sleep(2000);
  await ctx.to(href, { pageLabel: "detail" });
}

/**
 * 展示名：与 PixAI 等一致，用「 / 」分割。
 * title = 作品(copyright) / 角色(character)（缺段则跳过）；author = 作家(artist)；
 * 最终为 title / author（任一段为空则省略该段及多余斜线）。
 * 对应页内 ul.tags：作品名（他の）/ キャラクターの名前 / アーティスト名 三块下的 big_tag 链接。
 */
function pickAnimePicturesDisplayName(ctx) {
  const log = (msg) => {
    if (ctx && typeof ctx.log === "function") ctx.log(msg);
  };

  const textOf = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  const tagsUl = document.querySelector("ul.tags, .page-tags ul.tags, .wrapper.page-tags ul.tags");
  if (tagsUl) {
    const workEl = tagsUl.querySelector("a.copyright");
    const charEl = tagsUl.querySelector("a.character");
    const artistEl = tagsUl.querySelector("a.artist");
    const work = textOf(workEl);
    const character = textOf(charEl);
    const artist = textOf(artistEl);
    const titleSeg = [work, character].filter(Boolean).join(" / ");
    const name = [titleSeg, artist].filter(Boolean).join(" / ");
    if (name) {
      log(
        `[anime-pictures] pickName: title/author 作品=${JSON.stringify(work || null)} 角色=${JSON.stringify(character || null)} 作家=${JSON.stringify(artist || null)} => ${JSON.stringify(name)}`,
      );
      return name;
    }
    log("[anime-pictures] pickName: ul.tags 内未找到 copyright/character/artist 链接");
  } else {
    log("[anime-pictures] pickName: 未找到 ul.tags，走回退");
  }

  const illustRe = /^(イラスト|illustration|illustrations|арт|插画|圖片|图片)/i;
  const h1A = document.querySelector(
    ".post_content.head-info h1 a.copyright, .post-block h1 a.copyright",
  );
  const h1One = textOf(h1A);
  if (h1One) {
    log(`[anime-pictures] pickName: 回退 h1.copyright -> ${JSON.stringify(h1One)}`);
    return h1One;
  }

  const titleRaw = (document.title || "").trim();
  const lines = titleRaw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length >= 2 && illustRe.test(lines[0])) {
    log(
      `[anime-pictures] pickName: 回退 title 换行第2段 -> ${JSON.stringify(lines[1])}`,
    );
    return lines[1];
  }
  const oneLine = titleRaw.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const tokens = oneLine.split(" ").filter(Boolean);
  if (tokens.length >= 2 && illustRe.test(tokens[0])) {
    log(
      `[anime-pictures] pickName: 回退 title 分词第2词 -> ${JSON.stringify(tokens[1])}`,
    );
    return tokens[1];
  }

  log(
    `[anime-pictures] pickName: 仍为空 title=${JSON.stringify(oneLine.slice(0, 200))}`,
  );
  return "";
}

function resolveAbsHref(href) {
  if (!href) return "";
  try {
    return new URL(href, location.href).href;
  } catch {
    return href;
  }
}

/** 克隆 DOM 子树供详情 iframe 使用：绝对化链接与图片、外链新标签打开 */
function cloneNodeForDescriptionHtml(node) {
  const c = node.cloneNode(true);
  c.querySelectorAll("a[href]").forEach((a) => {
    const h = a.getAttribute("href");
    if (h) a.setAttribute("href", resolveAbsHref(h));
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  c.querySelectorAll("img[src]").forEach((img) => {
    const s = img.getAttribute("src");
    if (s) img.setAttribute("src", resolveAbsHref(s));
  });
  return c;
}

function infoItemPlainText(item) {
  const clone = item.cloneNode(true);
  clone.querySelectorAll("svg").forEach((s) => s.remove());
  clone.querySelectorAll("a[href]").forEach((a) => {
    const text = (a.textContent || "").replace(/\s+/g, " ").trim();
    const href = resolveAbsHref(a.getAttribute("href"));
    const rep = href ? `${text || href} (${href})` : text;
    a.replaceWith(document.createTextNode(rep));
  });
  clone.querySelectorAll("span.color-sample").forEach((sp) => {
    const st = sp.getAttribute("style") || "";
    const m = st.match(/background-color:\s*([^;]+)/i);
    sp.replaceWith(document.createTextNode(m ? ` ${m[1].trim()}` : ""));
  });
  const raw = (clone.textContent || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw;
}

/** 详情 metadata（由前端 `templates/description.ejs` 渲染） */
function buildAnimePicturesMetadata() {
  const head = document.querySelector(".post_content.head-info");
  if (!head) return null;

  let author = null;
  const authorSec = head.querySelector(".author-section");
  if (authorSec) {
    const avatarWrap = authorSec.querySelector("a[href*='profile']");
    const img = authorSec.querySelector("img");
    const userA = authorSec.querySelector("a.user_link");
    const name = (userA?.textContent || "").replace(/\s+/g, " ").trim();
    const profileHref = userA ? resolveAbsHref(userA.getAttribute("href")) : "";
    const hasImg = !!(img && avatarWrap);
    const avSrc = hasImg ? resolveAbsHref(img.getAttribute("src")) : "";
    if (name || avSrc || profileHref) {
      author = {
        name: name || "",
        profileUrl: profileHref || "",
        avatarUrl: avSrc || "",
      };
    }
  }

  const lines = [];
  const details = head.querySelector(".details-section");
  if (details) {
    for (const line of details.querySelectorAll(":scope > .info-line")) {
      if (line.querySelector("button.metrics-toggle")) continue;
      for (const item of line.querySelectorAll(":scope > .info-item")) {
        const ln = infoItemPlainText(item);
        if (ln) lines.push(ln);
      }
    }
  }

  let rating = null;
  const ratingEl = document.querySelector(".vote_block span.rating");
  if (ratingEl) {
    const b = ratingEl.querySelector("b");
    const countEl = [...ratingEl.querySelectorAll("span")].find((s) =>
      /^\d+$/.test((s.textContent || "").trim()),
    );
    if (b && countEl) {
      rating = {
        label: (b.textContent || "").trim(),
        count: (countEl.textContent || "").trim(),
      };
    }
  }

  const headClone = cloneNodeForDescriptionHtml(head);
  headClone.querySelectorAll("button.metrics-toggle").forEach((b) => {
    const line = b.closest(".info-line");
    if (line) line.remove();
  });
  const headInfoHtml = headClone.outerHTML;

  const tagsUl =
    document.querySelector("ul.tags[itemprop='keywords']") ||
    document.querySelector(".wrapper.page-tags ul.tags");
  const tagsHtml = tagsUl ? cloneNodeForDescriptionHtml(tagsUl).outerHTML : "";

  return { author, lines, rating, headInfoHtml, tagsHtml };
}

async function handleDetail(ctx) {
  await ctx.waitForDom();
  await ensurePastChallenge(ctx);

  const displayName = pickAnimePicturesDisplayName(ctx);
  const metadata = buildAnimePicturesMetadata();

  ctx.log(
    `[anime-pictures] downloadImage 展示名 name: ${displayName ? JSON.stringify(displayName) : "(空)"}`,
  );
  ctx.log(
    `[anime-pictures] metadata: ${metadata ? JSON.stringify(metadata).slice(0, 500) : "(空)"}`,
  );

  const downloadIcon = ctx.$(".icon-download");
  await ctx.sleep(3000);
  if (downloadIcon) {
    const href = downloadIcon.getAttribute("href");
    ctx.log(`下载图片: ${href}`);
    const opts = { cookie: true };
    if (displayName) opts.name = displayName;
    if (metadata) opts.metadata = metadata;
    await ctx.downloadImage(href, opts);
  }
  await ctx.back();
}

await run();
