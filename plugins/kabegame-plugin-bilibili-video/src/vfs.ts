// 分块下载与任务 VFS 管理。
//
// 宿主 fetch 是全缓冲的（prelude.js 的 Response 无 streaming body），整段视频
// 直接 arrayBuffer() 会把上百 MB 压进 V8 heap，所以这里用 Range 逐块拉、逐块落盘。
import { sleep } from "@kabegame/plugin-sdk";

import { CHUNK_SIZE } from "./consts";
import { t } from "./i18n";
import { coerceStr, errorMessage } from "./util";

const { fs, warn } = Kabegame;

/**
 * 宿主的 V8 prelude 在 Response 上额外提供 bytes()（`@kabegame/types` 尚未声明），
 * 这里补一个本地类型，只在 fetch 返回边界断言，运行期行为不变。
 */
type HostResponse = Response & {
  bytes(): Promise<Uint8Array>;
};

async function rangeFetch(url: string, start: number, end: number): Promise<HostResponse> {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  return response as HostResponse;
}

// 仅在 playurl 没给 size 字段时才需要：拿首字节的 Content-Range 反推总长。
// 403 在这里通常不是"不支持 Range"而是该 CDN 节点的防盗链拒绝，换 backupUrl 往往就好。
async function probeTotalSize(url: string): Promise<number> {
  const response = await rangeFetch(url, 0, 0);
  if (response.status !== 206) {
    throw new Error(t("probeSizeFailed", { status: response.status }));
  }
  const contentRange = coerceStr(response.headers.get("content-range"));
  const total = Number(contentRange.split("/")[1]);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(t("contentRangeUnparsable", { value: contentRange || t("emptyValue") }));
  }
  return total;
}

/**
 * 逐块 Range 拉取并追加写入 VFS，urls 里的地址依次兜底。
 * onChunk(received, total) 用于上报进度。
 */
export async function downloadStreamToVfs(
  urls: string[],
  targetPath: string,
  sizeHint: number,
  label: string,
  onChunk?: (received: number, total: number) => void,
): Promise<number> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const total = sizeHint > 0 ? sizeHint : await probeTotalSize(url);
      const file = await fs.open(targetPath, { write: true, create: true, truncate: true });
      try {
        let offset = 0;
        while (offset < total) {
          const end = Math.min(offset + CHUNK_SIZE, total) - 1;
          const response = await rangeFetch(url, offset, end);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = await response.bytes();
          if (bytes.length === 0) throw new Error(t("emptyChunk", { offset }));
          let written = 0;
          while (written < bytes.length) {
            written += await file.write(bytes.subarray(written));
          }
          offset += bytes.length;
          onChunk?.(bytes.length, total);
        }
      } finally {
        file.close();
      }
      return total;
    } catch (error) {
      lastError = error;
      warn(t("chunkDownloadRetry", { label, error: errorMessage(error) }));
      await sleep(500);
    }
  }
  throw new Error(t("allUrlsFailed", { label, error: errorMessage(lastError) }));
}

export async function removeQuietly(path: string): Promise<void> {
  try {
    await fs.remove(path);
  } catch {
    // 清理是 best-effort，失败无需打断流程。
  }
}

/**
 * `downloadImage` 只等到下载队列有槽位就返回，**不等文件被读走**，所以合流产物不能在
 * 本次任务里删（删了下载器就读不到了）。VFS tmp 是插件级持久目录、任务结束也不自动清理，
 * 因此改成下次任务开头把上次的残留扫掉。
 */
export async function cleanupStaleTmp(root: string): Promise<void> {
  const tmpDir = `${root}/tmp`;
  try {
    for await (const entry of fs.readDir(tmpDir)) {
      if (entry?.isFile) await removeQuietly(`${tmpDir}/${entry.name}`);
    }
  } catch {
    // 首次运行时 tmp 还不存在。
  }
}
