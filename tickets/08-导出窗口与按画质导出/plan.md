# 08 导出窗口：预设、记忆与按画质导出（以后再做第 17 项）
摘要：导出改为“画质档 + 可展开高级编码参数”，按画质导出复用内置 FFmpeg（高码率中间文件再压一遍）；预设是全部设置的快照、改动显示“已修改”；按项目 + 序列记住上次导出设置。
分级：大（持久格式、编码链路、界面）。A 段技术 Codex sol high（worktree `D:\VibeCode\Henji-AI-t08`，分支 `task/08-导出窗口与按画质导出`）；B 段界面 Claude（Opus 子代理，henji-ui-surface）在同一 worktree 接着做；交叉审查 Opus xhigh + /code-review。

## 依据
docs/task/代码效果与渲染改进/以后再做.md 第 17 项（现状、已定设计 1–6、分工、验收）；本目录 design.md 是 Claude 定的数据与交互决定。

## A 段（Codex，纯技术，不写 .tsx 界面）
1. 设置与预设数据：按 design.md 第 1 节新增编码参数、画质档的读写与推导函数；预设库与已嵌入文档的导出设置按 persistence.md 升版本、迁移、黄金样本。
2. 本机“上次导出”记忆（按项目 + 序列），design.md 第 3 节。
3. FFmpeg 按画质压制：design.md 第 2 节；编码器能力探测（缓存）供界面灰掉不支持的项。
4. 进度：合成、压制两段都有进度与可取消；失败与取消清理中间文件；日志按 logging.md。
5. 助手：新字段与画质档经现有导出设置与导出能力可读写（意图语义的画质档可直接用），能力门禁通过。
6. 画质档取值用真实画面校准：用《元宝搜索》的预渲染预览文件（200 Mbps，见项目缓存目录）或其他本机高码率片段，各档压制后算 VMAF 与体积，选“视觉无损”档使 VMAF ≥ 95 且明显小于 50 Mbps；数据写进 result.md。不导出整片、不改片子工程、不在开发版里点导出。

## B 段（Claude，界面）
预设菜单、画质档、高级折叠区、“已修改”、恢复为预设值、两段进度，见 design.md 第 4 节。

## 完成标准
- A 段：单测（画质档推导与“自定义”判定、已修改判定、迁移黄金样本、FFmpeg 参数构建、能力探测缓存、记忆读写）；真实 FFmpeg 测试（`*.ffmpeg.test.ts`）压一段 10 秒画面成功、取消可清理；`check:persistence-compat`、`check:assistant-capabilities`、`npm run verify:changed -- --level L2 <本次文件...>` 通过；VMAF/体积表写进 result.md。
- B 段：界面按 henji-ui-surface 规则，`check:surface` 等界面门禁通过；Claude 在开发版目视验收（不点导出）。
