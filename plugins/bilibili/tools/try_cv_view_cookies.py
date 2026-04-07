#!/usr/bin/env python3
"""
实验：GET 专栏页拿 Set-Cookie，再本地生成 b_lsid / _uuid（与 b-index.js、log-reporter.js 同逻辑），
配合 nav 拉取的 WBI 密钥签名后请求 x/article/view。

说明：请使用最终 HTTPS 地址（如 https://www.bilibili.com/read/cv{id}/）单次 GET；
实测该地址直接返回 200 并 Set-Cookie，无需跟随 301/302 链（allow_redirects=False 即可）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
import time
from functools import reduce
from pathlib import Path
from urllib.parse import urlencode

import requests

CV_URL = "https://www.bilibili.com/read/cv21097348/"
VIEW_API = "https://api.bilibili.com/x/article/view"
CV_ID = 21097348

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

HEADERS_DOC = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "ja",
    "priority": "u=0, i",
    "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
}


def _hex_ceil_u(val: float) -> str:
    return format(math.ceil(val), "x").upper()


def gen_o(length: int) -> str:
    t = ""
    for _ in range(length):
        t += _hex_ceil_u(16 * random.random())
    if len(t) < length:
        t = "0" * (length - len(t)) + t
    return t


def gen_uuid_infoc() -> str:
    e, t, r, n, a = gen_o(8), gen_o(4), gen_o(4), gen_o(4), gen_o(12)
    s = int(time.time() * 1000)
    tail = str(s % 100_000).zfill(5)
    return f"{e}-{t}-{r}-{n}-{a}{tail}infoc"


def gen_b_lsid() -> str:
    part = "".join(format(random.randint(0, 15), "x").upper() for _ in range(8))
    ts = format(int(time.time() * 1000), "x").upper()
    return f"{part}_{ts}"


def get_mixin_key(orig: str) -> str:
    return reduce(lambda s, i: s + orig[i], MIXIN_KEY_ENC_TAB, "")[:32]


def enc_wbi(params: dict, img_key: str, sub_key: str) -> dict:
    mixin_key = get_mixin_key(img_key + sub_key)
    params = dict(params)
    params["wts"] = round(time.time())
    params = dict(sorted(params.items()))
    params = {
        k: "".join(c for c in str(v) if c not in "!'()*")
        for k, v in params.items()
    }
    query = urlencode(params)
    w_rid = hashlib.md5((query + mixin_key).encode()).hexdigest()
    params["w_rid"] = w_rid
    return params


def get_wbi_keys(session: requests.Session) -> tuple[str, str] | None:
    r = session.get(
        "https://api.bilibili.com/x/web-interface/nav",
        headers={
            "user-agent": HEADERS_DOC["user-agent"],
            "referer": "https://www.bilibili.com/",
        },
        timeout=20,
    )
    j = r.json()
    data = j.get("data") or {}
    img = data.get("wbi_img") or {}
    img_url = img.get("img_url") or ""
    sub_url = img.get("sub_url") or ""
    if not img_url or not sub_url:
        return None
    img_key = img_url.rsplit("/", 1)[1].split(".")[0]
    sub_key = sub_url.rsplit("/", 1)[1].split(".")[0]
    return img_key, sub_key


def _save_view_json(path: Path, j: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(j, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path)


def run_until_view_ok(
    *,
    allow_redirects: bool,
    save_json: Path | None,
    max_attempts: int = 4,
    sleep_on_509_base: float = 3.0,
) -> tuple[bool, requests.Response | None, dict | None]:
    """多次尝试直到 view 返回 code==0 或放弃。成功且 save_json 时写入文件。"""
    label = "follow30x" if allow_redirects else "no30x"
    for attempt in range(max_attempts):
        r0, r1, j, cks = fetch_article_view(allow_redirects=allow_redirects)
        code = j.get("code")
        print(f"[{label}] 专栏页 url:", r0.url, "status:", r0.status_code, flush=True)
        print(f"[{label}] session cookies:", cks, flush=True)
        print(f"[{label}] view API code:", code, "message:", j.get("message"), flush=True)
        data = j.get("data") or {}
        c = data.get("content")
        print(f"[{label}] content length:", len(c) if c else 0, flush=True)

        if code == 0:
            if save_json is not None:
                _save_view_json(save_json, j)
            return True, r1, j

        if code == -509 and attempt < max_attempts - 1:
            wait = sleep_on_509_base + attempt * 2.0
            print(f"[{label}] sleep {wait:.1f}s (509)...", flush=True)
            time.sleep(wait)
            continue

        print(f"[{label}] give up: code={code}", file=sys.stderr)
        return False, r1, j

    return False, None, None


def fetch_article_view(
    cv_url: str = CV_URL,
    cv_id: int = CV_ID,
    *,
    allow_redirects: bool = False,
) -> tuple[requests.Response, requests.Response, dict, dict[str, str]]:
    """返回 (专栏页 response, view 接口 response, view 的 json, 合并后的 cookie 字典)。"""
    session = requests.Session()
    session.headers.update(HEADERS_DOC)

    r0 = session.get(cv_url, allow_redirects=allow_redirects, timeout=25)
    session.cookies.set("b_lsid", gen_b_lsid(), domain=".bilibili.com")
    session.cookies.set("_uuid", gen_uuid_infoc(), domain=".bilibili.com")

    keys = get_wbi_keys(session)
    if not keys:
        raise RuntimeError("no wbi keys from nav")
    img_key, sub_key = keys

    params = enc_wbi(
        {
            "id": str(cv_id),
            "gaia_source": "main_web",
            "web_location": "333.976",
        },
        img_key,
        sub_key,
    )

    api_headers = {
        "accept": "*/*",
        "accept-language": "ja",
        "origin": "https://www.bilibili.com",
        "referer": f"https://www.bilibili.com/read/cv{cv_id}/?opus_fallback=1",
        "user-agent": HEADERS_DOC["user-agent"],
        "sec-ch-ua": HEADERS_DOC["sec-ch-ua"],
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
    }

    r1 = session.get(VIEW_API, params=params, headers=api_headers, timeout=25)
    return r0, r1, r1.json(), session.cookies.get_dict()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--save-json",
        type=Path,
        default=None,
        help="将 view 接口完整 JSON 写入路径（成功时）",
    )
    parser.add_argument(
        "--follow-redirects",
        action="store_true",
        help="专栏页 GET 时跟随 30x（默认不跟随）",
    )
    parser.add_argument(
        "--compare-redirects",
        action="store_true",
        help="先不跟随 30x 重试，再间隔 --gap-sec 秒后跟随 30x 重试；"
        "若指定 --save-json，成功时分别写入 .no30x 与 .follow30x 两份",
    )
    parser.add_argument(
        "--sleep-before",
        type=float,
        default=0.0,
        help="首次请求前休眠秒数（降频）",
    )
    parser.add_argument(
        "--gap-sec",
        type=float,
        default=15.0,
        help="--compare-redirects 时两阶段之间的间隔秒数",
    )
    args = parser.parse_args()

    if args.sleep_before > 0:
        print("sleep before:", args.sleep_before, "s", flush=True)
        time.sleep(args.sleep_before)

    if args.compare_redirects:
        base = args.save_json
        p_no = None
        p_follow = None
        if base is not None:
            p_no = base.parent / f"{base.stem}.no30x{base.suffix}"
            p_follow = base.parent / f"{base.stem}.follow30x{base.suffix}"

        ok1, _, _ = run_until_view_ok(
            allow_redirects=False,
            save_json=p_no,
        )
        print("--- gap between modes:", args.gap_sec, "s ---", flush=True)
        time.sleep(args.gap_sec)
        ok2, _, _ = run_until_view_ok(
            allow_redirects=True,
            save_json=p_follow,
        )
        if base is not None and (ok1 or ok2):
            # 便于分析：任选一份成功副本复制为主文件名
            if ok1 and p_no is not None and p_no.is_file():
                _save_view_json(base, json.loads(p_no.read_text(encoding="utf-8")))
            elif ok2 and p_follow is not None and p_follow.is_file():
                _save_view_json(base, json.loads(p_follow.read_text(encoding="utf-8")))
        return

    ok, _, _ = run_until_view_ok(
        allow_redirects=args.follow_redirects,
        save_json=args.save_json,
    )
    if args.save_json and not ok:
        print("skip save: never got code 0", file=sys.stderr)


if __name__ == "__main__":
    main()
