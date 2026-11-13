# 长录结果：录音 3 分钟

**结论：通过**

## 提示

- main-load：加压期间主进程 ping 最长只有 18 ms，压力不明显（当天日志可能很小）
- powercfg /requests 未取证：此命令需要管理员权限，并且必须从提升的命令提示符中执行。；可用管理员终端重跑
- 期间警告 3 条（见 logs.warnings）
- 需要补的接口：主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 需要补的接口：窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 需要补的接口：音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- 需要补的接口：powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证

## 概况

- 开始：2026-11-13T02:06:16.586Z；停止：2026-11-13T02:09:19.299Z
- 墙钟时长：183.5 秒；录到的时长：181.0 秒；差：-2.45 秒
- 录音汇总：时长 180.999 秒、经过 181 秒、溢出 0、欠载 0、丢帧补静音 0、丢推送 0/0、写盘峰值 235.709 ms
- 拼回作品：插入 181.0 秒
- 作品音频：E:\文档\HenjiAI\Audio Recordings\b43c74ae-1737-4949-8a62-feae10bd39f6.wav（181.5 秒、48000 Hz、1 声道）
- 原始录音：E:\文档\HenjiAI\Audio Recordings\录音 2026-11-13 100615.wav（181.0 秒、48000 Hz、1 声道）

## 施压步骤

| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |
|---|---|---|---|---|---|
| 5 秒 | wake-lock | 11 ms | 成功 | 在录 5.5 秒 | 在录 5.7 秒 |
| 9 秒 | switch-away | 11 ms | 成功 | 在录 9.1 秒 | 在录 14.8 秒 |
| 14 秒 | switch-back | 320 ms | 成功 | 在录 14.8 秒 | 在录 16.9 秒 |
| 18 秒 | minimize | 4 ms | 成功 | 在录 18.1 秒 | 在录 23.3 秒 |
| 49 秒 | restore | 12 ms | 成功 | 在录 48.7 秒 | 在录 55.0 秒 |
| 58 秒 | main-load | 10 ms | 成功 | 在录 57.7 秒 | 在录 71.1 秒 |
| 76 秒 | reload | 10 ms | 成功 | 在录 75.7 秒 | 在录 82.4 秒 |
| 90 秒 | status | 7 ms | 成功 | 在录 90.1 秒 | 在录 91.0 秒 |
| 126 秒 | switch-away | 5 ms | 成功 | 在录 126.1 秒 | 在录 131.7 秒 |
| 180 秒 | stop | 10 ms | 成功 | 在录 180.1 秒 | — |

## 内存（私有字节合计）

- before-start 02:06:12：1209 MB（main 460 MB、crashpad-handler 9 MB、gpu-process 403 MB、utility:network.mojom.NetworkService 12 MB、renderer 325 MB）
- start 02:06:17：1984 MB（main 443 MB、crashpad-handler 9 MB、gpu-process 1087 MB、utility:network.mojom.NetworkService 12 MB、renderer 364 MB、henji-audio-capture 38 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 8 MB、conhost 13 MB）
- periodic 02:06:47：1570 MB（main 338 MB、crashpad-handler 9 MB、gpu-process 755 MB、utility:network.mojom.NetworkService 12 MB、renderer 312 MB、henji-audio-capture 38 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- periodic 02:07:28：1711 MB（main 437 MB、crashpad-handler 9 MB、gpu-process 739 MB、utility:network.mojom.NetworkService 11 MB、renderer 370 MB、henji-audio-capture 37 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- mid 02:07:47：1557 MB（main 343 MB、crashpad-handler 9 MB、gpu-process 486 MB、utility:network.mojom.NetworkService 11 MB、renderer 564 MB、henji-audio-capture 37 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- periodic 02:07:48：1554 MB（main 343 MB、crashpad-handler 9 MB、gpu-process 479 MB、utility:network.mojom.NetworkService 11 MB、renderer 569 MB、henji-audio-capture 37 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- periodic 02:08:17：1628 MB（main 342 MB、crashpad-handler 9 MB、gpu-process 458 MB、utility:network.mojom.NetworkService 11 MB、renderer 664 MB、henji-audio-capture 37 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- periodic 02:08:47：1548 MB（main 343 MB、crashpad-handler 9 MB、gpu-process 333 MB、utility:network.mojom.NetworkService 11 MB、renderer 707 MB、henji-audio-capture 37 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- end 02:09:17：1421 MB（main 344 MB、crashpad-handler 9 MB、gpu-process 306 MB、utility:network.mojom.NetworkService 11 MB、renderer 607 MB、henji-audio-capture 37 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）
- after-stop 02:09:25：1427 MB（main 405 MB、crashpad-handler 9 MB、gpu-process 305 MB、utility:network.mojom.NetworkService 11 MB、renderer 585 MB、henji-audio-capture 5 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、conhost 19 MB）

## 防睡眠

- 录制期间：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）
- 结束之后：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）

## 日志

- 警告/错误按事件计数：warn logging.bridge.event_rejected ×2；warn audio_capture.disk.slow ×1

## 产物

- E:\文档\HenjiAI\Projects\长录测试：0 MB
- E:\文档\HenjiAI\Audio Recordings\录音 2026-11-13 100615.wav：25 MB
- E:\文档\HenjiAI\Audio Recordings\b43c74ae-1737-4949-8a62-feae10bd39f6.wav：33 MB
- 合计：58 MB（脚本不删除，核对后手动清理）

## 需要补的接口

- 主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证
