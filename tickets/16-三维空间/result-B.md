摘要：已实现 B 提前开工包：受管 createThree、共享设备 G/W 桥接、r186 宿主时钟、冻结 SpatialCodeSources 接口及所有权内入口适配；冻结签名未改。
摘要：真实 GPU 原型通过；ExternalTexture 直接输出在 r186 失败，公开中间 RT＋同设备拷贝通过；独立审查一轮的两项重要问题已修复，最终 L2（169 个精确测试及静态门禁）通过。
摘要：完整 B 验收尚有类型检查器接线与 A/15/17/18 联调缺口；本交付不等同整片空间功能验收，不合并、不推送。

## 范围与提交

- 工作目录：D:/VibeCode/Henji-AI-t16b；分支：task/16B-三维作者场景；基线：3c813ce7d。
- 提交：c61d343519fb07b2d514cace20f52de757657b75（feat(video-edit): 接入受管 three 场景与宿主时钟）。提交后工作区干净；未推送。
- 仅修改 design.md 3.1 的 B 所有权文件及相邻精确测试。没有改 A 的 spatialTypes / spatialContracts / 持久版本，也没有改其他工作区源码。
- 没有 npm install/ci/uninstall，没有删除联接点，没有接入 9334 或 D:/视频制作。GPU 用独立 Chrome headless 进程及随机本地端口；一次一个重任务。

## 实现与边界

1. createThree(host) 工厂返回同一冻结作者库的 Scene/update/dispose；与绘制入口互斥。模块实例由现有 Programs 队列管理。元数据将其识别为 worldScene；其他入口只有 space:true 才注入空间信息。旧入口默认不添加空间指纹。
2. 相机在 update 前同步、渲染前重新同步；使用 A 的数值矩阵；场景根一次应用片段矩阵。保留作者 Scene 的 background/environment/fog；worldBounds 从受管根求取。相机、根矩阵、输出 DTO 冻结后交作者。共享几何/材质按活跃实例计数释放，作者清理报错不阻止其余资源释放。
3. G/W 都实例化 WebGPURenderer。G 为 forceWebGL＋OffscreenCanvas 上传；W 使用现有共享 GPUDevice。库来自 authorLibraries 的原生挂载 URL，不导入应用 three 0.169 的值，也不复制 renderer 后端纹理句柄。
4. r186 的 _animation / _nodes 仅集中在 AuthorThreeClock。初始化后停 RAF，compile/render/compute 的异步期间固定 nodeFrame.time、deltaTime=0、frameId；保留 renderId，结束恢复 update 方法。TSL.time 与 FRAME/RENDER 更新均测过。
5. W 走公开 HalfFloat RenderTarget、4x MSAA、ExternalTexture 拷贝目的地；每样本一次同设备拷贝，再转宿主 gamma 2.4 预乘输出。G 先公开 canvas 拷贝再转色。宿主目标只借用；包装释放后宿主目标仍可写入。深度、MSAA、颜色和桥接 scratch 计入已知工作集，目标另由 CodeGpu allocator 计数。
6. CodeSources 实现冻结的 describe/prepare/inspect/render/capacity/release 六个接口。普通卡片冻结中心材料面，worldScene 用曝光计划源子时刻；借用材料面等待所有 afterUse 完成才回收。取消后的请求不发布旧输出，释放保护名单。普通卡片继续传递元素覆写、序列内部位姿模糊开关、渲染缩放和效果环境；输出及精度升级都允许 storage texture 写入。
7. 空间内容键含请求键、源码、参数、覆写、实际源时刻、尺寸、格式、质量与空间 DTO。frameKey 不能抹掉空间依赖。尚未接入 15 时，不启用跨帧空间复用；整片指纹遇空间作者保守回退，普通二维序列化保持原路径。
8. API 暂记值只在 contract.ts 的 AUTHOR_SPATIAL_API_VERSION 一处为 9；未调整正式持久最大版本。17 的准备和采样、18 的网页票据与文本 DTO 通过 setSpatialAuthorHooks 的 prepare/inputs 接入，不伪造模拟实现。测试桩验证中心与精确子时刻传递、info 扩展共存。
9. GLSL ShaderMaterial/RawShaderMaterial 有带源位置的静态诊断函数；TS 打包路径调用并抛 TYPE。初始化及每次 update 遍历实际场景作运行时兜底，错误点名材质。普通 createWebGL 不受此规则影响。
10. 已检查 AuthorDeterminism、AuthorBundle、AuthorJsLocations、codeTrackReview 的入口枚举并适配；declarationReader 仅读取声明、AuthorProbeSources 仅生成滤镜探针，未发现需要增加 createThree 分支的枚举，故未机械修改。

