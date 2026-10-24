"""用 hydrus 本体依次导入一组 downloader png，输出下载器库的最终状态，作为合并逻辑的对照答案。
导入流程照搬 ClientGUISerialisableImport._ImportPayloads（不勾「从列表里挑选」、最后一步点「是」）。
用法（在 hydrus 源码目录，用它的 venv）：
  venv/bin/python -I hydrus_import.py "$PWD" <png>... > <输出.json>
key 是随机的，输出里一律换成名字：关联写成 [URL class 名, 解析器名]，NGUG 的子 GUG 写名字。"""
import sys, types, json
sys.path.insert(0, sys.argv[1])
import cv2
from hydrus.core import HydrusCompression, HydrusSerialisable
from hydrus.client import ClientConstants as CC, ClientSerialisable, ClientGlobals as CG
from hydrus.client.networking import ClientNetworkingBandwidth, ClientNetworkingContexts, ClientNetworkingDomain, ClientNetworkingGUG, ClientNetworkingURLClass
from hydrus.client.parsing import ClientParsing


class Opts:
    def GetBoolean(self, k): return False


CG.client_controller = types.SimpleNamespace(new_options=Opts(), pub=lambda *a, **k: None, CallToThread=lambda *a, **k: None)
domain_manager = ClientNetworkingDomain.NetworkDomainManager()
bandwidth_manager = ClientNetworkingBandwidth.NetworkBandwidthManager()


def load_png(path):
    s = HydrusCompression.DecompressBytesToString(ClientSerialisable.LoadFromNumPyImage(cv2.imread(path, cv2.IMREAD_UNCHANGED)))
    objs = HydrusSerialisable.CreateFromString(s)
    return list(objs) if isinstance(objs, HydrusSerialisable.SerialisableList) else [objs]


def import_payload(objs):
    gugs = [o for o in objs if isinstance(o, (ClientNetworkingGUG.GalleryURLGenerator, ClientNetworkingGUG.NestedGalleryURLGenerator))]
    url_classes = [o for o in objs if isinstance(o, ClientNetworkingURLClass.URLClass)]
    parsers = [o for o in objs if isinstance(o, ClientParsing.PageParser)]
    domain_metadatas = [o for o in objs if isinstance(o, ClientNetworkingDomain.DomainMetadataPackage)]

    seen = set(); dupe_url_classes = []; new_url_classes = []; dupes = 0
    for url_class in url_classes:
        if url_class.GetName() in seen: continue
        if domain_manager.AlreadyHaveExactlyThisURLClass(url_class):
            dupe_url_classes.append(url_class); dupes += 1
        else:
            new_url_classes.append(url_class); seen.add(url_class.GetName())

    seen = set(); new_gugs = []
    for gug in gugs:
        if gug.GetName() in seen: continue
        if domain_manager.AlreadyHaveExactlyThisGUG(gug): dupes += 1
        else:
            new_gugs.append(gug); seen.add(gug.GetName())

    seen = set(); new_parsers = []
    for parser in parsers:
        if parser.GetName() in seen: continue
        if domain_manager.AlreadyHaveExactlyThisParser(parser): dupes += 1
        else:
            new_parsers.append(parser); seen.add(parser.GetName())

    seen = set(); new_domain_metadatas = []
    for dm in domain_metadatas:
        domain = dm.GetDomain(); headers_list = None; bandwidth_rules = None
        if domain in seen: continue
        nc = ClientNetworkingContexts.NetworkContext(CC.NETWORK_CONTEXT_DOMAIN, domain)
        if dm.HasHeaders():
            headers_list = dm.GetHeaders()
            if domain_manager.AlreadyHaveExactlyTheseHeaders(nc, headers_list): headers_list = None
        if dm.HasBandwidthRules():
            bandwidth_rules = dm.GetBandwidthRules()
            if bandwidth_manager.AlreadyHaveExactlyTheseBandwidthRules(nc, bandwidth_rules): bandwidth_rules = None
        if headers_list is None and bandwidth_rules is None: dupes += 1
        else:
            new_domain_metadatas.append(ClientNetworkingDomain.DomainMetadataPackage(domain=domain, headers_list=headers_list, bandwidth_rules=bandwidth_rules))
            seen.add(domain)

    if len(new_gugs) + len(new_url_classes) + len(new_parsers) + len(new_domain_metadatas) == 0:
        return dupes

    new_gugs.sort(key=lambda o: o.GetName())
    new_url_classes.sort(key=lambda o: o.GetName())
    new_parsers.sort(key=lambda o: o.GetName())
    new_domain_metadatas.sort(key=lambda o: o.GetDomain())

    if len(new_gugs) > 0:
        for gug in new_gugs: gug.RegenerateGUGKey()
        domain_manager.AddGUGs(new_gugs)
    domain_manager.AutoAddURLClassesAndParsers(new_url_classes, dupe_url_classes, new_parsers)
    bandwidth_manager.AutoAddDomainMetadatas(new_domain_metadatas)
    domain_manager.AutoAddDomainMetadatas(new_domain_metadatas, approved=ClientNetworkingDomain.VALID_APPROVED)
    return dupes


steps = []
for png in sys.argv[2:]:
    steps.append({"png": png.split("/")[-1], "duplicates": import_payload(load_png(png))})

url_classes = list(domain_manager._url_classes)
parsers = list(domain_manager._parsers)
uc_names = {u.GetClassKey(): u.GetName() for u in url_classes}
parser_names = {p.GetParserKey(): p.GetName() for p in parsers}
gugs = []
for gug in domain_manager._gugs:
    if isinstance(gug, ClientNetworkingGUG.NestedGalleryURLGenerator):
        subs = [domain_manager.GetGUG(kn) for kn in gug.GetGUGKeysAndNames()]
        gugs.append([gug.GetName(), [s.GetName() if s is not None else None for s in subs]])
    else:
        gugs.append([gug.GetName(), gug.GetExampleURL()])
headers = {}
for nc, d in domain_manager._network_contexts_to_custom_header_dicts.items():
    if nc.context_type == CC.NETWORK_CONTEXT_DOMAIN:
        headers[nc.context_data] = sorted([k, v[0]] for k, v in d.items())
bandwidth = {}
for nc, rules in bandwidth_manager._network_contexts_to_bandwidth_rules.items():
    if nc.context_type == CC.NETWORK_CONTEXT_DOMAIN and nc.context_data is not None:  # None 是「所有域名」的默认规则
        bandwidth[nc.context_data] = sorted(list(r) for r in rules.GetSerialisableTuple()[2])
print(json.dumps({
    "steps": steps,
    "gugs": gugs,
    "urlClasses": [u.GetName() for u in url_classes],
    "parsers": [[p.GetName(), sorted(p.GetExampleURLs())] for p in parsers],
    "links": sorted([uc_names[k], parser_names[v]] for k, v in domain_manager._url_class_keys_to_parser_keys.items()),
    "headers": dict(sorted(headers.items())),
    "bandwidth": dict(sorted(bandwidth.items())),
}, ensure_ascii=False, indent=1))
