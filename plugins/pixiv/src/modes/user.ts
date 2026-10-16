// @ts-nocheck
import { addArtworkProgress, coerceStr, ensurePixivCookie, fetchJson, rethrowIfLoginFailed } from "../common";
import { downloadIllust } from "../illust";

const { setHeader, warn } = Kabegame;

export async function runUser(vars) {
  const artistId = coerceStr(vars.artist_id);
  const userId = coerceStr(vars.user_id);
  if (!artistId) throw new Error("画师模式请填写画师 UID");
  if (!userId) throw new Error("画师模式请填写登录用户 UID");
  setHeader("x-user-id", userId);
  ensurePixivCookie("画师作品抓取");

  let json;
  try {
    json = await fetchJson(
      `https://www.pixiv.net/ajax/user/${artistId}/profile/all?lang=zh`,
    );
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
    warn(
      `画师作品页范围为空：起始页 ${firstPage}，结束页 ${lastPage}，总页数 ${totalPages}`,
    );
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

