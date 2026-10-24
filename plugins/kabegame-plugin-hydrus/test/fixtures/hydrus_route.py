"""用 hydrus 本体的 NetworkDomainManager 求 URL 的实际请求地址与解析器（GetURLToFetchAndParser），作为路由对照答案。
用法（在 hydrus 源码目录，用它的 venv）：
  venv/bin/python -I hydrus_route.py "$PWD" <png> <url>... > <输出.json>
每行输出 [url, 请求地址, 解析器名]；找不到时请求地址为 null，第三项为错误信息。"""
import sys, types, json
sys.path.insert(0, sys.argv[1])
import cv2
from hydrus.core import HydrusCompression, HydrusSerialisable
from hydrus.client import ClientSerialisable, ClientGlobals as CG
from hydrus.client.networking import ClientNetworkingDomain, ClientNetworkingGUG, ClientNetworkingURLClass
from hydrus.client.parsing import ClientParsing
class Opts:
    def GetBoolean(self, k): return False
CG.client_controller = types.SimpleNamespace(new_options=Opts(), pub=lambda *a, **k: None, CallToThread=lambda *a, **k: None)
s = HydrusCompression.DecompressBytesToString(ClientSerialisable.LoadFromNumPyImage(cv2.imread(sys.argv[2], cv2.IMREAD_UNCHANGED)))
objs = HydrusSerialisable.CreateFromString(s)
objs = list(objs) if isinstance(objs, HydrusSerialisable.SerialisableList) else [objs]
dm = ClientNetworkingDomain.NetworkDomainManager()
dm.SetURLClasses([o for o in objs if isinstance(o, ClientNetworkingURLClass.URLClass)])
dm.SetParsers([o for o in objs if isinstance(o, ClientParsing.PageParser)])
dm.TryToLinkURLClassesAndParsers()
out = []
for u in sys.argv[3:]:
    try:
        f, p = dm.GetURLToFetchAndParser(u)
        out.append([u, f, p.GetName()])
    except Exception as e:
        out.append([u, None, str(e).splitlines()[0]])
print(json.dumps(out, ensure_ascii=False, indent=1))
