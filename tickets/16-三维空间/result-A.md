摘要：A 线未完成交付；冻结契约已提交，求值、传播基础、曝光及 GPU 内核已实现并验证；正式 Renderer、完整事务传播与最终格式登记未闭环。
摘要：契约提交 3c813ce7d；task/16-三维空间 已通过 b97a099be 吸收 main fde217903（含 12、15、21）；剩余实现未提交，未切分支、未合 main、未推送。
摘要：144 项精确测试、19 项 Node 测试、237 项能力门禁测试、双工程 tsc、依赖图、3 项真实 GPU 通过；P1 合成器 12 组原始帧差异为零；持久兼容与完整 L2 未通过。

## 契约检查点

- 完整提交：`3c813ce7d1c316aeb86c48ea1fa748fb3b7fd23b`，`feat(video-edit): 三维空间契约与坐标曲线夹具`。
- design.md 4.5/4.6 的 DTO、schema、曝光/Host/CodeSources 契约与品牌符号已冻结，后续未改签名。新增内部辅助函数不改变冻结接口。
- 数学复用已安装的作者版 three 0.186.1，经动态入口加载；schema/DTO 不静态导入 three。关键帧 schema 从运行时抽离，共用插值与来源结构。
- 检查点的 15 项精确测试、12 项依赖门禁自测、双工程 tsc、当时 66 种格式兼容检查通过。格式通过证据仅属于契约提交，不能代替当前格式验证。

## 当前工作区实现

| 范围 | 已实现内容 |
| --- | --- |
| 片段与相机 | 四个动画键/开关、相机数值及 hold 绑定；关闭空间和禁用 motion 无空间贡献，缺失字段不补零 |
| 几何求值 | 默认及推拉变焦相机、轴心旋转、完整齐次投影、视锥裁剪、中心视深/CoC、framing/aim/focus、隐藏目标几何 |
| 动画传播基础 | 复用通用切分/缩放；分割目标按切点切换引用；整序列复制重映射静态/hold 引用；帧率及跨帧率粘贴保留四键 |
| 引用传播服务 | 拒绝过期 revision；删除/搬移前烘成普通世界目标曲线；核对 8/16 快门样本的投影和中心 CoC 误差；失败不提交部分结果 |
| 指纹 | 相机与目标引用进入依赖，含隐藏/范围外目标和嵌套；旧无空间数据不补字段 |
| 曝光 | 180° 快门、8/16 样本、切点/hold 截断、二维覆盖/调整层隔断、稳定层序按层累积、换序逐子时刻整组曝光 |
| 转场 | 原子项排序；稳定层序也按子时刻合成两端与淡化后累积，不再重复混合终图 |
| GPU | 完整 xyzw、透视正确 UV、mip、MSAA 透明外沿、预乘 alpha、同根 device、completion/lease、流式释放累积器 |
| 景深 | 复用正式镜头核；两轴参考平面尺度换算、扩展材料面/padding、小 CoC 归零连接；没有新建 blur shader |
| 合成 helper | renderVideoEditSpatialCompositeScene 复用正式树/效果/转场；合成器支持材料 viewport；非代码卡片已实际走此入口验证 |
| Worker | 既有运动 Worker 增加求值/传播；取消终止 Worker，拒绝迟到结果并返回几何事实 |
| 格式准备 | 实际嵌入空间数据的版本及迁移；生成器加入四键、切分/缩放、相机绑定、原生模板及旧标题/预设包样本构造 |

## 一轮独立审查

干净上下文只收到文件/diff、任务目标及领域规则；没有实现推理，不改文件、不重复跑测试。

1. **重要：亚像素深度交叉漏曝光。已修。** 降为单样本前检查探测帧层序，换序独立触发完整采样；新增微小深度穿越回归。
2. **重要：真实场景范围未参与裁剪面。已修。** worldBounds 扩展逐样本 near/far，重算 WebGPU/WebGL 与卡片投影；包围框面经视锥裁剪。缺少同样本观测明确失败。

审查覆盖求值、曝光/GPU、引用传播、分割/帧率/复制和主要格式迁移，未提出其他有充分证据的问题。审查后转场累积、淡化、格式核对收缩等增量由主代理自审并定向验证，没有第二轮独立审查。

## 验证证据

| 验证 | 结果与边界 |
| --- | --- |
| 精确 Vitest | 14 文件 144 项通过：契约/求值/传播、关键帧/轨道、几何、时间线、缓存、属性、Worker、曝光、树/合成器、效果计划；17.41s |
| Node 精确 | dependency-graph、testSuites，19 项通过 |
| 双工程 tsc | renderer、Electron 均通过；12GiB Node 堆，任务本地增量缓存 |
| 文件级 ESLint | 实现 TS 文件通过；GPU 测试诊断的 no-console 已修并单独复验 |
| dependency-graph | 通过；0 静态值 SCC、0 冻结跨层边、首屏 0 重模块；62.44s |
| check:main-imports | 通过；977 个 main/preload 文件 |
| check:assistant-capabilities | 31 文件 237 项通过；C 未合入，不能据此声称三维公共能力闭环已验 |
| 真实 GPU | 永久专项 3 项通过；与临时 P1 同次合计 4 项通过，14.26s |
| check:persistence-compat | **未通过**：8 个升级格式缺新版黄金样本与基线 |
| verify:changed L2 | 显式任务文件 dry-run 已做；计划包含 persistence:baseline，完整执行尚未开始，不能报通过 |

临时 P1 源码/测试已删，专项清单仅保留永久 SpatialComposite GPU 测试。未安装/卸载依赖、未删除 node_modules 联接点、未操作 9334 或 D:/视频制作，未创建其他总结文档。

## P1 实验数据

### 合成器原始帧

- 改前 main 为 `1e3982dd4`；提取其正式 GPU 合成器和 shader，与当前实现同设备、同输入比较。其余共同依赖使用当前分支，因此不是完整旧/新应用或 Renderer 验收。
- 独立 VGPU Node 进程。系统枚举 RTX 4090，驱动 32.0.16.1047（2026-05-19）；未另采集 VGPU adapter.info。
- 1920×1080、960×540 × RGBA8、RGBA16F × 非中心轴心/Z 旋转、四角定位、三姿态运动曝光，共 12 组。
- 每组比较旧 main、当前缺省空间、当前显式开启且四值为零；**差异字节 0，最大字节差 0**。
- 首轮：`evidence-A/p1-compositor.json` 与列出的 12 份编码前 raw。
- viewport 接线及 main 15/21 合并后重验：`evidence-A/p1-material-compositor.json` 与另 12 份 raw；再次全部为零，GPU 主体 2683ms。
- 未覆盖正式 Renderer 恒等分流、文字/字幕、完整效果链、PAR、嵌套、非零趋零投影，不能宣称完整 P1 通过。

### 指纹

旧 `1e3982dd4` renderCache 与当前实现对同一无空间文档（含嵌套）生成 18 个窗口；序列化 1660 字节，差异 0。临时实现/测试已清理。

### 小 CoC 连续性

真实镜头核，64×64 RGBA16F，含透明边界的预乘色块，比较编码前线性通道：

| CoC 半径 px | 最大差 | 平均差 |
| --- | --- | --- |
| 0 / 0.124 / 0.125 | 0 | 0 |
| 0.126 | 0.000244140625 | 0.000005772511940449476 |
| 0.13 | 0.000244140625 | 0.000005941696144873276 |
| 0.2 | 0.00439453125 | 0.00010653396384441294 |
| 0.5 | 0.098388671875 | 0.0025004663038998842 |

归零段原样输出，连接起点小于 1/1024。该实验仅标定小半径连接，不能替代完整景深样片矩阵。

