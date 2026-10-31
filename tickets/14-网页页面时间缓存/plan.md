# 14 网页页面时间缓存 + 网页取帧遗留（以后再做第 7 项；ticket 03 遗留）
摘要：按（网页内容指纹、视口、scale、页面帧率）把网页按页面时间录成硬件编码视频分段（闭合 GOP 约 2 秒）放进作品缓存，预览/拖动/暂停/导出优先读缓存，缺段回退实时页面；顺带收掉 ticket 03 遗留：完整取帧流水线、按屏幕实际尺寸定倍率、占位宽高 1×1、硬剪点预开页面、冷页面首播丢帧。
分级：大；执行 Codex gpt-6-astra high，worktree `D:\VibeCode\Henji-AI-t14`，分支 `task/14-网页页面时间缓存`；先写 design.md 交 Claude + Opus xhigh 审，批准后实现；实现后交叉审查 + /code-review。

## 依据
以后再做第 7 项（方案、参考、验收）与第 12 项剩余；ticket 03（tickets/03-网页取帧不阻塞与倍率跟随/）的 result 与遗留；现有网页源：electron/main/services/web-source/**、渲染器网页输入 videoEditWebInputs.ts、videoEditWebContentIdentity、渲染缓存 videoEditRenderCache.ts / core/videoEdit/renderCache.ts。

## 验收
缓存补齐后网页段播放与来回拖动和普通视频一样流畅（真机数据）；日志可查命中、补录进度与回退原因；导出网页段每帧耗时明显下降；冷页面首播丢帧下降；只在网页内容变时失效。
