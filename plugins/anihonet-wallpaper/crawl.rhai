// anihonetwallpaper.com：排行榜模式 + アニメ・ゲーム作品索引模式（仅用现有 Rhai API）
// 索引页结构：多段 div.post-list，每段以 <h3 id="a|ka|sa|..."> 开头；wa 段后以 <div id="side" 结束。
// 注意：Rhai 函数体不能读取脚本顶层的 let；注入的 checkbox（Map）常量也可能在 fn 内无法按名访问，须从顶层调用处作为参数传入。

fn anihonet_row_ids() {
    return ["a", "ka", "sa", "ta", "na", "ha", "ma", "ya", "ra", "wa"];
}

// 从 URL 中提取“文件名”（忽略 query/hash，只取最后一个 '/' 之后的部分）
fn extract_filename(url) {
    let no_query = url.split("?")[0];
    let no_hash = no_query.split("#")[0];
    let parts = no_hash.split("/");
    if parts.len() == 0 {
        return "";
    }
    return parts[parts.len() - 1];
}

fn is_android_image(url) {
    let filename = extract_filename(url);
    return re_is_match("(?i)android", filename);
}

fn total_pages() {
    return end_page - start_page + 1;
}

// start_pat 第一次出现之后、end_pat 第一次出现之前的子串（均不含边界标记）
fn slice_between(html, start_pat, end_pat) {
    let a = html.split(start_pat);
    if a.len() < 2 {
        return "";
    }
    let b = a[1].split(end_pat);
    return b[0];
}

// 从 HTML 片段中收集 href=" / href='（站内 li 链接）
fn hrefs_from_fragment(frag) {
    let out = [];
    let parts = frag.split("href=\"");
    let i = 1;
    while i < parts.len() {
        let tail = parts[i];
        let q = tail.split("\"")[0];
        if q.len() > 0 && q != "#" && !re_is_match("(?i)^javascript:", q) {
            out.push(q);
        }
        i += 1;
    }
    let parts2 = frag.split("href='");
    let j = 1;
    while j < parts2.len() {
        let tail2 = parts2[j];
        let q2 = tail2.split("'")[0];
        if q2.len() > 0 && q2 != "#" && !re_is_match("(?i)^javascript:", q2) {
            out.push(q2);
        }
        j += 1;
    }
    return out;
}

fn count_index_series_links(html, rows) {
    let row_order = anihonet_row_ids();
    let total = 0;
    let idx = 0;
    while idx < row_order.len() {
        let rid = row_order[idx];
        if rows[rid] != true {
            idx += 1;
            continue;
        }
        let start_pat = `<h3 id="` + rid + `"`;
        let end_pat = if idx < 9 {
            `<h3 id="` + row_order[idx + 1] + `"`
        } else {
            `<div id="side"`
        };
        let frag = slice_between(html, start_pat, end_pat);
        let hrefs = hrefs_from_fragment(frag);
        total += hrefs.len();
        idx += 1;
    }
    total
}

// 作品列表页：进入各作品详情页的链接（与站内 $$('.itiran:last-of-type > a:last-of-type') 一致）
fn collect_detail_page_hrefs() {
    return get_attr(".itiran:last-of-type > a", "href");
}

