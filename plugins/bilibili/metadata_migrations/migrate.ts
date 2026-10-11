// @ts-nocheck
// bilibili 历史 metadata 不改结构，只按当前规则补标签并重建搜索词。
// Rspack 将本文件及 tiny-pinyin 打进自包含的 dist/migrate.js，满足裸 V8 migration 环境。
import { labelsFromMetadata, searchTextsFromMetadata } from "../src/metadata-derived";

export function provideLabels(input) {
  return labelsFromMetadata(JSON.parse(input));
}

export function provideSearchTextList(input) {
  return searchTextsFromMetadata(JSON.parse(input));
}
