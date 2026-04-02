// 小黑盒 (XHH) 综合搜索爬虫
// 流程：搜索 → 对每条帖子拉 tree → 提取 type=img 缩略图 → 请求原图 → 下载

const API_HOST = "https://api.xiaoheihe.cn";
const PATH_SEARCH = "/bbs/app/api/general/search/v1";
const PATH_TREE = "/bbs/app/link/tree";
const PATH_ORIGINAL = "/bbs/app/api/original/image";

// 公共平台参数（无签名、无 device_id）；device_id 每次任务在脚本内生成，见 items-api.md §2
const COMMON_PARAMS_BASE = "os_type=web&app=heybox&client_type=web&version=999.0.4&web_version=2.5&x_client_type=web&x_app=heybox_website&heybox_id=&x_os_type=Windows&device_info=Chrome";

// 模拟浏览器持久化的 32 位 hex device_id（与官网 nonce 同源算法，仅转为小写）；仅用已有 xhh_nonce / re_replace_all
fn xhh_fake_device_id() {
    let t0 = unix_time_ms() / 1000;
    let s = xhh_nonce(t0).to_string();
    s = re_replace_all("A", "a", s);
    s = re_replace_all("B", "b", s);
    s = re_replace_all("C", "c", s);
    s = re_replace_all("D", "d", s);
    s = re_replace_all("E", "e", s);
    s = re_replace_all("F", "f", s);
    s
}

// 构建带签名的 URL；extra 为附加 query 字符串（已编码）
fn signed_url(api_host, path, common_params, extra) {
    let t = unix_time_ms() / 1000;
    let nonce = xhh_nonce(t);
    let hkey = xhh_hkey(path, t, nonce);
    let sign = "hkey=" + hkey + "&_time=" + t.to_string() + "&nonce=" + nonce;
    api_host + path + "?" + common_params + "&" + sign + "&" + extra
}

// 从 share_url 提取 link_id query 参数
fn extract_link_id(share_url) {
    if share_url == () || share_url == "" {
        return "";
    }
    let s = share_url.to_string();
    let marker = "link_id=";
    let idx = s.index_of(marker);
    if idx < 0 {
        return "";
    }
    let start = idx + marker.len();
    let after = s.sub_string(start, s.len() - start);
    let amp = after.index_of("&");
    if amp < 0 {
        return after;
    }
    return after.sub_string(0, amp);
}

// 服务端风控/验证码（见 items-api.md：show_captcha 等）
fn xhh_is_challenge(status) {
    if status == () {
        return false;
    }
    let s = status.to_string();
    if s == "show_captcha" {
        return true;
    }
    if s == "need_verify" {
        return true;
    }
    if s.index_of("captcha") >= 0 {
        return true;
    }
    false
}

fn xhh_challenge_exit(where_msg, status_val) {
    let st = if status_val == () { "nil" } else { status_val.to_string() };
    throw where_msg + " status=" + st + "。已触发小黑盒风控/验证码，请切换网络或代理 IP 后重试。";
}

fn xhh_coerce_str(v) {
    if v == () {
        return "";
    }
    v.to_string()
}

fn xhh_strip_tags(html) {
    if html == () || html == "" {
        return "";
    }
    re_replace_all("<[^>]*>", "", html.to_string())
}

// 去掉 URL 的 query（? 及之后），原图接口 imgs 为空时用作回退
fn xhh_strip_url_query(url) {
    if url == () || url == "" {
        return "";
    }
    let s = url.to_string();
    let q = s.index_of("?");
    if q < 0 {
        return s;
    }
    s.sub_string(0, q)
}

// 去掉标题里的 [cube_菜doge] 等表情占位（与正文 [] 语法一致）；下载名/展示名无法渲染表情
fn xhh_strip_emoji_bracket_tokens(s) {
    if s == () || s == "" {
        return "";
    }
    let o = re_replace_all("\\[[a-z]+_[^\\]]*\\]", "", s.to_string());
    let o2 = re_replace_all("\\s+", " ", o);
    o2.trim();
    o2
}

