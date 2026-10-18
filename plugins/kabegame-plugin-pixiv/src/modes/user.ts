import { addArtworkProgress, coerceStr, ensurePixivCookie, fetchJson, rethrowIfLoginFailed, type PixivVars } from "../common";
import { t } from "../i18n";
import { downloadIllust } from "../illust";

const { setHeader, warn } = Kabegame;

type PixivProfileResponse = {
  body?: { illusts?: Record<string, unknown> | null } | null;
};

export async function runUser(vars: PixivVars): Promise<void> {
  const artistId = coerceStr(vars.artist_id);
  const userId = coerceStr(vars.user_id);
  if (!artistId) throw new Error(t("artistRequired"));
  if (!userId) throw new Error(t("artistUserRequired"));
  setHeader("x-user-id", userId);
  ensurePixivCookie(t("labelArtist"));

  let json: PixivProfileResponse | null = null;
  try {
    json = await fetchJson<PixivProfileResponse>(
      `https://www.pixiv.net/ajax/user/${artistId}/profile/all?lang=zh`,
    );
  } catch (e) {
    rethrowIfLoginFailed(e, t("labelArtist"), true);
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
    warn(t("artistEmpty"));
    return;
  }
  if (firstPage > totalPages || firstPage > lastPage) {
    warn(t("artistPageRangeEmpty", { firstPage, lastPage, totalPages }));
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
