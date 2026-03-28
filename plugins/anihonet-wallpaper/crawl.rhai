// anihonetwallpaper.com：排行榜 + 作品索引（假名行）+ 主题模式（一覧关键字检索）（仅用现有 Rhai API）
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

// 作品列表分页：'.post_box2 .center' 示例「1 / 152 ページ」→ 总页数 152；解析失败则按 1 页（进度全摊在第一页）
fn parse_list_page_total_pages() {
    let texts = query(".post_box2 .center");
    if texts.len() == 0 {
        print("[anihonet]   未找到 .post_box2 .center，列表总页数按 1 计（进度分摊）");
        return 1;
    }
    let raw = texts[0];
    let s = raw.trim();
    print(`[anihonet]   分页文案(.post_box2 .center)：${s}`);
    if !re_is_match("(?s)[0-9]+[ \t]*/[ \t]*[0-9]+", s) {
        print("[anihonet]   分页文案未含「当前/总页」数字格式，总页数按 1 计");
        return 1;
    }
    let extracted = re_replace_all("(?s)^[ \t]*[0-9]+[ \t]*/[ \t]*([0-9]+).*$", "$1", s);
    if extracted == "" || extracted == s {
        print("[anihonet]   无法从分页文案提取总页数，按 1 计");
        return 1;
    }
    let t = parse_int(extracted);
    if t < 1 {
        print("[anihonet]   解析到的总页数无效，按 1 计");
        return 1;
    }
    print(`[anihonet]   解析到列表总页数（用于主题内按页均分进度）：${t}`);
    return t;
}

// 在作品タイトル一覧当前页：链接文案包含 theme_query 的第一个 div.post-list li > a
fn find_theme_list_href(theme_query) {
    let q = theme_query;
    if q == () {
        q = "";
    }
    q = q.trim();
    if q == "" {
        print("[anihonet] 主题关键字为空，请在插件配置中填写「主题关键字」");
        return "";
    }
    let hrefs = get_attr("div.post-list li > a", "href");
    let labels = query("div.post-list li > a");
    let n = hrefs.len();
    if labels.len() < n {
        n = labels.len();
    }
    if n == 0 {
        print("[anihonet] 未找到 div.post-list li > a，改试 div.post-list a");
        hrefs = get_attr("div.post-list a", "href");
        labels = query("div.post-list a");
        n = hrefs.len();
        if labels.len() < n {
            n = labels.len();
        }
    }
    if n == 0 {
        print("[anihonet] 索引页未解析到任何 .post-list 下的链接");
        return "";
    }
    let i = 0;
    let found_h = "";
    let match_count = 0;
    while i < n {
        let lab = labels[i].trim();
        if lab.contains(q) {
            match_count += 1;
            if found_h == "" {
                found_h = hrefs[i];
                print(`[anihonet] 命中链接（文案含「${q}」）：${lab}`);
            }
        }
        i += 1;
    }
    if found_h == "" {
        print(`[anihonet] 一覧中无链接文案包含「${q}」`);
        return "";
    }
    if match_count > 1 {
        print(`[anihonet] 共 ${match_count} 个链接含「${q}」，使用第一个`);
    }
    return found_h;
}