## 格式核对

暂定 content/minReader：video-edit 49/49、screen-recording 52/52、native template 7/7、style package 11/11、title-templates 10/10、preset-package 12/12、subtitle-manifest 25/25、creative-intent-candidate 5/5。后续前置票合入后按 main 顺延，每格式本票最终只占一个版本。

实际 creative-intent-page schema 不导入 referenceTransforms，也不嵌 clip.curves；referenceTransformTrackSchema.native.curves 虽复用通用曲线，却未被该页格式引用。因此撤回该页额外升版及关联写入方改动，保持 v1；实际直接嵌曲线的候选外壳仍升级。

样本生成器用正式 schema/构造器编写；只读加载校验通过，未调用生成函数。普通 Node 加载器缺 import.meta.env 时失败，补齐构建环境定义后通过；不据此声称八种样本均已生成/往返通过。

API 9 未登记，当前正式作者 API 仍是 7；等待 10 的 API 8、17/18 共用 API 9，不只改数字冒充可执行。

## 未完成事项

1. **正式 Renderer 接入。** helper 已有，帧准备/预热、恒等分流、跟随/防抖求值、作者图像/音频输入和根调度尚需串起来。
2. **B 联调。** B `c61d343519fb07b2d514cace20f52de757657b75` 未合入 A。只读核对其 renderSpatialSample 未消费 materialPlan.logicalBounds/uvToReference，代码卡片参考平面和片段效果需 B 配合；prepareSpatialFrame 要求 composition 身份相同，不能伪造替代文档。
3. **C Worker。** C 已交 `b3e94fc9c`，spatialLayout 不在 A；待集成后增加 planVideoEditSpatialLayoutOffThread，未用空实现或忽略打包伪装存在。
4. **事务传播。** 同步 videoEditService.ts/editVideoProject 不在 3.1 文件清单，未修改；删除、波纹、嵌套需要同一异步规划/提交边界。未找到设计所称的解除嵌套服务。相机 mapClock 基础已有，各正式 ripple/nest 入口尚未贯通。
5. **材料与预算。** 尚缺透视放大时自适应栅格密度；当前工作集估计、MSAA 字节可读，但完整预算预留/spill/three 内部 RT 合计未闭环。世界场景局部工作域和发光链路还需联调。
6. **最终格式/验收。** 新黄金样本、schemaBaseline、releasedCompatibility 未生成；完整 persistence/L2/P1 未通过，未执行发布或安装包构建。
7. **存量切片边界。** 通用 slice 最后持久点为 duration−1，之后子帧保持端值；本票未擅改既有整数帧/切片语义。当前分割证据不代表该存量边界全部子帧恒等。

## 已询问、尚待回复

- 是否允许 A 最小扩展同步事务入口及必要直接调用方，接入异步空间传播。
- 是否由 A 在当前任务分支串行执行八种样本生成、baseline、release-snapshot。design.md 3.1 明确“Claude 负责……全局生成命令的串行执行”，而完整 L2 会调用 persistence:baseline；未擅自接手。
- 是否允许 B/C 已完成提交先合入 A 任务分支联调（不合 main、不 push），或由 Claude 按最新 main 顺序在 A 后集成。

本文件为进度及阻塞回报，不是完成验收。格式门禁未闭环，除契约与 main 合并提交外，实现仍保留在任务工作区，未提交一个被标成“验证通过”的实现提交。

## A 线统一集成进度（11-01）

摘要：A 当前实现已提交，B c61d34351、C b3e94fc9c 已 git merge 进 task/16-三维空间；A 是唯一集成分支，未推送。
摘要：已补布局 Worker、作者空间类型与材质诊断、相机 schema 共享、中心场景观测；两套 tsc 与能力聚合门禁通过，整项尚未验收。
摘要：正式 Renderer、完整事务传播、预算与栅格密度、最终格式登记和 GPU PNG 样片仍未完成；尚未执行收尾的 git merge main。

### 本轮提交

- `37400bb22 feat(video-edit): 实现三维空间求值与曝光合成内核`：保存 A 未提交实现，并修复独立审查指出的两处重要问题。相机关键帧不按内容时长截断；画幅外、相机前方卡片保留可进入画面的景深扩边。
- `743068c85 merge(video-edit): 集成三维作者场景 B 线`：正式 merge B。AuthorPrograms、CodeGpu、CodeSources 三处冲突保留 main ticket 15 的内容键、字体修订与输出复用，同时接入 B 空间接口；未恢复旧 staticPictures 路径。
- `e5c7886af`：正式 merge C，无冲突。
- `f7754ee71 fix(video-edit): 接通三维布局线程与作者空间检查`：C 布局进入现有 Worker；相机公共 schema 和持久 schema 共用字段表；空间入口的 params 与 info.space 类型共同推断；材质诊断识别静态默认导出，普通 JS 保留原生动态导入语义；B 准备集合和包围框观测包含中心时刻 `sampleIndex: -1`。
- `fcb7e2793 refactor(video-edit): 解耦空间能力与实体反射引用`：修复依赖图发现的静态值环及跨功能内部导入；空间公共调用 4 项、渲染层 tsc、3 文件 ESLint 与依赖图复验通过。提交后本任务 worktree 干净。

### 已执行验证与审查

- A 检查点：原精确集合缺 creative-intent-candidate/v5 样本的两项失败，经正式生成器生成该样本后，resourceContracts 9 项通过；空间传播 5 项、空间求值与曝光 17 项通过。不是八种格式全部登记完成。
- B 合并冲突回归：AuthorPrograms、CodeSources、CodeGpu、AuthorFingerprint 共 90 项通过。
- 作者／应用接缝：AuthorModules、AuthorBundle、AuthorTypeCheck、typeDiagnostics、MotionWorkerClient、videoEditSpatial 共 49 项通过。
- 中心场景观测修复后，CodeSources 51 项、videoEditSpatial 4 项通过。应用测试的布局 Worker 和像素边界仍为替身，不能作为真实 Worker/GPU 证据。
- 渲染层和 Electron 两套 tsc 均退出 0；12 个本轮源码／测试文件 ESLint 与 `git diff --check` 通过。author-api.d.ts 单独 lint 命中 3 处原有参数宽类型 any，本轮未新增；正式局部门禁只 lint src/electron，未为此修改作者参数契约。
- `npm run check:assistant-capabilities` 完整退出 0：结构检查通过，覆盖 15 项、不变量 237 项通过。纯 harness 的桌面能力不可用警告不作为真实桌面验证。
- `check:dependency-graph` 首轮发现 Spatial↔Reflection 静态值环及跨 feature 内部类型引用；提取唯一引用解析到 videoEditRefs、保留原重导出，并使用 application-control 公开类型入口后，复验通过：0 静态值 SCC、0 冻结跨层边、首屏 0 重模块。未修改依赖图基线；该修复独立审查 1 轮，无重要问题。
- A 检查点独立审查 1 轮：2 项重要问题均修复。接缝独立审查 3 轮：普通 JS 文本命中切换编译路径的回归已修复，最后两轮无新增重要问题。
- 自适应密度试改另审 1 轮：发现强推近将整面放大到约 21634×12170、约 2.17 GB，超过设备纹理尺寸；整组试改已撤回，未提交，未宣称密度完成。下一实现须先结合可见支持域／分块、效果参照和现有栅格倍率，不能仅提高整面倍率。

### 下一步与未验证范围

