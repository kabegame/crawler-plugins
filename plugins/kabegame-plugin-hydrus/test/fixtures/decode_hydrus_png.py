"""解析 hydrus 序列化 png。

用法: python decode_hydrus_png.py <png> <out_dir> [hydrus_src]
输出:
  raw.json        png 里的原始序列化 JSON（未升级）
  annotated.json  把 [type, version, info] 展开成 {"@type": 名字, "@v": 版本, ...} 的可读树
  upgraded.json   （给了 hydrus_src 时）用 hydrus 反序列化并升级到当前版本后再导出的 JSON
"""
import json
import re
import struct
import sys
import zlib
from pathlib import Path


def read_gray_png(path: Path) -> tuple[int, int, bytes]:
    """最小 PNG 解码：只支持 8bit 灰度、非隔行（hydrus 的 cv2 输出就是这种）。"""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos, idat, width, height = 8, b"", 0, 0
    while pos < len(data):
        (length,) = struct.unpack("!I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack("!IIBBBBB", body)
            assert depth == 8 and color == 0 and interlace == 0, f"unsupported png: depth={depth} color={color}"
        elif ctype == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    # 逐行去 PNG filter
    out = bytearray()
    prev = bytearray(width)
    stride = width + 1
    for y in range(height):
        ftype = raw[y * stride]
        line = bytearray(raw[y * stride + 1 : (y + 1) * stride])
        for x in range(width):
            a = line[x - 1] if x else 0
            b = prev[x]
            c = prev[x - 1] if x else 0
            if ftype == 1:
                line[x] = (line[x] + a) & 0xFF
            elif ftype == 2:
                line[x] = (line[x] + b) & 0xFF
            elif ftype == 3:
                line[x] = (line[x] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        out += line
        prev = line
    return width, height, bytes(out)


def payload_from_png(path: Path) -> str:
    width, _, pixels = read_gray_png(path)
    (top_height,) = struct.unpack("!H", pixels[:2])
    body = pixels[width * top_height :]
    (length,) = struct.unpack("!I", body[:4])
    payload = body[4 : 4 + length]
    try:
        return zlib.decompress(payload).decode("utf-8")
    except zlib.error:
        return payload.decode("utf-8")  # 很老的 png 不压缩


def type_names(hydrus_src: Path | None) -> dict[int, str]:
    if hydrus_src is None:
        return {}
    text = (hydrus_src / "hydrus/core/HydrusSerialisable.py").read_text()
    return {int(n): name for name, n in re.findall(r"^SERIALISABLE_TYPE_(\w+) = (\d+)", text, re.M)}


def annotate(node, names):
    """hydrus 的序列化元组是 [int type, int version, info]，info 也可能嵌套；这里启发式识别。"""
    if (
        isinstance(node, list)
        and len(node) == 3
        and isinstance(node[0], int)
        and isinstance(node[1], int)
        and node[0] in names
    ):
        return {"@type": names[node[0]], "@v": node[1], "info": annotate(node[2], names)}
    if (
        isinstance(node, list)
        and len(node) == 4
        and isinstance(node[0], int)
        and isinstance(node[1], str)
        and isinstance(node[2], int)
        and node[0] in names
    ):
        # SerialisableBaseNamed: [type, name, version, info]
        return {"@type": names[node[0]], "@name": node[1], "@v": node[2], "info": annotate(node[3], names)}
    if isinstance(node, list):
        return [annotate(x, names) for x in node]
    if isinstance(node, dict):
        return {k: annotate(v, names) for k, v in node.items()}
    return node


def upgrade_with_hydrus(raw: str, hydrus_src: Path) -> str:
    sys.path.insert(0, str(hydrus_src))
    from hydrus.core import HydrusSerialisable

    # 注册 downloader 相关的全部 serialisable 类
    from hydrus.client.networking import ClientNetworkingDomain, ClientNetworkingGUG, ClientNetworkingURLClass  # noqa: F401
    from hydrus.client.parsing import ClientParsing  # noqa: F401

    obj = HydrusSerialisable.CreateFromString(raw)
    return obj.DumpToString()


def main():
    png, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    hydrus_src = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    out_dir.mkdir(parents=True, exist_ok=True)
    names = type_names(hydrus_src)

    raw = payload_from_png(png)
    (out_dir / "raw.json").write_text(raw)
    (out_dir / "annotated.json").write_text(json.dumps(annotate(json.loads(raw), names), indent=2, ensure_ascii=False))
    if hydrus_src is not None:
        upgraded = upgrade_with_hydrus(raw, hydrus_src)
        (out_dir / "upgraded.json").write_text(upgraded)
        (out_dir / "upgraded.annotated.json").write_text(
            json.dumps(annotate(json.loads(upgraded), names), indent=2, ensure_ascii=False)
        )
    print("ok", out_dir)


if __name__ == "__main__":
    main()
