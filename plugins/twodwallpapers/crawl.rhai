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
    let image = get_attr(".bip-download-btn", "href")[0];
    download_image(image);
    back()
}

// 抓取某个页面范围的壁纸
fn crawl(category, sub_cate_key, max_num, orderby) {
    let download_num = 0;
    to(`${base_url}/${category}`);
    // query 只返回文本数组；属性用 get_attr 取，两者顺序一致，按索引对应
    let filter_texts = query(".filter-link > a");
    let filter_hrefs = get_attr(".filter-link > a", "href");
    for (text, idx) in filter_texts {
        if re_is_match(sub_cate_key, text) {
            let base = filter_hrefs[idx];
            to(`${base}?orderby=${orderby}`);
            let next_page_link = get_attr(".page-link.page-next", "href");
            while next_page_link.len() > 0 {
                let image_links = get_attr(".media-img", "href");
                for image_link in image_links {
                    if download_num >= max_num {
                        return;
                    }
                    process_detail_page(image_link);
                    download_num += 1;
                    add_progress(100.0 / max_num);
                }
                to(next_page_link[0]);
                next_page_link = get_attr(".page-link.page-next", "href");
            }
        }
    }
}

// 根据用户选择的壁纸类型爬取对应的壁纸
crawl(category, sub_cate_key, max_num, orderby);
