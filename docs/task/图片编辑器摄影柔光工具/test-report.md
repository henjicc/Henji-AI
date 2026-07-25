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

# 第二阶段测试报告

## 自动测试与静态检查

- `vitest run`（第二阶段定向）：4 个文件、20 项通过，覆盖 V1/V2/未知操作兼容、六层配方、三模式响应、缓存失效、Tile 计划/重基准、Worker revision/取消/Device Lost 事件和 Sharp 能力限制。
- `npm run lint`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- Electron 目录定向 ESLint：通过。
- `npm run check:colors`：通过。
- `npm run check:model-i18n`：通过。
- `npm run electron:build`：通过；成功产出 `imageEditWorker` bundle，仅有既有 Vite 动静态导入提示。
- `npx tsc --noEmit`：仍仅失败于既有 `src/core/modelCatalog/generationModelDescriptions.test.ts:38`，与第一阶段登记一致。

## 已验证的第二阶段行为

- 六层半径递增、权重归一化，直接光保留与散射能量和为 1。
- 黑柔、白柔、辉光的高光源、微扩散、长尾与雾幕响应不同。
- 色调/细节只触发 Composite，质量/半径触发 Pyramid，源图响应参数触发 Source。
- 原尺寸导出计划固定使用 2048 全局图、1536 Tile、64 Halo，并保持 Tile 半径对应的原图像素尺度。
- Worker 客户端只接受最新 revision，可转发进度、发送 requestId 取消，并在 Device Lost 时结束等待请求。
- Sharp 完整公共参数会返回兼容输出，同时明示不支持参数；硬取消始终为 false。

## 留到 4.2 的正式验收

- 未在本阶段重新运行正式多尺度 WGSL 的真实 Electron GPU 画面、Golden 或性能基准，不沿用第一阶段线性基线冒充结论。
- 需验证点光源、阶梯、色块、透明边缘、Halo 接缝、三模式视觉差异和能量边界。
- 需执行真实或故障注入 Device Lost、24MP 三格式耗时/峰值内存/重开、取消超时和 Sharp 视觉容差。

# 第三阶段测试报告

## 自动测试与静态检查

- `vitest run src/features/imageEdit/editor/useImageEditorSession.test.tsx src/features/assistant/imageEditAdapter.test.ts src/features/imageEdit/execution/workerImageEditClient.test.ts src/core/imageEdit/worker/exportPrototype.test.ts src/core/imageEdit/imageEdit.test.ts electron/main/services/image/diffusion-fallback.test.ts`：6 个文件、27 项通过。
- 定向 ESLint（编辑器、Worker 合成、标注渲染、执行、助手适配）：通过，零 warning。
- `npm run check:colors`：通过。
- `npm run check:model-i18n`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npx tsc --noEmit`：仅失败于既有 `src/core/modelCatalog/generationModelDescriptions.test.ts:38`；与第一、二阶段记录一致，未由本阶段引入。

## 待 4.2 执行的人工交互验证

- 在真实 `npm run electron:dev` 中打开工具箱、查看器和画布编辑器，确认右侧出现“辉光/柔光”，顶部标注工具栏与几何面板保持可用。
- 在每个分组拖动一个滑块并松开，验证连续拖动只生成一条撤销记录；再验证重做、预设、启用/禁用、重置和移除。
- 对含旋转、镜像、文字、箭头、像素马赛克、模糊马赛克与裁剪的图片导出，检查执行顺序、坐标、透明边缘及最终文件可重新打开。
- 禁用/模拟不可用 WebGPU：纯柔光应显示 Sharp 降级；组合文档应显示明确能力错误且原始文档不被修改。
- 在 2MP 预览及大图场景检查预览画面、标注命中和裁剪框不漂移；鼠标交互未由自动化执行。
