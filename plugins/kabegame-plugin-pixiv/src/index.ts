// @ts-nocheck
// 入口：按 source 分派到 modes/ 下的各模式。各模式只负责产出作品 id，下载统一走 illust.ts。
import { setPixivHeaders } from "./common";
import { t } from "./i18n";
import { runBookmark } from "./modes/bookmark";
import { runKeyword } from "./modes/keyword";
import { runRanking } from "./modes/ranking";
import { runThirdParty } from "./modes/third-party";
import { runUser } from "./modes/user";

const RUNNERS = {
  ranking: runRanking,
  bookmark: runBookmark,
  user: runUser,
  keyword: runKeyword,
  third_party: runThirdParty,
};

export async function crawl(_common, custom) {
  const vars = custom || {};
  setPixivHeaders();
  const run = RUNNERS[vars.source];
  if (!run) throw new Error(t("unknownSource", { source: vars.source }));
  await run(vars);
}
