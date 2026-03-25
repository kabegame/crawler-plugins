// PixAI：外层分页拉模型，拿到模型后立刻调用函数抓取其作品 PUBLIC 图片

let api_url = "https://api.pixai.art/graphql";
let operation_models = "listGenerationModels";
let operation_artworks = "listArtworks";
let models_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"4d76952c681f7d0787077ddeec310f6475ab059e50546248120617abfb4031e9\"}}";

let artworks_extensions = "{\"clientLibrary\":{\"name\":\"@apollo/client\",\"version\":\"4.1.4\"},\"persistedQuery\":{\"version\":1,\"sha256Hash\":\"e0c938939452d33abf3289e74b9f9f7bebd749e065ee905e7e073aca6f05199c\"}}";

set_header("Accept", "application/json");
set_header("Content-Type", "application/json");
set_header("Origin", "https://pixai.art");
set_header("Referer", "https://pixai.art/");
set_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");

let safe_search_json = if safe_search { "true" } else { "false" };

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

fn process_model_artworks(
    model_id,
    model_page_index,
    model_index_in_page,
    total_models_in_page,
    max_artwork_pages,
    safe_search_json,
    api_url,
    operation_artworks,
    artworks_extensions,
    per_model_progress
) {
    let after_cursor = "";
    let artwork_page = 0;
    let downloaded = 0;
    let per_artwork_page_progress = if max_artwork_pages > 0 {
        per_model_progress / max_artwork_pages
    } else {
        0.0
    };

    print(`[PixAI] 处理模型：模型页 ${model_page_index} 的第 ${model_index_in_page}/${total_models_in_page} 个，loraId=${model_id}`);

    while artwork_page < max_artwork_pages {
        set_header("x-apollo-operation-name", operation_artworks);
        print(`[PixAI] 进入作品页：模型 ${model_id} 第 ${artwork_page + 1}/${max_artwork_pages} 页`);

        let variables = `{"loraId":"${model_id}","isSafeSearch":${safe_search_json},"first":24,"feed":"trending1"`;
        if after_cursor != "" {
            variables += `,"after":"${after_cursor}"`;
        }
        variables += "}";

        let url = `${api_url}?operation=${operation_artworks}&operationName=${operation_artworks}&variables=${url_encode(variables)}&extensions=${url_encode(artworks_extensions)}`;

        let res = fetch_json(url);
        let data = res["data"];
        if data == () {
            break;
        }
        let artworks = data["artworks"];
        if artworks == () {
            print("[PixAI] 作品响应缺少 artworks，停止当前模型");
            break;
        }
        let edges = artworks["edges"];
        if edges == () || edges.len() == 0 {
            print("[PixAI] 当前作品页无数据，停止当前模型");
            break;
        }
        print(`[PixAI] 作品页返回 ${edges.len()} 条`);

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
        print(`[PixAI] 作品页 PUBLIC 图片数 ${public_count}`);
        let progress_per_download = if public_count > 0 {
            per_artwork_page_progress / public_count
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
                                print(`[PixAI] 下载模型 ${model_id} 的第 ${downloaded + 1} 张（当前作品页第 ${edge_idx + 1}/${edges.len()} 条）`);
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

        let page_info = artworks["pageInfo"];
        if page_info == () {
            break;
        }
        let has_next_page = page_info["hasNextPage"];
        if has_next_page != true {
            print("[PixAI] 当前模型无下一作品页");
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

    print(`[PixAI] 模型处理完成：loraId=${model_id}，共下载 ${downloaded} 张`);

    return downloaded;
}

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
                    let model_downloaded = process_model_artworks(
                        model_id_str,
                        model_page + 1,
                        edge_idx + 1,
                        edges.len(),
                        max_artwork_pages,
                        safe_search_json,
                        api_url,
                        operation_artworks,
                        artworks_extensions,
                        per_model_progress
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
