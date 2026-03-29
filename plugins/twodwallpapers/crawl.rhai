// twodwallpapers Rhai 模板
// 提示：按需使用 to/query/get_attr/download_image 等 API
/**
    category 爬取的壁纸类型
    sub_cate_key 爬取的子目录关键字
    max_num 最大爬取的图片张数
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

// 抓取某个页面范围的壁纸
fn crawl(category, sub_cate_key, max_num, orderby) {
    let download_num = 0;

    print("[twodwallpapers] 开始爬取");
    print(`站点: ${base_url}`);
    print(`目录: ${category}`);
    print(`子目录关键字（正则）: "${sub_cate_key}"`);
    print(`爬取上限: ${max_num} 张，排序 orderby: ${orderby}`);

    let category_url = `${base_url}/${category}`;
    print(`打开分类页: ${category_url}`);
    to(category_url);

    // query 只返回文本数组；属性用 get_attr 取，两者顺序一致，按索引对应
    let filter_texts = query(".filter-link > a");
    let filter_hrefs = get_attr(".filter-link > a", "href");
    for (text, idx) in filter_texts {
        if re_is_match(sub_cate_key, text) {
            let base = filter_hrefs[idx];
            let list_url = `${base}?orderby=${orderby}`;
            print(`匹配子分类「${text}」: ${list_url}`);
            to(list_url);

            let next_page_link = get_attr(".page-link.page-next", "href");
            if next_page_link.len() == 0 {
                print("提示: 未找到「下一页」链接，列表循环不会执行（站点结构或当前页无翻页控件）");
            }

            let page_idx = 1;
            while next_page_link.len() > 0 {
                let image_links = get_attr(".media-img", "href");
                print(`列表第 ${page_idx} 页: 媒体链接 ${image_links.len()} 个，逐个进入详情下载`);

                for image_link in image_links {
                    if download_num >= max_num {
                        print(`已达爬取上限 ${max_num} 张，提前结束`);
                        return;
                    }
                    process_detail_page(image_link);
                    download_num += 1;
                    add_progress(100.0 / max_num);
                }

                print(`列表第 ${page_idx} 页: 完成`);

                print(`翻页: ${next_page_link[0]}`);
                to(next_page_link[0]);
                page_idx += 1;
                next_page_link = get_attr(".page-link.page-next", "href");
            }
        }
    }

    print("[twodwallpapers] 爬取结束");
}

// 根据用户选择的壁纸类型爬取对应的壁纸
crawl(category, sub_cate_key, max_num, orderby);
