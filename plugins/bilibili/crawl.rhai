// 哔哩哔哩专栏：关键词 WBI 搜索；单篇 cv → x/article/view；单篇图文 opus → to(页面) 抽 bfs 图；opus 页若含 cv 可从版权区解析后拉评论
// 依赖宿主：md5 / fetch_json / to / current_html / back / set_header / del_header / sleep
// Cookie 由用户在前端「高级设置」中配置为请求头，由宿主合并进 HTTP 请求；脚本不读写 Cookie。
// 遇 -101/-352 等风控/未登录时提示用户在高级设置中补充 Cookie 请求头。
// 注意：函数内不读取顶层 let；URL / UA / MIXIN 表由入口 run(...) 实参传入。

fn warn_if_bilibili_risk(code) {
    if code == -101 || code == -352 {
        warn("B 站接口可能要求登录或触发风控，请在爬虫任务的高级设置中为请求添加 Cookie 请求头（浏览器复制 SESSDATA、bili_jct 等）后重试。");
    }
}

// -509：请求过于频繁；最多 5 次、间隔 3s、每次重签 wts/w_rid（与 tools/simulate_crawl_rhai.py 一致）。Rhai 无顶层 const，次数/间隔写死在下列函数内。

fn fetch_search_json_509_retry(keyword, page, page_size, order, category_id, img_s, sub_s, search_api, mixin_tab) {
    let attempt = 0;
    while attempt < 5 {
        attempt += 1;
        let surl = sign_search_url(keyword, page, page_size, order, category_id, img_s, sub_s, search_api, mixin_tab);
        set_header("Referer", `https://search.bilibili.com/article?keyword=${url_encode(keyword)}&from_source=article`);
        set_header("Origin", "https://search.bilibili.com");
        let sj = fetch_json(surl);
        if sj["code"] != -509 {
            return sj;
        }
        warn(`搜索接口 -509 过于频繁，${attempt}/5`);
        if attempt >= 5 {
            return sj;
        }
        sleep(3.0);
    }
    throw "fetch_search_json_509_retry";
}

fn fetch_view_json_509_retry(cv_s, img_s, sub_s, view_api, mixin_tab) {
    let attempt = 0;
    while attempt < 5 {
        attempt += 1;
        let vurl = sign_view_url(cv_s, img_s, sub_s, view_api, mixin_tab);
        set_header("Referer", `https://www.bilibili.com/read/cv${cv_s}/?opus_fallback=1`);
        set_header("Origin", "https://www.bilibili.com");
        let vj = fetch_json(vurl);
        if vj["code"] != -509 {
            return vj;
        }
        warn(`cv ${cv_s} view -509 过于频繁，${attempt}/5`);
        if attempt >= 5 {
            return vj;
        }
        sleep(3.0);
    }
    throw "fetch_view_json_509_retry";
}

fn fetch_reply_json_509_retry(cv_s, offset, img_s, sub_s, reply_api, mixin_tab) {
    let attempt = 0;
    while attempt < 5 {
        attempt += 1;
        let rurl = sign_reply_url(cv_s, offset, img_s, sub_s, reply_api, mixin_tab);
        set_header("Referer", `https://www.bilibili.com/read/cv${cv_s}/?opus_fallback=1`);
        set_header("Origin", "https://www.bilibili.com");
        let rj = fetch_json(rurl);
        if rj["code"] != -509 {
            return rj;
        }
        warn(`cv ${cv_s} 评论接口 -509 过于频繁，${attempt}/5`);
        if attempt >= 5 {
            return rj;
        }
        sleep(3.0);
    }
    throw "fetch_reply_json_509_retry";
}

fn wbi_filter_value(s) {
    let t = s.to_string();
    let out = "";
    let i = 0;
    while i < t.len() {
        let c = t.sub_string(i, 1);
        if c != "!" && c != "'" && c != "(" && c != ")" && c != "*" {
            out += c;
        }
        i += 1;
    }
    out
}

