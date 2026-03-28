// konachan 动漫壁纸

fn trim_text(text) {
    return re_replace_all("^\\s+|\\s+$", "", text);
}

fn parse_int_or_zero(text) {
    let t = trim_text(text);
    if re_is_match("^\\d+$", t) {
        return t.parse_int();
    }
    return 0;
}

fn normalize_tag_token(text) {
    let t = trim_text(text);
    if t == "" {
        return "";
    }
    return re_replace_all("\\s+", "_", t);
}

fn build_tags_value_from_list(tag_list) {
    let normalized = [];
    for raw_tag in tag_list {
        let token = normalize_tag_token(`${raw_tag}`);
        if token != "" {
            normalized.push(token);
        }
    }

    let joined = "";
    let idx = 0;
    while idx < normalized.len() {
        if idx > 0 {
            joined += "+";
        }
        joined += normalized[idx];
        idx += 1;
    }
    return joined;
}

// 处理单个详情页
fn process_detail_page(href) {
    let full_url = resolve_url(href);
    to(full_url);
    let images = [];
    let q = quality;
    if q == "high" {
        let high_notice = get_attr(".highres-show", "href");
        if high_notice.len() > 0 {
            images = high_notice;
        } else {
            q = "medium";
        }
    }
    if q == "medium" {
        images = get_attr("#image", "src");
    }
    if images.len() > 0 {
        download_image(images[0]);
    }
    back();
}

// 计算 all 模式总页数
fn total_pages_all(start_page, end_page) {
    return end_page - start_page + 1;
}

fn validate_page_range(start_page, end_page) {
    if end_page >= start_page + 100 {
        throw "在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪";
    } else if end_page < start_page {
        throw "结束页面需要比开始页面大";
    }
}

// all 模式：抓取某个页面范围的壁纸
fn crawl_quality_all(start_page, end_page) {
    let pg = start_page;
    let total_pages = total_pages_all(start_page, end_page);
    let page_progress_increment = 90.0 / total_pages;
    while pg <= end_page {
        let start_url = `${base_url}/post/?page=${pg}`;
        print(`[konachan][all] 打开页面 ${pg}/${end_page}: ${start_url}`);
        to(start_url);
        let hrefs = get_attr("#post-list-posts > li > div > a", "href");
        let idx = 0;
        let total_links = hrefs.len();

        print(`[konachan][all] 第 ${pg} 页共 ${total_links} 个帖子`);
        while idx < total_links {
            process_detail_page(hrefs[idx]);
            if total_links > 0 {
                add_progress(page_progress_increment / total_links);
            }
            idx += 1;
        }
        pg += 1;
        back();
    }
}

fn build_tag_search_url(name, tag_type, tag_order, page) {
    let encoded_name = url_encode(name);
    return `${base_url}/tag?name=${encoded_name}&type=${tag_type}&order=${tag_order}&page=${page}`;
}

fn parse_tag_total_pages() {
    let has_next = get_attr("#paginator a.next_page", "href");
    if has_next.len() == 0 {
        return 1;
    }
    let page_links_text = query("#paginator > div > a");
    if page_links_text.len() >= 2 {
        let page_token = trim_text(page_links_text[page_links_text.len() - 2]);
        if re_is_match("^\\d+$", page_token) {
            return page_token.parse_int();
        }
    }
    return 1;
}

fn crawl_tag_posts(tag_name, tag_href, expected_images, per_tag_progress) {
    let tag_url = resolve_url(tag_href);
    let joiner = if re_is_match("\\?", tag_url) { "&" } else { "?" };
    let per_image_progress = if expected_images > 0 { per_tag_progress / expected_images } else { 0.0 };
    let post_page = 1;
    let downloaded = 0;

    print(`[konachan][tag-list] 开始标签: ${tag_name}，预计图片数: ${expected_images}`);
    while true {
        let page_url = `${tag_url}${joiner}page=${post_page}`;
        print(`[konachan][tag-list] 标签 ${tag_name} -> 第 ${post_page} 页: ${page_url}`);
        to(page_url);
        let hrefs = get_attr("#post-list-posts > li > div > a", "href");
        let total_links = hrefs.len();
        if total_links == 0 {
            print(`[konachan][tag-list] 标签 ${tag_name} 第 ${post_page} 页无帖子，停止翻页`);
            back();
            break;
        }

        let idx = 0;
        while idx < total_links {
            process_detail_page(hrefs[idx]);
            downloaded += 1;
            if expected_images > 0 && downloaded <= expected_images {
                add_progress(per_image_progress);
            }
            idx += 1;
        }

        back();
        post_page += 1;
    }

    if expected_images <= 0 {
        add_progress(per_tag_progress);
    } else if downloaded < expected_images {
        let remain = expected_images - downloaded;
        add_progress(per_image_progress * remain);
    }

    print(`[konachan][tag-list] 标签完成: ${tag_name}，实际下载 ${downloaded} / 预计 ${expected_images}`);
}