1. 接正式 Renderer：预览、导出、观察、嵌套共用空间分流；完整恒等保持旧路径；跟随、防抖、作者媒体／音频按同一样本时钟准备；根 GPU 队列串行。代码卡片 materialPlan 参考映射和片段效果仍未接通，不能直接把 B 原始作者纹理当最终材料面。
2. 接 videoEditService 的异步规划／提交边界，覆盖删除、波纹、分割、嵌套和相机时钟传播，保留同一撤销事务与取消／修订检查。用户已授权修改事务入口，无需重复确认。
3. 完成必要工作集预留、逐样本复用、spill、MSAA／mip／three 内部 RT 计费、局部景深与透视密度；空间输出接入 ticket 15 内容键。10/17/18 未进 main 不作为停止原因，API 9 按已定共用路线完成，最终再随 main 顺延。
4. 最后执行 `git merge main`，每种格式仅比届时 main 升一次，统一生成黄金样本、baseline、releasedCompatibility；当前只有候选 v5 新样本已生成，其他最终登记未完成。
5. 执行完整 Renderer 对改前 main 的恒等逐像素矩阵、设计时间线样片和第 12.1 节联合场景真实 GPU PNG，输出 evidence-A 供 Claude 目视；再完成 persistence-compat、精确 GPU、显式本次文件 L2 等剩余门禁。本轮未新增 PNG，旧合成器零差证据不代替整项验收。

本节覆盖上文“已询问、尚待回复”的旧阻塞：三项均已获授权并开始执行。未改依赖、UI、t16b/t16c、9334 开发实例或 D:\视频制作；未切分支、未合并到 main、未推送。

## A 线继续集成进度（11-01，Renderer 与事务接缝）

摘要：正式 Renderer 空间分流已提交 0aaf3e737；7 份缺失黄金样本及八种格式基线已提交 e62507a10，未推送。
摘要：异步空间事务边界、Worker 收口和并发修复已提交 ed85b8cfa；20 文件 L2、两套 tsc、依赖图、持久兼容基线及助手能力聚合门禁通过，工作区干净。
摘要：整票尚未验收；完整事务调用链、根 GPU 队列、预算/密度、API 9、完整 Renderer 恒等矩阵与 GPU PNG 样片仍未完成，未执行收尾 git merge main。

### 本轮实际实现

- 正式 Renderer 在帧准备后识别世界场景与显式空间依赖；预览/导出/嵌套复用空间合成入口，全恒等回到既有二维绘制链。跟随与防抖按曝光所需时刻预备；世界场景输入按样本时钟读取，普通空间卡片在中心注入 info.space。
- 作者卡片材料进入正式片段效果链及逻辑参照映射；保留 carriesLight、精度与纹理释放。修复混合二维/世界场景转场漏画、作者转场手柄合法子帧被拒绝的问题。
- editVideoProject 增加带 signal 的异步空间规划入口：原快照构造候选、一次 Worker 传播、取消/内容版本/实例身份复核、一次正式提交和撤销。空间布局能力已 await 此入口；通用属性/集合执行器共用一次文档传播，集合删除最终提交也复核后续修改。
- 多序列传播复用正式 composition 构造，避免普通序列继承根序列相机。构造函数移入独立核心模块；Worker 生命周期由实例服务注入，消除门禁发现的两条动态值回边，不修改依赖图基线。
- 正式生成器新增 document.video_edit/v49、document.screen_recording/v52、title-templates/v10、video-template-library/v7、video-style-package/v11、video-preset-package/v12、subtitle-manifest/v25 七份样本；已有 creative-intent-candidate/v5 一起更新 schemaBaseline。未新增版本台阶，未更新 releasedCompatibility；最终版本仍待最后合并 main 后核对。

### 已有验证证据

- Renderer 显式文件 L2 通过：5 文件 212 项，含 4 项真实 GPU；ESLint、渲染层 tsc、依赖图、主进程传递导入均通过。审查后追加的转场回归为 2 文件 63 项通过。日志：.tmp/t16-renderer-verify.log、.tmp/t16-renderer-review-tests.log、.tmp/t16-renderer-gpu.log。
- Renderer 的新增正式入口分流测试替换了 GPU 合成边界；4 项真实 GPU 覆盖材料/合成 helper。二者均不冒充“完整 Renderer 对改前 main 的逐像素恒等矩阵”。
- 事务首轮 43 项通过；增量回归 38 项通过；最终合并集合 8 文件 366 项通过，覆盖正式布局/属性/集合、取消/迟到、同栈撤销、多序列相机隔离、Worker 生命周期、二维运动和持久化。线程投递使用替身，数学/领域事务/存储为正式实现，不算实际 Worker/GPU 完整闭环。
- 持久兼容首次明确失败于既有升版缺样本/基线；补齐后 persistence:baseline 对 66 种格式通过。格式独立审查只读核对了八项当前 schema/指纹及相关 113 份历史和当前样本的正式迁移，输入未被修改。
- 事务首轮 L2 发现两条动态值回边；已按上节修依赖关系。最终 20 个显式文件 L2 完整退出 0：366 项、ESLint、两套 tsc、依赖图、主进程传递导入、66 种格式基线全部通过。依赖图为 0 静态值 SCC、0 冻结跨层边、首屏 0 重模块，动态值回边恢复原有 11 条。日志：.tmp/t16-transaction-final-verify.log。
- check:assistant-capabilities 完整退出 0：结构、覆盖及 31 文件 237 项不变量通过；日志 .tmp/t16-final-assistant-capabilities.log。harness 的预期失败分支/桌面边界警告不冒充真实模型或 Electron 端到端证据。
- 提交后只读 check:persistence-compat 再次退出 0，66 种格式通过；日志 .tmp/t16-persistence-final.log。没有遗留本轮源码或生成样本改动，三个提交均只保存在本任务分支，未推送。

### 独立审查

Renderer 两轮：2 项重要问题（混合转场漏画、作者手柄求值）均修复。事务三轮：1 项重要问题（跨序列相机继承）与 1 项同源原有竞态（集合提交覆盖后续修改）均修复，最后增量无新问题。格式一轮无重要问题。审查未使用外部聊天或用户登录浏览器。

### 下一步与明确未完成范围

1. Renderer 仍需统一根 GPU 提交队列，覆盖预热/作者检查/嵌套/合成；补完整恒等矩阵和真实正式运行取证。仅此次分流与 helper GPU 通过不代表 P1 完成。
2. 将时间线删除/波纹/分割/插入/重排、轨道删除、嵌套以及相关直接调用方接入异步空间提交；由正式编辑产生 clipMap/sequenceTimeMap，贯通全局相机时钟。当前 executeVideoEditTimelineEdit、nestVideoEditSelection、deleteVideoEditTracks 等仍为同步入口，不能宣称完整事务传播完成。
3. 完成必要工作集预留、spill、MSAA/mip/three 内部目标计费、逐样本复用和可见支持域/分块下的自适应栅格密度；旧整面放大方案仍未恢复。
4. 完成作者 API 9 及 B/C 剩余联合验证；10/17/18 未进 main 不作为等待条件。当前正式 API 常量仍未登记 9，不能仅以样本/类型通过宣称运行时完成。
5. 按设计 9.1 时间线段落及 12.1 换序/景深联合场景输出真实 GPU 关键帧 PNG 到 evidence-A，供 Claude 目视；本轮没有新增 PNG，也未调用外部 Claude。
6. 整项收尾最后 git merge main，每种格式仅比届时 main 升一次，核对黄金样本、baseline、releasedCompatibility 后再完成整项验收。当前没有合并 main、合并到 main 或推送。

约束保持：未改依赖、界面或主工作区代码，未使用用户登录浏览器/外部聊天，未碰 9334、D:\视频制作、node_modules 与 FFmpeg 联接点；一次一个重任务。

