// twodwallpapers Rhai 模板
// 提示：按需使用 to/query/get_attr/download_image 等 API
/**
    work_key 作品关键字
    start_page 起始页数
    end_page 结束页数
    orderby 排序方式
*/

// 处理单个详情页
fn process_detail_page(href) {
    to(href);
    let image_links = get_attr(".bip-download-btn", "href");
    if image_links.len() == 0 {
        print("[twodwallpapers] 详情页未找到下载链接，跳过");
        back();
        return;
    }

    let image = image_links[0];
    let detail_url = current_url();

    let title_raw = "";
    let title_arr = query(".post-title");
    if title_arr.len() > 0 {
        title_raw = title_arr[0];
        title_raw.trim();
    }

    let name = re_replace_all("\\s*Wallpaper\\s+ID\\d+\\s*$", "", title_raw);
    name.trim();
    if name == "" {
        name = title_raw;
    }

    let wallpaper_id = "";
    if re_is_match("Wallpaper\\s+ID(\\d+)\\s*$", title_raw) {
        wallpaper_id = re_replace_all("^.*Wallpaper\\s+ID(\\d+)\\s*$", "$1", title_raw);
        wallpaper_id.trim();
    }

    let page_num = "";
    if re_is_match("^.*/([^/]+)\\.html(?:\\?.*)?$", detail_url) {
        page_num = re_replace_all("^.*/([^/]+)\\.html(?:\\?.*)?$", "$1", detail_url);
        page_num.trim();
    }

    let category = "";
    let categories = query(".meta-cat-dot a");
    if categories.len() > 0 {
        category = categories[0];
        category.trim();
    }

    let sidebar_text = "";
    let sidebar_arr = query("#block-9");
    if sidebar_arr.len() > 0 {
        sidebar_text = sidebar_arr[0];
    }

    let resolution = "";
    if re_is_match("(?i)Resolution:\\s*[^\\n\\r]+", sidebar_text) {
        resolution = re_replace_all("(?is)^.*?Resolution:\\s*([^\\n\\r]+).*$", "$1", sidebar_text);
        resolution.trim();
    }

    let size = "";
    if re_is_match("(?i)Size:\\s*[^\\n\\r]+", sidebar_text) {
        size = re_replace_all("(?is)^.*?Size:\\s*([^\\n\\r]+).*$", "$1", sidebar_text);
        size.trim();
    }

    let file_format = "";
    if re_is_match("(?i)Format:\\s*[^\\n\\r]+", sidebar_text) {
        file_format = re_replace_all("(?is)^.*?Format:\\s*([^\\n\\r]+).*$", "$1", sidebar_text);
        file_format.trim();
    }

    let meta = #{
        name: name,
        wallpaper_id: wallpaper_id,
        page_num: page_num,
        detail_url: detail_url,
        resolution: resolution,
        size: size,
        format: file_format,
        category: category,
        download_url: image
    };

    if name != "" {
        download_image(image, #{ name: name, metadata: meta });
    } else {
        download_image(image, #{ metadata: meta });
    }
    back();
}

fn parse_page_num_from_url(url) {
    if url == () || url == "" {
        return 0;
    }
    if !re_is_match("/page/[0-9]+", url) {
        return 0;
    }
    let n_str = re_replace_all("^.*?/page/([0-9]+)(?:\\?.*)?$", "$1", url);
    if n_str == url || !re_is_match("^[0-9]+$", n_str) {
        return 0;
    }
    return parse_int(n_str);
}

fn parse_total_pages_from_pagination() {
    let max_page = 1;
    let hrefs = get_attr(".page-link", "href");
    for href in hrefs {
        let n = parse_page_num_from_url(href);
        if n > max_page {
            max_page = n;
        }
    }

    let labels = query(".page-link");
    for label in labels {
        if label == () {
            continue;
        }
        let text = label;
        text.trim();
        if re_is_match("^[0-9]+$", text) {
            let n = parse_int(text);
            if n > max_page {
                max_page = n;
            }
        }
    }

    return max_page;
}

fn build_page_url(list_url, page_num) {
    if page_num <= 1 {
        return list_url;
    }

    let parts = list_url.split("?");
    let base = parts[0];
    base = re_replace_all("/$", "", base);
    let query = "";
    if parts.len() > 1 {
        query = parts[1];
    }

    let page_url = `${base}/page/${page_num}`;
    if query != "" {
        page_url += `?${query}`;
    }
    return page_url;
}

fn work_category_paths() {
    return ["game-wallpapers", "anime-wallpapers", "uncategorized"];
}

fn find_work_entry(work_key) {
    let q = work_key;
    if q == () {
        q = "";
    }
    q.trim();
    if q == "" {
        throw "作品关键字不能为空";
    }

    let categories = work_category_paths();
    for category in categories {
        let category_url = `${base_url}/${category}`;
        print(`查找作品「${q}」：打开目录页 ${category_url}`);
        to(category_url);

        let labels = query(".filter-link > a");
        let hrefs = get_attr(".filter-link > a", "href");
        let n = labels.len();
        if hrefs.len() < n {
            n = hrefs.len();
        }

        let idx = 0;
        while idx < n {
            let label = labels[idx];
            if label != () {
                label.trim();
            } else {
                label = "";
            }
            let href = hrefs[idx];
            if re_is_match(q, label) || re_is_match(q, href) {
                print(`命中作品「${label}」: ${href}`);
                return #{ label: label, href: href, category: category };
            }
            idx += 1;
        }

        print(`目录 ${category} 未找到作品「${q}」，继续查找下一个目录`);
    }

    throw `未找到匹配作品: ${q}`;
}

fn crawl_matched_subcategory(label, list_url, start_page, end_page, pct_budget) {
    print(`匹配作品「${label}」: ${list_url}`);
    to(list_url);

    let site_total_pages = parse_total_pages_from_pagination();
    let requested_pages = end_page - start_page + 1;
    let actual_end_page = if end_page < site_total_pages {
        end_page
    } else {
        site_total_pages
    };
    let skip_pages = if start_page <= site_total_pages {
        start_page - 1
    } else {
        site_total_pages
    };
    let pct_per_requested_page = if requested_pages > 0 {
        pct_budget / requested_pages
    } else {
        0.0
    };
    let processed_pages = 0;

    print(`站点总页数: ${site_total_pages}；用户请求范围: ${start_page} ~ ${end_page}；跳过前置页数: ${skip_pages}`);

    if start_page > site_total_pages {
        print(`起始页 ${start_page} 超出站点总页数 ${site_total_pages}，跳过该作品并补足进度`);
        add_progress(pct_budget);
        return;
    }

    if actual_end_page < end_page {
        print(`结束页 ${end_page} 超出站点总页数，实际结束页调整为 ${actual_end_page}`);
    }

    let actual_pages = actual_end_page - start_page + 1;
    print(`实际处理范围: ${start_page} ~ ${actual_end_page}（共 ${actual_pages}/${requested_pages} 个请求页）；本作品进度份额 ${pct_budget}%`);

    let page_idx = start_page;
    while page_idx <= actual_end_page {
        let page_url = build_page_url(list_url, page_idx);
        if page_idx == 1 {
            print(`处理第 ${page_idx}/${site_total_pages} 页（已在当前页）：${page_url}`);
        } else {
            print(`处理第 ${page_idx}/${site_total_pages} 页：${page_url}`);
            to(page_url);
        }

        let image_links = get_attr(".media-img", "href");
        let image_count = image_links.len();
        let pct_per_image = if image_count > 0 {
            pct_per_requested_page / image_count
        } else {
            pct_per_requested_page
        };

        print(`列表第 ${page_idx}/${site_total_pages} 页: 媒体链接 ${image_count} 个，逐个进入详情下载`);

        for image_link in image_links {
            process_detail_page(image_link);
            add_progress(pct_per_image);
        }

        if image_count == 0 {
            add_progress(pct_per_requested_page);
        }

        processed_pages += 1;
        print(`列表第 ${page_idx}/${site_total_pages} 页: 完成`);
        page_idx += 1;
    }

    let missing_pages = requested_pages - processed_pages;
    if missing_pages > 0 && pct_per_requested_page > 0.0 {
        let remainder = pct_per_requested_page * missing_pages;
        print(`请求范围内实际处理 ${processed_pages}/${requested_pages} 页，跳过或超出站点范围 ${missing_pages} 页，补足进度 ${remainder}%`);
        add_progress(remainder);
    }
}

// 抓取某个作品页面范围的壁纸
fn crawl(work_key, start_page, end_page, orderby) {
    if end_page < start_page {
        throw "结束页数需要大于或等于起始页数";
    }

    print("[twodwallpapers] 开始爬取");
    print(`站点: ${base_url}`);
    print(`作品关键字（正则）: "${work_key}"`);
    print(`页码范围: ${start_page} ~ ${end_page}，排序 orderby: ${orderby}`);

    let work = find_work_entry(work_key);
    let list_url = `${work["href"]}?orderby=${orderby}`;
    print(`作品所在目录: ${work["category"]}`);
    crawl_matched_subcategory(work["label"], list_url, start_page, end_page, 100.0);

    print("[twodwallpapers] 爬取结束");
}

// 根据用户输入的作品抓取对应分页
crawl(work_key, start_page, end_page, orderby);
