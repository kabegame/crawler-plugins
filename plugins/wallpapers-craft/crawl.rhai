fn get_selected_res() {
    if res_type == "none" {
        return "";
    }
    if res_type == "mobile" {
        return res_mobile;
    }
    if res_type == "apple" {
        return res_apple;
    }
    if res_type == "fullscreen" {
        return res_fullscreen;
    }
    if res_type == "widescreen" {
        return res_widescreen;
    }
    return "";
}

fn build_page_url(page, selected_res) {
    let base_path = if mode == "tag" {
        // Rhai 的 trim() 为原地修改、返回 ()，不可写 let t = s.trim()
        let t = tag;
        t.trim();
        if t == "" {
            `${base_url}/all`
        } else {
            `${base_url}/tag/${url_encode(t)}`
        }
    } else {
        `${base_url}/catalog/${category}`
    };

    let sort_path = if orderby == "default" { "" } else { `/${orderby}` };
    let res_path = if selected_res == "" { "" } else { `/${selected_res}` };
    return `${base_path}${sort_path}${res_path}/page${page}`;
}

fn get_max_page() {
    let hrefs = get_attr("li.pager__item:last-of-type > a", "href");
    if hrefs.len() == 0 {
        return 1;
    }

    let last_href = hrefs[0];
    let segments = last_href.split("/");
    if segments.len() == 0 {
        return 1;
    }

    let last_seg = segments[segments.len() - 1];
    // 注意：Rhai 的 str.replace(s, "") 在替换为空串时可能得到 ()，勿用于剥离 "page" 前缀
    if last_seg.len() > 4 && last_seg.sub_string(0, 4) == "page" {
        let page_str = last_seg.sub_string(4, last_seg.len() - 4);
        if re_is_match("^\\d+$", page_str) {
            return page_str.parse_int();
        }
    }
    return 1;
}

// 每个 .wallpapers__link 下有两个 .wallpapers__info（元数据块 + 标签块），query 顺序为 [元0,标0,元1,标1,...]
fn info_text_for_thumb(info_texts, idx) {
    let meta_i = idx * 2;
    if meta_i < info_texts.len() {
        return info_texts[meta_i];
    }
    if idx < info_texts.len() {
        return info_texts[idx];
    }
    return "";
}

fn extract_res(info_text) {
    // Rhai 的 replace / trim 为原地修改、返回 ()（见 rhai-main string_more.rs）
    let normalized = info_text;
    normalized.replace("\n", " ");
    normalized.replace("\t", " ");
    let tokens = normalized.split(" ");
    for token in tokens {
        let t = token;
        t.trim();
        if re_is_match("^\\d+x\\d+$", t) {
            return t;
        }
    }
    return "";
}

fn make_full_url(thumb_url, res) {
    return re_replace_all("_\\d+x\\d+", `_${res}`, thumb_url);
}

fn run() {
    if end_page < start_page {
        throw "结束页数需要大于或等于起始页数";
    }

    let selected_res = get_selected_res();

    print("[wallpapers-craft] 开始爬取");
    print(`站点: ${base_url}`);
    if mode == "tag" {
        let t = tag;
        t.trim();
        print(`模式: 标签，关键词: "${t}"（空字符串表示 /all 全部分类）`);
    } else {
        print(`模式: 目录，分类: ${category}`);
    }
    let sort_txt = if orderby == "default" { "默认" } else { orderby };
    print(`排序: ${sort_txt}`);
    let res_txt = if selected_res == "" { "无（从每条缩略图信息解析分辨率）" } else { selected_res };
    print(`分辨率类别: ${res_type}，选用分辨率: ${res_txt}`);
    print(`页码（用户设置）: ${start_page} ~ ${end_page}`);

    let start_url = build_page_url(start_page, selected_res);
    print(`打开起始页: ${start_url}`);
    to(start_url);

    let max_page = get_max_page();
    let actual_end_page = if end_page < max_page { end_page } else { max_page };
    if start_page > max_page {
        throw `起始页 ${start_page} 超出网站最大页 ${max_page}`;
    }
    let total_pages = actual_end_page - start_page + 1;
    print(`站点分页上限: ${max_page}，实际结束页: ${actual_end_page}，本任务共 ${total_pages} 页`);

    let page = start_page;
    while page <= actual_end_page {
        let page_url = build_page_url(page, selected_res);
        if page > start_page {
            print(`翻页: ${page}/${actual_end_page} → ${page_url}`);
            to(page_url);
        } else {
            print(`处理第 ${page}/${actual_end_page} 页（已在起始页）`);
        }

        let thumbnail_srcs = get_attr(".wallpapers__link img", "src");
        let info_texts = query(".wallpapers__link .wallpapers__info");

        let page_progress = if total_pages > 0 { 100.0 / total_pages } else { 0.0 };
        let image_count = thumbnail_srcs.len();
        let per_image_progress = if image_count > 0 { page_progress / image_count } else { page_progress };

        print(`第 ${page} 页: 缩略图 ${image_count} 张，开始处理下载`);

        let idx = 0;
        while idx < thumbnail_srcs.len() {
            let thumb = thumbnail_srcs[idx];
            let final_res = if selected_res != "" {
                selected_res
            } else {
                extract_res(info_text_for_thumb(info_texts, idx))
            };

            if final_res != "" {
                let full_url = make_full_url(thumb, final_res);
                download_image(full_url);
            }

            add_progress(per_image_progress);

            idx += 1;
        }

        if image_count == 0 {
            add_progress(page_progress);
        }

        print(`第 ${page} 页: 完成`);

        if page > start_page {
            print(`后退: 返回第 ${page - 1} 页以便继续翻页`);
            back();
        }
        page += 1;
    }

    print("[wallpapers-craft] 爬取结束");
}

run();