fn get_mixin_key(orig, mixin_tab) {
    let o = orig.to_string();
    let acc = "";
    let i = 0;
    while i < 64 {
        let idx = mixin_tab[i];
        acc += o.sub_string(idx, 1);
        i += 1;
    }
    acc.sub_string(0, 32)
}

fn stem_from_wbi_url(u) {
    let s = u.to_string();
    let last = -1;
    let j = 0;
    while j < s.len() {
        if s.sub_string(j, 1) == "/" {
            last = j;
        }
        j += 1;
    }
    if last < 0 {
        return "";
    }
    let name = s.sub_string(last + 1, s.len() - last - 1);
    let dot = name.index_of(".");
    if dot < 0 {
        return name;
    }
    name.sub_string(0, dot)
}

fn wbi_keys_from_nav(nav) {
    let data = nav["data"];
    if data == () {
        return #{
            img: "",
            sub: "",
        };
    }
    let wbi = data["wbi_img"];
    if wbi == () {
        return #{
            img: "",
            sub: "",
        };
    }
    let img_url = wbi["img_url"];
    let sub_url = wbi["sub_url"];
    let iu = if img_url == () {
        ""
    } else {
        img_url.to_string()
    };
    let su = if sub_url == () {
        ""
    } else {
        sub_url.to_string()
    };
    #{
        img: stem_from_wbi_url(iu),
        sub: stem_from_wbi_url(su),
    }
}

fn sign_search_url(keyword, page, page_size, order, category_id, img, sub, search_api, mixin_tab) {
    let wts = unix_time_ms() / 1000;
    let kw = wbi_filter_value(keyword);
    let pg = wbi_filter_value(page.to_string());
    let ps = wbi_filter_value(page_size.to_string());
    let cat = wbi_filter_value(category_id.to_string());
    let st = wbi_filter_value("article");
    let wt = wbi_filter_value(wts.to_string());
    let ord_raw = if order == () {
        ""
    } else {
        order.to_string()
    };
    let ord_f = wbi_filter_value(ord_raw);
    let q_base = "category_id=" + url_encode(cat)
        + "&keyword=" + url_encode(kw);
    let q_rest = "&page=" + url_encode(pg)
        + "&page_size=" + url_encode(ps)
        + "&search_type=" + url_encode(st)
        + "&wts=" + url_encode(wt);
    let q = if ord_f != "" {
        q_base + "&order=" + url_encode(ord_f) + q_rest
    } else {
        q_base + q_rest
    };
    let mix = get_mixin_key(img + sub, mixin_tab);
    let w_rid = md5(q + mix);
    search_api + "?" + q + "&w_rid=" + w_rid
}

fn sign_view_url(cv_id, img, sub, view_api, mixin_tab) {
    let wts = unix_time_ms() / 1000;
    let gaia = wbi_filter_value("main_web");
    let id_s = wbi_filter_value(cv_id.to_string());
    let web = wbi_filter_value("333.976");
    let wt = wbi_filter_value(wts.to_string());
    let q = "gaia_source=" + url_encode(gaia)
        + "&id=" + url_encode(id_s)
        + "&web_location=" + url_encode(web)
        + "&wts=" + url_encode(wt);
    let mix = get_mixin_key(img + sub, mixin_tab);
    let w_rid = md5(q + mix);
    view_api + "?" + q + "&w_rid=" + w_rid
}

fn json_escape_offset(s) {
    let t = s.to_string();
    let out = "";
    let i = 0;
    while i < t.len() {
        let c = t.sub_string(i, 1);
        if c == "\\" {
            out += "\\\\";
        } else if c == "\"" {
            out += "\\\"";
        } else {
            out += c;
        }
        i += 1;
    }
    out
}

fn build_pagination_str(offset_token) {
    let o = if offset_token == () {
        ""
    } else {
        offset_token.to_string()
    };
    let esc = json_escape_offset(o);
    "{\"offset\":\"" + esc + "\"}"
}

