# 05 审查记录

## 设计审查（Claude，10-31）
见 design.md 第 11 节：C1 改为预乘 alpha 的“零 alpha 光”（不做双信号 picture）；C2 照 4.4 推荐；C3 只做全局 look。

## 实现交叉审查（Opus xhigh，第 1 轮，基于 060ebd192）
结论：先修 2 处重要再合并。审查员实跑：持久格式门禁 64 格式、生成器 --check、4 个单测文件 45 项、真实 GPU 12 项、助手能力 237 项通过。
重要：
1. 去掉 RGB≤alpha 钳制（videoEditGpuShaders.ts:39）会让旧作品变亮：片段级全能调色（colorGrade.ts:53、adjustmentPasses.ts:40 无上限）、gl-transitions 包装（glTransitionWgsl.cjs:56）、API 4–6 作者 WebGPU/WebGL 相加混合都可能输出 RGB>alpha。
2. beforeCommit（runtime.ts:529）对所有版本生效，帧过期即清空全部 surface 缓存与 lastFrame（:547-549），拖动/滑块频繁重画；AbortError 被包成普通 Error（:550）。
小问题：API<7 的 effects 属性被拆组报错；效果纹理不走宿主预算且每帧新建；镜头模糊进了片段面板（一级 mip 出颗粒、说明写实现细节）；pose.blur 读回参数名未登记且是栅格像素；空链不保留最小档；缩放模糊外扩偏小（估算）；转场期间光消失未写进技能；生成器 --check 未进门禁；frameKey 路径读资产即放弃指纹（保守正确）。
原有问题：runtime.ts:544 资源未就绪重试复用旧 mip。
已核无问题：片段模式发光/色差/马赛克/调色算法一致；uniform 与 scratch 整批不重用、一链一次提交、提交成功才发布缓存；三种尺度换算一致；API 4–6 指纹门控与耗时不变；持久格式符合规则；能力同源投影；五条底线未触及。
处理（Claude 裁定）：1 改为默认保留钳制，仅“携带零 alpha 光”的画面（API 7 且本帧产生发光 underlay）放开并沿嵌套向上传递；2 不清有效缓存、保留 AbortError；小问题除 frameKey 资产回退（记遗留）外全修；原有问题单独记录。交 Codex Astra 修复，修后同一审查员复审增量。

## 实现交叉审查（Opus xhigh，第 2 轮，增量 060ebd192..778b58bf8）
结论：先修预算超限再合并。第 1 轮：重要 1（钳制，carriesLight 仅 API≥7 且本帧有 underlay，嵌套与运动模糊累积都传）、重要 2（弃帧只清改过的 surface）、API<7 effects、pose.blur 读回、空链最小档、缩放模糊外扩、生成器门禁已修；镜头模糊修偏（助手片段效果目录仍列 lens_blur）；技能“转场丢光”说法不全。
新重要：发光外扩 1080p 默认 1262px 再取整到 2048 档、不随图层大小变，小字层纹理 4196×4136（带 mip 88MiB），一条发光链 3 张、参数动画时保留旧缓存再分配新一套，第 2 帧约 528MiB 超 512MiB 预算报错（按代码计算，未真机复现）。
小问题：转场/任何片段效果都丢光的文档；rgba32float 按 16 字节计后 4K final 高斯可能让原本能导出的作品超预算；弃帧释放整个 scratch 池；colorGradeOut 不钳直通色导致按整帧标记时边缘随发光强度闪。
处理（Claude 裁定）：外扩按能量截断（贡献低于半级即截）、细档位不按 2 的幂、中间纹理不建 mip、动画就地复用；lens_blur 按 space 从片段目录与写入入口排除；文档改准确；32f 只在必要工序、补 4K+10bit 回归；弃帧只回收本次借出；colorGradeOut 先钳直通色（根因）。交 Codex 第 3 轮修复（最后一轮），修后复审一次即合并。

## 实现交叉审查（Opus xhigh，第 3 轮，增量 778b58bf8..d7a284a7a）
结论：预算超限已修（默认 1080p 外扩 2048→338px、中间纹理无 mip、就地复用）、lens_blur 排除、文档、32f 高斯（峰值 443/512MiB）已修；弃帧回收修偏（abandon 末尾仍 releaseIdle）。
新重要：① colorGradeOut 非 extendedRange 时对所有中间工序钳直通色，10-bit 片段超亮值先被截，晕影/模糊高光变暗（GPU 测试期望值被改）——由 Claude 第 2 轮裁定引起；② glowEnergySupport 每帧重算，最大半径单次 19–44ms；③ 高斯 pose.blur 的 gaussianLoad 遇 alpha==0 返回 0，光纹理整片清空（本 ticket 新功能缺陷，合并前必须修）。小问题：预设导入可能绕过入口把 lens_blur 放到片段（未实测）。
处理（Claude 裁定）：① 只在图层模式或 alpha<1 像素钳，片段路径恢复原行为并恢复测试期望；② 跨帧 LRU 缓存；③ 虚化加“保留零 alpha”标志、补光能量守恒真实设备测试；小 a 去掉 releaseIdle；小 b 核实后按 space 过滤。
偏离：复审已满三轮，剩余三条均为局部缺陷、方案本身无问题，第 4 轮定点修复不再派独立复审，由 Claude 读增量、复跑验证后合并（同 ticket 03 做法）。
