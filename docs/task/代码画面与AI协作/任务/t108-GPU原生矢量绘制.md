# t108 GPU 原生矢量绘制

总任务见 t107。代码素材 v3 渲染器 `src/features/videoEdit/engine/videoEditCodeGpuV3.ts` 目前只有无效果的纯色矩形、椭圆（`simple()`）走 GPU 实例化直接绘制；其余图形都经 `raster()` 在 CPU 上画到 OffscreenCanvas（`rasterizeCodeShape`）再 `copyExternalImageToTexture` 上传，缓存键含坐标，动画时每帧不命中。基准 complex-to-simple 每帧约 820 次栅格化与上传，真实 Electron 每帧约 100ms。

## 要做

1. **先建基准**：新增 GPU 基准测试（`npm run test:gpu` 体系，参照 `videoEditCodeGpuV3.gpu.test.ts` 的 Dawn 初始化），对 `src/tests/fixtures/videoEdit/performance/` 三份素材在 1920×1080 下逐帧测“求值”和“GPU 绘制到队列完成”两段耗时（中位、p95），输出到测试日志；同时保存改前若干关键帧像素作为对照（测试内存中对照即可，不提交大图）。
2. **GPU 原生矢量绘制**，实例化批量提交，SDF/解析式抗锯齿，结果与现有 Canvas 栅格在容差内一致：
   - `line`：宽度、lineCap（butt/round/square）、dash、trimStart/trimEnd、纯色与渐变描边。
   - `path`/折线：描边（lineJoin miter/round/bevel、dash、trim）与填充（非零/奇偶按现有语义；可用 CPU 三角化后 GPU 绘制，三角化结果按几何缓存）。
   - `rect`（含 radius/radii、描边）、`ellipse`（含描边）、线性/径向/锥形渐变填充。
   - 有 shadow/glow/blur 的图形：先用矢量绘制到图层再走现有效果，不再走 Canvas 栅格。
   - 文字与少数实在难以矢量化的情况保留栅格路径，并说明为什么。
3. 同一批无混合模式差异的图形合并成尽量少的绘制调用；实例数据用可复用缓冲区，不每帧新建大量 GPU 对象。
4. **验收**：
   - 基准 complex-to-simple 的 GPU 绘制段中位数降到 6ms 以内（本机 Dawn），两段标题不回退；最终在测试日志与最终消息里给出改前改后数字。
   - 像素对照：每类图形（线帽、虚线、裁剪 trim、路径连接、圆角描边、各渐变）有像素对比测试，与原栅格结果平均误差与最大误差在合理阈值内（写明阈值）。
   - 现有 `videoEditCodeGpuV3.gpu.test.ts`、`videoEditCodeGpu.test.ts` 全部通过。

## 工作方式

独立 worktree，自己 `npm ci`（禁止 junction 主仓 node_modules），只改不提交。只改渲染侧（engine 目录），不改作者语言编译器与求值器（t110 并行在改）。验证：对应测试文件、`npm run test:gpu -- <文件>`、最终各跑一次两套 tsc、改动文件 eslint、`npm run check:colors`（测试里颜色用数组，不写十六进制或 rgba 字面量）。不启动 Electron 巡检。
