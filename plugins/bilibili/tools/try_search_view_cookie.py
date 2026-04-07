#!/usr/bin/env python3
"""
本地探测：带 Cookie 走与 crawl.rhai 相同的链路——
nav → WBI → /x/web-interface/wbi/search/type → 取专栏 id → /x/article/view。

环境变量 BILI_COOKIE 填浏览器 Cookie（或 --cookie-file）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from functools import reduce
from urllib.parse import quote, urlencode

import requests

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
    """与 crawl.rhai collect_article_ids 一致：分块式或扁平 result。"""
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keyword", default="美图", help="搜索关键词")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--page-size", type=int, default=10)
    ap.add_argument("--cookie-file", type=argparse.FileType("r", encoding="utf-8"), help="Cookie 一行文本")
    ap.add_argument(
        "--search-only",
        action="store_true",
        help="只请求搜索，不对第一篇专栏调用 view",
    )
    args = ap.parse_args()

    if args.cookie_file:
        cookie = args.cookie_file.read().strip()
    else:
        cookie = os.environ.get("BILI_COOKIE", "").strip()
    if not cookie:
        print("请设置 BILI_COOKIE 或使用 --cookie-file", file=sys.stderr)
        sys.exit(2)

    s = requests.Session()
    s.headers.update({"user-agent": UA, "cookie": cookie})

    r_nav = s.get(
        "https://api.bilibili.com/x/web-interface/nav",
        headers={"referer": "https://www.bilibili.com/"},
        timeout=25,
    )
    j_nav = r_nav.json()
    if j_nav.get("code") != 0:
        print("nav failed:", j_nav, file=sys.stderr)
        sys.exit(1)
    wbi = j_nav["data"]["wbi_img"]
    img_key = wbi["img_url"].rsplit("/", 1)[1].split(".")[0]
    sub_key = wbi["sub_url"].rsplit("/", 1)[1].split(".")[0]

    sp = enc_wbi(
        {
            "keyword": args.keyword,
            "page": str(args.page),
            "page_size": str(args.page_size),
            "search_type": "article",
        },
        img_key,
        sub_key,
    )
    kw_q = quote(args.keyword)
    r_search = s.get(
        "https://api.bilibili.com/x/web-interface/wbi/search/type",
        params=sp,
        headers={
            "referer": f"https://search.bilibili.com/article?keyword={kw_q}&from_source=article",
            "origin": "https://search.bilibili.com",
        },
        timeout=25,
    )
    js = r_search.json()
    print("search HTTP", r_search.status_code, "code", js.get("code"), js.get("message"))
    ids = collect_article_ids(js.get("data") or {})
    print("article ids:", ids)
    if not ids:
        sys.exit(3)

    if args.search_only:
        print("ok (--search-only)")
        return

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
    d = jv.get("data") or {}
    c = d.get("content") or ""
    print("view HTTP", r_view.status_code, "code", jv.get("code"), jv.get("message"))
    print("first cv", cv, "title", (d.get("title") or "")[:80])
    print("content length", len(c))


if __name__ == "__main__":
    main()
