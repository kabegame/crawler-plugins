// PixAI：支持全站、按模型、按标签、排行榜四种方式爬取作品

let api_url = "https://api.pixai.art/graphql";
let operation_models = "listGenerationModels";
let operation_artworks = "listArtworks";
let operation_get_tack = "getTack";
let models_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"4d76952c681f7d0787077ddeec310f6475ab059e50546248120617abfb4031e9\"}}";

let artworks_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"e0c938939452d33abf3289e74b9f9f7bebd749e065ee905e7e073aca6f05199c\"}}";
let get_tack_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"4517f9180265ab50f2cf3a92f33d146b957c8d73ed165ef39b4bb8ec927bf813\"}}";

let ranking_artworks_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"1e5f998b229a3701595632cbb2c28ee69534c22d7a3499ab657ca465fff85497\"}}";
let ranking_models_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"1658f8e716184e95d3177d20fad189d8f7b250fb30e8401496ed0aaf34e4ad83\"}}";
let media_api_base = "https://api.pixai.art/v1/media/";

set_header("Accept", "application/json");
set_header("Content-Type", "application/json");
set_header("Origin", "https://pixai.art");
set_header("Referer", "https://pixai.art/");
set_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");

fn count_public_urls(urls) {
    if urls == () {
        return 0;
    }
    let count = 0;
    let uidx = 0;
    while uidx < urls.len() {
        let u = urls[uidx];
        let variant = u["variant"];
        let image_url = u["url"];
        if variant == "PUBLIC" && image_url != () {
            count += 1;
        }
        uidx += 1;
    }
    return count;
}

// 动图优先用 videoMediaId，否则用 mediaId；无可用 id 时返回空字符串
fn pick_media_id_for_download(node) {
    if node == () {
        return "";
    }
    let video_media_id = node["videoMediaId"];
    if video_media_id != () {
        let vid_str = video_media_id.to_string();
        if vid_str != "" {
            return vid_str;
        }
    }
    let media_id = node["mediaId"];
    if media_id != () {
        let mid_str = media_id.to_string();
        if mid_str != "" {
            return mid_str;
        }
    }
    return "";
}