fn xhh_try_html_css_pair(node) {
    if node == () || node.type_of() != "map" {
        return ();
    }
    let h = node["html"];
    if h == () {
        return ();
    }
    let hs = h.to_string();
    if hs == "" {
        return ();
    }
    let cs = "";
    if node["css"] != () {
        cs = node["css"].to_string();
    }
    return #{ html: hs, css: cs };
}

fn xhh_find_post_render(link_obj) {
    let a = xhh_try_html_css_pair(link_obj["image_text"]);
    if a != () {
        return a;
    }
    let b = xhh_try_html_css_pair(link_obj["post_body"]);
    if b != () {
        return b;
    }
    let c = xhh_try_html_css_pair(link_obj["header_render"]);
    if c != () {
        return c;
    }
    return ();
}

fn xhh_find_comments_render(tr) {
    if tr == () {
        return ();
    }
    let a = xhh_try_html_css_pair(tr["comments_block"]);
    if a != () {
        return a;
    }
    let b = xhh_try_html_css_pair(tr["comment_list"]);
    if b != () {
        return b;
    }
    return ();
}

fn xhh_author_from_link(link_obj) {
    let u = link_obj["user"];
    if u == () {
        return #{ username: "", userid: "", avatar: "", avatar_decoration: "", level: 0, fan_num: 0 };
    }
    let un = xhh_coerce_str(u["username"]);
    let uid = xhh_coerce_str(u["userid"]);
    let av = xhh_coerce_str(u["avatar"]);
    let av_deco = "";
    let ad = u["avatar_decoration"];
    if ad != () {
        av_deco = xhh_coerce_str(ad["src_url"]);
    }
    let lv = 0;
    let li = u["level_info"];
    if li != () && li["level"] != () {
        lv = li["level"];
    }
    let fans = 0;
    if u["fan_num"] != () {
        fans = u["fan_num"];
    }
    return #{ username: un, userid: uid, avatar: av, avatar_decoration: av_deco, level: lv, fan_num: fans };
}

fn xhh_topics_to_tags(link_obj) {
    let tags = [];
    let topics = link_obj["topics"];
    if topics == () || topics.type_of() != "array" {
        return tags;
    }
    for t in topics {
        if t["name"] != () {
            let n = t["name"].to_string();
            if n != "" {
                tags.push(n);
            }
        }
    }
    tags
}