## A 线继续集成进度（11-01，事务调用链）

摘要：事务调用链已提交 2a9dc85bf；正式时间线、轨道删除、嵌套、源范围放置及直接消费者等待空间提交，两个本轮提交均未推送。
摘要：27 文件 L2、201 项精确回归、两套 tsc、依赖图、66 种格式兼容和助手能力聚合门禁通过；颜色登记修复 d41f2f19d 的 30 项真实 GPU 用例通过，像素快照内容未变。
摘要：整票未验收；完整事务时钟/身份映射、根 GPU 队列、预算与密度、API 9、完整 Renderer 恒等矩阵和 PNG 样片仍未完成，未执行最后的 git merge main。

### 本轮实现与提交

- `2a9dc85bf fix(video-edit): 等待空间编辑事务后返回时间线结果`：时间线编辑、拖动/重排/修剪结束、轨道删除、嵌套与源范围放置接入异步事务；命令、能力、拖入及必要界面回调等待事务后再保存、返回结果或关闭对话框，并传递取消信号。返回正式提交后的文档/序列，避免把规划前结果作为成功回执。TSX 仅调整必要的异步回调，没有改布局、样式、控件或视觉设计。
- 无相机的编辑保持立即提交，避免二维选区与连续操作读到旧状态。异步服务仅在候选含相机时加载传播器，取消、实例身份、内容版本及一次撤销的守卫仍在正式提交前复核。
- 新增正式删除、删轨、嵌套的相机烘焙/一次撤销，以及正式入口取消后重试回归。沿直接调用链核对命令、拖动、速度/修剪、嵌套、源范围放置；全仓搜索未发现这些入口在剪辑模块外还有运行时调用方。没有把不触发提交的拖动取消清理误改成等待规划。
- L2 暴露的既有字幕选中断言与 `b2c151832` 的行为冲突：正式实现规定时间线点击字幕不移动播放头，测试据此检查原帧保持，没有改变字幕运行逻辑。
- `d41f2f19d test(video-edit): 登记发光像素基线的固定着色输入`：全局颜色门禁扫描到既有 GPU 测试两处未登记字面量；将原值移入现有 colorTokens，删除失效的 ESLint 豁免。没有修改门禁、依赖、颜色值或像素快照。

### 验证与独立审查

- `npm run verify:changed -- --level L2 <本轮 27 个显式文件>` 最终退出 0：15 文件 201 项通过，文件级 ESLint、渲染层 tsc、严格表面/颜色/图标/残留/间距动效检查、依赖图及主进程传递导入全部通过。日志 `.tmp/t16-callers-verify-passed.log`；显式清单 `.tmp/t16-callers-files.json`。此前失败日志不作为通过证据。
- 依赖图保持 0 静态值 SCC、0 冻结跨层边、首屏 0 重模块、11 条动态值回边；未修改基线。界面表面门禁中的存量提示仍为提示，不表示本轮修改过这些界面。
- 补验 Electron tsc、`check:persistence-compat`、`check:assistant-capabilities` 串行完整退出 0。持久格式 66 种通过，助手覆盖 15 项及 31 文件 237 项不变量通过。日志 `.tmp/t16-caller-extra-checks.log`。
- `npm run test:gpu -- src/features/videoEdit/engine/videoEditStyleEffects.gpu.test.ts`：30 项通过，日志 `.tmp/t16-color-gpu.log`；颜色门禁与两文件 ESLint 通过。这是既有效果像素基线复验，不是本票 Renderer 恒等矩阵或原型样片证据。
- 独立审查三轮：首轮指出测试辅助函数未完整改成异步的重要问题，已修复并通过上述回归；后两轮增量无新增重要问题。审查未使用外部 Claude、聊天服务或登录浏览器。
- 事务测试使用正式领域/数学/文档服务，但 Worker 投递边界仍为替身；不能据此声称真实 Worker/GPU 整条链路已验收。工作区在两个提交后干净，无试稿源码遗留。

### 下一步与未完成范围

1. **先完成完整事务传播。** 正式时间线编辑仍未产生完整 clipMap/sequenceTimeMap。范围删除会先分割出新身份再删除中段，最初/最终两个快照不足以恢复中途目标；覆盖、插入、重排、波纹修剪/改速还需在实际编辑处保留来源与时钟映射，在一次事务内完成规划、取消、提交和撤销。不能把本轮入口 await 接通算作这项完成。
2. **相机曲线边界仍待处理。** 当前 mapSpatialCameraClock 借用通用切片时仍受 duration−1 尾点语义影响；删除拼接处及插入空隙的子帧/hold/Bezier 需按设计保留，不能用 epsilon、冻结曝光或降低 0.25px 门槛掩盖。通用 slice/scale 仍是唯一曲线变换入口。
3. 随后完成根 GPU 队列，统一预热、作者检查、嵌套、帧渲染与读回的资源所有权；嵌套不能重复排队造成自等待。本轮没有修改队列。
4. 完成必要工作集预留、spill、MSAA/mip/three 内部目标计费与可见支持域/分块的自适应栅格密度；继续落实作者 API 9 和 B/C 联调。不等待 10/17/18 进入 main。
5. 执行完整 Renderer 对改动前 main 的逐像素恒等矩阵，按设计 9.1 时间线及 12.1 联合场景生成真实 GPU 关键帧 PNG 到 evidence-A。本轮未新增 PNG；外部 Claude 目视验收仍待样片生成后交回，未调用外部聊天服务。
6. 整项收尾最后 `git merge main`，每种格式只比届时 main 升一次，核对黄金样本、schemaBaseline、releasedCompatibility 并完成最终验收。本轮未提前合并 main，也未合并到 main、切分支或推送。

本节为已验证阶段成果与剩余工作记录，不是整项验收报告。未改依赖、未占用 9334 开发实例，未碰 D:\视频制作或 node_modules/FFmpeg 联接点；重任务均串行运行。

## A 线继续集成进度（11-01，身份、时钟与文本事务）

摘要：已提交 71c18d1f9、2857dd07a、ce79121e2、0d8518e17，完成中间身份来源、已接入波纹操作的相机时钟/子帧边界、文本事务与历史贝塞尔兼容修复；未推送。
摘要：四块显式文件 L2 均通过，最后一块 399 项；两套 tsc、依赖图、66 种持久格式、助手能力聚合和 34 项真实 GPU 用例通过，任务工作区干净。
摘要：整票未验收；同轨波纹改速的定向验收、根 GPU 队列、预算/栅格密度、API 9 与 B/C 完整联调、完整 Renderer 恒等矩阵及 PNG 样片尚未完成，未执行最后的 git merge main。

### 实现与提交

- `71c18d1f9 fix(video-edit): 保留分割与覆盖事务的空间目标来源`：分割、范围删除、覆盖保留中间 clip 身份的来源；传播器能追溯原快照中的目标几何。沿时间线、拖入、模板、代码素材创建/导入、原位生成和结果放置传递 clipMap，并等待同一异步规划/提交。
- `2857dd07a fix(video-edit): 保留波纹编辑的相机时钟与连续边界`：实际删除/插入/重排/波纹修剪记录序列时钟映射；删除段保留来源记录，插入空隙保持切点时刻，复合编辑始终回到事务原时钟。相机切换事件按原时钟求值，普通片段切分保留 duration 右边界控制点，独立切口保存插值锚点；相机烘焙包含右边界。
- `ce79121e2 fix(video-edit): 在文本剪辑中保留完整空间事务映射`：多段文本删除/摘录/插入共用原快照映射；摘录先在原序列完成传播，再复制到新序列。代码元数据重试重新构造映射，最终提交的每次重试均复核取消和内容版本，防止迟到候选覆盖后续修改。
- `0d8518e17 fix(video-edit): 保持历史贝塞尔曲线的求值语义`：自查发现把历史 x=t 贝塞尔改为直接多项式会改变原有微小数值误差，可能影响像素量化。恢复历史反解路径；精确多项式仅用于新生成、带原值锚点的 ease 切口，重复映射和后续连续切片保留锚点。补齐公共关键帧说明中的右边界语义。

