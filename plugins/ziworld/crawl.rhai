// ziworld：category 为 checkbox 多选，运行时注入为 Map（选项名 -> true/false）
let res = fetch_json(`${base_url}/date.json`);
let list = res["data"];

// 先统计要爬取的总数（仅用户勾选的目录）
let total = 0;
for item in list {
    if category[item.category] == true {
        total += item.zids.len();
    }
}

let percent_per_image = if total > 0 { 100.0 / total } else { 0.0 };

for item in list {
    // 仅处理用户勾选的目录
    if category[item.category] == true {
        let category_images = item.zids;
        let base_url = item.baseUrl;
        for zid in category_images {
            download_image(base_url + zid);
            if total > 0 {
                add_progress(percent_per_image);
            }
        }
    }
}