fn sign_reply_url(cv_id, offset_token, img, sub, reply_api, mixin_tab) {
    let wts = unix_time_ms() / 1000;
    let pag = build_pagination_str(offset_token);
    let oid_s = wbi_filter_value(cv_id.to_string());
    let wt = wbi_filter_value(wts.to_string());
    let mode_s = wbi_filter_value("3");
    let plat_s = wbi_filter_value("1");
    let seek_s = wbi_filter_value("");
    let type_s = wbi_filter_value("12");
    let web_s = wbi_filter_value("1315875");
    let pag_f = wbi_filter_value(pag);
    let q = "mode=" + url_encode(mode_s)
        + "&oid=" + url_encode(oid_s)
        + "&pagination_str=" + url_encode(pag_f)
        + "&plat=" + url_encode(plat_s)
        + "&seek_rpid=" + url_encode(seek_s)
        + "&type=" + url_encode(type_s)
        + "&web_location=" + url_encode(web_s)
        + "&wts=" + url_encode(wt);
    let mix = get_mixin_key(img + sub, mixin_tab);
    let w_rid = md5(q + mix);
    reply_api + "?" + q + "&w_rid=" + w_rid
}

fn simplify_emotes(em) {
    let out = #{};
    if em == () {
        return out;
    }
    for k in em.keys() {
        let v = em[k];
        if v == () {
            continue;
        }
        let url = v["url"];
        let u = if url == () {
            ""
        } else {
            url.to_string()
        };
        let sz = 1;
        let meta = v["meta"];
        if meta != () && meta["size"] != () {
            sz = meta["size"];
        }
        out[k] = #{ url: u, size: sz };
    }
    out
}

fn simplify_one_reply(rep) {
    let mem = rep["member"];
    let mid = "";
    let uname = "";
    let avatar = "";
    let level = 0;
    if mem != () {
        if mem["mid"] != () {
            mid = mem["mid"].to_string();
        }
        if mem["uname"] != () {
            uname = mem["uname"].to_string();
        }
        if mem["avatar"] != () {
            avatar = mem["avatar"].to_string();
        }
        let li = mem["level_info"];
        if li != () && li["current_level"] != () {
            level = li["current_level"];
        }
    }
    let message = "";
    let emotes = #{};
    let cnt = rep["content"];
    if cnt != () {
        if cnt["message"] != () {
            message = cnt["message"].to_string();
        }
        if cnt["emote"] != () {
            emotes = simplify_emotes(cnt["emote"]);
        }
    }
    let ctime = 0;
    if rep["ctime"] != () {
        ctime = rep["ctime"];
    }
    let like = 0;
    if rep["like"] != () {
        like = rep["like"];
    }
    let location = "";
    let sub_count_text = "";
    let rc = rep["reply_control"];
    if rc != () {
        if rc["location"] != () {
            location = rc["location"].to_string();
        }
        if rc["sub_reply_entry_text"] != () {
            sub_count_text = rc["sub_reply_entry_text"].to_string();
        }
    }
    #{
        mid: mid,
        uname: uname,
        avatar: avatar,
        level: level,
        message: message,
        emotes: emotes,
        ctime: ctime,
        like: like,
        location: location,
        sub_count_text: sub_count_text,
    }
}