// 评论快照（扁平列表，最多 max_n 条，含楼中楼回复顺序）
fn xhh_flatten_comments(tr, max_n) {
    let out = [];
    let n = 0;
    if tr == () {
        return out;
    }
    let comments = tr["comments"];
    if comments == () || comments.type_of() != "array" {
        return out;
    }
    for group in comments {
        if n >= max_n {
            break;
        }
        let arr = group["comment"];
        if arr == () || arr.type_of() != "array" {
            continue;
        }
        for c in arr {
            if n >= max_n {
                break;
            }
            let txt = xhh_coerce_str(c["text"]);
            let floor_n = 0;
            if c["floor_num"] != () {
                floor_n = c["floor_num"];
            }
            let ts = 0;
            if c["create_at"] != () {
                ts = c["create_at"];
            }
            let ip = xhh_coerce_str(c["ip_location"]);
            let un = "";
            let uid = "";
            let av = "";
            let av_deco = "";
            let lv = 0;
            let u = c["user"];
            if u != () {
                un = xhh_coerce_str(u["username"]);
                uid = xhh_coerce_str(u["userid"]);
                av = xhh_coerce_str(u["avatar"]);
                let li = u["level_info"];
                if li != () && li["level"] != () {
                    lv = li["level"];
                }
                let ad = u["avatar_decoration"];
                if ad != () {
                    av_deco = xhh_coerce_str(ad["src_url"]);
                }
            }
            let up_cnt = 0;
            if c["up"] != () {
                up_cnt = c["up"];
            }
            let rep_un = "";
            let ru = c["replyuser"];
            if ru != () {
                rep_un = xhh_coerce_str(ru["username"]);
            }
            let is_rep = c["replyid"] != ();
            let is_cy = false;
            let is_cy_v = c["is_cy"];
            if is_cy_v != () {
                if is_cy_v == true || is_cy_v == 1 {
                    is_cy = true;
                }
            }
            let imgs_arr = [];
            let raw_imgs = c["imgs"];
            if raw_imgs != () && raw_imgs.type_of() == "array" {
                for img in raw_imgs {
                    if img == () || img.type_of() != "map" {
                        continue;
                    }
                    let iurl = xhh_coerce_str(img["url"]);
                    let ithumb = xhh_coerce_str(img["thumb"]);
                    let iw = 0;
                    let ih = 0;
                    if img["width"] != () {
                        iw = img["width"];
                    }
                    if img["height"] != () {
                        ih = img["height"];
                    }
                    if iurl != "" || ithumb != "" {
                        imgs_arr.push(#{ url: iurl, thumb: ithumb, width: iw, height: ih });
                    }
                }
            }
            out.push(#{
                text: txt,
                floor_num: floor_n,
                create_at: ts,
                ip_location: ip,
                username: un,
                userid: uid,
                avatar: av,
                avatar_decoration: av_deco,
                level: lv,
                up: up_cnt,
                reply_to_username: rep_un,
                is_reply: is_rep,
                is_cy: is_cy,
                imgs: imgs_arr
            });
            n += 1;
        }
    }
    out
}

