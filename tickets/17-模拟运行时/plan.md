# 17 模拟运行时（以后再做第 5 项）
摘要：作者代码的物理与累积模拟：固定步长、每 K 步存快照，取任意时刻恢复最近快照再推进；物理用 Rapier 的 deterministic-compat 构建；作者接口尽量与 FrameFlow 一致。预览、预渲染、导出逐帧一致，可与 frameKey/指纹/片段缓存配合。
分级：大；Codex astra 写 design.md → Claude 审 → 实现 → 合并审查一轮。
依据：以后再做第 5 项；作者确定性（videoEditAuthorDeterminism.ts）、作者库冻结机制。