fn crawl_theme_from_index(theme_query, page_start, page_end) {
    let index_url = "https://anihonetwallpaper.com/anime-game-wallpaper";
    print(`[anihonet] 主题模式：打开作品索引 ${index_url}`);
    to(index_url);
    let rel = find_theme_list_href(theme_query);
    if rel == "" {
        print("[anihonet] 未匹配到主题，跳过下载并推进任务进度");
        add_progress(100.0);
        return;
    }
    print(`[anihonet] 进入匹配到的主题列表（相对链接 ${rel}）`);
    crawl_anime_series(rel, 100.0, "theme", 1, 1, page_start, page_end);
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

// 作品索引详情页：原图按钮 a.button.add-dl。work_pct_budget 为本作品在当前「列表页」内分摊到的进度（= 主题按列表总页均分后再按本页作品数均分）；再均分到每张图
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

// theme_pct_budget：本主题占全任务的比例（索引模式已按主题数平分）。user_list_end==0：整主题翻页，进度按 center 标称总页均分；user_list_end>0：仅抓取 [user_list_start,user_list_end] 列表页，进度按该页数均分
fn crawl_anime_series(series_href, theme_pct_budget, row_id, idx_in_row, total_in_row, user_list_start, user_list_end) {
    let full = resolve_url(series_href);
    print(`[anihonet] 进入作品列表页 行=${row_id} 第${idx_in_row}/${total_in_row} 个分类：${full}`);
    to(full);
    let list_total_pages = parse_list_page_total_pages();
    let range_mode = user_list_end > 0;
    let eff_start = user_list_start;
    if eff_start < 1 {
        eff_start = 1;
    }
    let eff_end = user_list_end;
    if range_mode && eff_start > eff_end {
        print(`[anihonet]   起始页 ${user_list_start} 大于结束页 ${user_list_end}，已自动交换`);
        let tmp = eff_start;
        eff_start = eff_end;
        eff_end = tmp;
    }
    let page_span = if range_mode {
        eff_end - eff_start + 1
    } else {
        list_total_pages
    };
    if page_span < 1 {
        page_span = 1;
    }
    let pct_per_list_page = theme_pct_budget / page_span;
    if range_mode {
        print(`[anihonet]   列表页范围：第 ${eff_start}〜${eff_end} 页（共 ${page_span} 页）；本主题 ${theme_pct_budget}% → 范围内每列表页约 ${pct_per_list_page}%`);
    } else {
        print(`[anihonet]   本主题进度 ${theme_pct_budget}% → 列表每页约 ${pct_per_list_page}%（按 center 标称 ${list_total_pages} 页均分）；页内再按作品数均分`);
    }
    let page_idx = 0;
    let in_range_pages_completed = 0;
    while true {
        page_idx += 1;
        if range_mode && page_idx > eff_end {
            break;
        }
        let should_process = !range_mode || (page_idx >= eff_start && page_idx <= eff_end);
        if should_process {
            print(`[anihonet]   ── 作品列表 第 ${page_idx} 页（本页列表进度份额 ${pct_per_list_page}%）──`);
            let detail_hrefs = collect_detail_page_hrefs();
            let n = detail_hrefs.len();
            print(`[anihonet]     本页解析到 ${n} 个作品链接`);
            if n == 0 {
                print("[anihonet]     本页无作品，本页进度份额计入已完成");
                if pct_per_list_page > 0.0 {
                    add_progress(pct_per_list_page);
                }
            } else {
                let work_pct_budget = pct_per_list_page / n;
                let d = 0;
                while d < n {
                    let wi = d + 1;
                    print(`[anihonet]     处理本页第 ${wi}/${n} 个作品（本页内进度权重 1/${n}）`);
                    process_anime_game_detail(detail_hrefs[d], work_pct_budget, wi, n);
                    d += 1;
                }
            }
            in_range_pages_completed += 1;
        } else if range_mode {
            print(`[anihonet]   作品列表 第 ${page_idx} 页早于起始页 ${eff_start}，不抓取，仅翻页`);
        }
        if range_mode && page_idx >= eff_end {
            print(`[anihonet]   已达设定结束页 ${eff_end}，停止翻页`);
            break;
        }
        let next_hrefs = get_attr(".post_box2 .p-next a", "href");
        if next_hrefs.len() == 0 {
            print(`[anihonet]   未找到下一页 .post_box2 .p-next a（当前第 ${page_idx} 页）`);
            break;
        }
        let nh = next_hrefs[0];
        if nh == () || nh == "" {
            print("[anihonet]   下一页 href 为空，列表结束");
            break;
        }
        let next_full = resolve_url(nh);
        print(`[anihonet]   下一页 → ${next_full}`);
        to(next_full);
    }
    if range_mode {
        let budget_used = pct_per_list_page * in_range_pages_completed;
        let remainder = theme_pct_budget - budget_used;
        if remainder > 0.0001 {
            print(`[anihonet]   范围内列表页实际处理 ${in_range_pages_completed}/${page_span}，补足主题进度 ${remainder}%`);
            add_progress(remainder);
        } else if remainder < -0.0001 {
            print(`[anihonet]   注意：进度分摊差额约 ${-remainder}%（实走与页范围不一致时可能出现）`);
        }
    } else {
        let budget_used_by_pages = pct_per_list_page * page_idx;
        let remainder = theme_pct_budget - budget_used_by_pages;
        if remainder > 0.0001 {
            print(`[anihonet]   列表提前结束，补足主题进度 ${remainder}%（标称 ${list_total_pages} 页、每页 ${pct_per_list_page}% 与实走 ${page_idx} 页之差）`);
            add_progress(remainder);
        } else if remainder < -0.0001 {
            print(`[anihonet]   注意：实走 ${page_idx} 页多于 center 标称 ${list_total_pages} 页，可能略超本主题份额约 ${-remainder}%`);
        }
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
    // 全任务 100%：每主题均分 → 主题内按列表页数（.post_box2 .center 总页）均分 → 每页内每作品均分 → 作品内每张图均分
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
            crawl_anime_series(series_hrefs[s], pct_per_theme, rid, si, nrow, 1, 0);
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
} else if crawl_mode != "ranking" && crawl_mode != "anime_game" && crawl_mode != "by_theme" {
    print("错误：crawl_mode 必须是 'ranking'、'anime_game' 或 'by_theme'");
} else if crawl_mode == "anime_game" {
    crawl_anime_game_index(anime_game_rows);
} else if crawl_mode == "by_theme" {
    crawl_theme_from_index(theme_search, theme_start_page, theme_end_page);
} else {
    crawl_kind(wallpaper_type, start_page, end_page, ranking_period);
}