fn fetch_article_replies(cv_s, img_s, sub_s, reply_api, mixin_tab) {
    let cap = 100;
    let collected = [];
    let total = 0;
    let offset = "";
    let is_end = false;

    while collected.len() < cap && is_end == false {
        let rj = fetch_reply_json_509_retry(cv_s, offset, img_s, sub_s, reply_api, mixin_tab);

        if rj["code"] != 0 {
            warn_if_bilibili_risk(rj["code"]);
            warn(`评论 API 拉取失败 (cv ${cv_s}): ${rj["message"]}`);
            break;
        }

        let data = rj["data"];
        if data == () {
            break;
        }
        let cur = data["cursor"];
        if cur != () {
            let ac = cur["all_count"];
            if ac != () {
                total = ac;
            }
            let ie = cur["is_end"];
            if ie != () {
                is_end = ie;
            }
        }

        let repl = data["replies"];
        if repl != () && repl.type_of() == "array" {
            for rep in repl {
                if collected.len() >= cap {
                    break;
                }
                collected.push(simplify_one_reply(rep));
            }
        }

        if cur == () {
            break;
        }
        if is_end {
            break;
        }
        let pr = cur["pagination_reply"];
        if pr == () {
            break;
        }
        let no = pr["next_offset"];
        if no == () {
            break;
        }
        let next_s = no.to_string();
        if next_s == "" {
            break;
        }
        offset = next_s;
    }

    #{
        total: total,
        replies: collected,
    }
}

