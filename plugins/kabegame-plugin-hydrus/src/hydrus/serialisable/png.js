// hydrus 序列化 png 的解码：ClientSerialisable.LoadFromNumPyImage / LoadStringFromPNG。
//
// 布局：灰度图，每像素一个字节。前 2 字节是大端 top_height（顶部说明图的行数），
// 从第 top_height 行起是 4 字节大端 payload 长度，后跟 zlib 压缩的 UTF-8 JSON（很老的 png 不压缩）。

/**
 * zlib（RFC1950）解压。插件运行时（V8）没有 DecompressionStream，由调用方注入（fflate 的 unzlibSync）。
 * @typedef {(bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>} Inflate
 */

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * 解出 8bit PNG 的第一个通道。hydrus 对多通道图也是取第 0 通道
 * （被转成 RGB 的 png 也能读）。
 * @param {Uint8Array} data
 * @param {Inflate} inflate
 */
export async function decodePngFirstChannel(data, inflate) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => data[i] === b)) throw new Error("不是 PNG 文件");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos + 8 <= data.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...data.subarray(pos + 4, pos + 8));
    const body = data.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const depth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      channels = CHANNELS[colorType];
      if (depth !== 8 || !channels || interlace !== 0) {
        throw new Error(`不支持的 PNG 格式：bit depth ${depth}、color type ${colorType}、interlace ${interlace}（图片可能被转换或缩放过）`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  if (!width) throw new Error("PNG 缺少 IHDR");

  const compressed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of idat) {
    compressed.set(c, off);
    off += c.length;
  }
  const raw = await inflate(compressed);

  const bpp = channels;
  const stride = width * bpp;
  const out = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`未知的 PNG filter ${filter}`);
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) out[y * width + x] = line[x * bpp];
    prev = line;
  }
  return { width, height, pixels: out };
}

/**
 * 读出 hydrus png 里的序列化 JSON 字符串。
 * @param {Uint8Array} data  png 文件字节
 * @param {{ inflate: Inflate }} options
 */
export async function loadStringFromHydrusPng(data, { inflate }) {
  const { width, pixels } = await decodePngFirstChannel(data, inflate);
  const view = new DataView(pixels.buffer);
  const topHeight = view.getUint16(0);
  const start = width * topHeight;
  if (start + 4 > pixels.length) throw new Error("不像是 hydrus 序列化 png：头部高度越界");
  const length = view.getUint32(start);
  const payload = pixels.subarray(start + 4, start + 4 + length);
  if (payload.length !== length) throw new Error("不像是 hydrus 序列化 png：payload 长度越界");
  let bytes;
  try {
    bytes = await inflate(payload);
  } catch {
    bytes = payload; // 早期 payload 未压缩
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
