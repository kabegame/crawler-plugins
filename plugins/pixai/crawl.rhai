// PixAI：支持按模型、按标签、排行榜三种方式爬取作品

let api_url = "https://api.pixai.art/graphql";
let operation_models = "listGenerationModels";
let operation_artworks = "listArtworks";
let models_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"4d76952c681f7d0787077ddeec310f6475ab059e50546248120617abfb4031e9\"}}";

let artworks_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"e0c938939452d33abf3289e74b9f9f7bebd749e065ee905e7e073aca6f05199c\"}}";

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
                download_image(download_url);
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
                                print(`[PixAI] 下载 ${label} ${context_id} 第 ${downloaded_offset + downloaded + 1} 张（第 ${edge_idx + 1}/${edges.len()} 条）`);
                                download_image(image_url.to_string());
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

// 公共作品分页函数：query_key 为 "loraId" 或 "tackId"，label 用于日志
fn process_artworks(
    query_key,
    id,
    label,
    max_pages,
    api_url,
    operation_artworks,
    artworks_extensions,
    per_item_progress,
    media_api_base
) {
    let after_cursor = "";
    let artwork_page = 0;
    let downloaded = 0;
    let per_page_progress = if max_pages > 0 {
        per_item_progress / max_pages
    } else {
        0.0
    };

    print(`[PixAI] 处理${label}：${query_key}=${id}`);

    while artwork_page < max_pages {
        set_header("x-apollo-operation-name", operation_artworks);
        print(`[PixAI] ${label} ${id} 第 ${artwork_page + 1}/${max_pages} 页`);

        let variables = `{"${query_key}":"${id}","isSafeSearch":true,"first":24,"feed":"trending1"`;
        if after_cursor != "" {
            variables += `,"after":"${after_cursor}"`;
        }
        variables += "}";

        let url = `${api_url}?operation=${operation_artworks}&operationName=${operation_artworks}&variables=${url_encode(variables)}&extensions=${url_encode(artworks_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            print(`[PixAI] ${label} ${id} 响应缺少 data，停止`);
            break;
        }
        let artworks = data["artworks"];
        if artworks == () {
            print(`[PixAI] ${label} ${id} 响应缺少 artworks，停止`);
            break;
        }
        let edges = artworks["edges"];
        if edges == () || edges.len() == 0 {
            if artwork_page == 0 {
                print(`[PixAI] 警告：${label} ${id} 无任何作品数据，跳过`);
            } else {
                print(`[PixAI] ${label} ${id} 当前页无数据，停止`);
            }
            break;
        }
        print(`[PixAI] 作品页返回 ${edges.len()} 条`);

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

        let page_info = artworks["pageInfo"];
        if page_info == () {
            break;
        }
        let has_next_page = page_info["hasNextPage"];
        if has_next_page != true {
            print(`[PixAI] ${label} ${id} 无下一作品页`);
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
        after_cursor = next_after_str;
        artwork_page += 1;
    }

    print(`[PixAI] ${label}处理完成：${query_key}=${id}，共下载 ${downloaded} 张`);
    return downloaded;
}

// ─── 收集勾选的 tag id（从 checkbox map 中筛选 value==true 的 key）───
fn collect_selected_ids(tag_map) {
    let ids = [];
    let keys = tag_map.keys();
    let ki = 0;
    while ki < keys.len() {
        let k = keys[ki];
        if tag_map[k] == true {
            ids.push(k);
        }
        ki += 1;
    }
    return ids;
}

// ═══════════════════════ 主流程：按 crawl_type 分支 ═══════════════════════

if crawl_type == "tag" {
    // ──────────── 标签流 ────────────
    let tag_ids = [];
    let artwork_ids = collect_selected_ids(artwork_tags);
    let model_ids = collect_selected_ids(model_tags);

    let ai = 0;
    while ai < artwork_ids.len() {
        tag_ids.push(artwork_ids[ai]);
        ai += 1;
    }
    let mi = 0;
    while mi < model_ids.len() {
        tag_ids.push(model_ids[mi]);
        mi += 1;
    }

    if tag_ids.len() == 0 {
        print("[PixAI] 未勾选任何标签，结束");
        add_progress(100.0);
    } else {
        print(`[PixAI] 标签流：共 ${tag_ids.len()} 个标签，每标签最多 ${max_tag_artwork_pages} 页`);
        let per_tag_progress = 100.0 / tag_ids.len();
        let download_count = 0;
        let ti = 0;
        while ti < tag_ids.len() {
            let tag_id = tag_ids[ti];
            print(`[PixAI] 处理标签 ${ti + 1}/${tag_ids.len()}：tackId=${tag_id}`);
            let tag_downloaded = process_artworks(
                "tackId",
                tag_id,
                "标签",
                max_tag_artwork_pages,
                api_url,
                operation_artworks,
                artworks_extensions,
                per_tag_progress,
                media_api_base
            );
            download_count += tag_downloaded;
            ti += 1;
        }
        print(`[PixAI] 标签流结束：处理标签 ${tag_ids.len()} 个，下载图片 ${download_count} 张`);
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
                                    media_api_base
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
    // ──────────── 模型流（原有逻辑） ────────────
    let seen_model_ids = [];
    let before_cursor = "";
    let model_page = 0;
    let processed_models = 0;
    let download_count = 0;
    let progress_per_model_page = if max_model_pages > 0 {
        100.0 / max_model_pages
    } else {
        0.0
    };

    while model_page < max_model_pages {
        set_header("x-apollo-operation-name", operation_models);
        print(`[PixAI] 进入模型页：第 ${model_page + 1}/${max_model_pages} 页`);

        let variables = `{"feed":"trending","last":24`;
        if before_cursor != "" {
            variables += `,"before":"${before_cursor}"`;
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
                            media_api_base
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

        let page_info = generation_models["pageInfo"];
        if page_info == () {
            break;
        }
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
        before_cursor = next_before_str;
        model_page += 1;
    }

    print(`[PixAI] 任务结束：处理模型 ${processed_models} 个，下载图片 ${download_count} 张`);
    if processed_models == 0 {
        add_progress(100.0);
    }
}