// 处理单次 listArtworks 返回的 edges：按标签/模型流走 PUBLIC CDN；排行榜走 /v1/media/{id}/image
fn process_artworks_edges_for_download(
    edges,
    label,
    context_id,
    progress_budget,
    use_media_api,
    media_api_base,
    downloaded_offset
) {
    if edges == () || edges.len() == 0 {
        return 0;
    }
    let downloaded = 0;
    if use_media_api {
        let count_ok = 0;
        let ci = 0;
        while ci < edges.len() {
            let e = edges[ci];
            let n = e["node"];
            let mid = pick_media_id_for_download(n);
            if mid != "" {
                count_ok += 1;
            }
            ci += 1;
        }
        print(`[PixAI] ${label} ${context_id} 可经 media API 下载 ${count_ok}/${edges.len()} 条`);
        let progress_per = if count_ok > 0 {
            progress_budget / count_ok
        } else {
            0.0
        };
        let edge_idx = 0;
        while edge_idx < edges.len() {
            let edge = edges[edge_idx];
            let node = edge["node"];
            let media_id_str = pick_media_id_for_download(node);
            if media_id_str != "" {
                let title = "";
                if node != () {
                    let t = node["title"];
                    if t != () {
                        title = t.to_string();
                    }
                }
                let download_url = `${media_api_base}${media_id_str}/image`;
                print(`[PixAI] 下载 ${label} ${context_id} 第 ${downloaded_offset + downloaded + 1} 张（第 ${edge_idx + 1}/${edges.len()} 条）：${title}`);
                download_image(download_url, #{ name: title, metadata: node });
                downloaded += 1;
                if progress_per > 0.0 {
                    add_progress(progress_per);
                }
            }
            edge_idx += 1;
        }
    } else {
        let public_count = 0;
        let count_idx = 0;
        while count_idx < edges.len() {
            let edge = edges[count_idx];
            let node = edge["node"];
            if node != () {
                let media = node["media"];
                if media != () {
                    public_count += count_public_urls(media["urls"]);
                }
            }
            count_idx += 1;
        }
        print(`[PixAI] ${label} ${context_id} 作品页 PUBLIC 图片数 ${public_count}`);
        let progress_per_download = if public_count > 0 {
            progress_budget / public_count
        } else {
            0.0
        };
        let edge_idx = 0;
        while edge_idx < edges.len() {
            let edge = edges[edge_idx];
            let node = edge["node"];
            if node != () {
                let media = node["media"];
                if media != () {
                    let urls = media["urls"];
                    if urls != () {
                        let uidx = 0;
                        while uidx < urls.len() {
                            let u = urls[uidx];
                            let variant = u["variant"];
                            let image_url = u["url"];
                            if variant == "PUBLIC" && image_url != () {
                                let title = "";
                                let t = node["title"];
                                if t != () {
                                    title = t.to_string();
                                }
                                print(`[PixAI] 下载 ${label} ${context_id} 第 ${downloaded_offset + downloaded + 1} 张（第 ${edge_idx + 1}/${edges.len()} 条）：${title}`);
                                download_image(image_url.to_string(), #{ name: title, metadata: node });
                                downloaded += 1;
                                if progress_per_download > 0.0 {
                                    add_progress(progress_per_download);
                                }
                                break;
                            }
                            uidx += 1;
                        }
                    }
                }
            }
            edge_idx += 1;
        }
    }
    return downloaded;
}

// 公共作品分页函数：支持 tackId/loraId/全站（query_key 为空）与 7 种排序
fn process_artworks(
    query_key,
    id,
    label,
    max_pages,
    api_url,
    operation_artworks,
    artworks_extensions,
    per_item_progress,
    media_api_base,
    artwork_sort,
    skip_pages
) {
    let cursor = "";
    let artwork_page = 0;
    let downloaded = 0;
    let use_before_pagination = artwork_sort == "latest";
    let effective_pages = max_pages - skip_pages;
    let per_page_progress = if effective_pages > 0 {
        per_item_progress / effective_pages
    } else {
        0.0
    };

    let scope_desc = "全站";
    if query_key != "" && id != "" {
        scope_desc = `${query_key}=${id}`;
    }
    print(`[PixAI] 处理${label}：${scope_desc}，排序=${artwork_sort}，跳过页数=${skip_pages}`);

    while artwork_page < max_pages {
        set_header("x-apollo-operation-name", operation_artworks);
        if artwork_page < skip_pages {
            print(`[PixAI] ${label} ${scope_desc} 第 ${artwork_page + 1}/${max_pages} 页（跳过，仅获取游标）`);
        } else {
            print(`[PixAI] ${label} ${scope_desc} 第 ${artwork_page + 1}/${max_pages} 页（有效第 ${artwork_page - skip_pages + 1}/${effective_pages} 页）`);
        }

        let variables = `{"isSafeSearch":true`;
        if query_key != "" && id != "" {
            variables += `,"${query_key}":"${id}"`;
        }

        if artwork_sort == "trending" {
            variables += `,"first":24,"feed":"trending1"`;
        } else if artwork_sort == "daily_ranking" {
            variables += `,"first":24,"feed":"daily_ranking_dedup"`;
        } else if artwork_sort == "popular_desc" {
            variables += `,"first":24,"orderBy":"-markInfo.likedCount"`;
        } else if artwork_sort == "latest" {
            variables += `,"last":24,"feed":"latest"`;
        } else if artwork_sort == "popular_asc" {
            variables += `,"first":24,"orderBy":"markInfo.likedCount"`;
        } else if artwork_sort == "created_asc" {
            variables += `,"first":24,"orderBy":"createdAt"`;
        } else if artwork_sort == "created_desc" {
            variables += `,"first":24,"orderBy":"-createdAt"`;
        } else {
            // 未知排序兜底为趋势
            variables += `,"first":24,"feed":"trending1"`;
        }

        if cursor != "" {
            if use_before_pagination {
                variables += `,"before":"${cursor}"`;
            } else {
                variables += `,"after":"${cursor}"`;
            }
        }

        variables += "}";

        let url = `${api_url}?operation=${operation_artworks}&operationName=${operation_artworks}&variables=${url_encode(variables)}&extensions=${url_encode(artworks_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            print(`[PixAI] ${label} ${scope_desc} 响应缺少 data，停止`);
            break;
        }
        let artworks = data["artworks"];
        if artworks == () {
            print(`[PixAI] ${label} ${scope_desc} 响应缺少 artworks，停止`);
            break;
        }
        let edges = artworks["edges"];
        if edges == () || edges.len() == 0 {
            if artwork_page == 0 {
                print(`[PixAI] 警告：${label} ${scope_desc} 无任何作品数据，跳过`);
            } else {
                print(`[PixAI] ${label} ${scope_desc} 当前页无数据，停止`);
            }
            break;
        }
        print(`[PixAI] 作品页返回 ${edges.len()} 条`);

        if artwork_page >= skip_pages {
            let page_dl = process_artworks_edges_for_download(
                edges,
                label,
                id,
                per_page_progress,
                false,
                media_api_base,
                downloaded
            );
            downloaded += page_dl;
        }

        let page_info = artworks["pageInfo"];
        if page_info == () {
            break;
        }
        if use_before_pagination {
            let has_previous_page = page_info["hasPreviousPage"];
            if has_previous_page != true {
                print(`[PixAI] ${label} ${scope_desc} 无上一作品页`);
                break;
            }
            let next_before = page_info["startCursor"];
            if next_before == () {
                break;
            }
            let next_before_str = next_before.to_string();
            if next_before_str == "" {
                break;
            }
            cursor = next_before_str;
        } else {
            let has_next_page = page_info["hasNextPage"];
            if has_next_page != true {
                print(`[PixAI] ${label} ${scope_desc} 无下一作品页`);
                break;
            }
            let next_after = page_info["endCursor"];
            if next_after == () {
                break;
            }
            let next_after_str = next_after.to_string();
            if next_after_str == "" {
                break;
            }
            cursor = next_after_str;
        }
        artwork_page += 1;
    }

    print(`[PixAI] ${label}处理完成：${scope_desc}，排序=${artwork_sort}，共下载 ${downloaded} 张`);
    return downloaded;
}

// 作者作品分页函数：使用 authorId + types，支持 7 种排序
fn process_author_artworks(
    author_id,
    types_json,
    artwork_type_label,
    max_pages,
    api_url,
    operation_artworks,
    artworks_extensions,
    per_item_progress,
    media_api_base,
    artwork_sort,
    skip_pages
) {
    let cursor = "";
    let artwork_page = 0;
    let downloaded = 0;
    let use_before_pagination = artwork_sort == "latest";
    let effective_pages = max_pages - skip_pages;
    let per_page_progress = if effective_pages > 0 {
        per_item_progress / effective_pages
    } else {
        0.0
    };

    let scope_desc = `authorId=${author_id}, types=${artwork_type_label}`;
    print(`[PixAI] 处理作者流：${scope_desc}，排序=${artwork_sort}，跳过页数=${skip_pages}`);

    while artwork_page < max_pages {
        set_header("x-apollo-operation-name", operation_artworks);
        if artwork_page < skip_pages {
            print(`[PixAI] 作者流 ${scope_desc} 第 ${artwork_page + 1}/${max_pages} 页（跳过，仅获取游标）`);
        } else {
            print(`[PixAI] 作者流 ${scope_desc} 第 ${artwork_page + 1}/${max_pages} 页（有效第 ${artwork_page - skip_pages + 1}/${effective_pages} 页）`);
        }

        let variables = `{"authorId":"${author_id}","types":${types_json}`;

        if artwork_sort == "trending" {
            variables += `,"first":24,"feed":"trending1"`;
        } else if artwork_sort == "daily_ranking" {
            variables += `,"first":24,"feed":"daily_ranking_dedup"`;
        } else if artwork_sort == "popular_desc" {
            variables += `,"first":24,"orderBy":"-markInfo.likedCount"`;
        } else if artwork_sort == "latest" {
            variables += `,"last":24,"feed":"latest"`;
        } else if artwork_sort == "popular_asc" {
            variables += `,"first":24,"orderBy":"markInfo.likedCount"`;
        } else if artwork_sort == "created_asc" {
            variables += `,"first":24,"orderBy":"createdAt"`;
        } else if artwork_sort == "created_desc" {
            variables += `,"first":24,"orderBy":"-createdAt"`;
        } else {
            // 未知排序兜底为趋势
            variables += `,"first":24,"feed":"trending1"`;
        }

        if cursor != "" {
            if use_before_pagination {
                variables += `,"before":"${cursor}"`;
            } else {
                variables += `,"after":"${cursor}"`;
            }
        }

        variables += "}";

        let url = `${api_url}?operation=${operation_artworks}&operationName=${operation_artworks}&variables=${url_encode(variables)}&extensions=${url_encode(artworks_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            print(`[PixAI] 作者流 ${scope_desc} 响应缺少 data，停止`);
            break;
        }
        let artworks = data["artworks"];
        if artworks == () {
            print(`[PixAI] 作者流 ${scope_desc} 响应缺少 artworks，停止`);
            break;
        }
        let edges = artworks["edges"];
        if edges == () || edges.len() == 0 {
            if artwork_page == 0 {
                print(`[PixAI] 警告：作者流 ${scope_desc} 无任何作品数据，跳过`);
            } else {
                print(`[PixAI] 作者流 ${scope_desc} 当前页无数据，停止`);
            }
            break;
        }
        print(`[PixAI] 作者流作品页返回 ${edges.len()} 条`);

        if artwork_page >= skip_pages {
            let page_dl = process_artworks_edges_for_download(
                edges,
                "作者",
                author_id,
                per_page_progress,
                false,
                media_api_base,
                downloaded
            );
            downloaded += page_dl;
        }

        let page_info = artworks["pageInfo"];
        if page_info == () {
            break;
        }
        if use_before_pagination {
            let has_previous_page = page_info["hasPreviousPage"];
            if has_previous_page != true {
                print(`[PixAI] 作者流 ${scope_desc} 无上一作品页`);
                break;
            }
            let next_before = page_info["startCursor"];
            if next_before == () {
                break;
            }
            let next_before_str = next_before.to_string();
            if next_before_str == "" {
                break;
            }
            cursor = next_before_str;
        } else {
            let has_next_page = page_info["hasNextPage"];
            if has_next_page != true {
                print(`[PixAI] 作者流 ${scope_desc} 无下一作品页`);
                break;
            }
            let next_after = page_info["endCursor"];
            if next_after == () {
                break;
            }
            let next_after_str = next_after.to_string();
            if next_after_str == "" {
                break;
            }
            cursor = next_after_str;
        }
        artwork_page += 1;
    }

    print(`[PixAI] 作者流处理完成：${scope_desc}，排序=${artwork_sort}，共下载 ${downloaded} 张`);
    return downloaded;
}

// 通过 codeName 调用 getTack，解析出 tackId；失败返回空字符串
fn resolve_tack_id(
    code_name,
    api_url,
    operation_get_tack,
    get_tack_extensions
) {
    if code_name == () {
        return "";
    }

    let code_name_str = code_name.to_string();
    if code_name_str == "" {
        return "";
    }

    set_header("x-apollo-operation-name", operation_get_tack);
    let variables = `{"codeName":"${code_name_str}"}`;
    let url = `${api_url}?operation=${operation_get_tack}&operationName=${operation_get_tack}&variables=${url_encode(variables)}&extensions=${url_encode(get_tack_extensions)}`;
    let res = fetch_json(url);
    let data = res["data"];
    if data == () {
        print(`[PixAI] codeName=${code_name_str} 的 getTack 响应缺少 data`);
        return "";
    }
    let tack = data["tack"];
    if tack == () {
        print(`[PixAI] codeName=${code_name_str} 未解析到 tack`);
        return "";
    }
    let tack_id = tack["id"];
    if tack_id == () {
        print(`[PixAI] codeName=${code_name_str} 的 getTack 响应缺少 tack.id`);
        return "";
    }
    let tack_id_str = tack_id.to_string();
    if tack_id_str == "" {
        print(`[PixAI] codeName=${code_name_str} 解析到空 tackId`);
        return "";
    }
    return tack_id_str;
}

// ═══════════════════════ 主流程：按 crawl_type 分支 ═══════════════════════

if crawl_type == "global" {
    // ──────────── 全站流（不带 loraId / tackId）────────────
    print(`[PixAI] 全站流：排序=${artwork_sort}，最多 ${max_global_pages} 页，跳过 ${skip_artwork_pages} 页`);
    let download_count = process_artworks(
        "",
        "",
        "全站",
        max_global_pages,
        api_url,
        operation_artworks,
        artworks_extensions,
        100.0,
        media_api_base,
        artwork_sort,
        skip_artwork_pages
    );
    print(`[PixAI] 全站流结束：下载图片 ${download_count} 张`);
    if download_count == 0 {
        add_progress(100.0);
    }
} else if crawl_type == "tag" {
    // ──────────── 标签流 ────────────
    if tag_code_names == () || tag_code_names.len() == 0 {
        print("[PixAI] 未输入任何标签 codeName，结束");
        add_progress(100.0);
    } else {
        print(`[PixAI] 标签流：共 ${tag_code_names.len()} 个 codeName，每标签最多 ${max_tag_artwork_pages} 页，跳过 ${skip_artwork_pages} 页`);
        let per_tag_progress = 100.0 / tag_code_names.len();
        let download_count = 0;
        let resolved_count = 0;
        let ti = 0;
        while ti < tag_code_names.len() {
            let code_name = tag_code_names[ti];
            let code_name_str = code_name.to_string();
            print(`[PixAI] 处理标签 ${ti + 1}/${tag_code_names.len()}：codeName=${code_name_str}`);
            let tag_id = resolve_tack_id(
                code_name_str,
                api_url,
                operation_get_tack,
                get_tack_extensions
            );
            if tag_id == "" {
                print(`[PixAI] 跳过标签：codeName=${code_name_str} 无效或未找到对应 tackId`);
                add_progress(per_tag_progress);
                ti += 1;
                continue;
            }
            resolved_count += 1;
            print(`[PixAI] codeName=${code_name_str} -> tackId=${tag_id}`);
            let tag_downloaded = process_artworks(
                "tackId",
                tag_id,
                "标签",
                max_tag_artwork_pages,
                api_url,
                operation_artworks,
                artworks_extensions,
                per_tag_progress,
                media_api_base,
                artwork_sort,
                skip_artwork_pages
            );
            download_count += tag_downloaded;
            ti += 1;
        }
        print(`[PixAI] 标签流结束：输入 codeName ${tag_code_names.len()} 个，解析成功 ${resolved_count} 个，下载图片 ${download_count} 张`);
        if download_count == 0 {
            add_progress(100.0);
        }
    }
} else if crawl_type == "author" {
    // ──────────── 作者流 ────────────
    let author_id_str = "";
    if author_id != () {
        author_id_str = author_id.to_string();
    }
    if author_id_str == "" {
        print("[PixAI] 未输入作者 ID，结束");
        add_progress(100.0);
    } else {
        let author_types_json = "[\"DEFAULT\",\"ALBUM\"]";
        let author_type_label = "图片(DEFAULT+ALBUM)";
        if author_artwork_type == "animated" {
            author_types_json = "[\"ANIMATED_ARTWORK\"]";
            author_type_label = "动图(ANIMATED_ARTWORK)";
        }

        print(`[PixAI] 作者流：authorId=${author_id_str}，类型=${author_type_label}，排序=${artwork_sort}，最多 ${max_author_artwork_pages} 页，跳过 ${skip_artwork_pages} 页`);
        let download_count = process_author_artworks(
            author_id_str,
            author_types_json,
            author_type_label,
            max_author_artwork_pages,
            api_url,
            operation_artworks,
            artworks_extensions,
            100.0,
            media_api_base,
            artwork_sort,
            skip_artwork_pages
        );
        print(`[PixAI] 作者流结束：authorId=${author_id_str}，下载图片 ${download_count} 张`);
        if download_count == 0 {
            add_progress(100.0);
        }
    }
} else if crawl_type == "ranking" {
    // ──────────── 排行榜流 ────────────
    let feed = if rank_period == "today" { "rankv2_daily" }
               else if rank_period == "weekly" { "rankv2_weekly" }
               else { "rankv2_monthly" };

    if rank_type == "artwork" || rank_type == "animated" {
        let rank_media_type = if rank_type == "artwork" { "ARTWORK" } else { "ARTWORK_ANIMATED" };
        print(`[PixAI] 排行榜：${rank_type} / ${rank_period}，feed=${feed}，rankMediaType=${rank_media_type}`);

        set_header("x-apollo-operation-name", operation_artworks);
        let variables = `{"rankMediaType":"${rank_media_type}","feed":"${feed}","first":100,"isNsfw":false}`;
        let url = `${api_url}?operation=${operation_artworks}&operationName=${operation_artworks}&variables=${url_encode(variables)}&extensions=${url_encode(ranking_artworks_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            print("[PixAI] 排行榜响应缺少 data，结束");
            add_progress(100.0);
        } else {
            let artworks = data["artworks"];
            if artworks == () {
                print("[PixAI] 排行榜响应缺少 artworks，结束");
                add_progress(100.0);
            } else {
                let edges = artworks["edges"];
                if edges == () || edges.len() == 0 {
                    print("[PixAI] 排行榜无数据");
                    add_progress(100.0);
                } else {
                    print(`[PixAI] 排行榜返回 ${edges.len()} 条作品`);
                    let rank_ctx = `${rank_type}/${rank_period}`;
                    let download_count = process_artworks_edges_for_download(
                        edges,
                        "排行榜",
                        rank_ctx,
                        100.0,
                        true,
                        media_api_base,
                        0
                    );
                    print(`[PixAI] 排行榜（${rank_ctx}）结束：下载 ${download_count} 张`);
                    if download_count == 0 {
                        add_progress(100.0);
                    }
                }
            }
        }
    } else {
        let model_type = if rank_type == "model" { "ANY_MODEL" } else { "ANY_LORA" };
        let order_by = if rank_period == "today" { "-markInfo.artworkLikedCountAvgDaily" }
                       else if rank_period == "weekly" { "-markInfo.artworkLikedCountAvgWeekly" }
                       else { "-markInfo.artworkLikedCountAvgMonthly" };
        print(`[PixAI] 排行榜：${rank_type} / ${rank_period}，type=${model_type}，orderBy=${order_by}`);

        set_header("x-apollo-operation-name", operation_models);
        let variables = `{"type":"${model_type}","orderBy":"${order_by}","first":100}`;
        let url = `${api_url}?operation=${operation_models}&operationName=${operation_models}&variables=${url_encode(variables)}&extensions=${url_encode(ranking_models_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            print("[PixAI] 排行榜模型响应缺少 data，结束");
            add_progress(100.0);
        } else {
            let generation_models = data["generationModels"];
            if generation_models == () {
                print("[PixAI] 排行榜模型响应缺少 generationModels，结束");
                add_progress(100.0);
            } else {
                let edges = generation_models["edges"];
                if edges == () || edges.len() == 0 {
                    print("[PixAI] 排行榜模型无数据");
                    add_progress(100.0);
                } else {
                    print(`[PixAI] 排行榜返回 ${edges.len()} 个模型`);
                    let per_model_progress = 100.0 / edges.len();
                    let download_count = 0;
                    let processed_models = 0;
                    let edge_idx = 0;
                    while edge_idx < edges.len() {
                        let edge = edges[edge_idx];
                        let node = edge["node"];
                        if node != () {
                            let model_id = node["id"];
                            if model_id != () {
                                let model_id_str = model_id.to_string();
                                let title = node["title"];
                                if title == () { title = ""; }
                                print(`[PixAI] 排行榜模型 ${edge_idx + 1}/${edges.len()}：${title} (loraId=${model_id_str})`);
                                let model_downloaded = process_artworks(
                                    "loraId",
                                    model_id_str,
                                    "排行榜模型",
                                    max_artwork_pages_ranking,
                                    api_url,
                                    operation_artworks,
                                    artworks_extensions,
                                    per_model_progress,
                                    media_api_base,
                                "trending",
                                0
                                );
                                download_count += model_downloaded;
                                processed_models += 1;
                            }
                        }
                        edge_idx += 1;
                    }
                    print(`[PixAI] 排行榜（${rank_type}/${rank_period}）结束：处理模型 ${processed_models} 个，下载 ${download_count} 张`);
                    if download_count == 0 {
                        add_progress(100.0);
                    }
                }
            }
        }
    }
} else {
    // ──────────── 模型流（支持 7 种排序）────────────
    let seen_model_ids = [];
    let model_cursor = "";
    let use_before_pagination = model_sort == "trending"
        || model_sort == "latest_desc"
        || model_sort == "latest_asc";
    let model_page = 0;
    let processed_models = 0;
    let download_count = 0;
    let effective_model_pages = max_model_pages - skip_model_pages;
    let progress_per_model_page = if effective_model_pages > 0 {
        100.0 / effective_model_pages
    } else {
        0.0
    };

    print(`[PixAI] 模型流排序：${model_sort}，最多 ${max_model_pages} 页，跳过 ${skip_model_pages} 页`);

    while model_page < max_model_pages {
        set_header("x-apollo-operation-name", operation_models);
        if model_page < skip_model_pages {
            print(`[PixAI] 进入模型页：第 ${model_page + 1}/${max_model_pages} 页（跳过）`);
        } else {
            print(`[PixAI] 进入模型页：第 ${model_page + 1}/${max_model_pages} 页（有效第 ${model_page - skip_model_pages + 1}/${effective_model_pages} 页）`);
        }

        let variables = "";
        if model_sort == "trending" {
            variables = `{"feed":"trending","last":24`;
        } else if model_sort == "popular_desc" {
            variables = `{"feed":"meilisearch","orderBy":"-markInfo.likedCount","first":24`;
        } else if model_sort == "popular_asc" {
            variables = `{"feed":"meilisearch","orderBy":"markInfo.likedCount","first":24`;
        } else if model_sort == "gen_popular_desc" {
            variables = `{"feed":"meilisearch","orderBy":"-markInfo.refCount","first":24`;
        } else if model_sort == "gen_popular_asc" {
            variables = `{"feed":"meilisearch","orderBy":"markInfo.refCount","first":24`;
        } else if model_sort == "latest_desc" {
            variables = `{"feed":"latest","last":24`;
        } else if model_sort == "latest_asc" {
            variables = `{"feed":"latest","orderBy":"createdAt","last":24`;
        } else {
            // 未知排序兜底为趋势
            variables = `{"feed":"trending","last":24`;
        }

        if model_cursor != "" {
            if use_before_pagination {
                variables += `,"before":"${model_cursor}"`;
            } else {
                variables += `,"after":"${model_cursor}"`;
            }
        }
        variables += "}";

        let url = `${api_url}?operation=${operation_models}&operationName=${operation_models}&variables=${url_encode(variables)}&extensions=${url_encode(models_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            print("[PixAI] 模型响应缺少 data，结束");
            break;
        }
        let generation_models = data["generationModels"];
        if generation_models == () {
            print("[PixAI] 模型响应缺少 generationModels，结束");
            break;
        }
        let edges = generation_models["edges"];
        if edges == () || edges.len() == 0 {
            print("[PixAI] 当前模型页无数据，结束");
            break;
        }
        print(`[PixAI] 当前模型页模型数 ${edges.len()}`);
        if model_page >= skip_model_pages {
            let per_model_progress = if edges.len() > 0 {
                progress_per_model_page / edges.len()
            } else {
                0.0
            };

            let edge_idx = 0;
            while edge_idx < edges.len() {
                let edge = edges[edge_idx];
                let node = edge["node"];
                if node != () {
                    let model_id = node["id"];
                    if model_id != () {
                        let model_id_str = model_id.to_string();
                        let exists = false;
                        let seen_idx = 0;
                        while seen_idx < seen_model_ids.len() {
                            if seen_model_ids[seen_idx] == model_id_str {
                                exists = true;
                                break;
                            }
                            seen_idx += 1;
                        }

                        if !exists {
                            print(`[PixAI] 获取模型：模型页 ${model_page + 1} 的第 ${edge_idx + 1}/${edges.len()} 个，loraId=${model_id_str}`);
                            seen_model_ids.push(model_id_str);
                            let model_downloaded = process_artworks(
                                "loraId",
                                model_id_str,
                                "模型",
                                max_artwork_pages,
                                api_url,
                                operation_artworks,
                                artworks_extensions,
                                per_model_progress,
                                media_api_base,
                                artwork_sort,
                                skip_artwork_pages
                            );
                            download_count += model_downloaded;
                            processed_models += 1;
                        } else {
                            print(`[PixAI] 跳过重复模型：模型页 ${model_page + 1} 第 ${edge_idx + 1} 个，loraId=${model_id_str}`);
                        }
                    }
                }
                edge_idx += 1;
            }
        }

        let page_info = generation_models["pageInfo"];
        if page_info == () {
            break;
        }
        if use_before_pagination {
            let has_previous_page = page_info["hasPreviousPage"];
            if has_previous_page != true {
                break;
            }
            let next_before = page_info["startCursor"];
            if next_before == () {
                break;
            }
            let next_before_str = next_before.to_string();
            if next_before_str == "" {
                break;
            }
            model_cursor = next_before_str;
        } else {
            let has_next_page = page_info["hasNextPage"];
            if has_next_page != true {
                break;
            }
            let next_after = page_info["endCursor"];
            if next_after == () {
                break;
            }
            let next_after_str = next_after.to_string();
            if next_after_str == "" {
                break;
            }
            model_cursor = next_after_str;
        }
        model_page += 1;
    }

    print(`[PixAI] 任务结束：处理模型 ${processed_models} 个，下载图片 ${download_count} 张`);
    if processed_models == 0 {
        add_progress(100.0);
    }
}
