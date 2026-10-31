# 09 审查记录
摘要：设计审查 1 轮（Opus xhigh）：必须改 5 条、建议 9 条；Claude 裁定见 design.md 第 10 节。
实现后的交叉审查与 /code-review 结果追加在后面。

## 设计审查（10-31）
必须改：
1. 浮点合成变体去钳制会改到现有嵌套与 10 位以上素材帧（共用 rgba16float 管线）；extendedRange 改的是算法、且与修图共用，不能复用。
2. 作者画布格式按层/组决定会受静止层历史（QUIET_FRAMES、粘性直接绘制槽）影响，预览与导出实例结果不同。
3. frameKey 路径不跑 draw，拿不到 Canvas 触发；精度本是已散列内容 + 判定算法的纯函数，额外签名反而会让独立指纹会话算出不同结果。
4. “Canvas 实际能力”入键没有来源（窗口键与指纹 Worker 都不拿 GPU）；shaders 框架出口若仍是 bgra8unorm，触发它只多付带宽。
5. 作者滤镜目标格式跟输入走，链路升 16f 后硬编码 rgba8unorm 的程序会报验证错误被静默移除；2.3 关于不能给 16f 的说法与现行 author-shaders.md:15 契约不符。
建议：6 不要两阶段准备帧，层栈遇到首个触发层再升 16f 并拷贝；7 运动模糊累积本已高精度，去掉该触发；8 显存按字节统计（含每层持久画布）；9 列全硬拒绝点（prepareImages、checkInputBudget、generatorTargetCapacity、spill）；10 bitmapOf 桥是 8 位边界；11 8↔16 往返切换的分配与编译开销，加边界往返基准；12 Canvas lighter/screen 在 float16 也可能截断；13 第 9 节与正文冲突需清理；14 Canvas float16 分到第二步。
