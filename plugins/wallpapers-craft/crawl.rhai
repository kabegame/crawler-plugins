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

// 详情页标题常以 "Wallpaper " 开头，图库展示名去掉此前缀
fn display_name_from_wallpaper_title(title_raw) {
    let t = title_raw;
    t.trim();
    if t == "" {
        return "";
    }
    if t.len() > 10 && t.sub_string(0, 10) == "Wallpaper " {
        let rest = t.sub_string(10, t.len() - 10);
        rest.trim();
        return rest;
    }
    return t;
}

// 栈顶须为 wallpaperscraft 壁纸详情页（已由调用方 to()）
fn wc_fetch_detail_metadata() {
    let detail_url = current_url();

    let title = "";
    let titles = query(".content-main h1.gui-heading");
    if titles.len() > 0 {
        title = titles[0];
        title.trim();
    }
    let author = "";
    let license = "";
    let auth_rows = query(".author .author__row");
    for row in auth_rows {
        let r = row;
        r.trim();
        if r.len() >= 7 && r.sub_string(0, 7) == "Author:" {
            let a = r.sub_string(7, r.len() - 7);
            a.trim();
            author = a;
        }
        if r.len() >= 8 && r.sub_string(0, 8) == "License:" {
            let l = r.sub_string(8, r.len() - 8);
            l.trim();
            l.replace("\n", " ");
            license = l;
        }
    }

    let source_url = "";
    let src_h = get_attr(".author__block_source a.author__link", "href");
    if src_h.len() > 0 {
        source_url = resolve_url(src_h[0]);
    }

    let rating = "";
    let rate_arr = query(".wallpaper-votes__rate");
    if rate_arr.len() > 0 {
        rating = rate_arr[0];
        rating.trim();
    }

    let votes_total = "";
    let vt = query(".JS-Vote-Total");
    if vt.len() > 0 {
        votes_total = vt[0];
        votes_total.trim();
    }

    let orig_res = "";
    let views = "";
    let uploaded = "";
    let cells = query(".wallpaper-table .wallpaper-table__cell");
    let ci = 0;
    while ci + 1 < cells.len() {
        let k = cells[ci];
        k.trim();
        let v = cells[ci + 1];
        v.trim();
        if k.contains("Original Resolution") {
            orig_res = v;
        } else if k.contains("Views") {
            views = v;
        } else if k.contains("Uploaded") {
            uploaded = v;
        }
        ci += 2;
    }

    let orig_dl = "";
    let dl_h = get_attr(".wallpaper-table a[href*='/download/']", "href");
    if dl_h.len() > 0 {
        orig_dl = resolve_url(dl_h[0]);
    }

    return #{
        site_base: base_url,
        detail_url: detail_url,
        wallpaper_title: title,
        author: author,
        license: license,
        source_url: source_url,
        rating: rating,
        votes_total: votes_total,
        original_resolution: orig_res,
        original_download_url: orig_dl,
        views: views,
        uploaded: uploaded
    };
}

fn download_with_wc_detail(full_url, detail_rel) {
    let rel = detail_rel;
    rel.trim();
    if rel == "" {
        download_image(full_url);
        return;
    }

    let detail_abs = resolve_url(rel);
    to(detail_abs);
    let meta = wc_fetch_detail_metadata();
    let dn = display_name_from_wallpaper_title(meta.wallpaper_title);
    if dn != "" {
        download_image(full_url, #{ name: dn, metadata: meta });
    } else {
        download_image(full_url, #{ metadata: meta });
    }
    back();
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
        let detail_hrefs = get_attr(".wallpapers__link", "href");
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
                let detail_rel = "";
                if idx < detail_hrefs.len() {
                    detail_rel = detail_hrefs[idx];
                }
                download_with_wc_detail(full_url, detail_rel);
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
