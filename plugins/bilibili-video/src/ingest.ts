// @ts-nocheck
// DASH 流的共享入库链路：挑流 → 分块下载 → 合流 → 入库。
// UGC（video.ts）与番剧 PGC（bangumi.ts）的 playurl 接口不同，但拿到 dash 之后
// 的处理完全同构，所以从 processPart 抽出来共用。
import { qualityLabels, pickAudio, pickVideo, streamUrls } from "./formats";
import { coerceStr } from "./util";
import { downloadStreamToVfs, removeQuietly } from "./vfs";

const { addProgress, downloadImage, ffmpeg, fs, warn } = Kabegame;

/**
 * 把一组 DASH 流下载合流并提交入库。
 *   dash         playurl 返回的 dash 对象
 *   formatSource 含 support_formats 的对象（UGC 是 play.data，番剧是 video_info）
 *   stem         临时文件名主干（须全局唯一，如 `${bvid}_${cid}` / `ep${id}`）
 *   buildMeta    (video, audio, qualityLabel) => metadata 对象
 *   budget       本条目可用的进度额度
 */
export async function ingestDash({ dash, formatSource, displayName, stem, pageUrl, buildMeta, vars, budget }) {
  const video = pickVideo(dash, Number(vars.max_quality ?? 0), vars.prefer_avc !== false);
  const audio = pickAudio(dash);
  if (!video) throw new Error("playurl 未返回可用视频流");
  if (!audio) throw new Error("playurl 未返回可用音频流");

  const qualityLabel = qualityLabels(formatSource)[Number(video.id ?? 0)] || `quality ${video.id}`;
  console.log(
    `[bilibili-video] ▶ ${displayName}：${qualityLabel} / ${video.width}x${video.height} / ${coerceStr(video.codecs)}`,
  );

  const root = fs.getRoot();
  const videoPath = `${root}/tmp/${stem}.video.m4s`;
  const audioPath = `${root}/tmp/${stem}.audio.m4s`;
  const outputPath = `${root}/tmp/${stem}.mp4`;

  try {
    // 进度切分：视频 60% / 音频 20% / 合流 10% / 入库 10%。
    let reported = 0;
    const reportChunk = (share) => (received, total) => {
      const step = (received / total) * budget * share;
      reported += step;
      addProgress(step);
    };

    await downloadStreamToVfs(
      streamUrls(video), videoPath, Number(video.size ?? 0), `${displayName} 视频流`, reportChunk(0.6),
    );
    await downloadStreamToVfs(
      streamUrls(audio), audioPath, Number(audio.size ?? 0), `${displayName} 音频流`, reportChunk(0.2),
    );

    await ffmpeg.muxStreams([videoPath, audioPath], outputPath);
    addProgress(budget * 0.1);
    reported += budget * 0.1;

    const probe = await ffmpeg.probe(outputPath);
    if (probe && !probe.browserSafe) {
      warn(`${displayName} 合流结果不是浏览器可直接播放的编码（${probe.mimeType}），画廊可能只显示缩略图。`);
    }

    await downloadImage(outputPath, {
      name: displayName,
      metadata: buildMeta(video, audio, qualityLabel),
      url: pageUrl,
    });

    // 补齐本条目剩余额度（分块进度是估算，未必刚好加满）。
    addProgress(Math.max(0, budget - reported));
    console.log(`[bilibili-video] ◀ ${displayName} 已提交下载队列`);
  } finally {
    // 合流产物 outputPath 交给下次任务开头的 cleanupStaleTmp 清理，见 vfs.ts。
    await removeQuietly(videoPath);
    await removeQuietly(audioPath);
  }
}
