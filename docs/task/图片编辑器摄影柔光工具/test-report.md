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

# 第四阶段 4.1 测试报告

## 自动测试与静态检查

- `npx vitest run src/core/imageEdit/imageEdit.test.ts src/core/imageEdit/testing/diffusionCharts.test.ts src/core/imageEdit/testing/diffusionBaseline.test.ts`：3 个文件、16 项通过。
- `npm run lint`：通过，零 warning。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npm run check:colors`、`npm run check:model-i18n`：通过。
- `git diff --check`：通过；只有 Git 的 LF→CRLF 工作树提示，无空白错误。

## 基线登记结果

- 九档预设均带版本、来源、授权边界、适用范围、非承诺项和可公开参数映射；未提交真实照片、品牌名称预设或许可不明资产。
- 八张程序化图覆盖点/双点高光、亮度阶梯、黑底高光、彩色色块、锐利边缘、透明边缘和噪声细节。
- Golden 索引覆盖全部九档预设；共享配方能量守恒阈值已冻结。WGSL/Sharp 的 PSF、峰值、黑位、色彩、细节、Alpha、Tile 接缝和感知容差均等待 4.2 真实 Electron 验证。

# 第四阶段 4.2 自动验收报告

## 通过项

- `npx vitest run`（8 个定向文件）：34 项通过，覆盖 V2/旧文档兼容、非法/重复操作、预设公开参数映射、程序化图/Golden 索引、历史事务、revision、取消、Device Lost 事件、Tile 计划、Sharp 能力边界与助手文档保留。
- `npm run lint`、`npx tsc -p tsconfig.electron.json --noEmit`、`npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npm run electron:build`：通过；模型清单 65 项生成成功，仅出现既有第三方依赖 unused-import 构建提示。
- `npm run electron:smoke`：通过，CDP 模式无 page/console error；画布 2560×1360、61 帧/秒基线、minimap 存在，native bridge、SQLite、媒体协议与项目包通过。
- `npm run electron:dpi-check`：6 个分辨率/DPI 场景通过，无横向溢出，3 个导航按钮均可见。

## 已知基线与待验证项

- `npx tsc --noEmit`：仍失败于既有 `src/core/modelCatalog/generationModelDescriptions.test.ts:38`，`I18nText` 可能为字符串；本任务电子端 TypeScript 与定向测试均通过，未越界修复。
- 环境：Windows 10 专业版 10.0.19045、AMD Ryzen 9 5900X、63.9 GiB RAM、NVIDIA GeForce RTX 4090、驱动 610.47、Electron 42.5.0。
- 未自动执行：正式 WGSL/Sharp Golden 与感知阈值、2MP/24MP 正式算法性能和内存、真实 Device Lost、三格式 Worker 合成重开、真实多宿主保存/重开及所有鼠标/画布交互。按项目约定，这些必须由用户在真实 Electron 窗口验证。

## 第四阶段 4.2 纠正测试（预览性能、降级诊断与 UI primitive）

### 自动通过

- `npx vitest run src/components/ui/Dropdown.test.ts src/features/imageEdit/execution/imageEditExecution.test.ts src/features/imageEdit/execution/workerImageEditClient.test.ts src/core/imageEdit/worker/exportPrototype.test.ts`：4 个文件、13 项通过。覆盖预览 2MP 尺寸计划、Worker 初始化失败原因、Device Lost 等待结束、降级原因分类，以及自定义 Dropdown 的键盘和 ARIA 状态。
- 定向 ESLint（Dropdown、Inspector、编辑器、执行器、Worker、测试）：通过，零 warning。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npm run lint`、`npm run check:colors`、`npm run check:model-i18n`：通过。
- Electron 构建产物已刷新；`npm run electron:smoke`：通过（CDP 无 page/console error，native bridge 与画布基线正常）。
- `git diff --check`：通过；仅出现既有 LF→CRLF 工作树提示，无空白错误。

### 既有基线与手动项

- `npx tsc --noEmit`：仍仅失败于既有 `src/core/modelCatalog/generationModelDescriptions.test.ts:38`，`I18nText` 可能为字符串；本次新增的 renderer 类型未产生额外错误。
- 未自行做鼠标/画布验收。需用户重启 Electron 后验证自定义下拉、2MP 大图跟手、日志中的真实 Worker 能力/Sharp 触发原因、原尺寸导出和现有 4.2 Golden/三格式/Device Lost 清单。
- Chromium `disk_cache` 0x5 只能确认当前缓存目录访问被拒绝；本次已隔离新 session-data 路径，但尚未将该日志与 GPU 失效建立因果关系，也不得据此宣称 GPU 已恢复。

## 第四阶段 4.2 WebGPU 启动纠正测试

### 自动通过

- `npm run lint`：通过，零 warning。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npx vitest run src/features/imageEdit/execution/imageEditExecution.test.ts src/features/imageEdit/execution/workerImageEditClient.test.ts`：2 个文件、6 项通过，覆盖 Worker 失败阶段码传递及稳定降级映射。

### 已确认根因与待验证

- 已确认的缓存根因：开发态仅改 `sessionData` 时，多个 worktree 仍共享 Electron `userData`，会继续竞争 `GPUCache`，可导致 `cache_util_win.cc:25` 0x5 与 `Gpu Cache Creation failed: -2`。现改为 worktree 专属开发态 `userData`；未读取、迁移或删除其他 worktree/原项目数据。
- 尚未在用户真实 Electron 中验证 GPU 设备创建；0x5 可能与 Worker WebGPU 初始化失败同时出现，但不能仅凭缓存日志建立因果。新版本会在 `image_edit.worker.initialize.completed` 输出失败阶段码和脱敏详情，并由主进程输出 GPU feature status。
- 仍需完全退出并重启本 worktree 的 Electron；鼠标/画布交互、正式 Golden、性能/内存、Device Lost 和三格式重开仍按 4.2 原清单待验。