## 尚未闭环的接线项

- **类型检查器所有权缺口**：videoEditAuthorTypeCheck.ts 不在 3.1 独占清单内。本次没有越权修改；需要协调 owner 后，将 authorThreeDiagnostics 接入 check() 汇总，并让入口包装按 space/createThree 选择 AuthorSpatialFrameInfo。当前 createThree.update 已拿到必有 space 的类型；其他入口仍是 optional space，不能宣称完成按声明推断。
- 直接 JS 编译走 directAuthorBundle，绕过 AuthorBundle 的 TS 打包静态诊断；其动态 GLSL 场景仍会被运行时校验拒绝。要在 JS 发布前也给出统一带位置诊断，需要与上述检查器接线一起收口，不能把当前运行时兜底当作发布静态校验已完成。
- 上述两项属于明确缺口，不因门禁通过而消失。尝试仅用公开声明联合类型会让现有作者参数推断漏报，已撤下该做法；原有类型检查回归保持通过。
- A 完成正式曝光/合成接入与 API 9 持久读取后，再联合验证实际作品。15 的最后内容键提交/失效、17 的 simulationEpoch/prepare/at、18 的正式文本 DTO 尚未接线；不改依赖方向、不实现替代协议。
- 冻结 4.5/4.6 签名零变更请求。后续只需接现有正式实现；本次没有为了早开工放宽整票质量门槛。

## GPU 原型数据

环境：2026-11-01；独立系统 Chrome headless；navigator.gpu 报告 NVIDIA / Lovelace（未暴露具体型号）；three 0.186.1。固定 80mm / 36mm 与 1 单位画高标定，单平面节点材质，TSL.time 驱动颜色；每档 5 帧预热、120 帧测量。1080p/4K 各测 1/8/16 样本，未混入并行构建。

CPU 是提交耗时；“完成延迟”是提交至 onSubmittedWorkDone 的端到端墙钟耗时，**不是 GPU timestamp**。表内均为毫秒，三项为 p50 / p95 / max。

| 后端 | 分辨率 | 样本 | CPU | 完成延迟 | 已知桥接工作集 MiB | 每帧拷贝 |
| --- | --- | ---: | --- | --- | ---: | ---: |
| W | 1920×1080 | 1 | 0.30 / 0.60 / 0.90 | 3.10 / 4.40 / 4.60 | 126.56 | 1 |
| W | 1920×1080 | 8 | 1.10 / 2.20 / 3.80 | 6.50 / 7.80 / 8.40 | 126.56 | 8 |
| W | 1920×1080 | 16 | 1.80 / 3.00 / 3.30 | 10.60 / 12.70 / 16.80 | 126.56 | 16 |
| W | 3840×2160 | 1 | 0.20 / 0.40 / 1.30 | 3.50 / 4.50 / 5.40 | 506.25 | 1 |
| W | 3840×2160 | 8 | 1.00 / 1.90 / 2.50 | 7.40 / 9.10 / 10.00 | 506.25 | 8 |
| W | 3840×2160 | 16 | 1.70 / 2.60 / 3.50 | 13.00 / 14.20 / 14.90 | 506.25 | 16 |
| G | 1920×1080 | 1 | 0.30 / 0.60 / 0.90 | 1.80 / 4.50 / 5.00 | 79.10 | 1 |
| G | 1920×1080 | 8 | 1.20 / 2.10 / 3.30 | 8.10 / 12.00 / 30.20 | 79.10 | 8 |
| G | 1920×1080 | 16 | 2.00 / 3.00 / 3.50 | 14.90 / 18.90 / 20.20 | 79.10 | 16 |
| G | 3840×2160 | 1 | 0.20 / 0.50 / 0.90 | 3.50 / 4.60 / 5.00 | 316.41 | 1 |
| G | 3840×2160 | 8 | 1.50 / 2.10 / 3.10 | 11.50 / 13.10 / 14.00 | 316.41 | 8 |
| G | 3840×2160 | 16 | 2.40 / 3.20 / 4.10 | 18.70 / 22.60 / 24.00 | 316.41 | 16 |

