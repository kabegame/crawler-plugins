// 注册所有已移植的类型，并提供 png → hydrus 当前版本（v690）的序列化元组。
import { defaultContext, loadDownloaderObjects } from "./core.js";
import "./strings.js";
import "./url.js";
import "./parsing.js";
import "./network.js";
import { loadStringFromHydrusPng } from "./png.js";

export { HydrusSerialisationError, HydrusUnsupportedError, infoOf, load, loadDownloaderObjects, T, typeName } from "./core.js";

/**
 * 读取 hydrus downloader png，升级到当前格式，返回其中的对象与跳过的对象说明。
 * @param {Uint8Array} pngBytes
 * @param {{ inflate: import("./png.js").Inflate, ctx?: import("./core.js").LoadContext }} options
 */
export async function loadHydrusPng(pngBytes, { inflate, ctx = defaultContext() }) {
  const json = await loadStringFromHydrusPng(pngBytes, { inflate });
  return loadDownloaderObjects(JSON.parse(json), ctx);
}
