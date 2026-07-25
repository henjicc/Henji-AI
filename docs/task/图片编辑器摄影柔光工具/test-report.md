# 第一阶段测试报告

## 自动测试与静态检查

- `vitest run`（阶段定向）：3 个文件、9 项测试通过。
- `HENJI_IMAGE_EDIT_BENCHMARK=1 vitest run electron/main/services/image/diffusion-fallback.benchmark.test.ts`：1 项 24MP 基准通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npm run lint`：通过。
- Electron 目录定向 ESLint：通过。
- `npm run check:colors`：通过。
- `npm run check:model-i18n`：通过。
- `npm run electron:build`：通过；仅有既有 Vite 动静态导入提示。
- `npx tsc --noEmit`：仅失败于既有 `src/core/modelCatalog/generationModelDescriptions.test.ts:38`，`I18nText` 可能为 string，计划已预先登记。

## 真实 Electron Worker 验证

- 环境：Windows x64、Electron 42.5.0、Chromium 148、Ryzen 9 5900X、RTX 4090。
- Worker adapter：`nvidia` / `lovelace`；`maxTextureDimension2D=16384`；`rgba16float` 可渲染、可采样。
- Blob 与 `henji-media://` 均解码并返回可转移 ImageBitmap。
- 2MP：首次 Blob 105.5ms、首次媒体 URL 71.3ms；预热 20 帧平均 10.13ms、P95 13.2ms、约 98.7 FPS。
- revision 过期请求返回取消，客户端关闭旧 ImageBitmap。

## 24MP WebGPU

- 测试图：6000×4000，线性化 → 单张全尺寸 FP16 → Tile 回编码 → OffscreenCanvas 一次编码。
- Tile 候选：1024 为 907.8ms、1536 为 939.8ms、2048 为 898.7ms；三者 PNG 约 22.47MB。
- 全局图代理：2048×1365 为 401.6ms，3072×2048 为 351.2ms；考虑 2.25 倍像素资源，冻结 2048。
- 1536 Tile / 64 Halo：跨边界采样最大 RGBA 通道误差 0，无黑边或接缝。
- 格式：PNG 939.8ms / 22,470,564B；JPEG 557.7ms / 437,603B；WebP 1453.4ms / 81,586B。
- 三种格式经现有 `persistImageBinary()` 保存并由 `readImageInfo()` 重开为 6000×4000。
- Renderer 末次采样 JS Heap：使用约 139MB，总量约 157MB；浏览器未提供 GPU 显存峰值读取 API。
- 取消：请求在 Tile 边界返回“图片编辑任务已取消”。

## 24MP Sharp

- PNG 394.3ms / 474,766B / RSS 631,828,480B。
- JPEG 412.2ms / 140,893B / RSS 634,155,008B。
- WebP 1053.6ms / 42,754B / RSS 634,810,368B。
- 三种输出均可重新解码为 6000×4000。
- 不支持参数返回 `UnsupportedSharpDiffusionParametersError`；硬取消明确为不支持。

## 未自动强制的验收

- 未强制制造真实 GPU Device Lost；已自动测试 Device Lost 事件能结束等待请求，运行时会清空设备并在下一请求重建。
- 当前无正式参数 UI，因此没有鼠标操作验收项；2.2 引入真实多尺度效果后需重新验证视觉能量边界。
