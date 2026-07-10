# 测试记录

## 1.1 动作片段确定性驱动

### 自动检查

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint` | 通过 | ESLint 零警告退出。 |
| `npx tsc --noEmit` | 通过 | TypeScript 类型检查零错误退出。 |
| `git diff --check` | 通过 | 未发现补丁空白错误。 |

### 待用户手动验证（真实 Electron 窗口）

1. 使用 `npm run electron:dev` 打开含角色和任一动作片段的工程；暂停时间轴，等待数秒，确认角色姿态保持不动。
2. 拖动时间轴到两个不同时间点并往返，确认同一时间点始终恢复相同姿态，动作不再自行循环。
3. 将速度调为非 1 倍，确认当前时间点的姿态即时按新速度映射变化；继续拖动时间轴，确认动作未因调速而从头重播。
4. 对同一工程连续导出两次 MP4；将两个视频定位到相同时间点，确认角色姿态一致。

### 重启说明

✔️无需重启

## 2.1 帧数据二进制传输

### 自动检查

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint` | 通过 | ESLint 零警告退出。 |
| `npx tsc --noEmit` | 通过 | 渲染层 TypeScript 类型检查零错误退出。 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 | Electron 主进程/预加载类型检查零错误退出。 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过 | Electron 源码 ESLint 零警告退出。 |
| `git diff --check` | 通过 | 未发现补丁空白错误。 |
| 旧帧载荷检索 | 通过 | 未发现 `decodePngDataUrl`、`appendVideoFrameExport` 的 dataURL 载荷或 IPC 旧字段解析。 |

### 待用户手动验证（真实 Electron 窗口）

1. 重启 `npm run electron:dev`，打开包含运镜控制场景的工程。
2. 分别选择 720p 和 1080p，各导出一次 MP4；确认导出成功、产物可播放且画面比例、背景与场景内容正确。
3. 对比一次 1080p 导出的进度速度，确认不慢于改造前的同类导出。
4. 使用截图保存和复制到剪贴板各执行一次，确认截图功能与裁剪画面正常。

### 重启说明

⚠️ 需要重启

## 1.2 动作片段与关节采样互斥

### 自动检查

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint` | 通过 | ESLint 零警告退出。 |
| `npx tsc --noEmit` | 通过 | TypeScript 类型检查零错误退出。 |
| `git diff --check` | 通过 | 未发现补丁空白错误。 |

### 待用户手动验证（真实 Electron 窗口）

1. 给角色的任一关节和颜色分别添加关键帧，再将角色切换到一个有效动作片段。
2. 播放或导出，确认骨骼只呈现动作片段、无抖动或姿态闪跳；同时确认颜色仍随颜色关键帧变化。
3. 将角色切回静态姿势，播放时间轴，确认关节关键帧动画恢复生效。

### 重启说明

✔️无需重启

## 2.2 导出会话与产物清理

### 自动检查

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint` | 通过 | ESLint 渲染层零警告退出。 |
| `npx tsc --noEmit` | 通过 | 渲染层 TypeScript 类型检查零错误退出。 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 | Electron 主进程/预加载类型检查零错误退出。 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过 | Electron 源码 ESLint 零警告退出。 |
| `git diff --check` | 通过 | 未发现补丁空白错误。 |

### 待用户手动验证（真实 Electron 窗口）

1. 重启 `npm run electron:dev`，开始一段足够长的视频导出；进入“编码中”后点击取消。确认应用数据根的 `Uploads` 内未新增半截 `.mp4`，且 `%TEMP%` 下没有对应 `henji-camera-stage-export-*` 会话目录。
2. 再次开始长视频导出，在逐帧渲染或编码阶段按 Ctrl+R（或开发者工具 Reload）刷新窗口。等待数秒后，确认 `%TEMP%` 的对应会话目录已删除；重新打开后可正常再次导出。
3. 正常完成一次导出。确认 Uploads 与所选目标路径都有可播放的完整 MP4，且文件名时间与本机当前本地时间一致（不是 UTC 偏移）。
4. 可选跨卷环境：将 `%TEMP%` 与应用数据根置于不同磁盘后完成导出，确认 Uploads 中未残留 `.henji-camera-stage-export-*.part` 文件。

### 重启说明

⚠️ 需要重启

## 3.1 编码真实进度推送

### 自动检查

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint` | 通过 | ESLint 渲染层零警告退出。 |
| `npx tsc --noEmit` | 通过 | 渲染层 TypeScript 类型检查零错误退出。 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 | Electron 主进程/预加载类型检查零错误退出。 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过 | Electron 源码 ESLint 零警告退出。 |

### 待用户手动验证（真实 Electron 窗口）

1. 重启 `npm run electron:dev`，打开包含至少 10 秒动画的运镜控制工程并导出 MP4。
2. 逐帧渲染完成后，确认工具栏编码提示从“编码 0/总帧数”开始，随后持续增长，最终达到总帧数；导出的视频可正常播放。
3. 在编码阶段点击“取消导出”，确认导出停止、无控制台报错；再次导出，确认只有新会话的编码数字更新，未出现重复或跳变的旧事件。

### 重启说明

⚠️ 需要重启

## 3.2 离屏渲染目标分辨率导出

### 本次验证

| 项目 | 结果 | 说明 |
|---|---|---|
| `npm run lint` | 通过 | ESLint 零警告退出。 |
| `npx tsc --noEmit` | 通过 | TypeScript 类型检查零错误退出。 |
| `git diff --check` | 通过 | 未发现补丁空白错误。 |
| 静态链路复核 | 通过 | 视频帧直接消费目标尺寸离屏 PNG bytes；截图仍保留无参 dataURL 与既有裁剪路径。 |

### 待用户手动验证（真实 Electron 窗口）

1. 使用 `npm run electron:dev` 打开含至少数秒动画和摄像机视角的工程，将窗口缩小到明显低于 1080p 的尺寸；分别导出 720p、1080p。确认 MP4 可播放、尺寸符合所选规格，且 1080p 细节不因小视口而模糊。
2. 在小窗口与接近全屏两种状态下导出同一时间段；比较同一帧，确认构图、FOV、目标位置一致，且 1080p 清晰度一致。
3. 导出过程中观察视口，确认没有尺寸变化、拉伸或闪变；取消一次导出后再次导出，确认可以正常完成。
4. 分别执行截图保存和复制到剪贴板；确认截图仍按当前相机画幅居中裁剪，画面与视频离屏导出均正常。

### 重启说明

✔️无需重启
