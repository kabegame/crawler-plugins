#!/usr/bin/env python3
"""
本地调试：拉取 B 站专栏评论（/x/v2/reply/wbi/main），签名逻辑与 crawl.rhai 一致。

完整模拟 crawl.rhai（含搜索/view/抽图/评论）请用：
  plugins/bilibili/tools/simulate_crawl_rhai.py --fetch-replies

Cookie（任选其一，勿提交到 git）:
  1) 环境变量 BILI_COOKIE=整段 Cookie 字符串
  2) 与本脚本同目录新建文件 .bili_cookie.local，粘贴浏览器复制的 Cookie（一行）

用法:
  python3 fetch_reply_sample.py 21097348
  python3 fetch_reply_sample.py 21097348 --cookie-file /path/to/cookie.txt
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

NAV_URL = "https://api.bilibili.com/x/web-interface/nav"
REPLY_API = "https://api.bilibili.com/x/v2/reply/wbi/main"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

MIXIN_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


def wbi_filter_value(s: str) -> str:
    out = []
    for c in s:
        if c not in "!'()*":
            out.append(c)
    return "".join(out)


def stem_from_wbi_url(u: str) -> str:
    name = u.rsplit("/", 1)[-1]
    if "." in name:
        return name.split(".", 1)[0]
    return name


def get_mixin_key(orig: str) -> str:
    o = orig
    acc = "".join(o[i] for i in MIXIN_TAB)
    return acc[:32]


def js_encodeURIComponent(s: str) -> str:
    return urllib.parse.quote(s, safe="-_.!~*'()")


def json_escape_offset(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def build_pagination_str(offset_token: str) -> str:
    esc = json_escape_offset(offset_token)
    return '{"offset":"' + esc + '"}'


def sign_reply_url(cv_id: str, offset_token: str, img: str, sub: str, wts: int) -> str:
    pag = build_pagination_str(offset_token)
    oid_s = wbi_filter_value(cv_id)
    wt = wbi_filter_value(str(wts))
    mode_s = wbi_filter_value("3")
    plat_s = wbi_filter_value("1")
    seek_s = wbi_filter_value("")
    type_s = wbi_filter_value("12")
    web_s = wbi_filter_value("1315875")
    pag_f = wbi_filter_value(pag)
    q = (
        "mode=" + js_encodeURIComponent(mode_s)
        + "&oid=" + js_encodeURIComponent(oid_s)
        + "&pagination_str=" + js_encodeURIComponent(pag_f)
        + "&plat=" + js_encodeURIComponent(plat_s)
        + "&seek_rpid=" + js_encodeURIComponent(seek_s)
        + "&type=" + js_encodeURIComponent(type_s)
        + "&web_location=" + js_encodeURIComponent(web_s)
        + "&wts=" + js_encodeURIComponent(wt)
    )
    mix = get_mixin_key(img + sub)
    w_rid = hashlib.md5((q + mix).encode("utf-8")).hexdigest()
    return REPLY_API + "?" + q + "&w_rid=" + w_rid


def http_json(url: str, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


def load_cookie(cookie_file: Path) -> str:
    """优先环境变量 BILI_COOKIE；否则读 cookie 文件（整段一行）。"""
    env = os.environ.get("BILI_COOKIE", "").strip()
    if env:
        return env
    if cookie_file.is_file():
        raw = cookie_file.read_text(encoding="utf-8")
        if raw.startswith("\ufeff"):
            raw = raw[1:]
        t = raw.strip()
        if t.lower().startswith("cookie:"):
            t = t[7:].strip()
        return t.replace("\r\n", " ").replace("\n", " ").strip()
    return ""


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    p = argparse.ArgumentParser(description="Fetch bilibili article comments (WBI)")
    p.add_argument("cvid", help="专栏 cv 数字 id，如 21097348")
    p.add_argument("--max-pages", type=int, default=3, help="最多请求页数（调试）")
    p.add_argument(
        "--cookie-file",
        type=str,
        default=str(script_dir / ".bili_cookie.local"),
        help="Cookie 文件路径（默认: 本目录 .bili_cookie.local；也可用环境变量 BILI_COOKIE）",
    )
    args = p.parse_args()
    cvid = args.cvid.strip()
    cookie = load_cookie(Path(args.cookie_file).expanduser().resolve())

    base_headers = {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
    }
    if cookie:
        base_headers["Cookie"] = cookie
    else:
        print(
            "未提供 Cookie：请设置 BILI_COOKIE 或在",
            script_dir / ".bili_cookie.local",
            "中粘贴 Cookie（已 gitignore）",
            file=sys.stderr,
        )

    print("1) GET nav …", flush=True)
    try:
        nav = http_json(NAV_URL, base_headers)
    except urllib.error.HTTPError as e:
        print("nav HTTP", e.code, e.read().decode("utf-8", errors="replace")[:500], file=sys.stderr)
        return 1
    except OSError as e:
        print("nav 请求失败:", e, file=sys.stderr)
        return 1

    nav_code = nav.get("code")
    if nav_code != 0:
        print(
            "nav code=",
            nav_code,
            " message=",
            nav.get("message"),
            "（若仍含 wbi_img 可继续试评论接口）",
            file=sys.stderr,
        )

    wbi = (nav.get("data") or {}).get("wbi_img") or {}
    img_u = wbi.get("img_url") or ""
    sub_u = wbi.get("sub_url") or ""
    if not img_u or not sub_u:
        print("nav 无 wbi_img", json.dumps(nav, ensure_ascii=False)[:600], file=sys.stderr)
        return 1

    img_k = stem_from_wbi_url(str(img_u))
    sub_k = stem_from_wbi_url(str(sub_u))
    print("   img_key=", img_k, " sub_key=", sub_k, flush=True)

    offset = ""
    wts_base = int(time.time())
    for page in range(args.max_pages):
        wts = wts_base + page
        url = sign_reply_url(cvid, offset, img_k, sub_k, wts)
        read_headers = {
            "User-Agent": UA,
            "Accept": "application/json",
            "Referer": f"https://www.bilibili.com/read/cv{cvid}/?opus_fallback=1",
            "Origin": "https://www.bilibili.com",
        }
        if cookie:
            read_headers["Cookie"] = cookie

        print(f"2) GET reply page {page + 1} …", flush=True)
        try:
            j = http_json(url, read_headers)
        except urllib.error.HTTPError as e:
            print("reply HTTP", e.code, e.read().decode("utf-8", errors="replace")[:800], file=sys.stderr)
            return 1
        except OSError as e:
            print("reply 请求失败:", e, file=sys.stderr)
            return 1

        print("   code=", j.get("code"), " message=", j.get("message"), flush=True)
        if j.get("code") != 0:
            print(json.dumps(j, ensure_ascii=False, indent=2)[:4000], file=sys.stderr)
            return 1

        data = j.get("data") or {}
        cur = data.get("cursor") or {}
        replies = data.get("replies") or []
        print("   all_count=", cur.get("all_count"), " replies_len=", len(replies), " is_end=", cur.get("is_end"), flush=True)
        if replies:
            for i, r in enumerate(replies[:3]):
                mem = r.get("member") or {}
                msg = (r.get("content") or {}).get("message") or ""
                preview = (msg[:80] + "…") if len(msg) > 80 else msg
                print(f"   [{i}] {mem.get('uname','')}: {preview!r}", flush=True)

        if cur.get("is_end"):
            break
        pr = cur.get("pagination_reply") or {}
        nxt = pr.get("next_offset")
        if not nxt:
            break
        offset = str(nxt)

    print("OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
