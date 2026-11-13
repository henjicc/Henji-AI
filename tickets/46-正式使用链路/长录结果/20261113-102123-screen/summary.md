# 长录结果：录屏 30 分钟

**结论：通过**

## 提示

- main-load：加压期间主进程 ping 最长只有 8 ms，压力不明显（当天日志可能很小）
- powercfg /requests 未取证：此命令需要管理员权限，并且必须从提升的命令提示符中执行。；可用管理员终端重跑
- 期间警告 12 条（见 logs.warnings）
- microphone 在 1 处缺数据空档分成了 2 条
- 麦克风缺数据空档 1 段，共 2.53 秒（界面重载期间麦克风轨由界面写，属已知限制）
- 系统声补静音 0.013854166666666667 秒、写盘峰值 1083.736 ms
- 需要补的接口：主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 需要补的接口：窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 需要补的接口：音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- 需要补的接口：powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证

## 概况

- 开始：2026-11-13T02:21:38.131Z；停止：2026-11-13T02:51:50.263Z
- 墙钟时长：1801.4 秒；录到的时长：1801.8 秒；差：0.46 秒
- 录制汇总：时长 1801.8 秒、画面分片 2（补齐 1、弃用 0）、丢帧 0、重复帧 21、续录 1、编码器 h264_nvenc
- 事件：797 页、203857 条；单页写盘最长 558 ms；轨道记录最长 501 ms；界面断开 1 次
- 声音：microphone 2 条、systemAudio 1 条
- 系统声：时长 1804.9638541666666 秒、361 段、补静音 0.013854166666666667 秒、设备不可用 0 秒、丢帧 0、不连续 0、设备切换 0、重连 0；电平峰值 -33.2 dB、平均 -47.3 dB
- 运动源：ffplay（带测试音），全程在跑
- 画面分片：E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e-d5f4-4f48-acb9-fb49be4b2634\screen-000000.mp4（1083.0 秒）
- 画面分片：E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e-d5f4-4f48-acb9-fb49be4b2634\screen-000001.mp4（719.3 秒）
- 麦克风：E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e-d5f4-4f48-acb9-fb49be4b2634\microphone-joined-000.wav（811.1 秒、48000 Hz、1 声道）
- 麦克风：E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e-d5f4-4f48-acb9-fb49be4b2634\microphone-joined-001.wav（989.5 秒、48000 Hz、1 声道）
- 系统声：E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e-d5f4-4f48-acb9-fb49be4b2634\systemAudio-joined-000.wav（1805.0 秒、48000 Hz、2 声道）

## 施压步骤

| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |
|---|---|---|---|---|---|
| 54 秒 | wake-lock | 13 ms | 成功 | 在录 54.0 秒 | 在录 54.3 秒 |
| 108 秒 | cursor | 14 ms | 成功 | 在录 108.0 秒 | 在录 109.8 秒 |
| 216 秒 | switch-away | 15 ms | 成功 | 在录 216.0 秒 | 在录 219.2 秒 |
| 324 秒 | switch-back | 7 ms | 成功 | 在录 324.0 秒 | 在录 327.1 秒 |
| 504 秒 | main-load | 2 ms | 成功 | 在录 504.0 秒 | 在录 528.8 秒 |
| 684 秒 | cursor | 14 ms | 成功 | 在录 684.0 秒 | 在录 685.8 秒 |
| 810 秒 | reload | 7 ms | 成功 | 在录 810.0 秒 | 在录 815.8 秒 |
| 936 秒 | status | 3 ms | 成功 | 在录 936.0 秒 | 在录 937.2 秒 |
| 1080 秒 | kill-encoder | 1 ms | 成功 | 在录 1080.0 秒 | 在录 1096.7 秒 |
| 1260 秒 | cursor | 13 ms | 成功 | 在录 1260.0 秒 | 在录 1261.8 秒 |
| 1530 秒 | switch-away | 1 ms | 成功 | 在录 1530.0 秒 | 在录 1533.2 秒 |
| 1674 秒 | cursor | 4 ms | 成功 | 在录 1674.0 秒 | 在录 1675.7 秒 |
| 1800 秒 | stop | 14 ms | 成功 | 在录 1800.0 秒 | — |

