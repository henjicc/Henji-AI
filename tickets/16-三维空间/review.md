# 16 审查记录
摘要：设计审查 1 轮（Opus xhigh）：必须改 13、建议 11；Claude 全部采纳（裁定见下），交回 Codex 改设计，复审一轮后三线开工。

## 裁定（11-01，优先于 design.md 第 14 节冲突处）
必须改：
1. 空间曲线不另存：depth、rotationX、rotationY、anchorDepth 并入现有动画键与 clip.curves，只新增 spatial.enabled；沿用通用切分/缩放/关键帧派生。
2. 提高最低可读版本（旧程序忽略会误解：修剪不平移、分割丢属性、引用悬空）。
3. 深度排序与景深按卡片几何中心（可见多边形质心）视深，锚点只作旋转轴心。
4. 相机存“相对默认机位的偏移 + 透视量”，默认全 0，缺省或全零即恒等，不用 epsilon；改尺寸、像素比、重构图、分割、嵌套、删除目标的传播与级联由 A 线负责并写进传播清单。
5. 接近恒等时三维分支收敛到二维：材料面效果与二维同单位、同参照；验收加“恒等前后各 1 帧人眼无跳变”。
6. 恒等逐像素对照改为对比改动前 main 在同输入下的原始帧。
7. 景深在材料面按中心时刻每帧一次；曝光只采变换；只有快门内层序变化才整组子帧合成；按包围框与弥散圆降采样。
8. three 内部时钟：停掉常驻 RAF，每次渲染前由宿主设定 nodeFrame 时间（锁 r186 版本，内部字段写在一处并加回归测试）。
9. 单一后端契约：WebGPURenderer（G 路线用 forceWebGL + 画布拷贝），作者只用节点材质与标准材质，GLSL ShaderMaterial 在类型检查报错；宿主渲染器与相机经与作者相同的挂载 URL 导入，不打包第二份 three。
10. 曝光调度接口由 A 线负责并在设计里冻结：子时刻“渲染场景 → 组合成 → 累积”的调用顺序、怎样调 B 的 CodeSources、目标容量、与 ticket 15“上次内容键”的关系（空间片段按子时刻键）。
11. 与 17、18 的集成顺序：17、18 先合并，16 的 A/B/C 在其后吸收 main；createThree 与 createSimulation 可同用，模拟在曝光子时刻用 simulation.at(t) 取样。
12. 只有显式声明空间依赖（createThree 或模块声明）的代码才注入 info.space 并把相机计入内容键。
13. core 里 schema 只用 zod，求值与矩阵另放文件懒加载；henji-author-three 别名加进依赖图门禁的重包名单。
建议（全部采纳）：14 用公开 ExternalTexture 试 W 路线，Z（XR 私有接口）首期不做；15 three 预热/编译与合成串行；16 P2 含 8/16 样本；17 两端都是空间卡的转场作为一个绘制项参与排序；18 写明斜视采样（mip、各向异性）、边缘抗锯齿与推近重栅格；19 持久化“取景对象 + 占高比例 + 透视量”曲线，“拉开景深层次”参数改为最近/最远层视差比；20 定旋转顺序（与 AE 一致）、背面镜像显示、lookAt 奇异时的上方向回退；21 模板首期只带片段空间属性、沿用目标序列相机；22 无空间数据的文档渲染指纹逐字节不变；23 弥散圆可感知阈值以下旁路且 r→0 连续；24 三维里保留卡片内部 pose 模糊，只替换片段变换模糊。

## 第 12.1 节裁定（11-01）
采纳建议例外：普通卡片维持中心材料面每帧一次景深；动态 worldScene 在快门内与别层换序且开启景深的联合情况，允许对每个子样本的场景结果做局部、降采样景深（CoC 仍取中心），再按层序合成累积；P2 单列 8/16 样本成本。不冻结模拟、不关模糊。

## 复审（Opus high）与裁定（11-01，第 2 轮，之后不再送审，Claude 自查后开工）
1. 第 12.1 节裁定并入正文（5.3、9.1、11.2、11.4、12.1、4.6 调用次序、P2 单列执行次数）。
2. transform 模式 worldScene：B 逐样本渲染，A 按层累积成一个材料面，再做一次中心景深；SpatialCompositeHost 补对应方法并写进冻结签名。
3. `space: true` 的非 three 卡片：材料面冻结在中心时刻，不逐样本重渲，内容键只用中心时刻。
4. 内容键由 B 生成（B 拥有作者指纹），A 只传样本时刻与相机；删掉 SpatialSampleRequest 里由 A 传入的 contentKey。
5. 改透视量 = 推拉变焦：移动机位保持 z=0 平面取景不变，焦距随之导出；“展开空间”即透视量曲线。
6. 无主文件：作者入口枚举相关（AuthorDeterminism、AuthorBundle、AuthorJsLocations、AuthorProbeSources、codeTrackReview、declarationReader、contract、typeDiagnostics）归 B；API 9 常量（codeMaterialVersions）归 A。
7. 执行顺序（写进 7.2）：先合并 20、12、15、17、18、10、21、19-U12/U13（它们都在进行中）；16-A 在这些之后从最新 main 开工并负责吸收；19 的 U9/U15a 排在 16-B 之后。19-U12 的立方体/翻转/开门是二维着色器转场，与空间复合转场不同概念，写明关系。
8. 传播清单补 creative-intent-candidate（嵌入 clip curves），并逐个核对 video-preset-package、title-templates、style-kits 是否间接嵌入模板片段。
9. 运动类算法（stagger、motionCompiler、fitting、motionDraft、MotionGroup、超级关键帧、稳定、跟踪写入）首期不处理四个空间键，只动二维键；C 负责在这些入口写明并测试“空间键原样保留”。
10. 4.6 补 PreparedSpatialFrame、SpatialPictureLease、materialPlan 的 TS 定义（PreparedSpatialFrame 对 A 不透明）；generatorTargetCapacity 经 CodeSources/Host 转接。
11. 景深阈值平滑归零与材料面 CoC 尺度换算由 16-A 在 ticket 12 合并后串行改 planAuthorDefocus/BuiltinEffectPasses。
12. 恒等判定明确包含 rotationX/Y/Z 偏移。
13. spatialMatrices 懒加载的 three 数学类是第 9 条的允许例外：只传数值，不跨实例 instanceof。
14. B、C 从 A 冻结接口提交的分支叠加开工（叠加分支），A 合并后各自 rebase 到 main。
15. 链接改为指向主仓库路径。