### 验证证据与实际范围

- 身份块：13 个显式文件 L2，510 项通过；日志 `.tmp/t16-identity-verify-8gb.log`。初次代码导入测试替身未等待异步回调，已修复；4GiB 堆类型检查 OOM 后按同一范围使用 8GiB 堆通过，没有修改依赖或工程配置。
- 时钟块：17 个显式文件 L2，568 项通过；日志 `.tmp/t16-clock-verify.log`。审查发现连续切片会丢失自动生成点来源，已区分连续切片与独立切口；音量回避、重构图、录屏注意力等直接消费者复验通过，日志 `.tmp/t16-clock-origins.log`。
- 文本块：4 个显式文件 L2，99 项通过；日志 `.tmp/t16-text-verify.log`。覆盖多段删除/摘录/插入、子帧相机、一次撤销、元数据重试、取消及后续修改拒绝迟到提交。
- 插值兼容块：6 个显式文件 L2，13 文件 399 项通过；日志 `.tmp/t16-interpolation-verify.log`。历史贝塞尔使用严格相等断言，重复时钟切口和连续切片通过正式 schema；两个 TypeScript 工程、文件 ESLint、66 种格式基线通过。各块测试有重叠，不将数量相加当作独立用例总数。
- 依赖图在本轮身份/时钟/文本 L2 中通过：0 静态值 SCC、0 冻结跨层边、首屏 0 重模块、11 条既有动态值回边；主进程传递导入扫描 977 个文件通过。最后插值修复没有新增运行时依赖边，复用有效证据，未改门禁基线。
- 提交后只读 `check:persistence-compat`：66 种格式通过，日志 `.tmp/t16-mapping-persistence.log`。`check:assistant-capabilities` 完整退出 0：结构检查、15 项覆盖和 31 文件 237 项不变量通过，日志 `.tmp/t16-mapping-capabilities.log`。
- `npm run test:gpu -- src/features/videoEdit/engine/videoEditSpatialComposite.gpu.test.ts src/features/videoEdit/engine/videoEditStyleEffects.gpu.test.ts`：34 项通过，日志 `.tmp/t16-mapping-gpu.log`。这是正式材料面/合成 helper 与既有效果 GPU 像素验证，不能冒充完整 Renderer 对改前 main 的恒等矩阵。
- 事务测试使用正式领域、数学、文档服务与存储；Worker 投递边界为替身，未以其通过宣称真实 Worker/GPU 完整链路或真实助手模型验收。

### 审查与未完成项

身份块独立审查 2 轮，时钟/插值块 3 轮，文本块 2 轮；报告的重要问题均已修复，最后增量未发现新重要问题。主要修复为直接消费者丢失映射、普通连续切片丢失生成来源、元数据重试未重建候选和最终提交重试遗漏并发守卫。未调用外部 Claude 或其他聊天服务。

1. **事务后续核对**：现有 `applyVideoEditSpeedChange` 的 ripple 只按各轨道自己的时长差移动同轨后续片段，其他轨道及序列事件未采用统一时钟；设计第 10 节规定单片段变速不移动序列相机。已确认不能直接套用全序列插删映射，但本轮未补这一入口的定向相机/绑定几何验收，因此不标完整事务矩阵完成。
2. **根 GPU 队列尚未实现**：已沿 prepareLookahead/prepareContent、作者元数据与渲染、prewarmCodeInput/ensureStill、嵌套、jump preview、合成与 dispose 核对。现有 drawLock 只包最终绘制；fork 初始化会异步编译管线，CodeSources 自身队列不能串行整个共享 device。前景帧等待后台上传、嵌套与清理重入会让简单整帧加锁自等待。下一步须先分清 CPU 准备、GPU 所有权借用和完成后释放，不能只扩大 drawLock。
3. **预算/密度与作者联调**：必要工作集、spill、MSAA/mip/three 内部目标计费、可见支持域/分块密度，以及 API 9 和 B/C 剩余联合验证仍未完成。本轮没有恢复已撤回的整面放大方案，也不因 10/17/18 未进 main 而等待它们。
4. **像素与样片**：完整 Renderer 对改动前 main 的逐像素矩阵、设计 9.1 时间线及 12.1 联合场景 PNG 尚未生成；evidence-A 本轮无新增样片。外部 Claude 目视验收在样片完成后交回，未擅自使用外部服务。
5. **最后集成**：尚未执行 `git merge main`；整项实现闭环后按届时 main 每种格式只升一次，核对当前黄金样本（含新切口锚点语义）、schemaBaseline、releasedCompatibility，再完成整票验收。

四个提交仅在 `task/16-三维空间`，未推送、未切分支、未合并到 main；未改依赖/界面、未动主工作区代码，未使用登录浏览器、9334 或 D:\视频制作，未删除或修改 node_modules/FFmpeg 联接点。本轮重任务串行运行。本节是阶段成果及下一步，不是整票完成报告。


## A 线继续集成进度（11-01，接手 Codex：改速验收、根队列、推近栅格与原型样片）

摘要：接手 Codex 后新增 4 个提交（1a3ae8744、3f4c895de、61d73a881、00fcd2269），完成同轨改速定向验收、设备根队列、推近按可见区域升档重栅格与工作集计费，并修复近恒等帧的亚像素偏移；未推送。
摘要：真实 GPU 原型样片 34 张与 6 张联系表已放 evidence-A/prototype/，待 Claude 目视；恒等前后帧最大差 1–2/255，平面段与压平尾段逐像素相同。本轮 L2（13 文件 332 项）、两套 tsc、依赖图通过。
摘要：整票未验收：作者 API（按 main 顺延为 10）登记、git merge main（预演 23 处冲突，含格式版本撞号）、对改动前 main 的完整 Renderer 恒等矩阵、经正式应用路径的样片与 P2/P5 性能仍未做。

### 本轮提交

