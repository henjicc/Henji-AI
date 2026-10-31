# 06 交叉审查（Opus high，第 1 轮）
结论：持久格式（三格式只加可选字段、最低可读不变、迁移/黄金样本/基线齐、缺省视为开）、几何、usePreviews 判定、预览四档、其他调用方均无问题；1 重要 + 4 小问题。
处理（Claude 裁定）：导出渲染比例封顶为 1，一并解决 1、2、3；4 修；5 改注释。交 Codex sol 修复。

## 重要
1. 作者说明（author-api.d.ts:47、author-api.md:59、author-shaders.md:16、videoEditAuthorModule.ts:19）写“导出没有 renderScale”，与新行为不符；输出大于序列时 renderScale > 1。→ 封顶 1，说明改为“预览降分辨率与导出按输出时都给出 renderScale（≤1）”。

## 小问题
2. 完整分辨率回退时网页倍率未夹到 ≤1（videoEditRenderer.ts:1551、videoEditWebInputs.ts:176）。→ 夹到 ≤1。
3. 放大导出按 >1 倍渲染，像素 3–4 倍（exportPresets.ts:101-112）。→ 封顶 1，按序列尺寸渲染再放大。
4. 回放非“完整”且勾“暂停时用完整”时，播放/暂停切换清空代码输入历史、递增 epoch 取消在提交画面（videoEditRenderer.ts:666-675，推断）。→ 只在实际比例变化时这样做，补测试。
5. 过时注释 videoEditGpuCompositor.ts:450、videoEditCodeGpu.ts:580。→ 改。