// 爬取单个帖子（通过 link_id）；item_weight 为进度权重（单帖调用时传 100.0）
// 注意：Rhai 函数体内不能读取脚本顶层 const / 注入变量，路径与开关须由调用方传入
fn xhh_crawl_post(link_id, item_weight, COMMON_PARAMS, api_host, path_tree, path_original, fetch_comment_images) {
    let tree_extra = "link_id=" + url_encode(link_id) + "&is_first=1&page=1&index=1&limit=20&owner_only=0";
    let tree_url = signed_url(api_host, path_tree, COMMON_PARAMS, tree_extra);
    let tree = fetch_json(tree_url);

    if xhh_is_challenge(tree["status"]) {
        xhh_challenge_exit("帖子树接口", tree["status"]);
    }

    if tree["status"] != "ok" {
        warn("tree 请求失败 link_id=" + link_id + " status=" + tree["status"].to_string());
        add_progress(item_weight);
        return;
    }

    let tr = tree["result"];
    let link_obj = tr["link"];
    if link_obj == () {
        warn("tree 无 result.link link_id=" + link_id);
        add_progress(item_weight);
        return;
    }

    let text_str = link_obj["text"];
    if text_str == () || text_str == "" {
        warn("帖子正文为空 link_id=" + link_id);
        add_progress(item_weight);
        return;
    }

    let wrapper = parse_json("{\"arr\":" + text_str.to_string() + "}");
    if wrapper == () {
        warn("解析帖子正文 JSON 失败 link_id=" + link_id);
        add_progress(item_weight);
        return;
    }

    let blocks = wrapper["arr"];
    if blocks == () {
        warn("帖子正文 JSON 无 arr/blocks link_id=" + link_id + "，跳过下载");
        add_progress(item_weight);
        return;
    }

    let title_html = "";
    let info_title = link_obj["title"];
    if info_title != () {
        title_html = info_title.to_string();
    }
    let title_plain = xhh_strip_tags(title_html);
    title_plain.trim();
    let display_name = xhh_strip_emoji_bracket_tokens(title_plain);
    if display_name == () || display_name == "" {
        let desc_html = "";
        if link_obj["description"] != () {
            desc_html = link_obj["description"].to_string();
        }
        if desc_html == "" && link_obj["desc"] != () {
            desc_html = link_obj["desc"].to_string();
        }
        let desc_plain = xhh_strip_tags(desc_html);
        desc_plain.trim();
        if desc_plain != () && desc_plain != "" {
            display_name = xhh_strip_emoji_bracket_tokens(desc_plain);
            if display_name == () || display_name == "" {
                display_name = "xhh_" + link_id;
            }
        } else {
            display_name = "xhh_" + link_id;
        }
    }
    print(`[调试] link_id=${link_id} title_html="${title_html}" display_name="${display_name}"`);

    let author = xhh_author_from_link(link_obj);
    let tags_arr = xhh_topics_to_tags(link_obj);
    let comments_snap = xhh_flatten_comments(tr, 120);
    let post_render = xhh_find_post_render(link_obj);
    let comm_render = xhh_find_comments_render(tr);
    let pr_html = "";
    let pr_css = "";
    if post_render != () {
        pr_html = post_render["html"];
        pr_css = post_render["css"];
    }
    let cr_html = "";
    let cr_css = "";
    if comm_render != () {
        cr_html = comm_render["html"];
        cr_css = comm_render["css"];
    }
    let share_u = xhh_coerce_str(link_obj["share_url"]);
    let post_ca = 0;
    if link_obj["create_at"] != () {
        post_ca = link_obj["create_at"];
    }
    let post_ip = xhh_coerce_str(link_obj["ip_location"]);

    let thumb_strs = [];
    let description_plain = "";
    for block in blocks {
        if block["type"] == "text" && description_plain == "" {
            let bt = block["text"];
            if bt != () && bt != "" {
                let raw = bt.to_string();
                let stripped = xhh_strip_tags(raw);
                stripped.trim();
                description_plain = xhh_strip_emoji_bracket_tokens(stripped);
            }
        }
        if block["type"] != "img" {
            continue;
        }
        let thumb = block["url"];
        if thumb == () || thumb == "" {
            continue;
        }
        thumb_strs.push(thumb.to_string());
    }

    let K = thumb_strs.len();
    if K == 0 {
        warn("已解析正文但未找到 type=img 配图缩略图 link_id=" + link_id + " display_name=" + display_name + "，跳过下载");
        add_progress(item_weight);
        return;
    }

    let delta_per_image = item_weight / K.to_float();

    let post_meta_id = create_image_metadata(#{
        link_id: link_id,
        share_url: share_u,
        description: description_plain,
        title_html: title_html,
        title_plain: title_plain,
        link_title: xhh_coerce_str(link_obj["title"]),
        author: author,
        tags: tags_arr,
        comments_snapshot: comments_snap,
        comments_max: 120,
        post_create_at: post_ca,
        post_ip: post_ip,
        post_render_html: pr_html,
        post_render_css: pr_css,
        comments_render_html: cr_html,
        comments_render_css: cr_css,
        image_total: K
    });

    let k = 1;
    while k <= K {
        let thumb_str = thumb_strs[k - 1];
        let orig_extra = "url=" + url_encode(thumb_str);
        let orig_url = signed_url(api_host, path_original, COMMON_PARAMS, orig_extra);
        let orig = fetch_json(orig_url);

        if xhh_is_challenge(orig["status"]) {
            xhh_challenge_exit("原图接口", orig["status"]);
        }

        if orig["status"] == "ok" {
            let imgs = orig["result"]["imgs"];
            let final_url = "";
            if imgs != () && imgs != "" {
                if imgs.type_of() == "string" {
                    final_url = imgs.to_string();
                } else if imgs.len() > 0 {
                    final_url = imgs[0].to_string();
                }
            }
            if final_url == "" || !re_is_match("^https?://", final_url) {
                let fb = xhh_strip_url_query(thumb_str);
                if fb != "" && re_is_match("^https?://", fb) {
                    final_url = fb;
                }
            }
            if final_url != "" && re_is_match("^https?://", final_url) {
                let image_display_name = display_name;
                if K > 1 {
                    image_display_name = display_name + "(" + k.to_string() + ")";
                }
                download_image(final_url, #{
                    name: image_display_name,
                    metadata_id: post_meta_id
                });
            } else {
                warn("原图 URL 无效且无可用回退 link_id=" + link_id + " k=" + k.to_string());
            }
        } else {
            warn("original/image 失败 link_id=" + link_id + " status=" + orig["status"].to_string());
        }
        add_progress(delta_per_image);
        k += 1;

        sleep(rand_f64(8.0, 14.0));
    }

    if fetch_comment_images {
        for cmt in comments_snap {
            let cmt_imgs = cmt["imgs"];
            if cmt_imgs == () || cmt_imgs.type_of() != "array" {
                continue;
            }
            let n_imgs = cmt_imgs.len();
            if n_imgs == 0 {
                continue;
            }
            let ci_idx = 0;
            for cimg in cmt_imgs {
                ci_idx += 1;
                if cimg == () || cimg.type_of() != "map" {
                    continue;
                }
                let thumb_u = xhh_coerce_str(cimg["thumb"]);
                let url_u = xhh_coerce_str(cimg["url"]);
                let input_url = if thumb_u != "" { thumb_u } else { url_u };
                if input_url == "" || !re_is_match("^https?://", input_url) {
                    continue;
                }

                let orig_extra = "url=" + url_encode(input_url);
                let orig_url = signed_url(api_host, path_original, COMMON_PARAMS, orig_extra);
                let orig = fetch_json(orig_url);

                if xhh_is_challenge(orig["status"]) {
                    xhh_challenge_exit("原图接口(评论图)", orig["status"]);
                }

                if orig["status"] == "ok" {
                    let imgs = orig["result"]["imgs"];
                    let final_url = "";
                    if imgs != () && imgs != "" {
                        if imgs.type_of() == "string" {
                            final_url = imgs.to_string();
                        } else if imgs.len() > 0 {
                            final_url = imgs[0].to_string();
                        }
                    }
                    if final_url == "" || !re_is_match("^https?://", final_url) {
                        let fb = xhh_strip_url_query(input_url);
                        if fb != "" && re_is_match("^https?://", fb) {
                            final_url = fb;
                        }
                    }
                    if final_url != "" && re_is_match("^https?://", final_url) {
                        let floor_s = cmt["floor_num"].to_string();
                        let base_cname = display_name + "[comment_" + floor_s + "]";
                        let cname = if n_imgs > 1 {
                            base_cname + "(" + ci_idx.to_string() + ")"
                        } else {
                            base_cname
                        };
                        download_image(final_url, #{
                            name: cname,
                            metadata_id: post_meta_id
                        });
                    } else {
                        warn("原图 URL 无效且无可用回退(评论图) link_id=" + link_id + " floor=" + cmt["floor_num"].to_string());
                    }
                } else {
                    warn("original/image 失败(评论图) link_id=" + link_id + " status=" + orig["status"].to_string());
                }
                sleep(rand_f64(8.0, 14.0));
            }
        }
    }
}

