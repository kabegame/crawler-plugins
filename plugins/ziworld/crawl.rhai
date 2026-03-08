// ziworld：category 为 checkbox 多选，运行时注入为 Map（选项名 -> true/false）
let res = fetch_json("https://t.ziworld.top/date.json");
let list = res["data"];
for item in list {
    // 仅处理用户勾选的目录
    if category[item.category] == true {
        let category_images = item.zids;
        let base_url = item.baseUrl;
        for zid in category_images {
            download_image(base_url + zid);
        }
    }
}
