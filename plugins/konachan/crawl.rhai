// konachan 动漫壁纸
/**
    start_page 到 end_page （包含）爬取
    quality 爬取图片的质量。其实这里
 */

if end_page >= start_page + 100 {
    throw "在一次之内不允许爬取超过100页，咱二次元人要保持文明礼仪"
} else if end_page < start_page {
    throw "结束页面需要比开始页面大"
}

// 计算总页数
fn total_pages() {
    return end_page - start_page + 1;
}

// 处理单个详情页
fn process_detail_page(href) {
    let full_url = resolve_url(href);
    to(full_url);
    let images = [];
    let q = quality;
    if q == "high" {
        let high_notice = get_attr("#resized_notice > a.highres-show", "href");
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
    back()
}

// 抓取某个页面范围的壁纸
fn crawl_quality(start_page, end_page, quality) {
    let pg = start_page;
    while pg <= end_page {
        let start_url = `${base_url}/post/?page=${pg}`;
        to(start_url);
        let hrefs = get_attr("#post-list-posts > li > div > a", "href");
        
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
        back();
    }
}

// 根据用户选择的壁纸类型爬取对应的排行榜
crawl_quality(start_page, end_page, quality);
