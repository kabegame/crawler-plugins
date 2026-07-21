// @ts-nocheck
const {
  addProgress,
  createImageMetadata,
  downloadImage,
  requireCookie,
  setHeader,
  warn,
} = Kabegame;

function coerceStr(value) {
  return value == null ? "" : String(value);
}

// 需要登录态的分支：从畅游注入 pixiv 的 Cookie（脚本拿不到明文）。
// 取不到（畅游无该站 Cookie）直接抛错终止任务，提示用户先去畅游登录 pixiv。
function ensurePixivCookie(reason) {
  if (!requireCookie()) {
    throw new Error(`${reason}需要登录：未从畅游获取到 Cookie，请先在畅游登录 pixiv 后重试`);
  }
}

// 需登录分支中，列表请求得到 403 视为登录态失效 → 抛错终止（提示重新登录）。
// 其它错误交回调用方按原逻辑处理（通常是到底/瞬时错误后 break）。
function rethrowIfLoginFailed(error, reason, loginRequired) {
  if (loginRequired && error?.status === 403) {
    throw new Error(`${reason}失败：pixiv 登录态失效（403），请在畅游重新登录 pixiv 后重试`);
  }
}

function setPixivHeaders() {
  setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");
  setHeader("Referer", "https://www.pixiv.net/");
  setHeader("Origin", "https://www.pixiv.net");
  setHeader("x-requested-with", "XMLHttpRequest");
  setHeader("Accept", "application/json");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}: ${url}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function addArtworkProgress(totalArtworks) {
  if (totalArtworks > 0) addProgress(99.0 / totalArtworks);
}

function effectiveContentForRanking(rankingMode, contentMode) {
  return ["daily", "weekly", "monthly", "rookie"].includes(rankingMode)
    ? contentMode
    : "all";
}

function rankingPixivMode(rankingMode, ageMode) {
  if (ageMode !== "r18") return rankingMode;
  return rankingMode === "daily_ai" ? "daily_r18_ai" : `${rankingMode}_r18`;
}

function pixivTrimIllustBody(body) {
  return {
    illustId: body?.illustId,
    id: body?.id,
    title: body?.title,
    illustTitle: body?.illustTitle,
    description: body?.description,
    illustComment: body?.illustComment,
    userId: body?.userId,
    userName: body?.userName,
    uploadDate: body?.uploadDate,
    createDate: body?.createDate,
    bookmarkCount: body?.bookmarkCount,
    likeCount: body?.likeCount,
    viewCount: body?.viewCount,
    tags: body?.tags,
  };
}

async function fetchPixivComments(illustId) {
  try {
    setHeader("Referer", `https://www.pixiv.net/artworks/${illustId}`);
    const url = `https://www.pixiv.net/ajax/illusts/comments/roots?illust_id=${illustId}&offset=0&limit=20&lang=en`;
    const json = await fetchJson(url);
    if (json && json.error !== true && json.body?.comments) return json.body.comments;
  } catch {
    warn(`[Pixiv] 评论获取失败，illust_id=${illustId}`);
  }
  return [];
}

async function downloadIllust(illustId) {
  setHeader("Referer", `https://www.pixiv.net/artworks/${illustId}`);
  let illustBody = null;
  try {
    illustBody = (await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}`))?.body || null;
  } catch {
    // Deleted or restricted details still allow trying pages below.
  }

  try {
    const json = await fetchJson(`https://www.pixiv.net/ajax/illust/${illustId}/pages`);
    const body = Array.isArray(json?.body) ? json.body : [];
    const pages = body.filter((page) => page?.urls?.original);
    if (pages.length === 0) return;

    const baseName = coerceStr(illustBody?.title) || illustId;
    const comments = await fetchPixivComments(illustId);
    const metadataId = Number(illustBody
      ? createImageMetadata({ body: pixivTrimIllustBody(illustBody), comments }, null)
      : createImageMetadata({ illustId }, null));

    for (let index = 0; index < pages.length; index += 1) {
      const displayName = pages.length > 1 ? `${baseName}(${index + 1})` : baseName;
      await downloadImage(pages[index].urls.original, {
        name: displayName,
        metadata_id: metadataId,
        url: `https://www.pixiv.net/artworks/${illustId}`,
      });
    }
  } catch {
    // Works may be deleted/restricted. Skip quietly like the Rhai plugin.
  }
}

async function runRanking(vars) {
  const effectiveContent = effectiveContentForRanking(vars.ranking_mode, vars.content_mode);
  if ((vars.ranking_mode === "monthly" || vars.ranking_mode === "rookie") && effectiveContent === "ugoira") {
    throw new Error("月榜与新生榜不支持动图（うごイラ）内容类型");
  }

  const apiMode = rankingPixivMode(vars.ranking_mode, vars.age_mode);
  if (vars.age_mode === "r18") {
    if (!coerceStr(vars.user_id)) throw new Error("R18 排行榜请在「用户 UID」填写登录账号 UID（x-user-id）");
    setHeader("x-user-id", coerceStr(vars.user_id));
    ensurePixivCookie("R18 排行榜");
  }

  let done = 0;
  let page = 1;
  const target = Number(vars.num_artworks ?? 0);
  while (done < target) {
    const dateQ = coerceStr(vars.ranking_date) ? `&date=${vars.ranking_date}` : "";
    const refBase = `https://www.pixiv.net/ranking.php?mode=${apiMode}&content=${effectiveContent}${dateQ}`;
    setHeader("Referer", refBase);
    let json;
    try {
      json = await fetchJson(`${refBase}&p=${page}&format=json`);
    } catch (e) {
      rethrowIfLoginFailed(e, "R18 排行榜", vars.age_mode === "r18");
      break;
    }
    const contents = Array.isArray(json?.contents) ? json.contents : [];
    for (const item of contents) {
      if (done >= target) break;
      const id = coerceStr(item?.illust_id);
      if (!id) continue;
      await downloadIllust(id);
      done += 1;
      addArtworkProgress(target);
    }
    if (done >= target || !json?.next) break;
    page = Number(json.next);
    if (!Number.isFinite(page) || page < 1) break;
  }
  if (done < target) {
    warn(`排行榜实际只获取到 ${done} 个作品，少于请求的 ${target} 个（可能已到底或无更多页）`);
  }
}

