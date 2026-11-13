# 长录结果：录音 3 分钟

**结论：有问题**

## 问题

- 脚本中途失败：应用对外宿主没有就绪
- 录制没有开始
- 日志里没有 recording_power.hold.start
- 没有找到 audio_capture.recording.summary

## 提示

- 内存样本不足三次，增长判断不可靠
- 需要补的接口：主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 需要补的接口：窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 需要补的接口：音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- 需要补的接口：powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证

## 概况

- 开始：—；停止：—
- 墙钟时长：—；录到的时长：—；差：—

## 施压步骤

| 计划 | 动作 | 迟到 | 结果 | 前 | 后 |
|---|---|---|---|---|---|

## 内存（私有字节合计）

- before-start 01:58:44：1039 MB（main 347 MB、crashpad-handler 9 MB、gpu-process 423 MB、utility:network.mojom.NetworkService 12 MB、renderer 248 MB）

## 防睡眠

- 录制期间：—
- 结束之后：—

## 日志

- 警告/错误按事件计数：无

## 产物

- 合计：0 MB（脚本不删除，核对后手动清理）

## 需要补的接口

- 主进程加压：没有只在自动化模式开放的“让主进程忙 N 毫秒”开发钩子，脚本用并发全文日志查询近似（读整天日志并逐行解析），并用 ping 往返时间证明主进程确实变慢
- 窗口还原：渲染层只有 minimize，没有 restore IPC，脚本用 Win32 ShowWindowAsync 还原主进程的最小化窗口
- 音频编辑录音的会话 ID 不在正式读回里，脚本从 audio_capture.recording.start 日志取，再用 audioCapture.status 读主进程真实状态；读不到时退回 audio_capture.settings.recording
- powercfg /requests 需要管理员权限；脚本不在管理员终端运行时只能用 recording_power.* 日志佐证
