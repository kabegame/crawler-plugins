// Pixiv 爬虫：排行榜 / 收藏 / 画师 / 关键词
// 非 R18 排行榜一般无需 Cookie；R18 榜、收藏、画师、关键词等需在「高级设置 → HTTP 头」填写有效 Cookie（含年龄认证）。
// 流式：按列表分页拉取，每拿到一个作品 ID 立即下载，达到 num_artworks 即停。
// 排行榜：榜序 + 内容类型 + 年龄向（config）；单日期 ranking_date，留空不传 date（Pixiv 返回最新）；分页由响应的 next 字段驱动。

set_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");
set_header("Referer", "https://www.pixiv.net/");
set_header("Origin", "https://www.pixiv.net");
set_header("x-requested-with", "XMLHttpRequest");
set_header("Accept", "application/json");

fn add_artwork_progress() {
    if num_artworks > 0 {
        add_progress(99.0 / num_artworks);
    }
}

/// 日/周/月/新生榜可选 content；其余榜序站点固定为 all
fn effective_content_for_ranking(rm, cm) {
    if rm == "daily" || rm == "weekly" || rm == "monthly" || rm == "rookie" {
        return cm;
    }
    "all"
}

/// age_mode=r18 时拼接 Pixiv mode 参数（daily_ai → daily_r18_ai）
fn ranking_pixiv_mode(rm, am) {
    if am != "r18" {
        return rm;
    }
    if rm == "daily_ai" {
        return "daily_r18_ai";
    }
    rm + "_r18"
}

/// 仅保留 description.ejs 展示所需字段，避免整份 ajax/illust body（userIllusts、zoneConfig 等）入库。
fn pixiv_trim_illust_body(ib) {
    #{
        illustId: ib["illustId"],
        id: ib["id"],
        title: ib["title"],
        illustTitle: ib["illustTitle"],
        description: ib["description"],
        illustComment: ib["illustComment"],
        userId: ib["userId"],
        userName: ib["userName"],
        uploadDate: ib["uploadDate"],
        createDate: ib["createDate"],
        bookmarkCount: ib["bookmarkCount"],
        likeCount: ib["likeCount"],
        viewCount: ib["viewCount"],
        tags: ib["tags"],
    }
}

fn download_illust(illust_id) {
    set_header("Referer", "https://www.pixiv.net/artworks/" + illust_id);
    // ① 详情：body 为作品对象 → 写入 metadata（与官网「作品页」同源）
    let illust_body = ();
    try {
        let detail = fetch_json("https://www.pixiv.net/ajax/illust/" + illust_id);
        let ib = detail["body"];
        if ib != () {
            illust_body = ib;
        }
    } catch {
    }

    // ② 分页原图：只有 /pages 的 body 才是「每页一张图」的数组，不可再请求 ① 的同 URL
    // 多页作品：下载名 title(1)、title(2)…；仅一页时只用 title（无后缀）
    let url = "https://www.pixiv.net/ajax/illust/" + illust_id + "/pages";
    try {
        let json = fetch_json(url);
        let body = json["body"];
        if body == () {
            return;
        }
        let page_count = 0;
        let pc = 0;
        while pc < body.len() {
            let pg = body[pc];
            let u = pg["urls"];
            if u != () && u["original"] != () {
                page_count += 1;
            }
            pc += 1;
        }
        let base = if illust_body != () {
            let t = illust_body["title"];
            if t != () { t.to_string() } else { illust_id.to_string() }
        } else {
            illust_id.to_string()
        };
        // ③ 评论快照：静态获取第一页评论存入元数据，供 EJS 静态渲染（失败只 warn，不中断）
        let pixiv_comments = [];
        try {
            set_header("Referer", "https://www.pixiv.net/artworks/" + illust_id);
            let c_url = "https://www.pixiv.net/ajax/illusts/comments/roots?illust_id="
                + illust_id + "&offset=0&limit=20&lang=en";
            let cj = fetch_json(c_url);
            if cj != () && cj["error"] != true && cj["body"] != () {
                let cl = cj["body"]["comments"];
                if cl != () { pixiv_comments = cl; }
            }
        } catch {
            warn("[Pixiv] 评论获取失败，illust_id=" + illust_id);
        }

        let meta_id = if illust_body != () {
            let trimmed = pixiv_trim_illust_body(illust_body);
            create_image_metadata(#{ body: trimmed, comments: pixiv_comments })
        } else {
            create_image_metadata(#{ illustId: illust_id })
        };
        let i = 0;
        let page_idx = 0;
        while i < body.len() {
            let page = body[i];
            let urls = page["urls"];
            if urls != () {
                let orig = urls["original"];
                if orig != () {
                    page_idx += 1;
                    let disp = if page_count > 1 {
                        base + "(" + page_idx.to_string() + ")"
                    } else {
                        base
                    };
                    download_image(orig, #{ name: disp, metadata_id: meta_id });
                }
            }
            i += 1;
        }
    } catch {
        // 作品可能已删除/限制，跳过
    }
}

if source == "ranking" {
    let effective_content = effective_content_for_ranking(ranking_mode, content_mode);
    if (ranking_mode == "monthly" || ranking_mode == "rookie") && effective_content == "ugoira" {
        throw "月榜与新生榜不支持动图（うごイラ）内容类型";
    }
    let api_mode = ranking_pixiv_mode(ranking_mode, age_mode);
    if age_mode == "r18" {
        if user_id == "" {
            throw "R18 排行榜请在「用户 UID」填写登录账号 UID（x-user-id）";
        }
        set_header("x-user-id", user_id);
    }
    set_header("x-requested-with", "XMLHttpRequest");
    let done = 0;
    let p = 1;
    while done < num_artworks {
        let date_q = if ranking_date == "" { "" } else { "&date=" + ranking_date };
        let ref_base = "https://www.pixiv.net/ranking.php?mode=" + api_mode + "&content=" + effective_content + date_q;
        set_header("Referer", ref_base);
        let list_url = "https://www.pixiv.net/ranking.php?mode=" + api_mode + "&content=" + effective_content + date_q + "&p=" + p.to_string() + "&format=json";
        let json = ();
        try {
            json = fetch_json(list_url);
        } catch {
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
        if done >= num_artworks {
            break;
        }
        let nxt = json["next"];
        if nxt == () {
            break;
        }
        if nxt == false {
            break;
        }
        p = parse_int(nxt.to_string());
    }
    if done < num_artworks {
        warn("排行榜实际只获取到 " + done.to_string() + " 个作品，少于请求的 " + num_artworks.to_string() + " 个（可能已到底或无更多页）");
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
        // profile/all 的 illusts 为对象，键顺序与站点列表一致；站点从后往前加载，故逆序遍历
        let key_list = illusts.keys();
        let ki = key_list.len() - 1;
        while ki >= 0 {
            if done >= num_artworks {
                break;
            }
            let id = key_list[ki];
            download_illust(id);
            // TODO: 去掉限制（done默认为0）
            // TODO: 添加起止页数，每页48个，程序计算，不指定默认全部
            done += 1;
            add_artwork_progress();
            ki -= 1;
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