- `1a3ae8744 test(video-edit): 验证同轨波纹改速的空间曲线与相机时钟`：接手时遗留的未提交用例思路正确，只修了夹具（复用已有轨道，原先新增的 2 号轨与已有轨道编号重复）。6/24 帧两档：同轨后续片段移动、其他轨道与序列相机不动；四个空间键随片段时长缩放；相机目标几何按新片段时钟求值，偏移与绑定切换仍取序列时刻；一次 Worker 规划、一步撤销。
- `3f4c895de fix(video-edit): 用设备根队列串行 three 预热与跨等待的错误作用域`：新增 videoEditGpuRootQueue（按 GPUDevice 串行）。three 的 WebGPU 初始化（含 onuncapturederror 恢复）与 compileAsync 预热、着色器图渲染进队列；WebGL 后端不占队列。合成器初始化、作者图层管线编译、自定义 WGSL 检查改为发起后在等待前弹出作用域（顺带修掉合成器初始化同步抛错时的作用域泄漏）。区段只等驱动/GPU 完成，不等帧准备、嵌套或另一区段，因此嵌套与清理不会自等待。没有把整帧合成包进队列：帧内的嵌套、代码输入与 B 的实例队列会反向等待持锁的根，按设计“B 内部队列不得反向等待持锁的 A”，改为只串行真正跨 await 持有设备状态的区段；普通提交在区段等待期间若出校验错误会记进当时栈顶的作用域，已写在模块注释。
- `61d73a881 feat(video-edit): 推近空间卡片按可见区域升档重栅格并计入工作集`：曝光规划对“含效果扩边与景深扩边的完整范围”在各曝光样本的扩边视锥内裁剪，只栅格可见支持域；密度取卡片可见部分投影 Jacobian 的最大奇异值，按现有二次幂文字档位升档。视频、图片、嵌套与图形不超过源像素密度；作者代码效果与世界场景保持整面一倍。逐个降档直到裁剪目标与代码卡整幅生成目标都在 8192 内。工作集计入 mip、景深、组/累积/四样本覆盖率、层图、组结果、效果临时目标与 three 内部目标；升档只在 2GiB 预算内，一倍栅格不按固定容量拒绝（AGENTS.md“容量不设硬上限”，与设计“返回事实”有张力，见待裁定）。合成器文字在材料视口内按“二维档位 × 推近档位”重新栅格。上次撤回的整面放大方案没有恢复。
- `00fcd2269 fix(video-edit): 材料面纹素格对齐输出像素，近恒等空间帧收敛到二维画面`：样片发现恒等前后帧最大差 34/255（文字横笔边缘亚像素位移）。根因是材料面取小数边界、目标尺寸向上取整后纹素密度略大于输出密度。现在范围向外对齐输出像素格，放大不足 5% 不升档；对比降到 1–2（半浮点累积末位）。

### 原型样片（evidence-A/prototype/，请 Claude 目视）

- 生成方式：隔离的无头 Chrome 156（独立临时资料目录，不连 9334、不用登录浏览器），NVIDIA Lovelace，three 0.186.1。esbuild 打包正式模块：曝光规划、空间合成宿主、GPU 合成器、受管 three 桥（WebGPURenderer 外部设备 + ExternalTexture）、文字栅格（HarmonyOS Sans SC 700）。脚本在 prototype/harness/，可重跑（`node run.mjs <仓库> <输出>`）。
- 时间线（8 秒、1920×1080、30fps；6 张卡 = 3 文字 + 3 界面面板，加一个 three 二十面体）：0–1.5s 平面；1.5–4.5s 展开（深度/倾斜、透视量 0→−1、机位横移与上移）、场景淡入；4.5–6.5s 景深开启并从后排拉焦到标题，场景在 5.6s 穿过标题深度（快门内换序）后淡出；6.5–7.5s 压平，7.5s 后回到二维路径。
- 文件：逐帧 `fNNN-16.png`（final 16 样本），换序帧另有 `-08`（interactive 8 样本）。联系表 sheet-1…6 分别对应平面/进入、展开、拉焦与换序、8 对 16 样本、压平、离开恒等。samples.json 记有每帧路径、样本数、组模式、场景探测/渲染次数、材料档位/尺寸/CoC、工作集与对比。
- 已核对数据：f000=f044=f226=f239 逐像素相同；f044↔f045（进入）最大差 1，f225↔f226（离开）最大差 2；换序帧 f168/f170 为 group 模式，场景渲染 16（final）/8（interactive）次；8 对 16 样本最大差 4。推近时文字升 2 档，面板保持 1 档；工作集约 0.5–0.78GiB。
- 不能代替的部分：未经 CodeSources/createThree 编译、助手写入、结构读回与 Electron 正式取帧，这些是设计 9.1 的正式样片要求。three 来源由样片脚本按 SpatialCodeSources 契约直接驱动 VideoEditAuthorThree，没有使用模拟运行时。字体取本机安装版本。尚未与改动前 main 对比。

### 验证

- `npm run verify:changed -- --level L2 --test <13 个直接消费者> <本轮 14 个文件>`：13 文件 332 项通过，含 ESLint 与渲染层 tsc。日志 `.tmp/t16-takeover-verify.log`。
- Electron tsc 退出 0（`.tmp/t16-takeover-electron-tsc.log`）；`check:dependency-graph`：0 静态值 SCC、0 冻结跨层边、首屏 0 重模块、11 条既有动态值回边（`.tmp/t16-takeover-depgraph.log`）。
- 真实 GPU：`HENJI_THREE_GPU=1` three G/W 2 项、空间合成 GPU 4 项、着色器图 GPU 10 项通过。
- 本轮没有改持久格式与助手能力文件，check:persistence-compat、check:assistant-capabilities 沿用上一轮通过证据，未重跑。

### 独立审查

- 根队列 2 轮：首轮 1 项重要问题已修（同设备上还有 3 处跨等待持有作用域），第二轮无新重要问题。
- 推近栅格 2 轮：首轮 5 项重要问题已修（文字档位取整误升、裁剪目标未受 8192 限制、只有扩边可见时丢画面、固定容量拒绝、工作集漏项）；第二轮无新重要问题，新增 3 项小问题中的“档位无有限上界”已修。
- 审查未使用外部聊天或登录浏览器。

### 待 Claude 裁定

1. 推近升档预算：现为 2GiB，只限制升档；一倍栅格超出时只记 debug（曝光日志带 workingSetBytes），不拒绝帧。设计 4.6 要求“最低必要工作集不能容纳则返回事实”，而 AGENTS.md 规定“容量不设硬上限”，两者冲突，目前按项目规则处理。
2. 原型样片画面是否认可（构图、景深强度、换序观感），以及可否据此进入正式应用路径样片。

### 余项与下一步

1. **作者 API 与合并 main**：main 已改为 codeAuthorVersions.ts 分功能常量（ADJUSTMENT=9）。本分支的 AUTHOR_SPATIAL_API_VERSION=9 与持久 schema 上限（仍为 7）都需要在合并后改成 `CODE_AUTHOR_SPATIAL_MIN_API_VERSION = 10`，并让 CODE_AUTHOR_API_VERSION 跟随。`git merge-tree` 预演有 23 处冲突：schemaVersions/formats/formatMigrations/schemaBaseline、videoEdit 与 screenRecording 文档种类、presetPackage、templateSchemas、四份同号黄金样本（main 也新增了 video_edit v49、screen_recording v52、preset v12、style v11）、作者确定性/指纹、CodeSources、CompositeScene、blur、反射/执行器/应用域。本票格式要按届时 main 顺延一号（每种只升一次），然后重新生成样本、基线与 releasedCompatibility。
2. **P1 完整 Renderer 恒等矩阵**：合并后在同一样片脚本上分别对 main 与本分支取平面/恒等帧做逐像素对比（8/16 位、半分辨率、效果链、角点贴合、嵌套）。
3. **正式路径样片**：在隔离的 Electron 正式构建里，经助手能力写入、createThree 编译、结构读回与正式取帧，复现上面的时间线。
4. **小余项**：
   - 图形推近需要在图形准备路径按档位重新栅格。
   - 代码卡整幅生成按“图片像素 × 密度”计算，存在原有的过采样。
   - 文字推近时每帧都要测一次排版边界。
   - 半分辨率下 1×1 回退材料的档位会被反推为 2。
   - renderAuthorFrame 与 videoEditCompositeProbe 仍跨等待持有作用域（原有问题；前者只有测试调用）。
   - P2/P5 性能未测。

未推送、未合并到 main、未切分支；未改依赖、界面与 9334 实例，未碰 D:\视频制作，未动 node_modules 与 FFmpeg 联接点。重任务都经排队脚本串行执行。本节记录阶段成果，不是整票验收报告。


## A 线继续集成进度（11-01，接手 Codex 第二段：预算报告与合并准备）