// 每条为 #{ id, desc }，desc 为搜索列表摘要（可能为空）
fn collect_article_ids(data) {
    let ids = [];
    let res = data["result"];
    if res == () {
        return ids;
    }
    if res.len() == 0 {
        return ids;
    }
    let probe = res[0];
    let has_block = probe["result_type"];
    if has_block != () {
        for block in res {
            let rt = block["result_type"];
            if rt == () {
                continue;
            }
            if rt.to_string() != "article" {
                continue;
            }
            let arr = block["data"];
            if arr == () {
                continue;
            }
            for item in arr {
                let id = item["id"];
                if id != () {
                    let desc_s = "";
                    if item["desc"] != () {
                        desc_s = item["desc"].to_string();
                    }
                    ids.push(#{ id: id, desc: desc_s });
                }
            }
        }
        return ids;
    }
    for item in res {
        let t = item["type"];
        if t == () {
            continue;
        }
        if t.to_string() != "article" {
            continue;
        }
        let id = item["id"];
        if id != () {
            let desc_s = "";
            if item["desc"] != () {
                desc_s = item["desc"].to_string();
            }
            ids.push(#{ id: id, desc: desc_s });
        }
    }
    ids
}

fn ensure_https_bfs(path) {
    let p = path.to_string();
    if p.len() >= 2 && p.sub_string(0, 2) == "//" {
        return "https:" + p;
    }
    p
}

// 单篇模式：纯数字 id，或 URL / 路径中的 cv + 数字（会先去掉 ? # 片段）
fn parse_cv_id_from_input(raw) {
    if raw == () {
        return "";
    }
    let t = raw.to_string();
    t.trim();
    if t.len() == 0 {
        return "";
    }
    let work = t;
    let q = t.index_of("?");
    if q >= 0 {
        work = t.sub_string(0, q);
    }
    let h = work.index_of("#");
    if h >= 0 {
        work = work.sub_string(0, h);
    }
    work.trim();

    let only_digits = true;
    let i = 0;
    while i < work.len() {
        let c = work.sub_string(i, 1);
        if c < "0" || c > "9" {
            only_digits = false;
            break;
        }
        i += 1;
    }
    if only_digits {
        return work;
    }

    let pos = work.index_of("cv");
    if pos < 0 {
        pos = work.index_of("CV");
    }
    if pos < 0 {
        return "";
    }
    let start = pos + 2;
    let digits = "";
    let j = start;
    while j < work.len() {
        let c = work.sub_string(j, 1);
        if c >= "0" && c <= "9" {
            digits += c;
        } else if digits.len() > 0 {
            break;
        }
        j += 1;
    }
    digits
}

// 单篇图文（opus）：路径 /opus/{雪花 id}；或仅填 15 位以上数字 id（与短 cvid 区分）
fn parse_opus_id_from_input(raw) {
    if raw == () {
        return "";
    }
    let t = raw.to_string();
    t.trim();
    if t.len() == 0 {
        return "";
    }
    let work = t;
    let q = t.index_of("?");
    if q >= 0 {
        work = t.sub_string(0, q);
    }
    let h = work.index_of("#");
    if h >= 0 {
        work = work.sub_string(0, h);
    }
    work.trim();

    let marker = "/opus/";
    let pos = work.index_of(marker);
    if pos >= 0 {
        let start = pos + marker.len();
        let digits = "";
        let j = start;
        while j < work.len() {
            let c = work.sub_string(j, 1);
            if c >= "0" && c <= "9" {
                digits += c;
            } else if digits.len() > 0 {
                break;
            }
            j += 1;
        }
        if digits.len() > 0 {
            return digits;
        }
    }

    let only_digits = true;
    let i = 0;
    while i < work.len() {
        let c = work.sub_string(i, 1);
        if c < "0" || c > "9" {
            only_digits = false;
            break;
        }
        i += 1;
    }
    if only_digits && work.len() >= 15 {
        return work;
    }
    ""
}

// 从 opus 页「版权」区块解析关联专栏 cv 数字 id（如 opus-module-copyright__right 内 cv41583491）
fn parse_cv_id_from_opus_html(html) {
    let h = html.to_string();
    let mark = "opus-module-copyright__right";
    let pos = h.index_of(mark);
    if pos < 0 {
        return "";
    }
    let tail = h.sub_string(pos, h.len() - pos);
    let lim = tail.len();
    if lim > 4000 {
        lim = 4000;
    }
    let slice = tail.sub_string(0, lim);
    let gt = slice.index_of(">cv");
    if gt >= 0 {
        let start = gt + 3;
        let digits = "";
        let j = start;
        while j < slice.len() {
            let c = slice.sub_string(j, 1);
            if c >= "0" && c <= "9" {
                digits += c;
            } else if digits.len() > 0 {
                break;
            }
            j += 1;
        }
        if digits.len() > 0 {
            return digits;
        }
    }
    let i = 0;
    while i < slice.len() - 2 {
        if slice.sub_string(i, 2) == "cv" {
            let k = i + 2;
            let d = "";
            while k < slice.len() {
                let c = slice.sub_string(k, 1);
                if c >= "0" && c <= "9" {
                    d += c;
                } else if d.len() > 0 {
                    return d;
                }
                k += 1;
            }
            if d.len() > 0 {
                return d;
            }
        }
        i += 1;
    }
    ""
}

// 拉取 opus 详情页 HTML，从正文区域可解析的 bfs 图链；若解析到 cv 则 nav+WBI 拉 view 元数据与评论
fn process_one_opus(opus_id_s, per_total, nav_url, view_api, reply_api, mixin_tab) {
    let page_url = "https://www.bilibili.com/opus/" + opus_id_s;
    set_header("Referer", page_url);
    set_header("Origin", "https://www.bilibili.com");
    to(page_url);
    let html = current_html();
    back();
    let imgs = collect_image_urls_from_content(html);
    let ni = imgs.len();
    if ni == 0 {
        warn("opus 页面未解析到 bfs 图片链接，可能为壳页或结构变化；可尝试在高级设置中加 Cookie 后重试。");
        add_progress(per_total);
        return;
    }

    let cv_s = parse_cv_id_from_opus_html(html);
    let vd = ();
    let replies_data = ();
    let rich_meta = false;

    if cv_s != "" {
        del_header("Referer");
        set_header("Referer", "https://www.bilibili.com/");
        let nav = fetch_json(nav_url);
        del_header("Referer");
        if nav["code"] == 0 {
            let keys = wbi_keys_from_nav(nav);
            let img_k = keys["img"];
            let sub_k = keys["sub"];
            let img_s = if img_k == () {
                ""
            } else {
                img_k.to_string()
            };
            let sub_s = if sub_k == () {
                ""
            } else {
                sub_k.to_string()
            };
            if img_s != "" && sub_s != "" {
                let vj = fetch_view_json_509_retry(cv_s, img_s, sub_s, view_api, mixin_tab);
                if vj["code"] == 0 {
                    vd = vj["data"];
                } else {
                    warn_if_bilibili_risk(vj["code"]);
                    warn(`opus ${opus_id_s} 关联 cv ${cv_s} view 失败: ${vj["message"]}，仍尝试拉取评论`);
                }
                set_header("Referer", `https://www.bilibili.com/read/cv${cv_s}/?opus_fallback=1`);
                set_header("Origin", "https://www.bilibili.com");
                replies_data = fetch_article_replies(cv_s, img_s, sub_s, reply_api, mixin_tab);
                rich_meta = true;
            } else {
                warn(`opus 页解析到 cv ${cv_s}，但 nav 未返回 WBI 密钥，跳过评论与专栏元数据`);
            }
        } else {
            warn_if_bilibili_risk(nav["code"]);
            warn(`opus ${opus_id_s} nav 失败，无法拉取 cv ${cv_s} 的评论: ${nav["message"]}`);
        }
    }

    let meta = if rich_meta {
        build_article_metadata(vd, cv_s, "", replies_data, ni, opus_id_s)
    } else {
        #{
            source: "bilibili_opus",
            opus_id: opus_id_s,
            total_image_count: ni,
        }
    };

    let subject = "";
    if vd != () && vd["title"] != () {
        subject = vd["title"].to_string();
    }
    let base = if subject != "" {
        subject
    } else {
        "图文 " + opus_id_s
    };

    let per_img = per_total / ni;
    let k = 0;
    while k < imgs.len() {
        let u = imgs[k];
        let name = if ni > 1 {
            base + "(" + (k + 1).to_string() + ")"
        } else {
            base
        };
        download_image(u, #{
            name: name,
            metadata: meta,
            url: page_url,
        });
        add_progress(per_img);
        k += 1;
    }
}

