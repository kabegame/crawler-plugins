// 本地导入脚本（local-import）
// - path：导入本地图片文件 / ZIP / 文件夹（自动识别）
// - 兼容旧字段：file_path / folder_path

// 1) 读取输入路径（新字段优先，其次兼容旧字段）
let input_path = "";
try {
    input_path = path;
} catch (err) {}

if input_path == "" {
    try {
        input_path = file_path;
    } catch (err) {}
}
if input_path == "" {
    try {
        input_path = folder_path;
    } catch (err) {}
}

if input_path == "" {
    throw "错误：请设置 path（选择文件/ZIP/文件夹）";
}

// 定义默认的文件扩展名列表
let extensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
try {
    let user_extensions = file_extensions;
    if user_extensions.len() > 0 {
        extensions = user_extensions;
    }
} catch (err) {
    // 如果 file_extensions 未定义，使用默认值
}

// 检查是否启用递归扫描
let recursive_scan = false;
try {
    recursive_scan = recursive;
} catch (err) {
    recursive_scan = false;
}

// 2) 优先尝试按“文件夹”导入：能成功列出文件则视为文件夹
// list_local_files 使用 file URL；Rust 端会处理路径格式（包括 Windows 反斜杠）
let folder_url = "file:///" + input_path;
let files = [];
let is_folder = true;
try {
    files = list_local_files(folder_url, extensions, recursive_scan);
} catch (err) {
    is_folder = false;
}

if !is_folder {
    // 3) 不是文件夹：按“单文件/zip”导入
    // download_image 支持：
    // - file:///xxx 的 file URL
    // - 直接的本地路径（若存在）
    try {
        download_image(input_path);
    } catch (err) {
        throw "错误：加入下载队列失败 - " + err;
    }

    // 给任务一个可见的进度推进（下载在后台异步进行）
    add_progress(99.9);
    return;
}

let total_files = files.len();
if total_files == 0 {
    return;
}

// 99.9% / 总文件数（留 0.1% 给完成状态）
let progress_per_file = 99.9 / total_files.to_float();

let count = 0;
let file_idx = 0;
while file_idx < total_files {
    let file_path_item = files[file_idx];
    try {
        // download_image 会检测到是本地路径并进行复制
        if download_image(file_path_item) {
            count = count + 1;
        }
    } catch (err) {
        // 单个文件失败不影响整体
    }

    add_progress(progress_per_file);
    file_idx = file_idx + 1;
}

return;


