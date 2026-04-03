// 米游社爬虫
// 搜索接口使用 last_id 游标翻页；帖子图片直接从 post.images[] 取原图 URL 下载

let API_SEARCH    = "https://bbs-api.miyoushe.com/painter/wapi/searchPosts";
let API_USER_POSTS = "https://bbs-api.miyoushe.com/painter/wapi/userPostList";
let API_POST_FULL = "https://bbs-api.miyoushe.com/post/wapi/getPostFull";
let API_REPLIES   = "https://bbs-api.miyoushe.com/post/wapi/getPostReplies";
let API_EMOTICONS = "https://bbs-api-static.miyoushe.com/misc/api/emoticon_set";

fn mys_coerce_str(v) {
    if v == () { return ""; }
    v.to_string()
}

fn mys_build_search_url(api_search, keyword, size, last_id, gids) {
    let url = api_search + "?keyword=" + url_encode(keyword) + "&size=" + size.to_string();
    if last_id != "" {
        url += "&last_id=" + url_encode(last_id);
    }
    if gids != "" {
        url += "&gids=" + url_encode(gids);
    }
    url
}

fn mys_build_user_posts_url(api, uid, size, offset) {
    let url = api + "?uid=" + url_encode(uid) + "&size=" + size.to_string();
    if offset != "" {
        url += "&offset=" + url_encode(offset);
    }
    url
}

fn mys_build_replies_url(api_replies, post_id, size, last_id) {
    let url = api_replies + "?post_id=" + url_encode(post_id)
        + "&size=" + size.to_string()
        + "&order_type=1&is_hot=false";
    if last_id != "" {
        url += "&last_id=" + url_encode(last_id);
    }
    url
}

fn mys_collect_emoticon_names_from_text(text, used_names) {
    if text == () { return; }
    let s = mys_coerce_str(text);
    if s == "" { return; }
    let cursor = 0;
    while cursor < s.len() {
        let rem = s.sub_string(cursor, s.len() - cursor);
        if rem == () { break; }
        let idx = rem.index_of("_(");
        if idx < 0 { break; }
        let start = cursor + idx + 2;
        if start >= s.len() { break; }
        let rem2 = s.sub_string(start, s.len() - start);
        if rem2 == () { break; }
        let end_rel = rem2.index_of(")");
        if end_rel < 0 { break; }
        let raw_name = rem2.sub_string(0, end_rel);
        let name = mys_coerce_str(raw_name);
        name.trim();
        if name != "" {
            used_names[name] = true;
        }
        cursor = start + end_rel + 1;
    }
}

// 从 user 对象提取简要信息
fn mys_user_info(u) {
    if u == () {
        return #{ uid: "", nickname: "", avatar_url: "", level: 0, certification_label: "" };
    }
    let uid = mys_coerce_str(u["uid"]);
    let nickname = mys_coerce_str(u["nickname"]);
    let avatar_url = mys_coerce_str(u["avatar_url"]);
    let level = 0;
    let le = u["level_exp"];
    if le != () && le["level"] != () {
        level = le["level"];
    }
    let cert_label = "";
    let cert = u["certification"];
    if cert != () {
        let ct = cert["type"];
        if ct != () && ct != 0 {
            cert_label = mys_coerce_str(cert["label"]);
        }
    }
    let pendant = mys_coerce_str(u["pendant"]);
    let ip_region = mys_coerce_str(u["ip_region"]);
    let is_super_fan = u["is_super_fan"] == true;
    return #{
        uid: uid,
        nickname: nickname,
        avatar_url: avatar_url,
        level: level,
        certification_label: cert_label,
        pendant: pendant,
        ip_region: ip_region,
        is_super_fan: is_super_fan
    };
}

// 一次性拉取全站表情集合，返回 name→icon_url 的 map（仅 published + is_available 条目）
fn mys_build_emoticon_map(api_emoticons) {
    let map = #{};
    let resp = fetch_json(api_emoticons);
    if resp["retcode"] != 0 {
        warn("emoticon_set 请求失败 retcode=" + resp["retcode"].to_string());
        return map;
    }
    let data = resp["data"];
    if data == () { return map; }
    let groups = data["list"];
    if groups == () || groups.type_of() != "array" { return map; }
    for group in groups {
        if group["is_available"] != true { continue; }
        let items = group["list"];
        if items == () || items.type_of() != "array" { continue; }
        for item in items {
            if item["is_available"] != true { continue; }
            let n = item["name"];
            let ic = item["icon"];
            if n == () || ic == () { continue; }
            let ns = n.to_string();
            let ics = ic.to_string();
            if ns != "" && ics != "" {
                map[ns] = ics;
            }
        }
    }
    map
}