// 按 href 尝试下载（resize / 扩展名 / 桌面·手机 过滤）。progress_slice：本链接在「作品索引」模式下分摊到的进度（含跳过也计入，保证总和）；排行榜传 0
fn process_download_href(href, progress_slice) {
    if href == () || href == "" {
        print("[anihonet]     跳过：空 href");
        if progress_slice > 0.0 {
            add_progress(progress_slice);
        }
        return;
    }
    let full_image = resolve_url(href);
    if re_is_match("(?i)resize", full_image) {
        print(`[anihonet]     跳过：URL 含 resize（缩略图）→ ${full_image}`);
        if progress_slice > 0.0 {
            add_progress(progress_slice);
        }
        return;
    }
    if !is_image_url(full_image) {
        print(`[anihonet]     跳过：非图片扩展名 URL → ${full_image}`);
        if progress_slice > 0.0 {
            add_progress(progress_slice);
        }
        return;
    }
    let is_android = is_android_image(full_image);
    if wallpaper_type == "sp" && !is_android {
        print(`[anihonet]     跳过：当前为手机壁纸模式，跳过非 Android 文件名 → ${full_image}`);
        if progress_slice > 0.0 {
            add_progress(progress_slice);
        }
        return;
    }
    if wallpaper_type == "imgpc" && is_android {
        print(`[anihonet]     跳过：当前为桌面壁纸模式，跳过 Android 文件名 → ${full_image}`);
        if progress_slice > 0.0 {
            add_progress(progress_slice);
        }
        return;
    }
    print(`[anihonet]     开始下载：${full_image}`);
    download_image(full_image);
    if progress_slice > 0.0 {
        add_progress(progress_slice);
    }
}

// 排行榜详情：原图按钮 a.button:not(.add)。work_pct_budget 为本条排行作品在本页内分摊到的总进度，再均分到每张图
fn process_ranking_detail_page(href, item_idx, item_total, work_pct_budget) {
    let full_url = resolve_url(href);
    print(`[anihonet] 进入排行榜详情页 ${item_idx}/${item_total}：${full_url}`);
    to(full_url);
    let dl_hrefs = get_attr("a.button:not(.add)", "href");
    let ne = dl_hrefs.len();
    print(`[anihonet]   本页共 ${ne} 个 a.button:not(.add) 下载链接`);
    let pct_per_img = if ne > 0 {
        work_pct_budget / ne
    } else {
        0.0
    };
    if ne == 0 && work_pct_budget > 0.0 {
        add_progress(work_pct_budget);
    }
    let elem_idx = 0;
    while elem_idx < ne {
        let img_i = elem_idx + 1;
        print(`[anihonet]   下载第 ${img_i}/${ne} 张（按链接顺序尝试）`);
        process_download_href(dl_hrefs[elem_idx], pct_per_img);
        elem_idx += 1;
    }
    back();
}

// 作品索引详情页：原图按钮 a.button.add-dl。work_pct_budget 为本作品在主题内分摊到的总进度；再均分到每张图
fn process_anime_game_detail(href, work_pct_budget, work_idx, work_total) {
    let full = resolve_url(href);
    print(`[anihonet]   进入作品详情页 ${work_idx}/${work_total}：${full}`);
    to(full);
    let dl_hrefs = get_attr("a.button.add-dl", "href");
    let m = dl_hrefs.len();
    print(`[anihonet]     本页共 ${m} 个 a.button.add-dl 原图下载按钮`);
    let pct_per_img = if m > 0 {
        work_pct_budget / m
    } else {
        0.0
    };
    if m == 0 && work_pct_budget > 0.0 {
        add_progress(work_pct_budget);
    }
    let k = 0;
    while k < m {
        let img_i = k + 1;
        print(`[anihonet]     下载第 ${img_i}/${m} 张（按链接顺序尝试）`);
        process_download_href(dl_hrefs[k], pct_per_img);
        k += 1;
    }
    back();
}

// theme_pct_budget：本主题占全任务的比例（已按主题数平分）；在内部分给各作品、各图
fn crawl_anime_series(series_href, theme_pct_budget, row_id, idx_in_row, total_in_row) {
    let full = resolve_url(series_href);
    print(`[anihonet] 进入作品列表页 行=${row_id} 第${idx_in_row}/${total_in_row} 个分类：${full}`);
    to(full);
    let detail_hrefs = collect_detail_page_hrefs();
    let n = detail_hrefs.len();
    print(`[anihonet]   此列表下共 ${n} 个作品（将进入各详情页）`);
    if n == 0 {
        back();
        if theme_pct_budget > 0.0 {
            add_progress(theme_pct_budget);
        }
        return;
    }
    let work_pct_budget = theme_pct_budget / n;
    let d = 0;
    while d < n {
        let wi = d + 1;
        print(`[anihonet]   开始处理第 ${wi}/${n} 个作品（本主题内进度权重 1/${n}）`);
        process_anime_game_detail(detail_hrefs[d], work_pct_budget, wi, n);
        d += 1;
    }
    back();
}

