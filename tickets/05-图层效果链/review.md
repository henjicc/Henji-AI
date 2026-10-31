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