fn build_article_metadata(vd, cv_s, search_desc, replies_data, total_image_count, opus_id_extra) {
    let title = "";
    if vd != () && vd["title"] != () {
        title = vd["title"].to_string();
    }
    let summary = "";
    if vd != () && vd["summary"] != () {
        summary = vd["summary"].to_string();
    }
    let desc_out = search_desc;
    if desc_out == "" && summary != "" {
        desc_out = summary;
    }
    let publish_time = 0;
    if vd != () && vd["publish_time"] != () {
        publish_time = vd["publish_time"];
    }
    let author = #{};
    if vd != () {
        let au = vd["author"];
        if au != () {
            if au["mid"] != () {
                author["mid"] = au["mid"];
            }
            if au["name"] != () {
                author["name"] = au["name"].to_string();
            }
            if au["face"] != () {
                author["face"] = au["face"].to_string();
            }
            if au["fans"] != () {
                author["fans"] = au["fans"];
            }
            if au["level"] != () {
                author["level"] = au["level"];
            }
        }
    }
    let stats = #{};
    if vd != () {
        let st = vd["stats"];
        if st != () {
            if st["view"] != () {
                stats["view"] = st["view"];
            }
            if st["like"] != () {
                stats["like"] = st["like"];
            }
            if st["reply"] != () {
                stats["reply"] = st["reply"];
            }
            if st["favorite"] != () {
                stats["favorite"] = st["favorite"];
            }
            if st["coin"] != () {
                stats["coin"] = st["coin"];
            }
            if st["share"] != () {
                stats["share"] = st["share"];
            }
        }
    }
    let tags = [];
    if vd != () {
        let t0 = vd["tags"];
        if t0 != () {
            for tag in t0 {
                let nm = tag["name"];
                if nm != () {
                    tags.push(#{ name: nm.to_string() });
                }
            }
        }
    }
    let categories = [];
    if vd != () {
        let c0 = vd["categories"];
        if c0 != () {
            for c in c0 {
                let nm = c["name"];
                if nm != () {
                    categories.push(#{ name: nm.to_string() });
                }
            }
        }
    }
    let reply_total = 0;
    let replies = [];
    if replies_data != () {
        let rt = replies_data["total"];
        if rt != () {
            reply_total = rt;
        }
        let rr = replies_data["replies"];
        if rr != () && rr.type_of() == "array" {
            replies = rr;
        }
    }
    let result = #{
        source: "bilibili_article",
        cvid: cv_s,
        title: title,
        desc: desc_out,
        publish_time: publish_time,
        author: author,
        stats: stats,
        tags: tags,
        categories: categories,
        reply_total: reply_total,
        replies: replies,
        total_image_count: total_image_count,
    };
    if opus_id_extra != () {
        let ox = opus_id_extra.to_string();
        if ox != "" {
            result["opus_id"] = ox;
        }
    }
    result
}

fn process_one_cv(cv_s, img_s, sub_s, view_api, reply_api, mixin_tab, per_cv, search_desc) {
    let vj = fetch_view_json_509_retry(cv_s, img_s, sub_s, view_api, mixin_tab);
    if vj["code"] != 0 {
        warn_if_bilibili_risk(vj["code"]);
        warn(`cv ${cv_s} view 失败: ${vj["message"]}`);
        add_progress(per_cv);
        return;
    }
    let vd = vj["data"];
    let content = "";
    if vd != () && vd["content"] != () {
        content = vd["content"].to_string();
    }
    let imgs = collect_image_urls_from_content(content);
    let ni = imgs.len();
    if ni == 0 {
        add_progress(per_cv);
        return;
    }
    let replies_data = fetch_article_replies(cv_s, img_s, sub_s, reply_api, mixin_tab);
    set_header("Referer", `https://www.bilibili.com/read/cv${cv_s}/?opus_fallback=1`);
    set_header("Origin", "https://www.bilibili.com");
    let subject = "";
    if vd != () && vd["title"] != () {
        subject = vd["title"].to_string();
    }
    let meta = build_article_metadata(vd, cv_s, search_desc, replies_data, ni, ());
    let per_img = per_cv / ni;
    let k = 0;
    while k < imgs.len() {
        let u = imgs[k];
        let name = if ni > 1 {
            if subject != "" {
                subject + "(" + (k + 1).to_string() + ")"
            } else {
                "cv" + cv_s + "(" + (k + 1).to_string() + ")"
            }
        } else {
            if subject != "" {
                subject
            } else {
                "cv" + cv_s
            }
        };
        let cv_page_url = "https://www.bilibili.com/read/cv" + cv_s;
        download_image(u, #{
            name: name,
            metadata: meta,
            url: cv_page_url,
        });
        add_progress(per_img);
        k += 1;
    }
}

