# 17 审查记录
摘要：合并审查 1 轮（Opus xhigh）：重要 5、小 8、清理 2；裁定见下。合并顺序：10 先合（占 API 8），15 先于 17 合；17 合并时接上 15 的内容键。

1. 重要：at() 每次重新校验、深拷贝、冻结（100 刚体一次 0.31ms，按推荐用法一帧可达 1 秒）→ 每步视图在 prepare 时冻结一次，at 直接返回缓存（插值结果按时刻缓存）；技能写明同一时刻只取一次。
2. 重要：判断恢复时没看已缓存视图，25/50fps 加插值时顺播反复恢复检查点 → [a, current] 已有视图时从 current 续推；补“顺播只付差值步数”的计数测试。
3. 重要：ticket 15 的 outputKey 在模拟模块 frameKey 回退时不含曲线历史 → 合并 main（含 15）后 outputKey 带上 plan.simulation.identity，补“改早期关键帧、当前值不变也失效”的测试。
4. 重要：API 默认与常量 → ticket 10 合并后（冻结 2.0.0、默认 API 8），17/18/16 共用**一个**最新 API 常量（9），新建素材默认 API 9；删掉 CODE_SIMULATION_API_VERSION、WEB_TEXT_AUTHOR_API_VERSION 这类分散常量。
5. 重要：持久格式基线落后 → 合并 main 后按 main 登记顺延重排（video_edit、screen_recording、风格库、风格包、code-asset、code-version）；删掉本分支的 API 8 占位（由 10 提供），authorVersion 与模板 pin 的副本与 10 去重。
6. renderCache 整份计入片子数据按“是否声明模拟”判断，不按 apiVersion ≥ 9。
7. dispose 与在途渲染竞态导致模拟泄漏 → 等在途渲染结束后再取并释放。
8. interpolate 抛错后 poisoned 不复位 → 正确复位，取消不被当失败。
9. 试画入口传 simulationInput 与 signal。
10. 附加滤镜的模拟零点改为片段在源媒体上的入点（片段开始即模拟开始），避免长素材冷补数十万步；技能写明。
11. 第三方许可证生成登记 vendor 的 Rapier 及 wasm 内嵌的 parry、nalgebra 等。
12. 技能：工厂里 await 之后也只用 info.random()，不用 Math.random/Date.now；at() 结果每次调用复制的说法随第 1 条更新。
13. 引擎版本散列不依赖是否先跑过 build:author-libs（只散列冻结目录或改为只靠片段指纹里的库身份，新冻结版本不让全部预渲染失效）——查实后按更稳的做。
14. 冻结 upstream.mjs 去掉 sourceMappingURL；init 失败不永久缓存。
15. 清理：NaN/Infinity/undefined 报准确错误；save 不重复快照 S0、不重复遍历；导出 AuthorSimulationDeclaration/Sampler 类型；step params 按 AuthorParamValues<P> 定型。