工作集数值由受管分配公式计账，不是驱动显存峰值；不含作者几何、纹理、shadow/postprocess 的任意额外资源与 A 合成工作集。没有用本表宣称整票 P2 已达标。当前实现默认 W，G 留作宿主可选原型路径，无用户设置；W 在多样本桥接测试有收益，最终正式后端仍需完整 A/B 正确性与性能门槛确认。

### 正确性与 ExternalTexture

- 构造器身份：three.module 与 three.webgpu 的 Scene 严格相等；宿主加载函数复用实际 authorLibraries URL。
- 时间序列：0→37→12→37→37，及空闲 80ms 后重复 37；所有相同时间的整幅 SHA-256 相等。FRAME/RENDER Node 回调的 delta 均为 0，compute 读回为 [0,37,12,37]。
- 64×64 RGBA8 → 128×64 RGBA16F → 64×64 后，恢复目标的整幅哈希不变。
- 37 秒中心 RGBA8：W [179,119,167,255]；G [179,118,167,255]。半透明 RGBA16F：W [0.35156,0.23291,0.32642,0.5]；G [0.35303,0.23401,0.32690,0.49780]。
- 提交前取消返回 AbortError，后续正常帧可渲染；共享错误观察器保留；渲染器释放后借入目标仍可提交；正常 G/W 路径未捕获设备验证错误。
- 公开 ExternalTexture **直接作为 RenderTarget 输出失败**：createRenderPipeline 的 fragment.targets[0].format 为 undefined（Required member is undefined）。失败在独立 validation scope 捕获，不混入正常路径结果。
- 公开中间 RT＋copyTextureToTexture 到 ExternalTexture 通过；未采用私有 texture/backend 访问 Z 路径。多样本复用固定 scratch，不按样本数倍增颜色目标。
- 尚未验证：完整 P1/P4/P5 整片联调、真实设备丢失重建、正在飞行的真实 GPU 提交取消、零 alpha 发光场景与遮挡/景深/顺序跨越、Electron 正式作品导出。单平面原型不能替代这些门槛。

原始本地证据：.tmp/t16b/gpu-evidence.json、gpu-final.log；可重跑：HENJI_THREE_GPU=1 HENJI_THREE_BENCH=1 下运行 videoEditAuthorThreeWebGpu.test.ts。环境变量仅作用于该命令；未加入普通测试默认运行。

## 验证与审查

- 独立干净上下文审查 1 轮：只交文件清单、diff、目标与领域规则。报告 2 项重要问题，均已修复：空间路径遗漏覆写/模糊/缩放；空间目标与精度升级遗漏 STORAGE_BINDING。新增针对回归断言，相关 58 测试通过。
- 主代理继续检查中心/子样本切换、相机复核、根变换一次应用、共享资源释放、保护名单生命周期、旧指纹保守性；相关精确用例通过。未将仅有桩测试的接缝说成真实联调通过。
- 最终 L2：通过。16 个精确测试文件、169 个测试全部通过；ESLint、渲染层 tsc、Electron tsc、依赖图、主进程导入边界全部通过。显式 23 个本次文件；额外精确指定 AuthorTypeCheck 与 AuthorApiContract，未扫描整个脏工作区。日志：.tmp/t16b/verify-final.log。
- GPU 专项：2/2 通过，15.51 秒；普通精确运行不会重复启动 GPU 基准。
- 未新增/修改应用能力注册、manifest 或助手工具，故没有触发 check:assistant-capabilities；未运行全仓测试、完整 Electron 构建或修改当前开发实例。