fn collect_image_urls_from_content(html) {
    let out = [];
    let seen = #{};
    let h = html.to_string();
    let prefixes = [
        "//i0.hdslb.com/bfs/article/",
        "//i1.hdslb.com/bfs/article/",
        "//i2.hdslb.com/bfs/article/",
        "//i0.hdslb.com/bfs/new_dyn/",
        "//i1.hdslb.com/bfs/new_dyn/",
        "//i2.hdslb.com/bfs/new_dyn/",
    ];
    for p in prefixes {
        let cursor = 0;
        while cursor < h.len() {
            let rem = h.sub_string(cursor, h.len() - cursor);
            let idx = rem.index_of(p);
            if idx < 0 {
                break;
            }
            let abs = cursor + idx;
            let rest = h.sub_string(abs, h.len() - abs);
            let end1 = rest.index_of("\"");
            let end2 = rest.index_of("'");
            let end3 = rest.index_of(" ");
            let end4 = rest.index_of(">");
            let end = -1;
            if end1 >= 0 {
                end = end1;
            }
            if end2 >= 0 && (end < 0 || end2 < end) {
                end = end2;
            }
            if end3 >= 0 && (end < 0 || end3 < end) {
                end = end3;
            }
            if end4 >= 0 && (end < 0 || end4 < end) {
                end = end4;
            }
            if end < 0 {
                break;
            }
            let path = rest.sub_string(0, end);
            let full = ensure_https_bfs(path);
            if seen[full] == () {
                seen[full] = true;
                out.push(full);
            }
            cursor = abs + end + 1;
        }
    }
    out
}

