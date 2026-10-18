// 全站 / 标签 / 作者三种「一条流打到底」的爬取模式。三者都只是把配置项翻成
// artworks.ts 的参数，区别在于页码上限从哪来：
//   全站   起始页 + 结束页（end_page 就是页码上限）
//   标签   起始页 + 每个标签的分页数
//   作者   起始页 + 作者作品分页数
import { DEFAULT_AUTHOR_ARTWORK_PAGES, DEFAULT_TAG_ARTWORK_PAGES } from "./consts";
import { processArtworks, processAuthorArtworks } from "./artworks";
import { resolveTackId } from "./tacks";
import type { PixaiVars } from "./types";
import { arrayValue, coerceStr, globalPageWindow, log, skipPagesOf, toInt } from "./util";
import { t } from "./i18n";

const { addProgress } = Kabegame;

export async function runGlobal(vars: PixaiVars): Promise<void> {
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const { skipPages, maxPages } = globalPageWindow(vars);

  log(t("globalFlowStart", { sort: artworkSort, startPage: skipPages + 1, endPage: maxPages }));
  const downloadCount = await processArtworks(
    "",
    "",
    t("labelGlobal"),
    maxPages,
    100.0,
    artworkSort,
    skipPages,
  );
  log(t("globalFlowDone", { count: downloadCount }));
  if (downloadCount === 0) addProgress(100.0);
}

export async function runTag(vars: PixaiVars): Promise<void> {
  const tagCodeNames = arrayValue<unknown>(vars.tag_code_names);
  const maxTagArtworkPages = toInt(vars.max_tag_artwork_pages, DEFAULT_TAG_ARTWORK_PAGES);
  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = skipPagesOf(vars);

  if (tagCodeNames.length === 0) {
    log(t("tagsEmpty"));
    addProgress(100.0);
    return;
  }

  log(t("tagFlowStart", {
    count: tagCodeNames.length,
    maxPages: maxTagArtworkPages,
    startPage: skipArtworkPages + 1,
  }));
  const perTagProgress = 100.0 / tagCodeNames.length;
  let downloadCount = 0;
  let resolvedCount = 0;

  for (let index = 0; index < tagCodeNames.length; index += 1) {
    const codeName = coerceStr(tagCodeNames[index]);
    log(t("tagProcessing", { index: index + 1, total: tagCodeNames.length, codeName }));
    const tagId = await resolveTackId(codeName);
    if (!tagId) {
      log(t("tagSkipped", { codeName }));
      addProgress(perTagProgress);
      continue;
    }

    resolvedCount += 1;
    log(`[PixAI] codeName=${codeName} -> tackId=${tagId}`);
    downloadCount += await processArtworks(
      "tackId",
      tagId,
      t("labelTags"),
      maxTagArtworkPages,
      perTagProgress,
      artworkSort,
      skipArtworkPages,
    );
  }

  log(t("tagFlowDone", {
    input: tagCodeNames.length,
    resolved: resolvedCount,
    count: downloadCount,
  }));
  if (downloadCount === 0) addProgress(100.0);
}

export async function runAuthor(vars: PixaiVars): Promise<void> {
  const authorId = coerceStr(vars.author_id);
  if (!authorId) {
    log(t("authorIdMissing"));
    addProgress(100.0);
    return;
  }

  const artworkSort = coerceStr(vars.artwork_sort) || "trending";
  const skipArtworkPages = skipPagesOf(vars);
  const maxAuthorArtworkPages = toInt(vars.max_author_artwork_pages, DEFAULT_AUTHOR_ARTWORK_PAGES);
  const animated = coerceStr(vars.author_artwork_type) === "animated";
  const authorTypes = animated ? ["ANIMATED_ARTWORK"] : ["DEFAULT", "ALBUM"];
  const authorTypeLabel = animated ? t("authorTypeAnimated") : t("authorTypeImage");

  log(t("authorFlowStart", {
    authorId,
    type: authorTypeLabel,
    sort: artworkSort,
    maxPages: maxAuthorArtworkPages,
    startPage: skipArtworkPages + 1,
  }));
  const downloadCount = await processAuthorArtworks(
    authorId,
    authorTypes,
    authorTypeLabel,
    maxAuthorArtworkPages,
    100.0,
    artworkSort,
    skipArtworkPages,
  );
  log(t("authorFlowDone", { authorId, count: downloadCount }));
  if (downloadCount === 0) addProgress(100.0);
}