// 设置请求头
set_header("Accept", "application/json, text/plain, */*");
set_header("Accept-Encoding", "gzip, deflate, br, zstd");
set_header("Accept-Language", "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7");
set_header("Cache-Control", "no-cache");
set_header("Origin", "https://www.xiaoheihe.cn");
set_header("Pragma", "no-cache");
set_header("Referer", "https://www.xiaoheihe.cn/");
set_header("Sec-Fetch-Dest", "empty");
set_header("Sec-Fetch-Mode", "cors");
set_header("Sec-Fetch-Site", "same-site");
set_header("sec-ch-ua", "\"Chromium\";v=\"146\", \"Google Chrome\";v=\"146\", \"Not/A)Brand\";v=\"99\"");
set_header("sec-ch-ua-mobile", "?0");
set_header("sec-ch-ua-platform", "\"Windows\"");
set_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
set_header("x-client-type", "web");
set_header("x-app", "heybox_website");
set_header("x-os-type", "Windows");
set_header("device-info", "Chrome");

let COMMON_PARAMS = COMMON_PARAMS_BASE + "&device_id=" + xhh_fake_device_id();

// ── 单帖子模式 ────────────────────────────────────────────────────────────────
if crawl_mode == "single_post" {
    let input_url = if post_share_url == () { "" } else { post_share_url.to_string() };
    if input_url == "" {
        throw "单帖子模式：请填写帖子分享 URL";
    }
    let link_id = extract_link_id(input_url);
    if link_id == "" {
        throw "无法从 URL 中提取 link_id，请确认这是小黑盒帖子分享链接";
    }
    print(`[小黑盒] 单帖子模式：link_id=${link_id}`);
    xhh_crawl_post(link_id, 100.0, COMMON_PARAMS, API_HOST, PATH_TREE, PATH_ORIGINAL, fetch_comment_images);
    print("[小黑盒] 任务结束");
    return;
}

