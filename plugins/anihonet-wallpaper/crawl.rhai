// 从 URL 中提取“文件名”（忽略 query/hash，只取最后一个 '/' 之后的部分）
fn extract_filename(url) {
    // 先去掉 query / hash
    let no_query = url.split("?")[0];
    let no_hash = no_query.split("#")[0];

    // 再取最后一段路径作为文件名
    let parts = no_hash.split("/");
    if parts.len() == 0 { return ""; }
    return parts[parts.len() - 1];
}

// 判断图片是否为手机（android）版本。
// 约定：文件名包含 "android" => 手机壁纸；否则 => 桌面壁纸。
fn is_android_image(url) {
    let filename = extract_filename(url);
    // 使用 Rust regex 语法，(?i) 表示大小写不敏感
    return re_is_match("(?i)android", filename);
}

// 计算总页数
fn total_pages() {
    return max_pages - start_page + 1;
}

// 验证 wallpaper_type 值
if wallpaper_type != "imgpc" && wallpaper_type != "sp" {
    print("错误：wallpaper_type 必须是 'imgpc' 或 'sp'");
    return;
}

// 处理单个元素，尝试提取并下载图片
fn process_element(element) {
    let tag = element["tag"];
    if tag != "a" { return; }
    let attrs = element["attrs"];
    let href = attrs["href"];
    let full_image = resolve_url(href);
    if is_image_url(full_image) {
        let is_android = is_android_image(full_image);
        // 根据用户选择的 wallpaper_type 决定是否下载
        if wallpaper_type == "sp" && !is_android { return; }
        if wallpaper_type == "imgpc" && is_android { return; }
        download_image(full_image);
    }
}

// 处理单个详情页
fn process_detail_page(href) {
    let full_url = resolve_url(href);
    to(full_url);
    let elements = query_by_text("画像をダウンロード");
    let elem_idx = 0;
    while elem_idx < elements.len() {
        process_element(elements[elem_idx]);
        elem_idx += 1;
    }
}

// 抓取某一类（imgpc/sp）的排行榜页
fn crawl_kind(kind, start_page, max_pages, period) {
    let pg = start_page;
    while pg <= end_page {
        let start_url = `https://anihonetwallpaper.com/ranking-${period}-${kind}/${pg}`;
        to(start_url);

        let hrefs = get_attr("a", "href");
        let page_progress_increment = 90.0 / total_pages();

        let idx = 0;
        let total_links = hrefs.len();
        while idx < total_links {
            process_detail_page(hrefs[idx]);

            if total_links > 0 {
                add_progress(page_progress_increment / total_links);
            }
            idx += 1;
        }

        pg += 1;
    }
}

// 根据用户选择的壁纸类型爬取对应的排行榜
crawl_kind(wallpaper_type, start_page, end_page, ranking_period);
