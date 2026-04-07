#!/usr/bin/env python3
"""
探测：搜索 → view → 从 content HTML 抽图链并真实下载到 tools/_probe_downloads/。

  BILI_COOKIE='...' python3 try_download_images_probe.py
  python3 try_download_images_probe.py --no-cookie
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import time
from functools import reduce
from pathlib import Path
from urllib.parse import quote, urlencode

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR / "_probe_downloads"

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)

def get_mixin_key(orig: str) -> str:
    return reduce(lambda s, i: s + orig[i], MIXIN_KEY_ENC_TAB, "")[:32]


def enc_wbi(params: dict, img_key: str, sub_key: str) -> dict:
    mixin_key = get_mixin_key(img_key + sub_key)
    params = dict(params)
    params["wts"] = int(time.time())
    params = dict(sorted(params.items()))
    params = {
        k: "".join(c for c in str(v) if c not in "!'()*")
        for k, v in params.items()
    }
    query = urlencode(params)
    w_rid = hashlib.md5((query + mixin_key).encode()).hexdigest()
    params["w_rid"] = w_rid
    return params


def collect_article_ids(data: dict) -> list[int]:
    ids: list[int] = []
    res = data.get("result")
    if not res:
        return ids
    probe = res[0]
    if probe.get("result_type") is not None:
        for block in res:
            if block.get("result_type") != "article":
                continue
            for item in block.get("data") or []:
                if "id" in item:
                    ids.append(item["id"])
        return ids
    for item in res:
        if item.get("type") != "article":
            continue
        if "id" in item:
            ids.append(item["id"])
    return ids


def collect_image_urls_from_content(html: str) -> list[str]:
    """与 crawl.rhai 中 bfs/article + new_dyn 前缀扫描一致。"""
    pat = re.compile(r"//i[0-2]\.hdslb\.com/bfs/(?:article|new_dyn)/[^\"'\\s<>]+")
    seen: set[str] = set()
    out: list[str] = []
    for m in pat.finditer(html):
        u = "https:" + m.group(0)
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keyword", default="美图")
    ap.add_argument("--max-images", type=int, default=3, help="最多下载几张")
    ap.add_argument("--no-cookie", action="store_true", help="不传 Cookie（对比风控）")
    args = ap.parse_args()

    cookie = "" if args.no_cookie else os.environ.get("BILI_COOKIE", "").strip()
    if not args.no_cookie and not cookie:
        print("请设置环境变量 BILI_COOKIE，或使用 --no-cookie", file=sys.stderr)
        sys.exit(2)

    label = "no-cookie" if args.no_cookie else "with-cookie"
    out_dir = OUT_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)

    s = requests.Session()
    h = {"user-agent": UA}
    if cookie:
        h["cookie"] = cookie
    s.headers.update(h)

    if not cookie:
        # 与 crawl.rhai build_cookie_line 类似：先访首页拿 visitor Cookie，再 nav 才可能拿到 WBI
        s.get("https://www.bilibili.com/", timeout=20)

    # nav
    r_nav = s.get(
        "https://api.bilibili.com/x/web-interface/nav",
        headers={"referer": "https://www.bilibili.com/"},
        timeout=25,
    )
    j_nav = r_nav.json()
    print("[nav]", r_nav.status_code, "code", j_nav.get("code"), j_nav.get("message"))
    if j_nav.get("code") != 0:
        if args.no_cookie:
            print(
                "匿名 nav 未返回 WBI（常见为 -101 需登录）。"
                "请设置 BILI_COOKIE 或在浏览器同网络下重试。",
                file=sys.stderr,
            )
        else:
            print("nav 失败，终止", file=sys.stderr)
        sys.exit(1)
    wbi = j_nav["data"]["wbi_img"]
    img_key = wbi["img_url"].rsplit("/", 1)[1].split(".")[0]
    sub_key = wbi["sub_url"].rsplit("/", 1)[1].split(".")[0]

    kw = args.keyword
    sp = enc_wbi(
        {
            "keyword": kw,
            "page": "1",
            "page_size": "10",
            "search_type": "article",
        },
        img_key,
        sub_key,
    )
    r_search = s.get(
        "https://api.bilibili.com/x/web-interface/wbi/search/type",
        params=sp,
        headers={
            "referer": f"https://search.bilibili.com/article?keyword={quote(kw)}&from_source=article",
            "origin": "https://search.bilibili.com",
        },
        timeout=25,
    )
    js = r_search.json()
    print("[search]", r_search.status_code, "code", js.get("code"), js.get("message"))
    ids = collect_article_ids(js.get("data") or {})
    print("[search] article ids count:", len(ids), "first:", ids[:3] if ids else None)
    if not ids or js.get("code") != 0:
        print("搜索无可用 id 或 code!=0，跳过下载", file=sys.stderr)
        sys.exit(3)

    cv = ids[0]
    vp = enc_wbi(
        {"id": str(cv), "gaia_source": "main_web", "web_location": "333.976"},
        img_key,
        sub_key,
    )
    r_view = s.get(
        "https://api.bilibili.com/x/article/view",
        params=vp,
        headers={
            "referer": f"https://www.bilibili.com/read/cv{cv}/?opus_fallback=1",
            "origin": "https://www.bilibili.com",
        },
        timeout=25,
    )
    jv = r_view.json()
    print("[view]", r_view.status_code, "code", jv.get("code"), jv.get("message"))
    if jv.get("code") != 0:
        print("view 失败，终止", file=sys.stderr)
        sys.exit(4)

    d = jv.get("data") or {}
    title = (d.get("title") or "untitled")[:40]
    content = d.get("content") or ""
    urls = collect_image_urls_from_content(content)
    print("[view] cv", cv, "title", title)
    print("[view] content len", len(content), "image urls", len(urls))

    take = urls[: args.max_images]
    if not take:
        print("未解析到图片 URL", file=sys.stderr)
        sys.exit(5)

    img_headers = {
        "user-agent": UA,
        "referer": f"https://www.bilibili.com/read/cv{cv}/",
    }
    if cookie:
        img_headers["cookie"] = cookie

    for i, u in enumerate(take):
        name = f"{i:02d}_{u.rsplit('/', 1)[-1].split('?')[0][:80]}"
        r = requests.get(u, headers=img_headers, timeout=60)
        print(f"  GET {u[:72]}... -> {r.status_code} bytes {len(r.content)}")
        if r.status_code == 200 and r.content:
            path = out_dir / name
            path.write_bytes(r.content)
            print(f"  saved {path}")
        else:
            print(f"  skip (status {r.status_code})")

    print("done ->", out_dir)


if __name__ == "__main__":
    main()
