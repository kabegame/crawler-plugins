// @ts-nocheck
// PixAI V8 crawler. This mirrors the previous Rhai implementation but uses the
// Kabegame V8 host bridge and standard fetch.
//
// 模块分工：
//   consts   端点、GraphQL 查询文本、请求头与配置缺省值
//   util     取值归一、日志、起始页/结束页 → 分页窗口
//   api      GraphQL 访问层（请求头、URL 拼装、作品详情与评论）
//   tacks    标签 codeName → tackId 解析与 plugin_data 缓存
//   download 一页作品 edges → 下载入库
//   artworks 作品流翻页（全站/标签/模型/作者共用）
//   models   按模型爬（模型列表分页 → 每模型作品流）
//   ranking  排行榜（作品榜 / 模型榜）
//   streams  全站、标签、作者三种流的配置解析与调度
import { setRequestHeaders } from "./api";
import { runModel } from "./models";
import { runRanking } from "./ranking";
import { runAuthor, runGlobal, runTag } from "./streams";
import { coerceStr, log } from "./util";

export async function crawl(_common, custom) {
  const vars = custom || {};
  setRequestHeaders();

  const crawlType = coerceStr(vars.crawl_type) || "global";
  if (crawlType === "global") {
    await runGlobal(vars);
  } else if (crawlType === "tag") {
    await runTag(vars);
  } else if (crawlType === "author") {
    await runAuthor(vars);
  } else if (crawlType === "ranking") {
    await runRanking(vars);
  } else {
    await runModel(vars);
  }

  log("[PixAI] 任务结束");
}