fn run(nav_url, search_api, view_api, reply_api, mixin_tab, ua) {
    set_header("User-Agent", ua);
    set_header("Referer", "https://www.bilibili.com/");
    set_header("Origin", "https://www.bilibili.com");

    if mode == "single" {
        let opus_id = parse_opus_id_from_input(cv_id_or_url);
        if opus_id != "" {
            process_one_opus(opus_id, 100.0, nav_url, view_api, reply_api, mixin_tab);
            add_progress(100.0);
            return;
        }
    }

    del_header("Referer");
    set_header("Referer", "https://www.bilibili.com/");
    let nav = fetch_json(nav_url);
    del_header("Referer");

    if nav["code"] != 0 {
        warn_if_bilibili_risk(nav["code"]);
        warn("nav 接口异常: " + nav["message"].to_string());
        throw "nav failed";
    }

    let keys = wbi_keys_from_nav(nav);
    let img_k = keys["img"];
    let sub_k = keys["sub"];
    let img_s = if img_k == () {
        ""
    } else {
        img_k.to_string()
    };
    let sub_s = if sub_k == () {
        ""
    } else {
        sub_k.to_string()
    };
    if img_s == "" || sub_s == "" {
        throw "无法从 nav 获取 WBI 密钥";
    }

    let all_ids = [];

    if mode == "single" {
        let parsed = parse_cv_id_from_input(cv_id_or_url);
        if parsed == "" {
            throw "单篇模式请填写：专栏 cv 数字或 read/cv 链接，或图文帖 opus 链接（含 /opus/）";
        }
        all_ids.push(#{ id: parsed, desc: "" });
    } else {
        if end_page < start_page {
            throw "结束页须大于等于起始页";
        }

        let p = start_page;
        while p <= end_page {
            let sj = fetch_search_json_509_retry(keyword, p, page_size, order, category_id, img_s, sub_s, search_api, mixin_tab);
            del_header("Referer");
            del_header("Origin");
            set_header("Referer", "https://www.bilibili.com/");
            set_header("Origin", "https://www.bilibili.com");

            if sj["code"] != 0 {
                warn_if_bilibili_risk(sj["code"]);
                warn(`搜索第 ${p} 页失败: ${sj["message"]}`);
            } else {
                let d = sj["data"];
                if d != () {
                    let page_ids = collect_article_ids(d);
                    for row in page_ids {
                        all_ids.push(row);
                    }
                }
            }
            p += 1;
        }
    }

    let n = all_ids.len();
    if n == 0 {
        warn("未找到专栏 id，请检查关键词；若遇风控或接口异常，请在爬虫任务高级设置中为请求添加 Cookie 请求头后重试。");
        add_progress(100.0);
        return;
    }

    let per_cv = 100.0 / n;
    let ai = 0;
    while ai < n {
        let row = all_ids[ai];
        let cv_s = row["id"].to_string();
        let search_desc = "";
        let sd = row["desc"];
        if sd != () {
            search_desc = sd.to_string();
        }
        process_one_cv(cv_s, img_s, sub_s, view_api, reply_api, mixin_tab, per_cv, search_desc);
        ai += 1;
    }

    add_progress(100.0);
}

run(
    "https://api.bilibili.com/x/web-interface/nav",
    "https://api.bilibili.com/x/web-interface/wbi/search/type",
    "https://api.bilibili.com/x/article/view",
    "https://api.bilibili.com/x/v2/reply/wbi/main",
    // 与 B 站前端 WBI 一致（plugins/bilibili/ignore/web-min.js 中 D() 内数组，64 项）
    [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
        27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
        37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
        22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
    ],
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
);
