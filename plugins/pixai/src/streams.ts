// @ts-nocheck
// 全站 / 标签 / 作者三种「一条流打到底」的爬取模式。三者都只是把配置项翻成
// artworks.ts 的参数，区别在于页码上限从哪来：
//   全站   起始页 + 结束页（end_page 就是页码上限）
//   标签   起始页 + 每个标签的分页数
//   作者   起始页 + 作者作品分页数
import { DEFAULT_AUTHOR_ARTWORK_PAGES, DEFAULT_TAG_ARTWORK_PAGES } from "./consts";
import { processArtworks, processAuthorArtworks } from "./artworks";
import { resolveTackId } from "./tacks";
import { arrayValue, coerceStr, globalPageWindow, log, skipPagesOf, toInt } from "./util";

const { addProgress } = Kabegame;

export async function runGlobal(vars) {
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const { skipPages, maxPages } = globalPageWindow(vars);

  log(`[PixAI] 全站流：排序=${artworkSort}，第 ${skipPages + 1} 页到第 ${maxPages} 页`);
  const downloadCount = await processArtworks(
    "",
    "",
    "全站",
    maxPages,
    100.0,
    artworkSort,
    skipPages,
  );
  log(`[PixAI] 全站流结束：下载图片 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

export async function runTag(vars) {
  const tagCodeNames = arrayValue(vars.tag_code_names);
  const maxTagArtworkPages = toInt(vars.max_tag_artwork_pages, DEFAULT_TAG_ARTWORK_PAGES);
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = skipPagesOf(vars);

  if (tagCodeNames.length === 0) {
    log("[PixAI] 未输入任何标签 codeName，结束");
    addProgress(100.0);
    return;
  }

  log(`[PixAI] 标签流：共 ${tagCodeNames.length} 个 codeName，每标签最多 ${maxTagArtworkPages} 页，从第 ${skipArtworkPages + 1} 页开始`);
  const perTagProgress = 100.0 / tagCodeNames.length;
  let downloadCount = 0;
  let resolvedCount = 0;

  for (let index = 0; index < tagCodeNames.length; index += 1) {
    const codeName = coerceStr(tagCodeNames[index]);
    log(`[PixAI] 处理标签 ${index + 1}/${tagCodeNames.length}：codeName=${codeName}`);
    const tagId = await resolveTackId(codeName);
    if (!tagId) {
      log(`[PixAI] 跳过标签：codeName=${codeName} 无效或未找到对应 tackId`);
      addProgress(perTagProgress);
      continue;
    }

    resolvedCount += 1;
    log(`[PixAI] codeName=${codeName} -> tackId=${tagId}`);
    downloadCount += await processArtworks(
      "tackId",
      tagId,
      "标签",
      maxTagArtworkPages,
      perTagProgress,
      artworkSort,
      skipArtworkPages,
    );
  }

  log(`[PixAI] 标签流结束：输入 codeName ${tagCodeNames.length} 个，解析成功 ${resolvedCount} 个，下载图片 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}

export async function runAuthor(vars) {
  const authorId = coerceStr(vars.author_id);
  if (!authorId) {
    log("[PixAI] 未输入作者 ID，结束");
    addProgress(100.0);
    return;
  }

  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = skipPagesOf(vars);
  const maxAuthorArtworkPages = toInt(vars.max_author_artwork_pages, DEFAULT_AUTHOR_ARTWORK_PAGES);
  const animated = coerceStr(vars.author_artwork_type) === "animated";
  const authorTypes = animated ? ["ANIMATED_ARTWORK"] : ["DEFAULT", "ALBUM"];
  const authorTypeLabel = animated ? "动图(ANIMATED_ARTWORK)" : "图片(DEFAULT+ALBUM)";

  log(`[PixAI] 作者流：authorId=${authorId}，类型=${authorTypeLabel}，排序=${artworkSort}，最多 ${maxAuthorArtworkPages} 页，从第 ${skipArtworkPages + 1} 页开始`);
  const downloadCount = await processAuthorArtworks(
    authorId,
    authorTypes,
    authorTypeLabel,
    maxAuthorArtworkPages,
    100.0,
    artworkSort,
    skipArtworkPages,
  );
  log(`[PixAI] 作者流结束：authorId=${authorId}，下载图片 ${downloadCount} 张`);
  if (downloadCount === 0) addProgress(100.0);
}