## 内存（私有字节合计）

- before-start 02:21:26：1823 MB（main 366 MB、crashpad-handler 9 MB、gpu-process 853 MB、utility:network.mojom.NetworkService 11 MB、renderer 418 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 13 MB）
- start 02:21:39：3191 MB（main 386 MB、crashpad-handler 9 MB、gpu-process 791 MB、utility:network.mojom.NetworkService 11 MB、renderer 739 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 72 MB、electron 24 MB、conhost 32 MB、ffmpeg 971 MB）
- periodic 02:24:09：3038 MB（main 382 MB、crashpad-handler 9 MB、gpu-process 697 MB、utility:network.mojom.NetworkService 11 MB、renderer 681 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 72 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- periodic 02:26:39：3153 MB（main 399 MB、crashpad-handler 9 MB、gpu-process 734 MB、utility:network.mojom.NetworkService 12 MB、renderer 741 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 72 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- periodic 02:29:09：3157 MB（main 429 MB、crashpad-handler 9 MB、gpu-process 760 MB、utility:network.mojom.NetworkService 12 MB、renderer 689 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 72 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- periodic 02:31:39：3097 MB（main 372 MB、crashpad-handler 9 MB、gpu-process 746 MB、utility:network.mojom.NetworkService 12 MB、renderer 701 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- periodic 02:34:09：3129 MB（main 398 MB、crashpad-handler 9 MB、gpu-process 746 MB、utility:network.mojom.NetworkService 12 MB、renderer 706 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 72 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- periodic 02:36:39：3102 MB（main 401 MB、crashpad-handler 9 MB、gpu-process 726 MB、utility:network.mojom.NetworkService 12 MB、renderer 664 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 28 MB、conhost 31 MB、ffmpeg 1005 MB）
- mid 02:37:15：3128 MB（main 414 MB、crashpad-handler 9 MB、gpu-process 721 MB、utility:network.mojom.NetworkService 12 MB、renderer 683 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 26 MB、conhost 31 MB、ffmpeg 1005 MB）
- periodic 02:39:09：3160 MB（main 426 MB、crashpad-handler 9 MB、gpu-process 721 MB、utility:network.mojom.NetworkService 12 MB、renderer 702 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 1005 MB）
- periodic 02:41:39：3131 MB（main 429 MB、crashpad-handler 9 MB、gpu-process 721 MB、utility:network.mojom.NetworkService 12 MB、renderer 705 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 25 MB、conhost 31 MB、ffmpeg 972 MB）
- periodic 02:44:09：3138 MB（main 430 MB、crashpad-handler 9 MB、gpu-process 722 MB、utility:network.mojom.NetworkService 12 MB、renderer 708 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 972 MB）
- periodic 02:46:39：3138 MB（main 427 MB、crashpad-handler 9 MB、gpu-process 722 MB、utility:network.mojom.NetworkService 12 MB、renderer 710 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 28 MB、conhost 31 MB、ffmpeg 973 MB）
- periodic 02:49:09：3119 MB（main 438 MB、crashpad-handler 9 MB、gpu-process 697 MB、utility:network.mojom.NetworkService 12 MB、renderer 707 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- end 02:51:39：3115 MB（main 433 MB、crashpad-handler 9 MB、gpu-process 696 MB、utility:network.mojom.NetworkService 12 MB、renderer 708 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 973 MB）
- after-stop 02:52:10：1681 MB（main 371 MB、crashpad-handler 9 MB、gpu-process 645 MB、utility:network.mojom.NetworkService 11 MB、renderer 458 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 7 MB、conhost 25 MB）

## 防睡眠

- 录制期间：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）
- 结束之后：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）

## 日志

- 警告/错误按事件计数：warn audio_capture.disk.slow ×6；warn audio_capture.system_audio.disk.slow ×4；warn recording.host.detached ×1；warn recording.capture.restart.start ×1

## 产物

- E:\文档\HenjiAI\Projects\长录测试：1 MB
- E:\文档\HenjiAI\Uploads\screen-recordings\f7379a8e-d5f4-4f48-acb9-fb49be4b2634：9800 MB
- 合计：9801 MB（脚本不删除，核对后手动清理）

## 需要补的接口

- 主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证
