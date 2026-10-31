# 08 设计决定（Claude）
摘要：设置里只多一个可选的 `encoding` 对象（全部高级编码参数），画质档由参数推导、不单独存；预设是完整快照，“已修改”靠与所选预设比较得出；上次导出按项目 + 序列记在本机。
有 `encoding` 的视频导出走“WebCodecs 高码率中间文件 → FFmpeg 压制”；没有 `encoding` 的旧设置照旧走 WebCodecs 直出，结果与现在相同。

## 1. 数据
- `videoEditExportSettingsSchema` 新增可选 `encoding`：编码器（`h264_nvenc` / `hevc_nvenc` / `libx264` / `libx265`）、码率控制（`quality`：NVENC 用 CQ、x264/x265 用 CRF / `vbr` / `cbr` / `two_pass`）、画质数值、目标码率与最大码率、缓冲（VBV）、速度档、Profile/Level、关键帧间隔（秒）、B 帧数、前瞻帧数、空间 AQ、时间 AQ、色彩范围与矩阵（默认 BT.709 有限范围）、10 位输出。字段名与取值由 Codex 按 FFmpeg 官方文档定，`describe` 用用户语言写清含义，供助手读。
- 画质档：`visually_lossless` / `high` / `standard` / `bitrate`。函数 `applyVideoEditExportQuality(settings, tier, capabilities)` 一次写好 `encoding`（按可用编码器选：有 NVENC 用 NVENC，否则 x264/x265；编码选择沿用 `codec` 的 H.264/H.265）；`videoEditExportQualityOf(settings)` 与各档模板比较，不一致返回 `custom`。档位数值按 A 段第 6 条校准。
- 内置视频预设改为 `visually_lossless`（H.264）；“高质量母版”保持高码率 H.265（用 `bitrate` 档表达）；仅音频预设不变。
- 已修改：`videoEditExportPresetModified(settings, preset)` 规范化后深比较；`videoEditExportChangedFields(settings, preset)` 返回改动的高级参数列表（给“已改 N 项”与逐项恢复）。
- 预设库仍是本机列表，新增“更新当前预设”（只对自己建的），其余接口不变。

## 2. 压制链路
- 中间文件：WebCodecs 用同编码、足够高的码率（按像素与帧率算，接近无损，参照预渲染 200 Mbps 级别），写到成片目录旁的临时文件；声音照旧编进中间文件。
- 主进程用内置 FFmpeg 压制：视频按 `encoding` 编码，声音直接复制，MP4 faststart；`-hwaccel cuda` 解码（可用时）。完成后原子替换为成片并删除中间文件；失败或取消删除中间文件和半成品。
- 一次只跑一个压制任务；导出队列沿用现有顺序。
- 能力探测：主进程探测 FFmpeg 可用编码器与 NVENC 能否初始化，结果缓存到进程结束；经现有导出平台接口给渲染层。
- 字幕烧录、范围、响度、预览复用（usePreviews）、按输出分辨率渲染都发生在中间文件之前，行为不变。

## 3. 上次导出记忆
- 本机存储（不进工程）：键为“项目 + 序列”，值为上次实际导出的 预设 id、完整设置、目录、文件名、范围；导出成功后写入。打开导出窗口时有记录就恢复，没有就用“与序列一致”。
- 按 persistence.md 作为本机版本化 JSON 登记；条目数量不设硬上限，但只保留最近使用的若干条（例如 200 条）以免无限增长。

## 4. 界面（B 段，Claude）
- 预设：一个下拉，显示“预设名”或“预设名（已修改）”；下拉底部竖排操作：恢复为预设 / 更新当前预设（仅自建）/ 另存为新预设 / 重命名 / 删除，用不了的不显示；去掉现在的“…”横排面板。
- 视频分区：“画质”分段选择（视觉无损 / 高 / 标准 / 指定码率，参数被改时显示“自定义”）；选“指定码率”时显示码率输入。
- “高级”默认折叠，标题旁“已改 N 项”；展开后按编码器、码率控制、画质与码率、GOP 与 B 帧、AQ、色彩、10 位分组；不支持的项灰掉并在悬停提示里说原因；改过的项旁有“恢复为预设值”。说明进悬停提示。
- 进度两段：合成、压制。