fn crawl_anime_game_index(rows) {
    let index_url = "https://anihonetwallpaper.com/anime-game-wallpaper";
    print(`[anihonet] 进入作品索引页：${index_url}`);
    to(index_url);
    let html = current_html();
    let total_series = count_index_series_links(html, rows);
    print(`[anihonet] 全任务将遍历 ${total_series} 个「作品列表」入口（按勾选行累计）`);
    if total_series == 0 {
        print("[anihonet] 未勾选任何行，或索引页未解析到作品链接");
        return;
    }
    // 全任务 100%：每主题均分 → 主题内每作品均分 → 作品内每张图均分（跳过/失败也计该图份额）
    let pct_per_theme = 100.0 / total_series;
    print(`[anihonet] 进度分摊：每主题 ${pct_per_theme}% ，其下作品与图片再逐级均分`);
    let row_order = anihonet_row_ids();
    let idx = 0;
    while idx < row_order.len() {
        let rid = row_order[idx];
        if rows[rid] != true {
            idx += 1;
            continue;
        }
        let start_pat = `<h3 id="` + rid + `"`;
        let end_pat = if idx < 9 {
            `<h3 id="` + row_order[idx + 1] + `"`
        } else {
            `<div id="side"`
        };
        let frag = slice_between(html, start_pat, end_pat);
        let series_hrefs = hrefs_from_fragment(frag);
        let nrow = series_hrefs.len();
        print(`[anihonet] 假名行 id=${rid}：本段共 ${nrow} 个作品列表链接`);
        let s = 0;
        while s < nrow {
            let si = s + 1;
            crawl_anime_series(series_hrefs[s], pct_per_theme, rid, si, nrow);
            s += 1;
        }
        idx += 1;
    }
}

fn crawl_kind(kind, start_page, end_page, period) {
    let total_pg = total_pages();
    let pct_per_page = if total_pg > 0 {
        100.0 / total_pg
    } else {
        0.0
    };
    print(`[anihonet] 排行榜进度分摊：全任务 100% → 每列表页 ${pct_per_page}%（共 ${total_pg} 页）→ 页内每条 a 均分 → 详情内每图均分`);
    let pg = start_page;
    while pg <= end_page {
        let start_url = `https://anihonetwallpaper.com/ranking-${period}-${kind}/${pg}`;
        print(`[anihonet] 进入排行榜列表页 第${pg}/${end_page} 页：${start_url}`);
        to(start_url);
        let hrefs = get_attr("article .ranking-frame a", "href");
        let total_links = hrefs.len();
        print(`[anihonet] 本页解析到 ${total_links} 个 a 链接（将依次进入详情）`);
        if total_links == 0 {
            if pct_per_page > 0.0 {
                add_progress(pct_per_page);
            }
            pg += 1;
            continue;
        }
        let pct_per_item = pct_per_page / total_links;
        let idx = 0;
        while idx < total_links {
            let ii = idx + 1;
            process_ranking_detail_page(hrefs[idx], ii, total_links, pct_per_item);
            idx += 1;
        }
        pg += 1;
    }
}

if wallpaper_type != "imgpc" && wallpaper_type != "sp" {
    print("错误：wallpaper_type 必须是 'imgpc' 或 'sp'");
} else if crawl_mode != "ranking" && crawl_mode != "anime_game" {
    print("错误：crawl_mode 必须是 'ranking' 或 'anime_game'");
} else if crawl_mode == "anime_game" {
    crawl_anime_game_index(anime_game_rows);
} else {
    crawl_kind(wallpaper_type, start_page, end_page, ranking_period);
}
