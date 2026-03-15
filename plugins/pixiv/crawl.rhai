// Pixiv 爬虫：排行榜 / 收藏 / 画师 / 关键词
// Cookie 需在「高级设置 → HTTP 头」中填写

set_header("Referer", "https://www.pixiv.net/");
set_header("Origin", "https://www.pixiv.net");
set_header("x-requested-with", "XMLHttpRequest");
set_header("Accept", "application/json");

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

fn collect_illust_ids() {
    let ids = [];
    if source == "ranking" {
        if start_date == "" {
            throw "排行榜模式请填写起始日期（格式 YYYYMMDD）";
        }
        if user_id != "" && (ranking_mode == "daily_r18" || ranking_mode == "weekly_r18" || ranking_mode == "male_r18" || ranking_mode == "female_r18" || ranking_mode == "daily_r18_ai") {
            set_header("x-user-id", user_id);
        }
        let effective_content = content_mode;
        if ranking_mode == "monthly" || ranking_mode == "daily_r18" || ranking_mode == "weekly_r18" || ranking_mode == "male_r18" || ranking_mode == "female_r18" || ranking_mode == "daily_r18_ai" {
            effective_content = "all";
        }
        set_header("x-requested-with", "XMLHttpRequest");
        let artworks_per_page = 50;
        let num_pages = ((num_images - 1) / artworks_per_page) + 1;
        let date_val = start_date;
        let day = 0;
        while day < date_range {
            let p = 1;
            while p <= num_pages && ids.len() < num_images {
                set_header("Referer", "https://www.pixiv.net/ranking.php?mode=" + ranking_mode + "&content=" + effective_content + "&date=" + date_val);
                let url = "https://www.pixiv.net/ranking.php?mode=" + ranking_mode + "&content=" + effective_content + "&date=" + date_val + "&p=" + p + "&format=json";
                let json = fetch_json(url);
                let contents = json["contents"];
                if contents == () {
                    break;
                }
                let i = 0;
                while i < contents.len() {
                    let item = contents[i];
                    let id = item["illust_id"];
                    if id != () {
                        ids.push(id.to_string());
                    }
                    i += 1;
                }
                p += 1;
            }
            date_val = next_date(date_val);
            day += 1;
        }
    } else if source == "bookmark" {
        if user_id == "" {
            throw "收藏模式请填写用户 UID";
        }
        set_header("x-user-id", user_id);
        let limit = 48;
        let offset = 0;
        while offset < num_images {
            let url = "https://www.pixiv.net/ajax/user/" + user_id + "/illusts/bookmarks?tag=&offset=" + offset.to_string() + "&limit=" + limit.to_string() + "&rest=show&lang=zh";
            let json = fetch_json(url);
            let body = json["body"];
            if body == () {
                break;
            }
            let works = body["works"];
            if works == () {
                break;
            }
            let i = 0;
            while i < works.len() {
                let w = works[i];
                let id = w["id"];
                if id != () {
                    ids.push(id.to_string());
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
        set_header("x-user-id", user_id);
        let url = "https://www.pixiv.net/ajax/user/" + artist_id + "/profile/all?lang=zh";
        let json = fetch_json(url);
        let body = json["body"];
        if body == () {
            throw "无法获取画师作品列表";
        }
        let illusts = body["illusts"];
        if illusts != () {
            let count = 0;
            for id in illusts.keys() {
                if count >= num_images {
                    break;
                }
                ids.push(id);
                count += 1;
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
        while ids.len() < num_images {
            let url = "https://www.pixiv.net/ajax/search/artworks/" + kw_enc + "?word=" + kw_enc + "&order=" + order_param + "&mode=" + search_mode + "&p=" + p + "&s_mode=s_tag_full&type=all&lang=zh";
            let json = fetch_json(url);
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
            while i < data.len() {
                let item = data[i];
                let id = item["id"];
                if id != () {
                    ids.push(id.to_string());
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
    return ids;
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

let illust_ids = collect_illust_ids();
let total = illust_ids.len();
let to_process = total;
if to_process > num_images {
    to_process = num_images;
}
let idx = 0;
while idx < to_process {
    let id = illust_ids[idx];
    download_illust(id);
    if to_process > 0 {
        add_progress(99.0 / to_process);
    }
    idx += 1;
}
