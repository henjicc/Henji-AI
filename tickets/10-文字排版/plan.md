# 10 文字排版：Pretext + HarfBuzz（以后再做第 1 项）
摘要：henji-layout/text 内部换成 Pretext（断行与测量，UAX#14、避头尾、标点挤压）+ harfbuzzjs（整形、逐字位置、轮廓），对外接口 layoutText / GraphemePose 不变，发新的冻结版本；自己只写中英间距、两端对齐、简单表格等薄层。
分级：大（作者库与渲染核心）；执行 Codex gpt-6-astra high，worktree `D:\VibeCode\Henji-AI-t10`，分支 `task/10-文字排版`；先写 design.md 交 Claude + Opus xhigh 审，批准后实现；实验 1–8 需要真实 Electron/显卡的部分等显卡空闲再跑。

## 依据
docs/task/代码效果与渲染改进/以后再做.md 第 1 项（选型调研、薄层范围、不当主力的方案、实验 1–9、验收）。现有实现：henji-layout（`henji-layout/text` 的 layoutText、drawText，`henji-layout/flex`，作者接口 v6，提交 d02e970d5）。

## 范围（第一阶段）
Pretext 断行与测量；harfbuzzjs 整形与逐字位置、轮廓；OffscreenCanvas 2D 按输出分辨率逐字重画；中英间距（字间加距，不插空格）、两端对齐；简单表格（列宽简化 CSS 自动表格、数字列 tnum）。竖排可选。第二阶段（hb-gpu 显卡矢量字、three.js 立体字）不在本票。

## 验收
以后再做第 1 项的验收：不走网页的标题用选定库排版，与浏览器同字体、同宽度下断行与字位对照，差异列表清楚可解释；实验 1–8 数据写进 result.md。