fn mys_pick_required_emoticons(all_emoticon_map, post_subject, post_content) {
    let used_names = #{};
    mys_collect_emoticon_names_from_text(post_subject, used_names);
    mys_collect_emoticon_names_from_text(post_content, used_names);

    let picked = #{};
    for n in used_names.keys() {
        let url = all_emoticon_map[n];
        if url != () {
            picked[n] = url;
        }
    }
    picked
}

// 收集评论（含 struct_content）以及评论图片 URL
// 返回 #{ replies: [...], images: [...] }
fn mys_collect_replies(api_replies, post_id, reply_max_pages, reply_size) {
    let replies = [];
    let images = [];
    let last_id = "";
    let page = 0;
    while page < reply_max_pages {
        let url = mys_build_replies_url(api_replies, post_id, reply_size, last_id);
        let resp = fetch_json(url);
        if resp["retcode"] != 0 {
            warn("getPostReplies 失败 post_id=" + post_id
                + " retcode=" + resp["retcode"].to_string());
            break;
        }
        let data = resp["data"];
        if data == () { break; }
        let list = data["list"];
        if list == () || list.type_of() != "array" || list.len() == 0 { break; }

        for item in list {
            let reply = item["reply"];
            if reply == () { continue; }

            let user_info = mys_user_info(item["user"]);
            let floor_id = 0;
            if reply["floor_id"] != () { floor_id = reply["floor_id"]; }
            let created_at = 0;
            if reply["created_at"] != () { created_at = reply["created_at"]; }
            let struct_content = mys_coerce_str(reply["struct_content"]);

            // 主楼层图片
            let like_num = 0;
            let stat = item["stat"];
            if stat != () && stat["like_num"] != () { like_num = stat["like_num"]; }

            let reply_img_urls = [];
            let reply_imgs = item["images"];
            if reply_imgs != () && reply_imgs.type_of() == "array" {
                for img_obj in reply_imgs {
                    let s = if img_obj.type_of() == "map" {
                        mys_coerce_str(img_obj["url"])
                    } else {
                        mys_coerce_str(img_obj)
                    };
                    if s != "" {
                        reply_img_urls.push(s);
                        images.push(s);
                    }
                }
            }

            replies.push(#{
                uid: user_info["uid"],
                nickname: user_info["nickname"],
                avatar_url: user_info["avatar_url"],
                level: user_info["level"],
                certification_label: user_info["certification_label"],
                pendant: user_info["pendant"],
                ip_region: user_info["ip_region"],
                is_super_fan: user_info["is_super_fan"],
                floor_id: floor_id,
                created_at: created_at,
                struct_content: struct_content,
                like_num: like_num,
                images: reply_img_urls
            });

            // 楼中楼（sub_replies）
            let subs = item["sub_replies"];
            if subs != () && subs.type_of() == "array" {
                for sub in subs {
                    let sub_reply = sub["reply"];
                    if sub_reply == () { continue; }
                    let sub_user_info = mys_user_info(sub["user"]);
                    let sub_floor_id = 0;
                    if sub_reply["floor_id"] != () { sub_floor_id = sub_reply["floor_id"]; }
                    let sub_created_at = 0;
                    if sub_reply["created_at"] != () { sub_created_at = sub_reply["created_at"]; }
                    let sub_struct = mys_coerce_str(sub_reply["struct_content"]);

                    let sub_img_urls = [];
                    let sub_imgs = sub["images"];
                    if sub_imgs != () && sub_imgs.type_of() == "array" {
                        for img_obj in sub_imgs {
                            let s = if img_obj.type_of() == "map" {
                                mys_coerce_str(img_obj["url"])
                            } else {
                                mys_coerce_str(img_obj)
                            };
                            if s != "" {
                                sub_img_urls.push(s);
                                images.push(s);
                            }
                        }
                    }

                    let sub_like_num = 0;
                    let sub_stat = sub["stat"];
                    if sub_stat != () && sub_stat["like_num"] != () { sub_like_num = sub_stat["like_num"]; }

                    replies.push(#{
                        uid: sub_user_info["uid"],
                        nickname: sub_user_info["nickname"],
                        avatar_url: sub_user_info["avatar_url"],
                        level: sub_user_info["level"],
                        certification_label: sub_user_info["certification_label"],
                        pendant: sub_user_info["pendant"],
                        ip_region: sub_user_info["ip_region"],
                        is_super_fan: sub_user_info["is_super_fan"],
                        floor_id: sub_floor_id,
                        created_at: sub_created_at,
                        struct_content: sub_struct,
                        like_num: sub_like_num,
                        images: sub_img_urls,
                        is_sub: true
                    });
                }
            }
        }

        let new_last_id = mys_coerce_str(data["last_id"]);
        let is_last = data["is_last"];
        if is_last == true || new_last_id == "" || new_last_id == last_id {
            break;
        }
        last_id = new_last_id;
        page += 1;
    }
    return #{ replies: replies, images: images };
}

