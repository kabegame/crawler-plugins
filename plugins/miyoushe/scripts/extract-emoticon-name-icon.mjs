/**
 * 从 emoticon_set JSON 中遍历：凡含非空 list 的节点，对其子项递归，
 * 收集叶子节点（具 name + icon）的 { name, icon }，写入 json/emoticon-name-icon-list.json
 *
 * 用法:
 *   bun src-crawler-plugins/plugins/miyoushe/scripts/extract-emoticon-name-icon.mjs [输入.json]
 * 默认输入: ../json/emoticon_set-gids-8.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_DIR = join(__dirname, "..", "json");

const DEFAULT_IN = join(JSON_DIR, "emoticon_set-gids-8.json");
const DEFAULT_OUT = join(JSON_DIR, "emoticon-name-icon-list.json");

/**
 * @param {unknown} node
 * @returns {{ name: string, icon: string }[]}
 */
function collectNameIcon(node) {
  const out = [];
  if (node == null || typeof node !== "object") {
    return out;
  }
  const list = node.list;
  if (!Array.isArray(list) || list.length === 0) {
    return out;
  }
  for (const item of list) {
    if (item == null || typeof item !== "object") {
      continue;
    }
    const sub = item.list;
    if (Array.isArray(sub) && sub.length > 0) {
      out.push(...collectNameIcon(item));
    } else if (typeof item.name === "string" && typeof item.icon === "string") {
      out.push({ name: item.name, icon: item.icon });
    }
  }
  return out;
}

function main() {
  const inputPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : DEFAULT_IN;
  mkdirSync(JSON_DIR, { recursive: true });

  const raw = readFileSync(inputPath, "utf8");
  const root = JSON.parse(raw);
  const topList = root?.data?.list;
  if (!Array.isArray(topList)) {
    throw new Error("缺少 data.list");
  }

  const items = [];
  for (const group of topList) {
    items.push(...collectNameIcon(group));
  }

  const payload = {
    source: inputPath,
    count: items.length,
    items,
  };

  writeFileSync(DEFAULT_OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`已写入: ${DEFAULT_OUT}（共 ${items.length} 条）`);
}

main();
