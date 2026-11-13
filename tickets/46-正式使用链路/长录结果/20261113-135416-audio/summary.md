# 长录结果：录音 60 分钟

**结论：通过**

## 提示

- main-load：加压期间主进程 ping 最长只有 3 ms，压力不明显（当天日志可能很小）
- powercfg /requests 未取证：此命令需要管理员权限，并且必须从提升的命令提示符中执行。；可用管理员终端重跑
- 期间警告 18 条（见 logs.warnings）
- 写盘最长 780.514 ms
- 需要补的接口：主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 需要补的接口：窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 需要补的接口：音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- 需要补的接口：powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证

## 概况

- 开始：2026-11-13T05:54:24.101Z；停止：2026-11-13T06:54:45.155Z
- 墙钟时长：3601.0 秒；录到的时长：3601.1 秒；差：0.06 秒
- 录音汇总：时长 3601.091 秒、经过 3601 秒、溢出 0、欠载 0、丢帧补静音 0、丢推送 0/0、写盘峰值 780.514 ms
- 拼回作品：插入 3601.1 秒
- 作品音频：E:\文档\HenjiAI\Audio Recordings\b363dca3-f766-4b22-996a-1962dea3dafd.wav（3601.6 秒、48000 Hz、1 声道）
- 原始录音：E:\文档\HenjiAI\Audio Recordings\录音 2026-11-13 135423.wav（3601.1 秒、48000 Hz、1 声道）

## 施压步骤

| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |
|---|---|---|---|---|---|
| 108 秒 | wake-lock | 1 ms | 成功 | 在录 108.1 秒 | 在录 108.4 秒 |
| 180 秒 | switch-away | 14 ms | 成功 | 在录 180.2 秒 | 在录 185.8 秒 |
| 288 秒 | switch-back | 12 ms | 成功 | 在录 288.1 秒 | 在录 290.2 秒 |
| 360 秒 | minimize | 9 ms | 成功 | 在录 360.2 秒 | 在录 365.4 秒 |
| 972 秒 | restore | 0 ms | 成功 | 在录 972.2 秒 | 在录 978.5 秒 |
| 1152 秒 | main-load | 1 ms | 成功 | 在录 1152.1 秒 | 在录 1182.9 秒 |
| 1512 秒 | reload | 3 ms | 成功 | 在录 1512.1 秒 | 在录 1518.3 秒 |
| 1800 秒 | status | 2 ms | 成功 | 在录 1800.1 秒 | 在录 1801.1 秒 |
| 2520 秒 | switch-away | 14 ms | 成功 | 在录 2520.2 秒 | 在录 2525.8 秒 |
| 3600 秒 | stop | 9 ms | 成功 | 在录 3600.2 秒 | — |

## 内存（私有字节合计）

- before-start 05:54:19：1395 MB（main 470 MB、crashpad-handler 9 MB、gpu-process 456 MB、utility:network.mojom.NetworkService 12 MB、renderer 328 MB、henji-video-decoder 114 MB、conhost 6 MB）
- start 05:54:24：2288 MB（main 437 MB、crashpad-handler 9 MB、gpu-process 1263 MB、utility:network.mojom.NetworkService 12 MB、renderer 374 MB、henji-video-decoder 114 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、conhost 19 MB）
- periodic 05:59:25：3089 MB（main 379 MB、crashpad-handler 9 MB、gpu-process 814 MB、utility:network.mojom.NetworkService 12 MB、renderer 547 MB、henji-video-decoder 114 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 109 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、electron 19 MB、conhost 31 MB、ffmpeg 971 MB）
- periodic 06:04:25：1641 MB（main 388 MB、crashpad-handler 9 MB、gpu-process 494 MB、utility:network.mojom.NetworkService 11 MB、renderer 479 MB、henji-video-decoder 115 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:09:25：1735 MB（main 364 MB、crashpad-handler 9 MB、gpu-process 505 MB、utility:network.mojom.NetworkService 11 MB、renderer 491 MB、henji-video-decoder 210 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:14:25：1792 MB（main 364 MB、crashpad-handler 9 MB、gpu-process 559 MB、utility:network.mojom.NetworkService 11 MB、renderer 496 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:19:24：1790 MB（main 365 MB、crashpad-handler 9 MB、gpu-process 558 MB、utility:network.mojom.NetworkService 11 MB、renderer 492 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- mid 06:24:25：1728 MB（main 373 MB、crashpad-handler 9 MB、gpu-process 500 MB、utility:network.mojom.NetworkService 11 MB、renderer 482 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:24:25：1718 MB（main 372 MB、crashpad-handler 9 MB、gpu-process 501 MB、utility:network.mojom.NetworkService 11 MB、renderer 470 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:29:25：1725 MB（main 374 MB、crashpad-handler 9 MB、gpu-process 506 MB、utility:network.mojom.NetworkService 11 MB、renderer 470 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:34:25：1709 MB（main 370 MB、crashpad-handler 9 MB、gpu-process 527 MB、utility:network.mojom.NetworkService 11 MB、renderer 438 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 65 MB、conhost 19 MB）
- periodic 06:39:25：1574 MB（main 379 MB、crashpad-handler 9 MB、gpu-process 334 MB、utility:network.mojom.NetworkService 11 MB、renderer 486 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 19 MB）
- periodic 06:44:25：1602 MB（main 377 MB、crashpad-handler 9 MB、gpu-process 334 MB、utility:network.mojom.NetworkService 11 MB、renderer 517 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 19 MB）
- periodic 06:49:25：1602 MB（main 380 MB、crashpad-handler 9 MB、gpu-process 333 MB、utility:network.mojom.NetworkService 11 MB、renderer 515 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 19 MB）
- end 06:54:25：1582 MB（main 383 MB、crashpad-handler 9 MB、gpu-process 333 MB、utility:network.mojom.NetworkService 11 MB、renderer 491 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 42 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 19 MB）
- after-stop 06:54:51：1668 MB（main 554 MB、crashpad-handler 9 MB、gpu-process 332 MB、utility:network.mojom.NetworkService 11 MB、renderer 444 MB、henji-video-decoder 209 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-capture 5 MB、henji-audio-worker 8 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 19 MB）

## 防睡眠

- 录制期间：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）
- 结束之后：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）

## 日志

- 警告/错误按事件计数：warn audio_capture.disk.slow ×8；warn audio_capture.microphone_track.disk.slow ×5；warn audio_capture.system_audio.disk.slow ×4；warn recording.host.detached ×1

## 产物

- E:\文档\HenjiAI\Projects\主链路走查 11-13：744 MB
- E:\文档\HenjiAI\Audio Recordings\录音 2026-11-13 135423.wav：495 MB
- E:\文档\HenjiAI\Audio Recordings\b363dca3-f766-4b22-996a-1962dea3dafd.wav：659 MB
- 合计：1898 MB（脚本不删除，核对后手动清理）

## 需要补的接口

- 主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证