async function runBookmark(vars) {
  const userId = coerceStr(vars.user_id);
  if (!userId) throw new Error("收藏模式请填写用户 UID");
  ensurePixivCookie("收藏抓取");
  const target = Number(vars.num_artworks ?? 0);
  const limit = 48;
  let offset = 0;
  let done = 0;
  while (done < target) {
    let json;
    try {
      json = await fetchJson(`https://www.pixiv.net/ajax/user/${userId}/illusts/bookmarks?tag=&offset=${offset}&limit=${limit}&rest=show&lang=zh`);
    } catch (e) {
      rethrowIfLoginFailed(e, "收藏抓取", true);
      break;
    }
    const works = Array.isArray(json?.body?.works) ? json.body.works : [];
    for (const work of works) {
      if (done >= target) break;
      const id = coerceStr(work?.id);
      if (!id) continue;
      await downloadIllust(id);
      done += 1;
      addArtworkProgress(target);
    }
    if (works.length < limit) break;
    offset += limit;
  }
}

async function runUser(vars) {
  const artistId = coerceStr(vars.artist_id);
  const userId = coerceStr(vars.user_id);
  if (!artistId) throw new Error("画师模式请填写画师 UID");
  if (!userId) throw new Error("画师模式请填写登录用户 UID（x-user-id，与 PixivCrawler 一致）");
  setHeader("x-user-id", userId);
  ensurePixivCookie("画师作品抓取");

  let json;
  try {
    json = await fetchJson(`https://www.pixiv.net/ajax/user/${artistId}/profile/all?lang=zh`);
  } catch (e) {
    rethrowIfLoginFailed(e, "画师作品抓取", true);
    throw e;
  }
  const illusts = json?.body?.illusts || {};
  const ids = Object.keys(illusts)
    .map((key) => Number(key))
    .filter((id) => Number.isInteger(id))
    .sort((a, b) => b - a);

  const perPage = 48;
  const totalPages = Math.ceil(ids.length / perPage);
  let firstPage = Math.max(1, Number(vars.artist_start_page ?? 1));
  let lastPage = Number(vars.artist_end_page ?? totalPages);
  if (lastPage <= 0 || lastPage > totalPages) lastPage = totalPages;

  if (ids.length === 0) {
    warn("该画师没有可抓取的作品");
    return;
  }
  if (firstPage > totalPages || firstPage > lastPage) {
    warn(`画师作品页范围为空：起始页 ${firstPage}，结束页 ${lastPage}，总页数 ${totalPages}`);
    return;
  }

  const startOffset = (firstPage - 1) * perPage;
  const endOffset = Math.min(lastPage * perPage, ids.length);
  const selectedTotal = endOffset - startOffset;
  for (let index = startOffset; index < endOffset; index += 1) {
    await downloadIllust(String(ids[index]));
    addArtworkProgress(selectedTotal);
  }
}

async function runKeyword(vars) {
  const keyword = coerceStr(vars.keyword);
  if (!keyword) throw new Error("关键词模式请填写搜索关键词");
  // 热门排序需 Premium 登录；r18/all 搜索会出 R18 结果需登录
  const needLogin = vars.keyword_order === "popular" || vars.search_mode !== "safe";
  if (needLogin) ensurePixivCookie("热门排序 / R18 搜索");
  const kwEnc = encodeURIComponent(keyword);
  const orderParam = vars.keyword_order === "popular" ? "popular_d" : "date_d";
  const target = Number(vars.num_artworks ?? 0);
  const limit = 60;
  let page = 1;
  let done = 0;

  while (done < target) {
    let json;
    try {
      json = await fetchJson(`https://www.pixiv.net/ajax/search/artworks/${kwEnc}?word=${kwEnc}&order=${orderParam}&mode=${vars.search_mode}&p=${page}&s_mode=s_tag_full&type=all&lang=zh`);
    } catch (e) {
      rethrowIfLoginFailed(e, "关键词搜索", needLogin);
      break;
    }
    const data = Array.isArray(json?.body?.illustManga?.data) ? json.body.illustManga.data : [];
    for (const item of data) {
      if (done >= target) break;
      const id = coerceStr(item?.id);
      if (!id) continue;
      await downloadIllust(id);
      done += 1;
      addArtworkProgress(target);
    }
    if (data.length < limit) break;
    page += 1;
  }
}

export async function crawl(_common, custom) {
  const vars = custom || {};
  setPixivHeaders();
  if (vars.source === "ranking") {
    await runRanking(vars);
  } else if (vars.source === "bookmark") {
    await runBookmark(vars);
  } else if (vars.source === "user") {
    await runUser(vars);
  } else if (vars.source === "keyword") {
    await runKeyword(vars);
  } else {
    throw new Error(`未知的爬取类型: ${vars.source}`);
  }
}