// 持续拉取评论直到达到上限或无下一页，默认用于评论图片统计/下载（不入元数据）
fn mys_collect_replies_until_limit(api_replies, post_id, reply_limit) {
    let replies = [];
    let images = [];
    let last_id = "";
    let total = 0;
    let reply_page_size = 20;

    while total < reply_limit {
        let size = reply_page_size;
        let left = reply_limit - total;
        if size > left { size = left; }
        if size <= 0 { break; }

        let url = mys_build_replies_url(api_replies, post_id, size, last_id);
        let resp = fetch_json(url);
        if resp["retcode"] != 0 {
            warn("getPostReplies 失败 post_id=" + post_id
                + " retcode=" + resp["retcode"].to_string());
            break;
        }
        let data = resp["data"];
        if data == () { break; }
        let list = data["list"];
        if list == () || list.type_of() != "array" || list.len() == 0 { break; }

        for item in list {
            if total >= reply_limit { break; }
            let reply = item["reply"];
            if reply == () { continue; }

            let user_info = mys_user_info(item["user"]);
            let floor_id = 0;
            if reply["floor_id"] != () { floor_id = reply["floor_id"]; }
            let created_at = 0;
            if reply["created_at"] != () { created_at = reply["created_at"]; }
            let struct_content = mys_coerce_str(reply["struct_content"]);

            let like_num = 0;
            let stat = item["stat"];
            if stat != () && stat["like_num"] != () { like_num = stat["like_num"]; }

            let reply_img_urls = [];
            let reply_imgs = item["images"];
            if reply_imgs != () && reply_imgs.type_of() == "array" {
                for img_obj in reply_imgs {
                    let s = if img_obj.type_of() == "map" {
                        mys_coerce_str(img_obj["url"])
                    } else {
                        mys_coerce_str(img_obj)
                    };
                    if s != "" {
                        reply_img_urls.push(s);
                        images.push(s);
                    }
                }
            }

            replies.push(#{
                uid: user_info["uid"],
                nickname: user_info["nickname"],
                avatar_url: user_info["avatar_url"],
                level: user_info["level"],
                certification_label: user_info["certification_label"],
                pendant: user_info["pendant"],
                ip_region: user_info["ip_region"],
                is_super_fan: user_info["is_super_fan"],
                floor_id: floor_id,
                created_at: created_at,
                struct_content: struct_content,
                like_num: like_num,
                images: reply_img_urls
            });
            total += 1;

            if total >= reply_limit { break; }

            let subs = item["sub_replies"];
            if subs != () && subs.type_of() == "array" {
                for sub in subs {
                    if total >= reply_limit { break; }
                    let sub_reply = sub["reply"];
                    if sub_reply == () { continue; }
                    let sub_user_info = mys_user_info(sub["user"]);
                    let sub_floor_id = 0;
                    if sub_reply["floor_id"] != () { sub_floor_id = sub_reply["floor_id"]; }
                    let sub_created_at = 0;
                    if sub_reply["created_at"] != () { sub_created_at = sub_reply["created_at"]; }
                    let sub_struct = mys_coerce_str(sub_reply["struct_content"]);

                    let sub_img_urls = [];
                    let sub_imgs = sub["images"];
                    if sub_imgs != () && sub_imgs.type_of() == "array" {
                        for img_obj in sub_imgs {
                            let s = if img_obj.type_of() == "map" {
                                mys_coerce_str(img_obj["url"])
                            } else {
                                mys_coerce_str(img_obj)
                            };
                            if s != "" {
                                sub_img_urls.push(s);
                                images.push(s);
                            }
                        }
                    }

                    let sub_like_num = 0;
                    let sub_stat = sub["stat"];
                    if sub_stat != () && sub_stat["like_num"] != () { sub_like_num = sub_stat["like_num"]; }

                    replies.push(#{
                        uid: sub_user_info["uid"],
                        nickname: sub_user_info["nickname"],
                        avatar_url: sub_user_info["avatar_url"],
                        level: sub_user_info["level"],
                        certification_label: sub_user_info["certification_label"],
                        pendant: sub_user_info["pendant"],
                        ip_region: sub_user_info["ip_region"],
                        is_super_fan: sub_user_info["is_super_fan"],
                        floor_id: sub_floor_id,
                        created_at: sub_created_at,
                        struct_content: sub_struct,
                        like_num: sub_like_num,
                        images: sub_img_urls,
                        is_sub: true
                    });
                    total += 1;
                }
            }
        }

        let new_last_id = mys_coerce_str(data["last_id"]);
        let is_last = data["is_last"];
        if is_last == true || new_last_id == "" || new_last_id == last_id {
            break;
        }
        last_id = new_last_id;
    }
    return #{ replies: replies, images: images };
}

