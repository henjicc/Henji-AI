# 02 导出复用预览 · 计划
目标：导出时已渲染（ready）的窗口直接解码预览文件，其余帧现场合成，对照 Premiere“使用预览”。
分级：大（改导出设置持久格式 video_edit v43、screen_recording v46、导出预设 v2）。执行者：Codex（sol）；审查：Opus xhigh + /code-review。

## 依赖
01 的窗口键与 ready 判定。

## 完成标准
- 导出设置“使用预览文件”，预设、队列、助手导出能力同一份选项。
- 复用条件：与导出快照同一 revision、窗口按当前指纹与编码档案 ready、预览分辨率不低于输出、帧率相同；读不了的窗口退回现场合成，导出不失败。
- 真实片子上预览帧与现场帧画质人眼可接受（点阵台面重点核对），据此定默认开或关。
- 持久格式逐版本迁移与黄金样本齐全；verify:changed L2、check:assistant-capabilities 通过。
