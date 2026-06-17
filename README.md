# 张张实拍图 水印批量去除工具

用于自动识别并去除图片中的“张张实拍图”水印，同时保留其他水印（如价格标签、商品标签等）。

## 文件说明

- `remove_watermark.py` — 核心处理脚本（Python）
- `run_watermark_remover.bat` — Windows 一键运行脚本，双击即可批量处理
- `app.py` — Web UI 后端服务
- `templates/index.html` + `static/` — Web UI 前端页面
- `requirements.txt` — Python 依赖列表
- `input_images/` — 放置待处理图片的文件夹（CLI 批处理用）
- `output_images/` — 处理后图片的输出文件夹（CLI 批处理用）
- `web_uploads/` / `web_processed/` — Web UI 上传和处理结果存放位置

## 使用方法

### 方式一：Web 网页版（推荐，支持上传、预览、下载）

1. 启动 Web 服务：
   ```bash
   python app.py
   ```
   或双击 `start_web.bat`。

2. 在浏览器打开：http://127.0.0.1:5000

3. 点击或拖拽上传多张图片，点击“开始处理”。

4. 处理完成后可预览结果，并单独下载每张图片。

### 方式二：双击运行（本地批量处理）

1. 把需要去水印的照片放入 `input_images` 文件夹。
2. 双击 `run_watermark_remover.bat`。
3. 等待处理完成，结果会自动保存到 `output_images` 文件夹。

### 方式三：命令行运行

```bash
python remove_watermark.py
```

首次运行会自动下载 OCR 和 AI 修复模型（约 100MB+），请保持网络畅通。

## 支持格式

- JPG / JPEG
- PNG
- BMP
- WebP

## 注意事项

- 工具会自动识别“张张实拍图”文字位置，因此水印可以出现在图片任意位置、任意大小。
- 如果某张图片未能识别到水印，会跳过并提示 `[WARN] Skipped`。
- 仅去除“张张实拍图”，其他文字/图标水印均会保留。
- Web 版和命令行版使用独立的文件夹，互不干扰。
