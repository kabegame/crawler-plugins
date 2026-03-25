fn get_resolution_slug() {
    if resolution_mode == "all" {
        return "";
    }
    if resolution_mode == "for_mobile" {
        return "for_mobile";
    }
    if resolution_mode == "for_desktop" {
        return "for_desktop";
    }
    if resolution_mode == "specific" {
        if resolution_group == "ultra_hd" {
            return res_ultra_hd;
        }
        if resolution_group == "apple" {
            return res_apple;
        }
        if resolution_group == "android" {
            return res_android;
        }
        if resolution_group == "widescreen" {
            return res_widescreen;
        }
    }
    return "";
}

fn get_base_path() {
    if mode == "tag" {
        let t = tag;
        t.trim();
        if t == "" {
            return base_url;
        }
        return `${base_url}/tag/${url_encode(t)}`;
    }

    if album == "all" {
        return `${base_url}/album`;
    }
    return `${base_url}/album/${album}`;
}

fn build_page_url(page) {
    let url = get_base_path();

    if ranking != "" {
        url += `/${ranking}`;
    }

    let res_slug = get_resolution_slug();
    if res_slug != "" {
        url += `/${res_slug}`;
    }

    url += `?page=${page}`;
    return url;
}

fn max_page_from_inline_script(script_text) {
    if !re_is_match("mainGalleryTarget", script_text) {
        return 0;
    }
    let n_str = re_replace_all("(?s)^.*?\"pages\"\\s*:\\s*(\\d+).*$", "$1", script_text);
    if n_str == script_text {
        return 0;
    }
    if re_is_match("^\\d+$", n_str) {
        return n_str.parse_int();
    }
    return 0;
}

fn parse_max_page() {
    let amount_nodes = query(".pagination__amount");
    if amount_nodes.len() > 0 {
        let text = amount_nodes[0];
        let parts = text.split(" ");
        if parts.len() > 1 {
            let token = re_replace_all("^\\s+|\\s+$", "", parts[1]);
            if re_is_match("^\\d+$", token) {
                return token.parse_int();
            }
        }
    }

    // 与页面结构一致：<main class="layout-dynamic"> 下内联 script 含 window.mainGalleryTarget
    let scripts = query("main.layout-dynamic > script[type=\"text/javascript\"]:not([src])");
    for s in scripts {
        let n = max_page_from_inline_script(s);
        if n > 0 {
            return n;
        }
    }

    return 1;
}

fn collect_content_urls_from_scripts() {
    let urls = [];
    let scripts = query("script[type=\"application/ld+json\"]");

    for script_text in scripts {
        if script_text == () {
            continue;
        }

        try {
            let parsed = parse_json(script_text);

            // 数组顶层 JSON：parse_json 会包装为 { data: [...] }
            let data = parsed["data"];
            if data != () {
                for item in data {
                    let content_url = item["contentUrl"];
                    if content_url != () && is_image_url(content_url) {
                        urls.push(content_url);
                    }
                }
                continue;
            }

            // 对象顶层 JSON：直接尝试 contentUrl
            let content_url = parsed["contentUrl"];
            if content_url != () && is_image_url(content_url) {
                urls.push(content_url);
            }
        } catch {
            // 非 JSON 或格式不符合时忽略，继续处理下一个 script
        }
    }

    return urls;
}

fn run() {
    if end_page < start_page {
        throw "结束页数需要大于或等于起始页数";
    }

    print("[wallspic] 开始爬取");
    print(`站点: ${base_url}`);
    if mode == "tag" {
        let t = tag;
        t.trim();
        print(`模式: Tag，标签: "${t}"（空字符串表示全部分类）`);
    } else {
        print(`模式: Album，分类: ${album}`);
    }
    let rank_txt = if ranking == "" { "New（默认）" } else { `Popular（${ranking}）` };
    print(`排序: ${rank_txt}`);
    let res_slug = get_resolution_slug();
    let res_txt = if res_slug == "" { "无" } else { res_slug };
    print(`分辨率模式: ${resolution_mode}，URL 分辨率段: ${res_txt}`);
    print(`页码（用户设置）: ${start_page} ~ ${end_page}`);

    let start_url = build_page_url(start_page);
    print(`打开起始页: ${start_url}`);
    to(start_url);

    let max_page = parse_max_page();
    let actual_end_page = if end_page < max_page { end_page } else { max_page };
    if start_page > max_page {
        throw `起始页 ${start_page} 超出网站最大页 ${max_page}`;
    }
    let total_pages = actual_end_page - start_page + 1;
    print(`站点分页上限: ${max_page}，实际结束页: ${actual_end_page}，本任务共 ${total_pages} 页`);

    let page = start_page;
    while page <= actual_end_page {
        let page_url = build_page_url(page);
        if page > start_page {
            print(`翻页: ${page}/${actual_end_page} → ${page_url}`);
            to(page_url);
        } else {
            print(`处理第 ${page}/${actual_end_page} 页（已在起始页）`);
        }

        let image_urls = collect_content_urls_from_scripts();
        let page_progress = if total_pages > 0 { 100.0 / total_pages } else { 0.0 };
        let count = image_urls.len();
        let per_image_progress = if count > 0 { page_progress / count } else { page_progress };

        print(`第 ${page} 页: 解析到 ${count} 个图片地址，开始下载`);

        for image_url in image_urls {
            download_image(image_url);
            add_progress(per_image_progress);
        }

        if count == 0 {
            add_progress(page_progress);
        }

        print(`第 ${page} 页: 完成`);

        if page > start_page {
            print(`后退: 返回第 ${page - 1} 页以便继续翻页`);
            back();
        }
        page += 1;
    }

    print("[wallspic] 爬取结束");
}

run();
