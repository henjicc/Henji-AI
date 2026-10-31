# 10 审查记录
摘要：设计审查第 1 轮（Opus xhigh）：必须改 8、建议 6；Claude 裁定见 design.md 第 13 节，交回 Codex 改设计后再审一轮。

## 设计审查第 1 轮要点
必须改：1 风格样片、库模板、预设预览不记作者 API 与库版本，升 API 8 后会悄悄换新排版；2 升级操作保留原 API，API ≤7 素材永远升不到 2.0.0；3 prepareTextFonts 的异步准备在现有运行时接不上（draw/layers 同步、模块导入确定性链与全局替换、Worker 同一 queue 会卡死）；4 “未准备字体走已准备的回退”让回退随帧变化，预览/导出/指纹 Worker 结果不同；5 Pretext 测量注入范围被低估（Canvas 探测多处、逐段整形丢上下文、缓存键不含特性）；6 每帧 Path2D 重画让录制器失去纹理复用，带外观的字每帧建两张整画布；7 连字簇的部分揭示与不同位姿未定义；8 实验 2 阈值与 1/64 LayoutUnit 量化矛盾。
建议：9 生产只把字体字节交给 HarfBuzz、按书写系统懒加载，避免与 1.x 的 FontFaceSet 互相干扰；10 harfbuzzjs 的 HB_TINY 构建缺 AAT、位图 emoji 待核；11 标点分类用 HarfBuzz 字形范围而非 Canvas 墨迹；12 tsume、小型大写、上下标的映射；13 harfbuzzjs 作为独立作者库共用、字体按内容哈希缓存、显式释放 wasm 内存；14 text-autospace 在 Chromium 152 支持情况未定、自有样本比例要提高。
