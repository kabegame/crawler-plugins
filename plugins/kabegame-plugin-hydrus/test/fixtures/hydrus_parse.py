"""用 hydrus 本体的 PageParser 解析一张页面，输出与 JS 引擎 parsePage 相同的扁平结构，作为对照答案。
用法（在 hydrus 源码目录，用它的 venv）：
  TZ=UTC venv/bin/python -I hydrus_parse.py "$PWD" <png> <解析器名> <页面 url 或 parsing_context JSON> <页面文件> > <输出.json>
日期转换按本机时区解释时结果随时区变化，金标统一在 TZ=UTC 下生成。"""
import json, sys, types
sys.path.insert(0, sys.argv[1])
import cv2
from hydrus.core import HydrusCompression, HydrusSerialisable, HydrusTags
from hydrus.client import ClientSerialisable, ClientGlobals as CG
from hydrus.client.networking import ClientNetworkingDomain, ClientNetworkingGUG, ClientNetworkingURLClass  # noqa: F401
from hydrus.client.parsing import ClientParsing, ClientParsingResults as R

# PageParser 只用到 controller 的解析缓存与少量选项
class Cache:
    def GetSoup(self, t): return ClientParsing.GetSoup(t)
    def GetJSON(self, t): return json.loads(t)
class Opts:
    def GetBoolean(self, k): return False
CG.client_controller = types.SimpleNamespace(parsing_cache=Cache(), new_options=Opts())

_, _, png, parser_name, context_arg, html_path = sys.argv
s = HydrusCompression.DecompressBytesToString(ClientSerialisable.LoadFromNumPyImage(cv2.imread(png, cv2.IMREAD_UNCHANGED)))
objs = HydrusSerialisable.CreateFromString(s)
objs = list(objs) if isinstance(objs, HydrusSerialisable.SerialisableList) else [objs]
parser = next(o for o in objs if isinstance(o, ClientParsing.PageParser) and o.GetName() == parser_name)
# hydrus 运行时按内存里的顺序跑内容解析器，导出时才按名字排序；导入后保存、重启再读回的就是排序后的顺序。
# 插件对齐这个稳定状态，所以先往返一次序列化。
parser = HydrusSerialisable.CreateFromSerialisableTuple(parser.GetSerialisableTuple())
context = json.loads(context_arg) if context_arg.startswith("{") else {"url": context_arg}
posts = parser.Parse(context, open(html_path, encoding="utf-8").read())

out = []
for p in posts:
    post = {"urls": [], "tags": [], "titles": [], "notes": [], "hashes": [], "timestamps": [], "headers": [], "others": []}
    for c in p.parsed_contents:
        d, t = c.parsed_content_description, c.parsed_text
        if isinstance(d, R.ParsableContentDescriptionURL):
            post["urls"].append({"url": t, "urlType": d.url_type, "priority": d.priority})
        elif isinstance(d, R.ParsableContentDescriptionTag):
            post["tags"].append(t if d.namespace is None else HydrusTags.CombineTag(d.namespace, t))
        elif isinstance(d, R.ParsableContentDescriptionTitle):
            post["titles"].append({"title": t, "priority": d.priority})
        elif isinstance(d, R.ParsableContentDescriptionNote):
            post["notes"].append({"name": d.note_name, "text": t})
        elif isinstance(d, R.ParsableContentDescriptionHash):
            post["hashes"].append({"type": d.hash_type, "encoding": d.hash_encoding, "value": t})
        elif isinstance(d, R.ParsableContentDescriptionTimestamp):
            post["timestamps"].append({"type": d.timestamp_type, "value": int(t)})
        elif isinstance(d, R.ParsableContentDescriptionHTTPHeaders):
            post["headers"].append({"name": d.header_name, "value": t})
        else:
            raise SystemExit(f"未处理的内容类型 {type(d).__name__}")
    out.append(post)
print(json.dumps(out, ensure_ascii=False, indent=1))
