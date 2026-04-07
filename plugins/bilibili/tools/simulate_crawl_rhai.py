#!/usr/bin/env python3
"""
按 plugins/bilibili/crawl.rhai 的 run() 逻辑做本地模拟（nav → WBI 搜索 → view → 抽图 URL；可选拉取评论快照）。

URL 编码与 Rhai 宿主 url_encode（Rust urlencoding::encode）对齐：优先用 Python 包 urlencoding，无则回退 urllib.parse.quote(s, safe='')。

  BILI_COOKIE='...' python3 simulate_crawl_rhai.py --keyword 壁纸 --start-page 1 --end-page 1
  python3 simulate_crawl_rhai.py --cookie-file ./cookie.txt --max-cvs 2
  python3 simulate_crawl_rhai.py --cookie-file ./cookie.txt --cv 21097348 --fetch-replies
  # 无痕 Cookie、从搜索进入专栏：与 DevTools 抓包的 Referer 对齐，遇 -509 会自动重试
  BILI_COOKIE='...' python3 simulate_crawl_rhai.py --cv 21171437 --view-referer-from-search
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote as urllib_quote

import requests

try:
    from urlencoding import encode as url_encode_rhai  # type: ignore
except ImportError:
    def url_encode_rhai(s: str) -> str:
        return urllib_quote(s, safe="")


# 与 crawl.rhai run(...) 末尾常量一致
NAV_URL = "https://api.bilibili.com/x/web-interface/nav"
SEARCH_API = "https://api.bilibili.com/x/web-interface/wbi/search/type"
VIEW_API = "https://api.bilibili.com/x/article/view"
REPLY_API = "https://api.bilibili.com/x/v2/reply/wbi/main"
# 与 B 站前端 WBI 一致（ignore/web-min.js 中 D()，64 项；勿多写 30 导致错位）
MIXIN_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
# 与浏览器 DevTools「复制为 cURL」接近，避免评论接口返回 -403（访问权限不足）
UA_REPLY = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)


def reply_browser_headers(cv_s: str) -> dict[str, str]:
    return {
        "user-agent": UA_REPLY,
        "accept": "*/*",
        "accept-language": "ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6,ko;q=0.5",
        "referer": f"https://www.bilibili.com/read/cv{cv_s}/?opus_fallback=1",
        "origin": "https://www.bilibili.com",
        "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "priority": "u=1, i",
    }


def view_browser_headers(cv_s: str, *, from_search: bool = False) -> dict[str, str]:
    """与 DevTools「无痕从搜索进专栏」的 x/article/view 请求头对齐（在 reply_browser_headers 上可选加长 Referer）。"""
    h = reply_browser_headers(cv_s)
    if from_search:
        h["referer"] = (
            f"https://www.bilibili.com/read/cv{cv_s}/"
            f"?from=search&spm_id_from=333.337.0.0&jump_opus=1&opus_fallback=1"
        )
    return h

PREFIXES = [
    "//i0.hdslb.com/bfs/article/",
    "//i1.hdslb.com/bfs/article/",
    "//i2.hdslb.com/bfs/article/",
    "//i0.hdslb.com/bfs/new_dyn/",
    "//i1.hdslb.com/bfs/new_dyn/",
    "//i2.hdslb.com/bfs/new_dyn/",
]


def optional_cookie_header(user_cookie: str) -> str:
    """Cookie 请求头不能含裸换行；多行文件应合并为一条。"""
    t = user_cookie.strip()
    if not t:
        return ""
    parts = [p.strip() for p in t.replace("\r\n", "\n").split("\n") if p.strip()]
    return "; ".join(parts)


def warn_if_bilibili_risk_print(code: Any) -> None:
    if code == -101 or code == -352:
        print(
            "[warn] B 站接口可能要求登录或触发风控；实际使用时请在爬虫任务高级设置中添加 Cookie 请求头。",
            file=sys.stderr,
        )


def wbi_filter_value(s: str) -> str:
    return "".join(c for c in s if c not in "!'()*")


def get_mixin_key(orig: str, mixin_tab: list[int]) -> str:
    acc = "".join(orig[i] for i in mixin_tab)
    return acc[:32]


def stem_from_wbi_url(u: str) -> str:
    name = u.rsplit("/", 1)[-1]
    if "." in name:
        return name.rsplit(".", 1)[0]
    return name


def wbi_keys_from_nav(nav: dict[str, Any]) -> dict[str, str]:
    data = nav.get("data") or {}
    wbi = data.get("wbi_img")
    if not wbi:
        return {"img": "", "sub": ""}
    iu = wbi.get("img_url") or ""
    su = wbi.get("sub_url") or ""
    return {"img": stem_from_wbi_url(str(iu)), "sub": stem_from_wbi_url(str(su))}


def sign_search_url(
    keyword: str,
    page: int,
    page_size: int,
    order: str,
    category_id: str,
    img: str,
    sub: str,
    search_api: str,
    mixin_tab: list[int],
) -> str:
    wts = int(time.time() * 1000) // 1000
    kw = wbi_filter_value(keyword)
    pg = wbi_filter_value(str(page))
    ps = wbi_filter_value(str(page_size))
    cat = wbi_filter_value(str(category_id))
    st = wbi_filter_value("article")
    wt = wbi_filter_value(str(wts))
    ord_f = wbi_filter_value(order)
    q_base = "category_id=" + url_encode_rhai(cat) + "&keyword=" + url_encode_rhai(kw)
    q_rest = (
        "&page=" + url_encode_rhai(pg)
        + "&page_size=" + url_encode_rhai(ps)
        + "&search_type=" + url_encode_rhai(st)
        + "&wts=" + url_encode_rhai(wt)
    )
    if ord_f:
        q = q_base + "&order=" + url_encode_rhai(ord_f) + q_rest
    else:
        q = q_base + q_rest
    mix = get_mixin_key(img + sub, mixin_tab)
    w_rid = hashlib.md5((q + mix).encode()).hexdigest()
    return search_api + "?" + q + "&w_rid=" + w_rid


def sign_view_url(
    cv_id: str,
    img: str,
    sub: str,
    view_api: str,
    mixin_tab: list[int],
) -> str:
    wts = int(time.time() * 1000) // 1000
    gaia = wbi_filter_value("main_web")
    id_s = wbi_filter_value(cv_id)
    web = wbi_filter_value("333.976")
    wt = wbi_filter_value(str(wts))
    q = (
        "gaia_source=" + url_encode_rhai(gaia)
        + "&id=" + url_encode_rhai(id_s)
        + "&web_location=" + url_encode_rhai(web)
        + "&wts=" + url_encode_rhai(wt)
    )
    mix = get_mixin_key(img + sub, mixin_tab)
    w_rid = hashlib.md5((q + mix).encode()).hexdigest()
    return view_api + "?" + q + "&w_rid=" + w_rid


def json_escape_offset(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def build_pagination_str(offset_token: str) -> str:
    esc = json_escape_offset(offset_token)
    return '{"offset":"' + esc + '"}'


def sign_reply_url(
    cv_id: str,
    offset_token: str,
    img: str,
    sub: str,
    reply_api: str,
    mixin_tab: list[int],
    wts: int,
) -> str:
    """与 crawl.rhai sign_reply_url 一致（url_encode = 宿主 Rhai）。"""
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
        "mode=" + url_encode_rhai(mode_s)
        + "&oid=" + url_encode_rhai(oid_s)
        + "&pagination_str=" + url_encode_rhai(pag_f)
        + "&plat=" + url_encode_rhai(plat_s)
        + "&seek_rpid=" + url_encode_rhai(seek_s)
        + "&type=" + url_encode_rhai(type_s)
        + "&web_location=" + url_encode_rhai(web_s)
        + "&wts=" + url_encode_rhai(wt)
    )
    mix = get_mixin_key(img + sub, mixin_tab)
    w_rid = hashlib.md5((q + mix).encode()).hexdigest()
    return reply_api + "?" + q + "&w_rid=" + w_rid


def simulate_fetch_article_replies(
    s: requests.Session,
    cv_s: str,
    img_s: str,
    sub_s: str,
    cap: int,
) -> dict[str, Any]:
    """模拟 crawl.rhai fetch_article_replies：翻页直至 cap 条或 is_end。"""
    collected = 0
    total: Any = 0
    offset = ""
    is_end = False
    page_idx = 0
    previews: list[str] = []
    while collected < cap and not is_end:
        wts = int(time.time() * 1000) // 1000
        rurl = sign_reply_url(cv_s, offset, img_s, sub_s, REPLY_API, MIXIN_TAB, wts)
        r = s.get(
            rurl,
            headers=reply_browser_headers(cv_s),
            timeout=30,
        )
        rj = r.json()
        page_idx += 1
        print(
            f"  [reply cv={cv_s} page={page_idx}]",
            r.status_code,
            "code",
            rj.get("code"),
            rj.get("message"),
        )
        if rj.get("code") != 0:
            warn_if_bilibili_risk_print(rj.get("code"))
            return {
                "ok": False,
                "code": rj.get("code"),
                "message": rj.get("message"),
                "total": total,
                "fetched": collected,
                "previews": previews,
            }
        data = rj.get("data") or {}
        cur = data.get("cursor") or {}
        if cur.get("all_count") is not None:
            total = cur.get("all_count")
        is_end = bool(cur.get("is_end"))
        repl = data.get("replies") or []
        for rep in repl:
            if collected >= cap:
                break
            collected += 1
            msg = (rep.get("content") or {}).get("message") or ""
            preview = (msg[:72] + "…") if len(msg) > 72 else msg
            uname = (rep.get("member") or {}).get("uname") or ""
            previews.append(f"{uname}: {preview}")
        if is_end:
            break
        pr = cur.get("pagination_reply") or {}
        nxt = pr.get("next_offset")
        if not nxt:
            break
        offset = str(nxt)
    return {
        "ok": True,
        "code": 0,
        "total": total,
        "fetched": collected,
        "previews": previews[:8],
    }


def collect_article_ids(data: dict[str, Any]) -> list[int]:
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
                    ids.append(int(item["id"]))
        return ids
    for item in res:
        if item.get("type") != "article":
            continue
        if "id" in item:
            ids.append(int(item["id"]))
    return ids


def ensure_https_bfs(path: str) -> str:
    if path.startswith("//"):
        return "https:" + path
    return path


def collect_image_urls_from_content(html: str) -> list[str]:
    out: list[str] = []
    seen: dict[str, bool] = {}
    h = html
    for p in PREFIXES:
        cursor = 0
        while cursor < len(h):
            rem = h[cursor:]
            idx = rem.find(p)
            if idx < 0:
                break
            abs_pos = cursor + idx
            rest = h[abs_pos:]
            end1 = rest.find('"') if '"' in rest else -1
            end2 = rest.find("'") if "'" in rest else -1
            end3 = rest.find(" ") if " " in rest else -1
            end4 = rest.find(">") if ">" in rest else -1
            end = -1
            for e in (end1, end2, end3, end4):
                if e >= 0 and (end < 0 or e < end):
                    end = e
            if end < 0:
                break
            path = rest[:end]
            full = ensure_https_bfs(path)
            if full not in seen:
                seen[full] = True
                out.append(full)
            cursor = abs_pos + end + 1
    return out


def run_flow(
    *,
    cookie: str,
    keyword: str,
    start_page: int,
    end_page: int,
    page_size: int,
    order: str,
    category_id: str,
    max_cvs: int | None,
    dump_json: str | None,
    single_cv: int | None,
    fetch_replies: bool,
    reply_cap: int,
    view_referer_from_search: bool,
    sleep_after_nav_sec: float,
) -> None:
    ck = optional_cookie_header(cookie)
    s = requests.Session()
    base_h = {
        "user-agent": UA,
        "referer": "https://www.bilibili.com/",
        "origin": "https://www.bilibili.com",
    }
    if ck:
        base_h["cookie"] = ck
    s.headers.update(base_h)

    r_nav = s.get(NAV_URL, headers={"referer": "https://www.bilibili.com/"}, timeout=30)
    nav = r_nav.json()
    print("[nav]", r_nav.status_code, "code", nav.get("code"), nav.get("message"), flush=True)
    if nav.get("code") != 0:
        warn_if_bilibili_risk_print(nav.get("code"))

    keys = wbi_keys_from_nav(nav)
    img_s, sub_s = keys["img"], keys["sub"]
    if not img_s or not sub_s:
        raise RuntimeError("无法从 nav 获取 WBI 密钥（若 code≠0 多为未登录，请传 Cookie）")
    print("[nav] wbi img/sub stems:", img_s[:16] + "...", sub_s[:16] + "...", flush=True)

    if sleep_after_nav_sec > 0:
        time.sleep(sleep_after_nav_sec)

    all_ids: list[int] = []
    if single_cv is not None:
        all_ids = [single_cv]
    else:
        if end_page < start_page:
            raise ValueError("结束页须大于等于起始页")
        for p in range(start_page, end_page + 1):
            surl = sign_search_url(
                keyword,
                p,
                page_size,
                order,
                category_id,
                img_s,
                sub_s,
                SEARCH_API,
                MIXIN_TAB,
            )
            kw_enc = url_encode_rhai(keyword)
            r_s = s.get(
                surl,
                headers={
                    "referer": f"https://search.bilibili.com/article?keyword={kw_enc}&from_source=article",
                    "origin": "https://search.bilibili.com",
                },
                timeout=30,
            )
            sj = r_s.json()
            print(f"[search page={p}]", r_s.status_code, "code", sj.get("code"), sj.get("message"))
            if sj.get("code") != 0:
                warn_if_bilibili_risk_print(sj.get("code"))
                continue
            d = sj.get("data") or {}
            page_ids = collect_article_ids(d)
            all_ids.extend(page_ids)
            print(f"  -> ids +{len(page_ids)} (total {len(all_ids)})")

    if not all_ids:
        print(
            "[warn] 未找到专栏 id，请检查关键词；若遇风控，请在高级设置中添加 Cookie 请求头（本脚本用 BILI_COOKIE 模拟）。"
        )
        return

    if max_cvs is not None:
        all_ids = all_ids[: max_cvs]

    summary: list[dict[str, Any]] = []
    for cvid in all_ids:
        cv_s = str(cvid)
        view_h = view_browser_headers(cv_s, from_search=view_referer_from_search)
        r_v = None
        vj: dict[str, Any] = {}
        for attempt in range(1, 6):
            vurl = sign_view_url(cv_s, img_s, sub_s, VIEW_API, MIXIN_TAB)
            r_v = s.get(vurl, headers=view_h, timeout=30)
            try:
                vj = r_v.json()
            except json.JSONDecodeError:
                print(
                    f"[view cv={cv_s}] HTTP {r_v.status_code} 非 JSON（前 200 字符）：{r_v.text[:200]!r}",
                    file=sys.stderr,
                )
                break
            if vj.get("code") != -509:
                break
            if attempt < 5:
                print(
                    f"  [view cv={cv_s}] -509 过于频繁，3s 后重试 ({attempt}/5)，新 w_rid…",
                    file=sys.stderr,
                )
                time.sleep(3.0)
        assert r_v is not None
        print(
            "[view cv=" + cv_s + "]",
            r_v.status_code,
            "code",
            vj.get("code"),
            vj.get("message"),
            flush=True,
        )
        if vj.get("code") != 0:
            warn_if_bilibili_risk_print(vj.get("code"))
            continue
        vd = vj.get("data") or {}
        title = (vd.get("title") or "")[:120]
        content = vd.get("content") or ""
        imgs = collect_image_urls_from_content(content)
        print(f"  title: {title}")
        print(f"  content_len={len(content)} image_urls={len(imgs)}")
        for u in imgs[:5]:
            print(f"    {u[:96]}...")
        if len(imgs) > 5:
            print(f"    ... +{len(imgs) - 5} more")
        row: dict[str, Any] = {
            "cvid": cvid,
            "title": title,
            "content_len": len(content),
            "image_count": len(imgs),
            "sample_urls": imgs[:8],
        }
        # 与 crawl.rhai process_one_cv 一致：仅当正文解析到图时才拉取评论快照
        if fetch_replies and len(imgs) > 0:
            rr = simulate_fetch_article_replies(s, cv_s, img_s, sub_s, reply_cap)
            row["replies"] = rr
            if rr.get("ok"):
                print(f"  replies: all_count={rr.get('total')} fetched={rr.get('fetched')}")
                for line in (rr.get("previews") or [])[:5]:
                    print(f"    {line}")
            else:
                print(
                    f"  [reply failed] code={rr.get('code')} msg={rr.get('message')}",
                    file=sys.stderr,
                )
        summary.append(row)

    if dump_json:
        Path(dump_json).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print("wrote", dump_json)


def main() -> None:
    ap = argparse.ArgumentParser(description="模拟 crawl.rhai 的 run()")
    ap.add_argument("--keyword", default="壁纸", help="与 Rhai 变量 keyword 一致")
    ap.add_argument("--start-page", type=int, default=1)
    ap.add_argument("--end-page", type=int, default=1)
    ap.add_argument("--page-size", type=int, default=20)
    ap.add_argument(
        "--order",
        default="",
        help="与 Rhai order 一致：空=综合，pubdate/click/attention/scores",
    )
    ap.add_argument("--category-id", default="0", help="与 Rhai category_id 一致（分区 id）")
    ap.add_argument("--max-cvs", type=int, default=None, help="最多处理几篇专栏（默认全部）")
    ap.add_argument("--cookie-file", type=argparse.FileType("r", encoding="utf-8"))
    ap.add_argument("--dump-json", help="将每篇摘要写入该路径")
    ap.add_argument(
        "--cv",
        type=int,
        default=None,
        help="指定单篇专栏 cv 数字 id，跳过搜索（便于调试评论）",
    )
    ap.add_argument(
        "--fetch-replies",
        action="store_true",
        help="在 view 且解析到正文图片时，模拟 fetch_article_replies 拉取评论（最多 --reply-cap 条）",
    )
    ap.add_argument(
        "--reply-cap",
        type=int,
        default=100,
        help="与 crawl.rhai 一致：评论快照条数上限（默认 100）",
    )
    ap.add_argument(
        "--view-referer-from-search",
        action="store_true",
        help="x/article/view 使用从搜索进入专栏的长 Referer（与无痕 curl 抓包一致）",
    )
    ap.add_argument(
        "--sleep-after-nav",
        type=float,
        default=1.0,
        help="nav 成功后到首次业务请求前的休眠秒数，减轻 -509（默认 1；设为 0 关闭）",
    )
    args = ap.parse_args()

    if args.cookie_file:
        cookie = args.cookie_file.read()
    else:
        cookie = os.environ.get("BILI_COOKIE", "")
    try:
        run_flow(
            cookie=cookie,
            keyword=args.keyword,
            start_page=args.start_page,
            end_page=args.end_page,
            page_size=args.page_size,
            order=args.order,
            category_id=args.category_id,
            max_cvs=args.max_cvs,
            dump_json=args.dump_json,
            single_cv=args.cv,
            fetch_replies=args.fetch_replies,
            reply_cap=args.reply_cap,
            view_referer_from_search=args.view_referer_from_search,
            sleep_after_nav_sec=args.sleep_after_nav,
        )
    except ValueError as e:
        print(e, file=sys.stderr)
        sys.exit(2)
    except RuntimeError as e:
        print(e, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
