// Pixiv 爬虫：排行榜 / 收藏 / 画师 / 关键词
// Cookie 需在「高级设置 → HTTP 头」中填写
// 流式：按列表分页拉取，每拿到一个作品 ID 立即下载，达到 num_artworks 即停；不再预先扫完所有列表页

set_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");
set_header("Referer", "https://www.pixiv.net/");
set_header("Origin", "https://www.pixiv.net");
set_header("x-requested-with", "XMLHttpRequest");
set_header("Accept", "application/json");

// 排行榜 start_date / end_date：由 config 的 date.format 提交为 YYYYMMDD；闭区间 [start, end]

fn next_date(d) {
    let y = parse_int(d.sub_string(0, 4));
    let m = parse_int(d.sub_string(4, 2));
    let day = parse_int(d.sub_string(6, 2));
    let dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
        dim[1] = 29;
    }
    day += 1;
    if day > dim[m - 1] {
        day = 1;
        m += 1;
        if m > 12 { m = 1; y += 1; }
    }
    let ms = if m < 10 { "0" + m.to_string() } else { m.to_string() };
    let ds = if day < 10 { "0" + day.to_string() } else { day.to_string() };
    y.to_string() + ms + ds
}

fn add_artwork_progress() {
    if num_artworks > 0 {
        add_progress(99.0 / num_artworks);
    }
}

fn download_illust(illust_id) {
    set_header("Referer", "https://www.pixiv.net/artworks/" + illust_id);
    let url = "https://www.pixiv.net/ajax/illust/" + illust_id + "/pages?lang=zh";
    try {
        let json = fetch_json(url);
        let body = json["body"];
        if body == () {
            return;
        }
        let i = 0;
        while i < body.len() {
            let page = body[i];
            let urls = page["urls"];
            if urls != () {
                let orig = urls["original"];
                if orig != () {
                    download_image(orig);
                }
            }
            i += 1;
        }
    } catch {
        // 作品可能已删除/限制，跳过
    }
}

if source == "ranking" {
    if start_date == "" {
        throw "排行榜模式请选择起始日期";
    }
    if end_date == "" {
        throw "排行榜模式请选择结束日期";
    }
    if start_date > end_date {
        throw "结束日期不能早于起始日期";
    }
    let effective_content = content_mode;
    // R18 等与站点一致固定全部；日/周/月/AI 日榜可按 content= 传插画、漫画、动图等
    if ranking_mode == "daily_r18" || ranking_mode == "weekly_r18" || ranking_mode == "male_r18" || ranking_mode == "female_r18" || ranking_mode == "daily_r18_ai" {
        effective_content = "all";
    }
    set_header("x-requested-with", "XMLHttpRequest");
    let artworks_per_page = 50;
    let done = 0;
    let date_val = start_date;
    // 外层仅按日期区间推进；404 等只结束「当日」的 p 循环，不结束整段任务（未满 num_artworks 则继续后续日期）
    while date_val <= end_date {
        if done >= num_artworks {
            break;
        }
        let p = 1;
        while done < num_artworks {
            set_header("Referer", "https://www.pixiv.net/ranking.php?mode=" + ranking_mode + "&content=" + effective_content + "&date=" + date_val);
            let url = "https://www.pixiv.net/ranking.php?mode=" + ranking_mode + "&content=" + effective_content + "&date=" + date_val + "&p=" + p + "&format=json";
            let json = ();
            try {
                json = fetch_json(url);
            } catch {
                // HTTP 404 等：仅表示当日列表页用尽或该 URL 不可用，属「数量不足」路径，继续下一日历日
                break;
            }
            let contents = json["contents"];
            if contents == () {
                break;
            }
            let i = 0;
            while i < contents.len() && done < num_artworks {
                let item = contents[i];
                let id = item["illust_id"];
                if id != () {
                    download_illust(id.to_string());
                    done += 1;
                    add_artwork_progress();
                }
                i += 1;
            }
            if contents.len() < artworks_per_page {
                break;
            }
            p += 1;
        }
        date_val = next_date(date_val);
    }
} else if source == "bookmark" {
    if user_id == "" {
        throw "收藏模式请填写用户 UID";
    }
    let limit = 48;
    let offset = 0;
    let done = 0;
    while done < num_artworks {
        let url = "https://www.pixiv.net/ajax/user/" + user_id + "/illusts/bookmarks?tag=&offset=" + offset.to_string() + "&limit=" + limit.to_string() + "&rest=show&lang=zh";
        let json = ();
        try {
            json = fetch_json(url);
        } catch {
            break;
        }
        let body = json["body"];
        if body == () {
            break;
        }
        let works = body["works"];
        if works == () {
            break;
        }
        let i = 0;
        while i < works.len() && done < num_artworks {
            let w = works[i];
            let id = w["id"];
            if id != () {
                download_illust(id.to_string());
                done += 1;
                add_artwork_progress();
            }
            i += 1;
        }
        if works.len() < limit {
            break;
        }
        offset = offset + limit;
    }
} else if source == "user" {
    if artist_id == "" {
        throw "画师模式请填写画师 UID";
    }
    if user_id == "" {
        throw "画师模式请填写登录用户 UID（x-user-id，与 PixivCrawler 一致）";
    }
    set_header("x-user-id", user_id);
    let url = "https://www.pixiv.net/ajax/user/" + artist_id + "/profile/all?lang=zh";
    let json = fetch_json(url);
    let body = json["body"];
    if body == () {
        throw "无法获取画师作品列表";
    }
    let illusts = body["illusts"];
    let done = 0;
    if illusts != () {
        for id in illusts.keys() {
            if done >= num_artworks {
                break;
            }
            download_illust(id);
            done += 1;
            add_artwork_progress();
        }
    }
} else if source == "keyword" {
    if keyword == "" {
        throw "关键词模式请填写搜索关键词";
    }
    let kw_enc = url_encode(keyword);
    let order_param = if keyword_order == "popular" { "popular_d" } else { "date_d" };
    let limit = 60;
    let p = 1;
    let done = 0;
    while done < num_artworks {
        let url = "https://www.pixiv.net/ajax/search/artworks/" + kw_enc + "?word=" + kw_enc + "&order=" + order_param + "&mode=" + search_mode + "&p=" + p + "&s_mode=s_tag_full&type=all&lang=zh";
        let json = ();
        try {
            json = fetch_json(url);
        } catch {
            break;
        }
        let body = json["body"];
        if body == () {
            break;
        }
        let illust_manga = body["illustManga"];
        if illust_manga == () {
            break;
        }
        let data = illust_manga["data"];
        if data == () {
            break;
        }
        let i = 0;
        while i < data.len() && done < num_artworks {
            let item = data[i];
            let id = item["id"];
            if id != () {
                download_illust(id.to_string());
                done += 1;
                add_artwork_progress();
            }
            i += 1;
        }
        if data.len() < limit {
            break;
        }
        p += 1;
    }
} else {
    throw "未知的爬取类型: " + source;
}
