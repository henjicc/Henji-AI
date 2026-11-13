# 长录结果：录屏 3 分钟

**结论：通过**

## 提示

- main-load：加压期间主进程 ping 最长只有 4 ms，压力不明显（当天日志可能很小）
- powercfg /requests 未取证：此命令需要管理员权限，并且必须从提升的命令提示符中执行。；可用管理员终端重跑
- 期间警告 8 条（见 logs.warnings）
- microphone 在 1 处缺数据空档分成了 2 条
- 麦克风缺数据空档 1 段，共 2.56 秒（界面重载期间麦克风轨由界面写，属已知限制）
- 系统声补静音 0.013583333333333333 秒、写盘峰值 407.471 ms
- 需要补的接口：主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 需要补的接口：窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 需要补的接口：音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- 需要补的接口：powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证

## 概况

- 开始：2026-11-13T02:17:30.640Z；停止：2026-11-13T02:20:35.479Z
- 墙钟时长：181.4 秒；录到的时长：181.4 秒；差：0.03 秒
- 录制汇总：时长 181.4 秒、画面分片 1（补齐 0、弃用 0）、丢帧 0、重复帧 6、续录 0、编码器 h264_nvenc
- 事件：81 页、20681 条；单页写盘最长 422 ms；轨道记录最长 123 ms；界面断开 1 次
- 声音：microphone 2 条、systemAudio 1 条
- 系统声：时长 184.55358333333334 秒、37 段、补静音 0.013583333333333333 秒、设备不可用 0 秒、丢帧 0、不连续 0、设备切换 0、重连 0；电平峰值 -33.5 dB、平均 -47.3 dB
- 运动源：ffplay（带测试音），全程在跑
- 画面分片：E:\文档\HenjiAI\Uploads\screen-recordings\85544b17-b9e5-4099-a758-cd0c9ff311ec\screen-000000.mp4（183.6 秒）
- 麦克风：E:\文档\HenjiAI\Uploads\screen-recordings\85544b17-b9e5-4099-a758-cd0c9ff311ec\microphone-joined-000.wav（81.9 秒、48000 Hz、1 声道）
- 麦克风：E:\文档\HenjiAI\Uploads\screen-recordings\85544b17-b9e5-4099-a758-cd0c9ff311ec\microphone-joined-001.wav（98.1 秒、48000 Hz、1 声道）
- 系统声：E:\文档\HenjiAI\Uploads\screen-recordings\85544b17-b9e5-4099-a758-cd0c9ff311ec\systemAudio-joined-000.wav（184.6 秒、48000 Hz、2 声道）

## 施压步骤

| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |
|---|---|---|---|---|---|
| 5 秒 | wake-lock | 1 ms | 成功 | 在录 5.5 秒 | 在录 5.7 秒 |
| 11 秒 | cursor | 10 ms | 成功 | 在录 10.9 秒 | 在录 12.7 秒 |
| 22 秒 | switch-away | 2 ms | 成功 | 在录 21.7 秒 | 在录 24.8 秒 |
| 32 秒 | switch-back | 11 ms | 成功 | 在录 32.5 秒 | 在录 35.6 秒 |
| 50 秒 | main-load | 15 ms | 成功 | 在录 50.5 秒 | 在录 64.4 秒 |
| 68 秒 | cursor | 3 ms | 成功 | 在录 68.5 秒 | 在录 70.2 秒 |
| 81 秒 | reload | 7 ms | 成功 | 在录 81.1 秒 | 在录 86.8 秒 |
| 94 秒 | status | 7 ms | 成功 | 在录 93.7 秒 | 在录 94.9 秒 |
| 126 秒 | cursor | 9 ms | 成功 | 在录 126.1 秒 | 在录 127.8 秒 |
| 153 秒 | switch-away | 10 ms | 成功 | 在录 153.1 秒 | 在录 156.2 秒 |
| 167 秒 | cursor | 2 ms | 成功 | 在录 167.5 秒 | 在录 169.2 秒 |
| 180 秒 | stop | 6 ms | 成功 | 在录 180.1 秒 | — |

## 内存（私有字节合计）

- before-start 02:17:18：1706 MB（main 358 MB、crashpad-handler 9 MB、gpu-process 765 MB、utility:network.mojom.NetworkService 11 MB、renderer 396 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、conhost 13 MB）
- start 02:17:32：3201 MB（main 383 MB、crashpad-handler 9 MB、gpu-process 844 MB、utility:network.mojom.NetworkService 11 MB、renderer 702 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 72 MB、electron 24 MB、conhost 31 MB、ffmpeg 969 MB）
- periodic 02:18:01：3209 MB（main 376 MB、crashpad-handler 9 MB、gpu-process 801 MB、utility:network.mojom.NetworkService 12 MB、renderer 758 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 25 MB、conhost 31 MB、ffmpeg 971 MB）
- periodic 02:18:36：3200 MB（main 470 MB、crashpad-handler 9 MB、gpu-process 773 MB、utility:network.mojom.NetworkService 11 MB、renderer 682 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 25 MB、conhost 31 MB、ffmpeg 971 MB）
- periodic 02:19:01：3530 MB（main 381 MB、crashpad-handler 9 MB、gpu-process 1052 MB、utility:network.mojom.NetworkService 11 MB、renderer 821 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 25 MB、conhost 31 MB、ffmpeg 971 MB）
- mid 02:19:05：3252 MB（main 378 MB、crashpad-handler 9 MB、gpu-process 797 MB、utility:network.mojom.NetworkService 11 MB、renderer 802 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 25 MB、conhost 31 MB、ffmpeg 971 MB）
- periodic 02:19:31：3036 MB（main 384 MB、crashpad-handler 9 MB、gpu-process 744 MB、utility:network.mojom.NetworkService 11 MB、renderer 633 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 25 MB、conhost 31 MB、ffmpeg 971 MB）
- periodic 02:20:01：3033 MB（main 384 MB、crashpad-handler 9 MB、gpu-process 739 MB、utility:network.mojom.NetworkService 11 MB、renderer 634 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 971 MB）
- end 02:20:31：3026 MB（main 390 MB、crashpad-handler 9 MB、gpu-process 707 MB、utility:network.mojom.NetworkService 11 MB、renderer 653 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 73 MB、electron 27 MB、conhost 31 MB、ffmpeg 971 MB）
- after-stop 02:20:50：1681 MB（main 367 MB、crashpad-handler 9 MB、gpu-process 684 MB、utility:network.mojom.NetworkService 11 MB、renderer 423 MB、utility:audio.mojom.AudioService 11 MB、henji-audio-worker 9 MB、henji-video-decoder 68 MB、utility:video_capture.mojom.VideoCaptureService 66 MB、henji-audio-capture 7 MB、conhost 25 MB）

## 防睡眠

- 录制期间：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）
- 结束之后：未取证（此命令需要管理员权限，并且必须从提升的命令提示符中执行。）

## 日志

- 警告/错误按事件计数：warn audio_capture.disk.slow ×4；warn audio_capture.system_audio.disk.slow ×3；warn recording.host.detached ×1

## 产物

- E:\文档\HenjiAI\Projects\长录测试：0 MB
- E:\文档\HenjiAI\Uploads\screen-recordings\85544b17-b9e5-4099-a758-cd0c9ff311ec：998 MB
- 合计：998 MB（脚本不删除，核对后手动清理）

## 需要补的接口

- 主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证