// 从米游社帖子 URL 中提取 post_id
// 支持格式：https://www.miyoushe.com/{slug}/article/{id}[?...]
fn mys_extract_post_id(url) {
    if url == () || url == "" { return ""; }
    let s = url.to_string();
    // 去掉 query/fragment
    let q = s.index_of("?");
    if q >= 0 { s = s.sub_string(0, q); }
    let h = s.index_of("#");
    if h >= 0 { s = s.sub_string(0, h); }
    // 末尾去斜杠
    while s.ends_with("/") { s = s.sub_string(0, s.len() - 1); }
    // 找 /article/
    let marker = "/article/";
    let idx = s.index_of(marker);
    if idx < 0 { return ""; }
    let after = s.sub_string(idx + marker.len(), s.len() - idx - marker.len());
    let slash = after.index_of("/");
    if slash >= 0 { after = after.sub_string(0, slash); }
    after.trim();
    after
}

// 爬取单个帖子（post_id 已知），进度权重 100.0
fn mys_crawl_post(api_post_full, api_replies, api_emoticons, post_id, reply_limit, fetch_comment_images) {
    let url = api_post_full + "?post_id=" + url_encode(post_id);
    let resp = fetch_json(url);
    if resp["retcode"] != 0 {
        throw "getPostFull 失败 post_id=" + post_id
            + " retcode=" + resp["retcode"].to_string()
            + " " + mys_coerce_str(resp["message"]);
    }
    let data = resp["data"];
    if data == () { throw "getPostFull 响应无 data，post_id=" + post_id; }
    let post_wrap = data["post"];
    if post_wrap == () { throw "getPostFull 响应无 data.post，post_id=" + post_id; }

    let post = post_wrap["post"];
    if post == () { throw "getPostFull 响应无 data.post.post，post_id=" + post_id; }

    let images = post["images"];
    if images == () || images.type_of() != "array" || images.len() == 0 {
        throw "帖子无图片 post_id=" + post_id;
    }

    let subject = mys_coerce_str(post["subject"]);
    if subject == "" { subject = "mys_" + post_id; }
    let game_id = 0;
    if post["game_id"] != () { game_id = post["game_id"]; }
    let created_at = 0;
    if post["created_at"] != () { created_at = post["created_at"]; }
    let post_content = mys_coerce_str(post["content"]);
    let post_structured_content = mys_coerce_str(post["structured_content"]);

    let view_num = 0; let reply_num = 0; let like_num = 0;
    let bookmark_num = 0; let forward_num = 0;
    let stat = post_wrap["stat"];
    if stat != () {
        if stat["view_num"]     != () { view_num     = stat["view_num"]; }
        if stat["reply_num"]    != () { reply_num    = stat["reply_num"]; }
        if stat["like_num"]     != () { like_num     = stat["like_num"]; }
        if stat["bookmark_num"] != () { bookmark_num = stat["bookmark_num"]; }
        if stat["forward_num"]  != () { forward_num  = stat["forward_num"]; }
    }

    let user_info = mys_user_info(post_wrap["user"]);

    print("[米游社] 拉取表情集合...");
    let all_emoticon_map = mys_build_emoticon_map(api_emoticons);
    let emoticon_map = mys_pick_required_emoticons(all_emoticon_map, subject, post_content);
    print("[米游社] 表情集合加载完成，正文必要表情 " + emoticon_map.keys().len().to_string() + " 个");

    let replies_data = mys_collect_replies_until_limit(api_replies, post_id, reply_limit);

    let K = images.len();
    let reply_img_list = replies_data["images"];
    let total_imgs = K + (if fetch_comment_images { reply_img_list.len() } else { 0 });
    let img_weight = if total_imgs > 0 { 100.0 / total_imgs.to_float() } else { 0.0 };

    let post_meta_id = create_image_metadata(#{
        post_id: post_id,
        title: subject,
        game_id: game_id,
        created_at: created_at,
        uid: user_info["uid"],
        nickname: user_info["nickname"],
        avatar_url: user_info["avatar_url"],
        level: user_info["level"],
        certification_label: user_info["certification_label"],
        pendant: user_info["pendant"],
        ip_region: user_info["ip_region"],
        is_super_fan: user_info["is_super_fan"],
        post_image_total: K,
        comment_image_total: reply_img_list.len(),
        total_image_count: K + reply_img_list.len(),
        post_content: post_content,
        post_structured_content: post_structured_content,
        view_num: view_num,
        reply_num: reply_num,
        like_num: like_num,
        bookmark_num: bookmark_num,
        forward_num: forward_num,
        post_snapshot: post,
        emoticon_map: emoticon_map
    });

    if total_imgs == 0 {
        add_progress(100.0);
        return;
    }

    // 下载正文图片
    let k = 0;
    while k < K {
        let img_url = mys_coerce_str(images[k]);
        if img_url != "" && re_is_match("^https?://", img_url) {
            let name = if K > 1 { subject + "(" + (k + 1).to_string() + ")" } else { subject };
            download_image(img_url, #{ name: name, metadata_id: post_meta_id });
        } else {
            warn("正文图片 URL 无效，跳过：post_id=" + post_id + " idx=" + k.to_string());
        }
        add_progress(img_weight);
        k += 1;
    }

    // 下载评论图片
    if fetch_comment_images {
        let ri_idx = 0;
        for rimg_url in reply_img_list {
            ri_idx += 1;
            if rimg_url != "" && re_is_match("^https?://", rimg_url) {
                let rname = subject + "[评论" + ri_idx.to_string() + "]";
                download_image(rimg_url, #{ name: rname, metadata_id: post_meta_id });
            } else {
                warn("评论图片 URL 无效，跳过：post_id=" + post_id + " idx=" + ri_idx.to_string());
            }
            add_progress(img_weight);
        }
    }
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

set_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
set_header("Referer", "https://www.miyoushe.com/");

// ── 单帖子模式 ────────────────────────────────────────────────────────────────
if crawl_mode == "single_post" {
    let input_url = if post_url == () { "" } else { post_url.to_string() };
    input_url.trim();
    if input_url == "" {
        throw "单帖子模式：请填写帖子 URL";
    }
    let post_id = mys_extract_post_id(input_url);
    if post_id == "" {
        throw "无法从 URL 中提取帖子 ID，请确认格式为 https://www.miyoushe.com/{游戏}/article/{id}";
    }
    print(`[米游社] 单帖子模式：post_id=${post_id}`);
    mys_crawl_post(API_POST_FULL, API_REPLIES, API_EMOTICONS, post_id, max_comments, fetch_comment_images);
    print("[米游社] 任务结束");
    return;
}

// ── 作者帖子列表模式 ────────────────────────────────────────────────────────────
if crawl_mode == "user_posts" {
    let uid_str = if user_uid == () { "" } else { user_uid.to_string() };
    uid_str.trim();
    if uid_str == "" { throw "作者帖子模式：请填写作者 UID"; }
    if end_page < start_page { throw "结束页须大于或等于起始页"; }
    if start_page < 1 { throw "起始页须至少为 1"; }
    if page_size < 1 { throw "每页条数须至少为 1"; }

    print("[米游社] 拉取表情集合...");
    let emoticon_map = mys_build_emoticon_map(API_EMOTICONS);
    print("[米游社] 表情集合加载完成");

    print(`[米游社] 作者 UID=${uid_str} 帖子列表，第 ${start_page}～${end_page} 页，每页 ${page_size} 条`);

    // 快进 offset 到 start_page
    let offset = "";
    let cur_page = 1;
    while cur_page < start_page {
        let skip_url = mys_build_user_posts_url(API_USER_POSTS, uid_str, page_size, offset);
        let skip_resp = fetch_json(skip_url);
        if skip_resp["retcode"] != 0 { break; }
        let skip_data = skip_resp["data"];
        if skip_data == () { break; }
        let new_off = mys_coerce_str(skip_data["next_offset"]);
        if new_off == "" || skip_data["is_last"] == true { break; }
        offset = new_off;
        cur_page += 1;
    }

    let total_pages = end_page - start_page + 1;
    let page_weight = 100.0 / total_pages.to_float();

    let page = start_page;
    let total_posts = 0;

    while page <= end_page {
        let url = mys_build_user_posts_url(API_USER_POSTS, uid_str, page_size, offset);
        let resp = fetch_json(url);
        if resp["retcode"] != 0 {
            warn("userPostList 失败 uid=" + uid_str
                + " retcode=" + resp["retcode"].to_string()
                + " " + mys_coerce_str(resp["message"]));
            break;
        }
        let data = resp["data"];
        if data == () { break; }
        let list = data["list"];
        if list == () || list.type_of() != "array" || list.len() == 0 {
            warn("第 " + page.to_string() + " 页无结果，停止");
            add_progress(page_weight);
            break;
        }

        // 仅保留含图片的帖子
        let valid_posts = [];
        for item in list {
            let post = item["post"];
            if post == () { continue; }
            let images = post["images"];
            if images == () || images.type_of() != "array" || images.len() == 0 { continue; }
            valid_posts.push(item);
        }

        let M = valid_posts.len();
        print("第 " + page.to_string() + "/" + end_page.to_string() + " 页：" + M.to_string()
            + " 条含图帖子（共 " + list.len().to_string() + " 条）");

        if M > 0 {
            let post_weight = page_weight / M.to_float();
            for item in valid_posts {
            let post = item["post"];
            let post_id = mys_coerce_str(post["post_id"]);
            let subject = mys_coerce_str(post["subject"]);
            if subject == "" { subject = "mys_" + post_id; }

            let game_id = 0;
            if post["game_id"] != () { game_id = post["game_id"]; }
            let created_at = 0;
            if post["created_at"] != () { created_at = post["created_at"]; }
            let post_content = mys_coerce_str(post["content"]);
            let post_structured_content = mys_coerce_str(post["structured_content"]);

            let view_num = 0; let reply_num = 0; let like_num = 0;
            let bookmark_num = 0; let forward_num = 0;
            let stat = item["stat"];
            if stat != () {
                if stat["view_num"]     != () { view_num     = stat["view_num"]; }
                if stat["reply_num"]    != () { reply_num    = stat["reply_num"]; }
                if stat["like_num"]     != () { like_num     = stat["like_num"]; }
                if stat["bookmark_num"] != () { bookmark_num = stat["bookmark_num"]; }
                if stat["forward_num"]  != () { forward_num  = stat["forward_num"]; }
            }

            let user_info = mys_user_info(item["user"]);

            let post_images = post["images"];
            let K = post_images.len();

            let replies_data = mys_collect_replies_until_limit(API_REPLIES, post_id, max_comments);
            let reply_img_list = replies_data["images"];
            let total_imgs = K + (if fetch_comment_images { reply_img_list.len() } else { 0 });

            let post_emoticon_map = mys_pick_required_emoticons(emoticon_map, subject, post_content);
            let post_meta_id = create_image_metadata(#{
                post_id: post_id,
                title: subject,
                game_id: game_id,
                created_at: created_at,
                uid: user_info["uid"],
                nickname: user_info["nickname"],
                avatar_url: user_info["avatar_url"],
                level: user_info["level"],
                certification_label: user_info["certification_label"],
                pendant: user_info["pendant"],
                ip_region: user_info["ip_region"],
                is_super_fan: user_info["is_super_fan"],
                post_image_total: K,
                comment_image_total: reply_img_list.len(),
                total_image_count: K + reply_img_list.len(),
                post_content: post_content,
                post_structured_content: post_structured_content,
                view_num: view_num,
                reply_num: reply_num,
                like_num: like_num,
                bookmark_num: bookmark_num,
                forward_num: forward_num,
                post_snapshot: post,
                emoticon_map: post_emoticon_map
            });

            if total_imgs > 0 {
                let img_weight = post_weight / total_imgs.to_float();
                let k = 0;
                while k < K {
                    let img_url = mys_coerce_str(post_images[k]);
                    if img_url != "" && re_is_match("^https?://", img_url) {
                        let name = if K > 1 {
                            subject + "(" + (k + 1).to_string() + ")"
                        } else { subject };
                        download_image(img_url, #{ name: name, metadata_id: post_meta_id });
                    }
                    add_progress(img_weight);
                    k += 1;
                }
                if fetch_comment_images {
                    let ri_idx = 0;
                    for rimg_url in reply_img_list {
                        ri_idx += 1;
                        if rimg_url != "" && re_is_match("^https?://", rimg_url) {
                            let rname = subject + "[评论" + ri_idx.to_string() + "]";
                            download_image(rimg_url, #{ name: rname, metadata_id: post_meta_id });
                        }
                        add_progress(img_weight);
                    }
                }
            } else {
                add_progress(post_weight);
            }
            total_posts += 1;
        }
        } else {
            add_progress(page_weight);
        }

        let new_offset = mys_coerce_str(data["next_offset"]);
        let is_last = data["is_last"];
        if is_last == true || new_offset == "" || new_offset == offset {
            print("已到最后一页，停止");
            break;
        }
        offset = new_offset;
        page += 1;
    }

    print("[米游社] 作者帖子列表任务结束，共处理 " + total_posts.to_string() + " 帖");
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

let gids_str = if gids == () { "" } else { gids.to_string() };

// 表情集合始终拉取（用于评论内容展示，API 响应约数 MB，任务内只调用一次）
print("[米游社] 拉取表情集合...");
let emoticon_map = mys_build_emoticon_map(API_EMOTICONS);
print("[米游社] 表情集合加载完成");

print(`[米游社] 搜索「${search_keyword}」，第 ${start_page}～${end_page} 页，每页 ${page_size} 条`);

// ── 快进游标到 start_page ─────────────────────────────────────────────────────
// 游标分页不支持直接跳页；start_page > 1 时先空跑前 N-1 页以获取正确 last_id
let cursor = "";
let cur_page = 1;
while cur_page < start_page {
    let skip_url = mys_build_search_url(API_SEARCH, search_keyword, page_size, cursor, gids_str);
    let skip_resp = fetch_json(skip_url);
    if skip_resp["retcode"] != 0 { break; }
    let skip_data = skip_resp["data"];
    if skip_data == () { break; }
    let new_lid = mys_coerce_str(skip_data["last_id"]);
    if new_lid == "" || skip_data["is_last"] == true { break; }
    cursor = new_lid;
    cur_page += 1;
}

// ── 主爬取循环 ────────────────────────────────────────────────────────────────
let page = start_page;
while page <= end_page {
    let search_url = mys_build_search_url(API_SEARCH, search_keyword, page_size, cursor, gids_str);
    let resp = fetch_json(search_url);

    if resp["retcode"] != 0 {
        warn("搜索失败 page=" + page.to_string()
            + " retcode=" + resp["retcode"].to_string()
            + " " + mys_coerce_str(resp["message"]));
        break;
    }

    let data = resp["data"];
    if data == () {
        warn("搜索响应无 data，page=" + page.to_string());
        break;
    }

    let list = data["list"];
    if list == () || list.type_of() != "array" || list.len() == 0 {
        warn("第 " + page.to_string() + " 页无结果，停止");
        add_progress(page_weight);
        break;
    }

    // 只保留含图片的帖子
    let valid_posts = [];
    for item in list {
        let post = item["post"];
        if post == () { continue; }
        let images = post["images"];
        if images == () || images.type_of() != "array" || images.len() == 0 { continue; }
        valid_posts.push(item);
    }

    let M = valid_posts.len();
    print("第 " + page.to_string() + "/" + end_page.to_string()
        + " 页：" + M.to_string() + " 条含图帖子（共 " + list.len().to_string() + " 条）");

    if M > 0 {
        let post_weight = page_weight / M.to_float();
        for item in valid_posts {
            let post = item["post"];
            let post_id = mys_coerce_str(post["post_id"]);
            let subject = mys_coerce_str(post["subject"]);
            if subject == "" { subject = "mys_" + post_id; }

            let game_id = 0;
            if post["game_id"] != () { game_id = post["game_id"]; }
            let created_at = 0;
            if post["created_at"] != () { created_at = post["created_at"]; }
            let post_content = mys_coerce_str(post["content"]);
            let post_structured_content = mys_coerce_str(post["structured_content"]);

            let view_num = 0; let reply_num = 0; let like_num = 0;
            let bookmark_num = 0; let forward_num = 0;
            let stat = item["stat"];
            if stat != () {
                if stat["view_num"]     != () { view_num     = stat["view_num"]; }
                if stat["reply_num"]    != () { reply_num    = stat["reply_num"]; }
                if stat["like_num"]     != () { like_num     = stat["like_num"]; }
                if stat["bookmark_num"] != () { bookmark_num = stat["bookmark_num"]; }
                if stat["forward_num"]  != () { forward_num  = stat["forward_num"]; }
            }

            let user_info = mys_user_info(item["user"]);

            let post_images = post["images"];
            let K = post_images.len();

            // 拉取评论仅用于评论图片统计/下载，不写入元数据；默认最多 max_comments 条
            let replies_data = mys_collect_replies_until_limit(API_REPLIES, post_id, max_comments);

            // 提前计算本帖总图片数，用于均分进度
            let reply_img_list = replies_data["images"];
            let total_imgs = K + (if fetch_comment_images { reply_img_list.len() } else { 0 });
            let img_weight = if total_imgs > 0 { post_weight / total_imgs.to_float() } else { 0.0 };

            let post_emoticon_map = mys_pick_required_emoticons(emoticon_map, subject, post_content);
            let post_meta_id = create_image_metadata(#{
                post_id: post_id,
                title: subject,
                game_id: game_id,
                created_at: created_at,
                uid: user_info["uid"],
                nickname: user_info["nickname"],
                avatar_url: user_info["avatar_url"],
                level: user_info["level"],
                certification_label: user_info["certification_label"],
                pendant: user_info["pendant"],
                ip_region: user_info["ip_region"],
                is_super_fan: user_info["is_super_fan"],
                post_image_total: K,
                comment_image_total: reply_img_list.len(),
                total_image_count: K + reply_img_list.len(),
                post_content: post_content,
                post_structured_content: post_structured_content,
                view_num: view_num,
                reply_num: reply_num,
                like_num: like_num,
                bookmark_num: bookmark_num,
                forward_num: forward_num,
                post_snapshot: post,
                emoticon_map: post_emoticon_map
            });

            if total_imgs == 0 {
                add_progress(post_weight);
                continue;
            }

            // 下载帖子正文图片
            let k = 0;
            while k < K {
                let img_url = mys_coerce_str(post_images[k]);
                if img_url != "" && re_is_match("^https?://", img_url) {
                    let name = if K > 1 {
                        subject + "(" + (k + 1).to_string() + ")"
                    } else {
                        subject
                    };
                    download_image(img_url, #{ name: name, metadata_id: post_meta_id });
                } else {
                    warn("正文图片 URL 无效，跳过：post_id=" + post_id + " idx=" + k.to_string());
                }
                add_progress(img_weight);
                k += 1;
            }

            // 下载评论图片
            if fetch_comment_images {
                let ri_idx = 0;
                for rimg_url in reply_img_list {
                    ri_idx += 1;
                    if rimg_url != "" && re_is_match("^https?://", rimg_url) {
                        let rname = subject + "[评论" + ri_idx.to_string() + "]";
                        download_image(rimg_url, #{ name: rname, metadata_id: post_meta_id });
                    } else {
                        warn("评论图片 URL 无效，跳过：post_id=" + post_id + " idx=" + ri_idx.to_string());
                    }
                    add_progress(img_weight);
                }
            }
        }
    } else {
        add_progress(page_weight);
    }

    let new_cursor = mys_coerce_str(data["last_id"]);
    let is_last = data["is_last"];
    if is_last == true || new_cursor == "" {
        print("已到最后一页，停止");
        break;
    }
    cursor = new_cursor;
    page += 1;
}

print("[米游社] 任务结束");
