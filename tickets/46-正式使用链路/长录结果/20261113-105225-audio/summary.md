# 长录结果：录音 60 分钟

**结论：通过**

## 提示

- main-load：加压期间主进程 ping 最长只有 5 ms，压力不明显（当天日志可能很小）
- powercfg /requests 未取证：此命令需要管理员权限，并且必须从提升的命令提示符中执行。；可用管理员终端重跑
- 期间警告 10 条（见 logs.warnings）
- 写盘最长 632.21 ms
- 需要补的接口：主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 需要补的接口：窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 需要补的接口：音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- 需要补的接口：powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证

## 概况

- 开始：2026-11-13T02:52:31.608Z；停止：2026-11-13T03:52:54.061Z
- 墙钟时长：3601.0 秒；录到的时长：3601.0 秒；差：0.07 秒
- 录音汇总：时长 3601.039 秒、经过 3601 秒、溢出 0、欠载 0、丢帧补静音 0、丢推送 0/0、写盘峰值 632.21 ms
- 拼回作品：插入 3601.0 秒
- 作品音频：E:\文档\HenjiAI\Audio Recordings\24ea1655-f5ba-4f1b-99f4-d5a4fdca0ccb.wav（3601.5 秒、48000 Hz、1 声道）
- 原始录音：E:\文档\HenjiAI\Audio Recordings\录音 2026-11-13 105230.wav（3601.0 秒、48000 Hz、1 声道）

## 施压步骤

| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |
|---|---|---|---|---|---|
| 108 秒 | wake-lock | 0 ms | 成功 | 在录 108.1 秒 | 在录 108.3 秒 |
| 180 秒 | switch-away | 8 ms | 成功 | 在录 180.1 秒 | 在录 185.9 秒 |
| 288 秒 | switch-back | 8 ms | 成功 | 在录 288.1 秒 | 在录 290.3 秒 |
| 360 秒 | minimize | 4 ms | 成功 | 在录 360.1 秒 | 在录 365.5 秒 |
| 972 秒 | restore | 5 ms | 成功 | 在录 972.1 秒 | 在录 978.7 秒 |
| 1152 秒 | main-load | 2 ms | 成功 | 在录 1152.1 秒 | 在录 1176.5 秒 |
| 1512 秒 | reload | 12 ms | 成功 | 在录 1512.1 秒 | 在录 1518.3 秒 |
| 1800 秒 | status | 9 ms | 成功 | 在录 1800.1 秒 | 在录 1801.1 秒 |
| 2520 秒 | switch-away | 10 ms | 成功 | 在录 2520.1 秒 | 在录 2525.8 秒 |
| 3600 秒 | stop | 14 ms | 成功 | 在录 3600.2 秒 | — |

## 内存（私有字节合计）

- before-start 02:52:27：1822 MB（main 374 MB、crashpad-handler 9 MB、gpu-process 819 MB、utility:network.mojom.NetworkService 11 MB、renderer 443 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 13 MB）
- start 02:52:32：2172 MB（main 388 MB、crashpad-handler 9 MB、gpu-process 1090 MB、utility:network.mojom.NetworkService 11 MB、renderer 462 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 10 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 38 MB、conhost 19 MB）
- periodic 02:57:32：1859 MB（main 375 MB、crashpad-handler 9 MB、gpu-process 806 MB、utility:network.mojom.NetworkService 11 MB、renderer 447 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:02:32：1969 MB（main 377 MB、crashpad-handler 9 MB、gpu-process 875 MB、utility:network.mojom.NetworkService 11 MB、renderer 485 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:07:32：2018 MB（main 380 MB、crashpad-handler 9 MB、gpu-process 920 MB、utility:network.mojom.NetworkService 11 MB、renderer 486 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:12:32：1872 MB（main 373 MB、crashpad-handler 9 MB、gpu-process 782 MB、utility:network.mojom.NetworkService 11 MB、renderer 486 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:17:32：1878 MB（main 372 MB、crashpad-handler 9 MB、gpu-process 789 MB、utility:network.mojom.NetworkService 11 MB、renderer 486 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- mid 03:22:32：1658 MB（main 379 MB、crashpad-handler 9 MB、gpu-process 528 MB、utility:network.mojom.NetworkService 11 MB、renderer 521 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:22:33：1661 MB（main 379 MB、crashpad-handler 9 MB、gpu-process 528 MB、utility:network.mojom.NetworkService 11 MB、renderer 523 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:27:32：1598 MB（main 379 MB、crashpad-handler 9 MB、gpu-process 530 MB、utility:network.mojom.NetworkService 11 MB、renderer 459 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:32:32：1611 MB（main 379 MB、crashpad-handler 9 MB、gpu-process 531 MB、utility:network.mojom.NetworkService 11 MB、renderer 471 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 37 MB、conhost 19 MB）
- periodic 03:37:32：1452 MB（main 380 MB、crashpad-handler 9 MB、gpu-process 351 MB、utility:network.mojom.NetworkService 11 MB、renderer 490 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 38 MB、conhost 19 MB）
- periodic 03:42:32：1454 MB（main 381 MB、crashpad-handler 9 MB、gpu-process 351 MB、utility:network.mojom.NetworkService 11 MB、renderer 492 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 38 MB、conhost 19 MB）
- periodic 03:47:32：1453 MB（main 381 MB、crashpad-handler 9 MB、gpu-process 350 MB、utility:network.mojom.NetworkService 11 MB、renderer 491 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 38 MB、conhost 19 MB）
- end 03:52:32：1452 MB（main 380 MB、crashpad-handler 9 MB、gpu-process 350 MB、utility:network.mojom.NetworkService 11 MB、renderer 490 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 38 MB、conhost 19 MB）
- after-stop 03:53:01：1604 MB（main 568 MB、crashpad-handler 9 MB、gpu-process 350 MB、utility:network.mojom.NetworkService 11 MB、renderer 488 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 5 MB、conhost 19 MB）

## 防睡眠

- 录制期间：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）
- 结束之后：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）

## 日志

- 警告/错误按事件计数：warn audio_capture.disk.slow ×8；warn logging.bridge.event_rejected ×2

## 产物

- E:\文档\HenjiAI\Projects\长录测试：1 MB
- E:\文档\HenjiAI\Audio Recordings\录音 2026-11-13 105230.wav：495 MB
- E:\文档\HenjiAI\Audio Recordings\24ea1655-f5ba-4f1b-99f4-d5a4fdca0ccb.wav：659 MB
- 合计：1155 MB（脚本不删除，核对后手动清理）

## 需要补的接口

- 主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证