摘要：按裁定补了推近升档受预算限制时的正式日志，提交 781b473c4，未推送。2GiB 只作软上限，从不拒绝帧。
摘要：没有开始 git merge main。上下文余量不够一次完成“解冲突 → 格式顺延 → 重新生成样本/基线/发布承诺 → 全套复验”，为避免留下半截合并，只做了冲突预演和合并方案（见下）。工作区干净，没有 MERGE_HEAD。
摘要：余项顺序不变：合并 main 与作者 API → P1 恒等矩阵 → 正式路径样片 → P2/P5 与小余项。

### 本段提交

- `781b473c4 feat(video-edit): 推近升档受工作集预算限制时记录正式日志`：曝光计划新增可选 `rasterLimits`（clipId、请求档位、实际档位）。空间曝光在最终计划受限时经 createLogger 记录 `video_edit.spatial.raster.limited`，上下文含 materials、workingSetBytes、budgetBytes、requestId、frame。同一序列只在受限的材料或档位变化时再报，推近播放不逐帧刷屏。
- 验证：空间曝光 15 项通过（新增 110 张推近卡超预算、逐项降档、上报请求与实际档位的用例），渲染层 tsc 通过。

### 合并 main 方案（2026-11-01 预演，main e3d72d3f0）

`git merge-tree` 预演有 23 处冲突，代码冲突都很小，大头在格式与样本：

| 文件 | 冲突 | 处理 |
| --- | --- | --- |
| 四份同号黄金样本：document.video_edit/v49、document.screen_recording/v52、video-preset-package/v12、video-style-package/v11 | add/add | 取 main 版（它们是 main 已登记的版本）；本票样本在顺延后的新号上用正式生成器重新生成，不改 main 已有样本 |
| schemaVersions.ts、formats.ts、formatMigrations.ts、schemaBaseline.json、documents/kinds/{videoEdit,screenRecording}.ts、presetPackage.ts、styles/templateSchemas.ts | 1–5 处 | 先取 main 的版本表与迁移，再在每种格式 main 最新号上各加一级（video_edit 53→54、screen_recording 56→57，title-templates、video-template-library、video-style-package、video-preset-package、subtitle-manifest、creative-intent-candidate 同理各顺延一号）。迁移保持本票原有的纯函数语义：只升号、不注入空间默认值；minReaderVersion 设为新号。删掉本票原先占用的旧号，不留两套台阶 |
| generate-persistence-fixtures.ts、scripts/lib/testSuites.cjs | 各 1 处 | 两边条目合并 |
| videoEditExecutors.ts（5 处、约 109 行）、applicationDomain.ts、videoEditReflection.ts | 小 | 保留 main 的执行器改动，再接回本票的异步空间事务入口与 videoEditRefs 引用解析 |
| blur.ts（2 处）、videoEditCompositeScene.ts、videoEditCodeSources.ts、videoEditAuthorDeterminism.ts、videoEditAuthorFingerprint.ts、videoEditStyleEffects.gpu.test.ts | 1–3 处 | 按 main 的效果登记骨架（19-U0）与内容键写法，接回本票的材料视口、空间入口与 GPU 颜色登记 |

作者 API：main 已改成 `codeAuthorVersions.ts` 分功能常量（ADJUSTMENT=9）。合并后：

- 新增 `CODE_AUTHOR_SPATIAL_MIN_API_VERSION = 10`，`CODE_AUTHOR_API_VERSION` 指向它。
- 删除 `codeMaterial/contract.ts` 的 `AUTHOR_SPATIAL_API_VERSION = 9`，`videoEditAuthorParameters` 改用新常量。
- 类型 `CodeAuthorApiVersionNumber` 补上新常量，持久 schema 上限随之放到 10；作者文档与 author-api.d.ts 同步。

之后依次执行：

1. 正式生成器生成新号样本。
2. 执行 `persistence:baseline` 与 `persistence:release-snapshot`。
3. 复验 check:persistence-compat、check:assistant-capabilities、依赖图、两套 tsc、显式文件 L2，以及空间合成、three、效果像素的真实 GPU 用例。

合并若与 19-U5/U15a/U7 同时进来，按届时 main 再顺延，每种格式仍只升一次。

### 下一步

1. 按上表执行 `git merge main` 并登记作者 API 10，完成后单独提交合并。
2. P1：复用 evidence-A/prototype/harness，在 main 与本分支上用同一份输入取平面/恒等帧做逐像素对比（8/16 位、半分辨率、效果链、角点贴合、嵌套），输出到 evidence-A。
3. 正式路径样片：隔离的 Electron 正式构建（不占 9334），经助手能力写入、createThree 编译、结构读回与正式取帧复现原型时间线。
4. P2/P5 性能；图形推近在图形准备路径按档位重栅格；代码卡整幅生成的过采样；推近文字逐帧测排版边界；半分辨率下 1×1 回退档位。

未推送、未合并到 main、未切分支；遵守排队脚本与 9334 限制。

## A 线整项验收续办（11-01，吸收 main 562d03188）

摘要：已解完 38 个文件的合并冲突，保留 main 的文字排版、元素效果覆盖、网页文本接口与历史黄金样本；空间作者接口顺延为 13。
摘要：剪辑 57、录制 60、代码版本 14、代码资产 19、效果库 10、预设包 17、风格库 13、模板库 10、风格包 16；标题模板 10、候选 5、字幕记录 27；每种仅增加一次。正式生成样本、基线与发布承诺已完成。
摘要：本块匹配验证通过；P1 完整 Renderer 矩阵正在准备，正式应用样片、P2/P5 和小余项尚未完成，整票不能标验收完成。

### 合并修复与证据

- 字幕迁移仅更新内容版本，不向 strict 内容 schema 注入外壳 minReaderVersion；历史样本全链读取通过。合并期间按脚本正式支持的 HENJI_PERSISTENCE_RELEASE_REF=562d03188 核对 main 发布承诺，避免本分支未发布的撞号占位覆盖 main。合并提交后默认 HEAD 即新基线。
- 旧接口代码不具备空间声明，空间源探测直接按普通卡片处理，保留网页首帧抓取与慢编译并行。
- main 的变形效果登记新增 tracking 值依赖，与片段可见性/转场登记形成初始化回环。将原有四角投影函数原样抽到 trackProjection，tracking 保持再导出，warps 直接依赖纯几何；消除回环，没有双实现。
- 独立审查 1 轮发现重复应用 PAR：Composition 已含显示宽，Renderer 再乘一次。已修复并补 PAR=1、4/3 的正式 Renderer 定向验收；同类 SpatialOutput 入口按原始 Sequence/已合成 Composition 逐一核对。
- 26 文件 771 项定向测试通过（.tmp/t16-merge-tests2.log）；最终 Renderer/跟踪 139 项通过（.tmp/t16-merge-final-checks.log）。包含作者编译/类型/运行时、空间曝光/传播/算法/正式事务、历史样本。两次范围重叠，不相加。
- 真实 GPU：空间材料与效果 72 项通过（.tmp/t16-merge-gpu.log）；three G/W、ExternalTexture、时钟与目标生命周期 2 项通过（.tmp/t16-merge-final-checks.log）。
- 双工程 tsc（8GiB）、精确文件 ESLint、66 格式兼容、公共能力结构与 15 项覆盖/31 文件 238 项不变量通过。依赖图 0 静态值 SCC、0 冻结跨层边、首屏 0 重模块、11 既有动态回边（.tmp/t16-merge-dependency2.log）。
- 独立审查检查合并文件、格式迁移、空间材料/作者输入、文字排版/元素覆盖/网页文本与投影抽取；1 项重要问题已修，无其余有证据的问题。未调用外部 Claude。

### 下一步