// ── 搜索模式 ──────────────────────────────────────────────────────────────────
if end_page < start_page {
    throw "结束页须大于或等于起始页";
}
if start_page < 1 {
    throw "起始页须至少为 1";
}
if page_size < 1 {
    throw "每页条数须至少为 1";
}

let total_pages = end_page - start_page + 1;
let page_weight = 100.0 / total_pages.to_float();

print(`[小黑盒] 开始：关键词「${search_keyword}」，第 ${start_page}～${end_page} 页，每页 ${page_size} 条`);

let page = start_page;
while page <= end_page {
    let offset = (page - 1) * page_size;
    let extra = "q=" + url_encode(search_keyword) + "&search_type=general&offset=" + offset.to_string() + "&limit=" + page_size.to_string();
    let search_url = signed_url(API_HOST, PATH_SEARCH, COMMON_PARAMS, extra);
    let resp = fetch_json(search_url);

    if xhh_is_challenge(resp["status"]) {
        xhh_challenge_exit("搜索接口", resp["status"]);
    }

    if resp["status"] != "ok" {
        warn("搜索请求失败: " + resp["status"].to_string());
        break;
    }

    let items = resp["result"]["items"];
    if items == () || items.len() == 0 {
        warn("第 " + page.to_string() + " 页无搜索结果");
        add_progress(page_weight);
        page += 1;
        sleep(rand_f64(0.8, 2.0));
        continue;
    }

    // 过滤掉无法解析出 link_id 的条目（非帖子类型等），仅对有效条目报告数量
    let valid_items = [];
    for raw_item in items {
        let ri = raw_item["info"];
        if ri == () { continue; }
        let lid = extract_link_id(ri["share_url"]);
        if lid == "" {
            let fallback = ri["linkid"];
            if fallback != () { lid = fallback.to_string(); }
        }
        if lid != "" { valid_items.push(raw_item); }
    }

    let M = valid_items.len();
    if M == 0 {
        warn("第 " + page.to_string() + " 页无含 link_id 的有效帖子");
        add_progress(page_weight);
        page += 1;
        sleep(rand_f64(0.8, 2.0));
        continue;
    }

    let item_weight = page_weight / M.to_float();
    print("第 " + page.to_string() + "/" + end_page.to_string() + " 页：共 " + M.to_string() + " 条有效帖子，开始解析");

    let j = 0;
    while j < M {
        let item = valid_items[j];
        let info = item["info"];
        let share_url = info["share_url"];
        let link_id = extract_link_id(share_url);
        if link_id == "" {
            let lid = info["linkid"];
            if lid != () { link_id = lid.to_string(); }
        }
        xhh_crawl_post(link_id, item_weight, COMMON_PARAMS, API_HOST, PATH_TREE, PATH_ORIGINAL, fetch_comment_images);
        j += 1;
    }

    print("第 " + page.to_string() + " 页处理完成");
    page += 1;
    sleep(rand_f64(8.0, 14.0));
}

print("[小黑盒] 任务结束");
