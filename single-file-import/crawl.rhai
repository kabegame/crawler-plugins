// 单文件导入脚本
// 参数：file_path（本地图片文件路径，由前端文件选择器填入）
// 行为：仅调用一次 download_image，将这一张加入下载队列（或若已存在则跳过入队）

let p = "";
try {
    p = file_path;
} catch (err) {
    throw "错误：请选择要导入的图片文件";
}

if p == "" {
    throw "错误：图片文件路径为空";
}

// download_image 支持：
// - file:///xxx 的 file URL
// - 直接的本地路径（若存在）
try {
    download_image(p);
} catch (err) {
    throw "错误：加入下载队列失败 - " + err;
}

// 给任务一个可见的进度推进（下载在后台异步进行）
add_progress(99.9);
return;