1. P1：main 562d03188 与当前分支完整 Renderer 的无空间/规范恒等原始 RGBA/half 对照，覆盖效果、角点、嵌套、PAR、运动模糊、半分辨率；脚本在 evidence-A/identity/harness，仍在调试启动，不是通过证据。
2. 隔离 Electron 正式路径样片：公共写入、createThree 编译、空间结构读回与正式取帧；样片交 Claude 目视，禁止外部聊天服务。
3. P2/P5 实测及图形推近重栅格等余项；最终再核对 main，若 ticket 17 已合入按当时登记顺延，不复占作者接口号。

仅在 task/16-三维空间 提交，未 push、未切分支、未合入 main；无界面或依赖变更，未动 9334、D:/视频制作 与联接点。所有重命令均经指定 heavy.sh。

## A 线剩余验收（11-01，本轮续办）

摘要：已通过 c82f96eb1 吸收 main b851ba00c；P1 完整 Renderer 的 58 组 RGBA/half 比较皆零差，18 组无空间内容序列化与窗口指纹字节相同。
摘要：恒等前后各一帧及非零趋零已补；稳定层序、完整可见夹具在 10^-6、10^-8 的最大差为 1/255，严格恒等帧零差；修复空间效果错误降级中间纹理格式。
摘要：正式应用样片与 P2/P5 尚在继续；本节随这三块更新，不表示整票已经验收。只在任务分支提交，不 push。

### P1：真值、连续性与同源修复

- 固定真值 main 为 b851ba00c（源码快照位于本机 .tmp/t16-reference-b851ba00c，无分支或 worktree）。同一隔离 Chrome 156.0.8078.74、RTX 4090 / 驱动 610.47，同字体与依赖，完整 VideoEditRenderer；显式固定 render-engine 标识，排除两份打包身份本身的差异。
- identity/matrix.json：14 个输入，46 组原始 RGBA8/完整 rgba16float 目标比较；identity-composite/matrix.json：4 个复合输入，12 组比较。两种分支结果（无空间、规范恒等）对 main 的差异像素数、差异通道数、最大通道差均为 0。高精度目标读回全部行，半分辨率实际输出尺寸同时断言。14+4 组无空间 clip 内容序列化与窗口内容指纹完全一致。
- 范围：图片、透明代码卡、文字、内置模糊/发光/调色、角点贴合、嵌套、PAR 4/3、运动模糊、图形、字幕、转场窗口，全/半分辨率及 8/16 位。图形对象与关键帧 ID 固定，避免随机输入混入指纹对照。
- identity-boundary/boundary.json 与 13 张 PNG：深度、Y 旋转、相机平移/透视、景深量按 10^-2 → 10^-4 → 10^-6 → 10^-8 趋零，帧 36/37/38 为前一帧/严格恒等/后一帧。完整可见且层序不变，最大通道差依次为 235、20、1、1；四个恒等帧皆零差。该夹具不把发生真实深度换序或参考画幅裁边的输入外推为连续性结论。
- 根因修复：VideoEditSpatialGpu 的效果 scratch 分配器原来把所有非 8 位格式转成 rgba16float；final 高斯实际要求 rgba32float，宽描边距离场要求 rg32float。它们与执行管线格式不匹配，非零空间帧会丢画面。现在保持计划声明的原格式；沿共享效果计划、正式 effectAllocator 与字节计费检查，当前其他 scratch 格式未发现同源转换。两种格式各补一个真实 GPU 输出/校验错误回归。
- 验证：合并定向测试 150 项；本块真实 GPU 6 项、渲染层 8GiB tsc、精确两文件 ESLint 通过。日志 .tmp/t16-current-merge-tests.log、t16-p1-gpu-regression.log、t16-p1-tsc.log、t16-p1-eslint.log；像素证据 .tmp/t16-p1-complete.log。所有重命令经指定 heavy.sh。
- 独立审查：合并 1 轮无重要问题；P1 2 轮，首轮指出同源宽描边格式遗漏和成功路径未记录页面错误，已修，第二轮无新问题。验收脚本还监听正式 codeGpu 错误观察器，页面/GPU 错误不能带着零退出码通过。
- 原始 .rgba/.half 留在用户指定 tickets/16-三维空间/evidence-A/{identity,identity-composite}/，不将大体积原始帧重复塞进 Git；脚本与完整比较清单入本分支，恒等边界 PNG 一并保留。正式样片待下一块产物完成后列图。

### 正式应用样片（公共写入、createThree、结构读回、Electron 取帧）

- 正式生产产物 electron:bundle 在 fcdb24c8d 上生成；隔离资料、独立随机 CDP/MCP 端口，Electron 44.9.3 / Chromium 152.0.7977.167，RTX 4090，three 0.186.1。本机 MCP 经正式通用实体写入创建作者接口 15 的 createThree 模块和时间线片段，再调用展开/压平算法；通过同一公共属性写入校正为已认可原型的连续保持段、倾斜与拉焦。
- 20 张 1920×1080 成片 PNG 全部经 observe_video_edit_frame 生产 Renderer 取得，调用回执与 verify_video_edit_space 的相机/卡片结构在 formal/evidence.json；正式保存回读为 saved-project.json；本轮 29 次公共调用，无页面或请求错误。读取用 saveToAssets:true 后的正式 asset 引用，所有素材写入只在隔离资料内，实例结束已清理。
- 已核对：f000=f044=f226=f239 逐像素相同；f044→f045 最大差 1，f225→f226 最大差 2（225 的快门仍含压平尾段的非零子帧，226 起整个曝光恒等）。f045→f046 最大差 25，f224→f225 最大差 139；实际差异统计记 evidence.json。已逐张目视三张联系表，透视、锐度、拉焦和换序与原型方向一致；最终构图与观感留给 Claude 目视，不代其签字。
- 给 Claude 的图：formal/sheet-flat-unfold.png（按行 f000、044、045、046、075、105）；formal/sheet-focus-crossing.png（135、150、162、167、168、169、170、180）；formal/sheet-flatten.png（195、210、224、225、226、239）。需要原尺寸时对应 fNNN.png；特别看 f044/045/046、f167/168/169/170、f224/225/226。
- 验收脚本修正了旧夹具的派生 fps 字段、素材项与片段重复 ID、片段引用多拼序列 ID，以及启动时 appPath 不正确导致内置库找不到的问题。正式内容在运行前通过完整 schema 校验；没有修改业务格式或增加旁路。生产产物、公共创建与保存、结构读回及真实取帧均已实际执行。
- 发现的既有问题：默认临时 observation.image 引用被 read_application_media 的通用实体前置校验拒绝，媒体读取器自身支持该种引用，但它不是普通反射实体。本票样片改用正式的永久素材选项完成；该默认读取问题未混入空间改动，也不宣称已修。
- 正式样片仅验证正式 final 取帧；8/16 样本和 G/W 性能由下一块单独记录，不能把这 20 张图当作整片实时性能通过。

## 接手收尾（11-01，Claude）

- 合并：6c50046fa 吸收 main 95daab10c（ticket 14、U10 片段效果批次进 main 后），持久格式顺延到剪辑 60、录屏 63，作者接口 15。空间材料上的原生内置效果按材料视口换算，由空间合成器自己编码，不进片段批次。
- 撤回：87324d682 撤回未经验证的性能半成品（它让 CodeGpu 测试变红，还改了非空间栅格）。P2/P5 实测与图形推近重栅格没有做，留在以后再做。
- P1 复测：对 main 95daab10c 重跑 identity 矩阵，46 组比较的差异像素数与最大通道差全部为 0。
- 样片：Claude 已目视三张联系表并认可。
