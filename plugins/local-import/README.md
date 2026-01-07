# 本地导入插件（local-import）

合并版导入插件：用一个插件同时支持**导入单文件**和**导入文件夹**。

## 设计要点

- `path`：单一输入，既可选择**文件**也可选择**文件夹**（UI 用 `type=file_or_folder` 渲染）。
- 文件夹导入使用 `list_local_files` 扫描后循环调用 `download_image`。
- 单文件导入只调用一次 `download_image`。
- `path` 也可以选择 `.zip`：后端会将 zip **解压到临时目录**，再递归导入其中的图片（**zip 等价于“压缩的文件夹导入”**），临时目录在任何情况下都会清理。

## 打包

在 `crawler-plugins/` 目录下：

```powershell
node package-plugin.js --only local-import
```