fn crawl_by_tag() {
    let search_name = trim_text(tag);
    let tag_type = mode_tag_type;
    let tag_order = mode_tag_order;
    let skip_count = if mode_tag_skip > 0 { mode_tag_skip } else { 0 };

    let first_url = build_tag_search_url(search_name, tag_type, tag_order, 1);
    print("[konachan][tag-list] 开始标签列表模式");
    print(`[konachan][tag-list] 搜索关键词: ${search_name}`);
    print(`[konachan][tag-list] 标签类型: ${tag_type}`);
    print(`[konachan][tag-list] 标签排序: ${tag_order}`);
    print(`[konachan][tag-list] 跳过标签数量: ${skip_count}`);
    print(`[konachan][tag-list] 打开搜索首页: ${first_url}`);

    to(first_url);
    let total_tag_pages = parse_tag_total_pages();
    print(`[konachan][tag-list] 搜索结果总页数: ${total_tag_pages}`);
    back();

    let skip_in_first_page = skip_count % 50;
    let start_tag_page = ((skip_count - skip_in_first_page) / 50) + 1;
    if start_tag_page > total_tag_pages {
        print(`[konachan][tag-list] 跳过数量过大，起始页 ${start_tag_page} 超出总页数 ${total_tag_pages}，本次无可爬取标签`);
        return;
    }

    let actual_pages_to_crawl = total_tag_pages - start_tag_page + 1;
    let per_page_progress = if actual_pages_to_crawl > 0 { 99.0 / actual_pages_to_crawl } else { 0.0 };

    print(`[konachan][tag-list] 实际从第 ${start_tag_page} 页开始，预计处理 ${actual_pages_to_crawl} 页`);

    let current_page = start_tag_page;
    while current_page <= total_tag_pages {
        let page_url = build_tag_search_url(search_name, tag_type, tag_order, current_page);
        print(`[konachan][tag-list] 处理标签列表页 ${current_page}/${total_tag_pages}: ${page_url}`);
        to(page_url);

        let tag_names = query(".highlightable > tbody > tr a[href*='tags']");
        let tag_hrefs = get_attr(".highlightable > tbody > tr a[href*='tags']", "href");
        let tag_counts = query(".highlightable > tbody > tr > td:first-of-type");

        let row_count = tag_names.len();
        if tag_hrefs.len() < row_count {
            row_count = tag_hrefs.len();
        }
        if tag_counts.len() < row_count {
            row_count = tag_counts.len();
        }

        let page_skip = if current_page == start_tag_page { skip_in_first_page } else { 0 };
        if row_count == 0 || page_skip >= row_count {
            print(`[konachan][tag-list] 第 ${current_page} 页无可处理标签（总 ${row_count}，跳过 ${page_skip}）`);
            add_progress(per_page_progress);
            back();
            current_page += 1;
            continue;
        }

        let tags_to_process = row_count - page_skip;
        let per_tag_progress = per_page_progress / tags_to_process;
        print(`[konachan][tag-list] 第 ${current_page} 页标签总数 ${row_count}，本页处理 ${tags_to_process} 个`);

        let idx = page_skip;
        while idx < row_count {
            let tag_name = trim_text(tag_names[idx]);
            let tag_href = tag_hrefs[idx];
            let image_count = parse_int_or_zero(tag_counts[idx]);

            if image_count <= 0 {
                print(`[konachan][tag-list] 跳过标签 ${tag_name}，图片数为 0`);
                add_progress(per_tag_progress);
                idx += 1;
                continue;
            }

            crawl_tag_posts(tag_name, tag_href, image_count, per_tag_progress);
            idx += 1;
        }

        print(`[konachan][tag-list] 完成标签列表页 ${current_page}`);
        back();
        current_page += 1;
    }

    print("[konachan][tag-list] 标签列表模式爬取结束");
}

fn crawl_by_tags(start_page, end_page) {
    let tags_value = build_tags_value_from_list(mode_tag_value);
    if tags_value == "" {
        throw "标签模式需要至少填写一个标签";
    }

    let total_pages = total_pages_all(start_page, end_page);
    let page_progress_increment = 90.0 / total_pages;

    print("[konachan][tags] 开始标签模式");
    print(`[konachan][tags] 标签组合: ${tags_value}`);
    print(`[konachan][tags] 页码范围: ${start_page} ~ ${end_page}`);

    let pg = start_page;
    while pg <= end_page {
        let start_url = `${base_url}/post?tags=${tags_value}&page=${pg}`;
        print(`[konachan][tags] 打开页面 ${pg}/${end_page}: ${start_url}`);
        to(start_url);
        let hrefs = get_attr("#post-list-posts > li > div > a", "href");

        let idx = 0;
        let total_links = hrefs.len();
        print(`[konachan][tags] 第 ${pg} 页共 ${total_links} 个帖子`);
        while idx < total_links {
            process_detail_page(hrefs[idx]);
            if total_links > 0 {
                add_progress(page_progress_increment / total_links);
            }
            idx += 1;
        }

        pg += 1;
        back();
    }
    print("[konachan][tags] 标签模式爬取结束");
}

if crawl_mode == "all" {
    validate_page_range(start_page, end_page);
    print(`[konachan][all] 开始爬取，页码范围 ${start_page} ~ ${end_page}，质量 ${quality}`);
    crawl_quality_all(start_page, end_page);
    print("[konachan][all] 爬取结束");
} else if crawl_mode == "tag_list" {
    crawl_by_tag();
} else if crawl_mode == "tags" {
    validate_page_range(start_page, end_page);
    crawl_by_tags(start_page, end_page);
} else {
    throw "未知的爬取模式: " + crawl_mode;
}
