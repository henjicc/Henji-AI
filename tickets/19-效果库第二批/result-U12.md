摘要：U12 的目录合并、精确迁移、移除项容错已实现；溶解的点阵／半调和独立亮边控制尚待 ticket 12 共用工序，不能认定设计全部完成。
摘要：最新 main cd7d8443b 已合入任务分支；剪辑内容 48→49、录制会话 51→52，支持起点不变；只在 task/19-U12-过渡 提交，不推送、不合 main；编号避让已合入的 ticket 13。
摘要：独立干净上下文审查 1 轮，1 项重要问题及 1 项小问题均已修复并补回归；验证结果见下方。

## 实现范围

- 视频过渡主目录整理为设计的 23 个条目，14 个低频过渡放进默认折叠的“更多”；音频过渡不变。每个条目的方式由共用登记生成，效果面板、控件及助手读取同一来源。
- 合并只在登记及参数映射层完成，复用已有内置过渡、shaders 和 gl-transitions 实现，不复制着色器、不新增依赖，不更改布局、颜色或样式。
- 参数按方式显隐；参数数值、单位、来源默认值、关键帧值及贝塞尔控制点都不换算。来源数值契约不同的同名参数保留独立键，避免把不同量纲的值直接当成同一值。
- 移除项原样保留 ID、参数、动画、时长、对齐与片段关系；播放走同时长的交叉溶解，包含入点和出点；控件显示设计原文“此过渡已移除，按交叉溶解播放”。剪辑及录制打开时各记一次结构化警告。新建及换入移除项被拒绝，已有项可调时长、移动、撤销、换为现存过渡或删除。
- 助手覆盖分级：复用既有 video_edit.transition 实体及通用属性写入，目录和参数声明自动覆盖，没有新增专用 MCP 工具。已撤下技能里的独立来源列表，说明改为读取正式目录。
- 历史“默认过渡”设置继续用原来源 ID 保存精确方式；创建时映射到整理后的条目。旧视频默认值不会使音频默认值一起丢失。
- 预热读取当前方式的实际来源，着色器图按正式结构键去重，GL 按实际来源 ID 去重。

## 迁移与黄金样本

- 独立纯迁移函数：migrateVideoEditTransitions、migrateRecordingTransitions；逐版本挂在剪辑 48→49、录制 51→52，不递归改作者数据等任意 JSON。
- 提高最低可读版本的理由：写出的径向擦除、对开门、形状擦除等新 ID 及 mode 含义不被旧程序认识，旧程序不能正确读取或播放；因此最低可读版本同步设为 49／52。main 的剪辑 v48／录制 v51 样本与发布承诺逐字节保留；U12 追加到 v49／v52。阶段提交未发布时曾用 48／51，合并时以不可变 main 2c7599d23 作为已发布历史基准（HENJI_PERSISTENCE_RELEASE_REF），没有豁免历史支持。支持起点仍为剪辑 17、录制 19，所有登记历史样本继续可读。设置 schema 的历史枚举保持不变，没有无关格式升级。
- 保留未变 ID 的三维过渡数据；发生合并的项填回来源默认值、逐键改名，曲线也按相同键改名，时钟及片段关系原样保留。
- before-u12.json 覆盖全部 94 个来源，单双侧、缺省／显式参数及贝塞尔动画；当前版本黄金样本 v49.json、v52.json 同时包含这些案例。

| 来源 ID | 写出的 ID | mode | 参数键变化 |
|---|---|---|---|
| flash | flash | white（白闪） | 同名保留 |
| gl.Overexposure | flash | exposure（过曝） | 同名保留 |
| wipe | wipe | wipe（擦除） | 同名保留 |
| shaders.LinearWipe | wipe | linear（线性擦除） | feather → linear_feather |
| shaders.RadialWipe | radial_wipe | —（时钟擦除） | 同名保留 |
| shaders.BarnDoors | barn_doors | angle（对开门） | 同名保留 |
| gl.SplitSlideInHorizontal | barn_doors | horizontal_in（水平分开） | 同名保留 |
| gl.SplitSlideInVertical | barn_doors | vertical_in（垂直分开） | 同名保留 |
| gl.SplitSlideOutHorizontal | barn_doors | horizontal_out（水平合拢） | 同名保留 |
| gl.SplitSlideOutVertical | barn_doors | vertical_out（垂直合拢） | 同名保留 |
| shaders.VenetianBlinds | blinds | uniform（均匀） | 同名保留 |
| shaders.RandomBars | blinds | random（随机） | angle → random_angle；invert → random_invert |
| shaders.SliceWipe | blinds | slice（切片） | angle → slice_angle |
| shaders.CheckerWipe | squares_wipe | checker（棋盘） | 同名保留 |
| gl.SquaresWipe | squares_wipe | sweep（扫入） | 同名保留 |
| gl.RectangleCover | squares_wipe | cover（遮盖） | 同名保留 |
| gl.TilesWave | squares_wipe | wave（波浪） | 同名保留 |
| iris_round | shape_wipe | circle（圆） | mode → operation |
| shaders.IrisWipe | shape_wipe | reveal（圆形揭示） | center_x → reveal_center_x；center_y → reveal_center_y；feather → reveal_feather |
| shaders.DiamondWipe | shape_wipe | diamond（菱形） | feather → diamond_feather；invert → diamond_invert |
| gl.RectangleIris | shape_wipe | rectangle（方形） | 同名保留 |
| gl.Box | shape_wipe | box（方框） | 同名保留 |
| gl.StarWipe | shape_wipe | star（星形） | border_color → star_border_color |
| gl.HeartWipe | shape_wipe | heart（心形） | 同名保留 |
| gl.LeafWipe | shape_wipe | leaf（叶形） | 同名保留 |
| gl.FlowerWipe | shape_wipe | flower（花瓣） | 同名保留 |
| gl.BowTie | shape_wipe | bow（领结） | 同名保留 |
| gl.BowTieHorizontal | shape_wipe | bow_horizontal（横向领结） | 同名保留 |
| gl.BowTieVertical | shape_wipe | bow_vertical（纵向领结） | 同名保留 |
| gl.PolkaDotsCurtain | shape_wipe | dots（圆点） | center_x → dots_center_x；center_y → dots_center_y |
| gl.Pinwheel | shape_wipe | pinwheel（风车） | 同名保留 |
| shaders.NoiseDissolve | dissolve | grain（颗粒） | 同名保留 |
| shaders.BlockDissolve | dissolve | blocks（方块） | softness → blocks_softness；invert → blocks_invert |
| gl.GlowDissolve | dissolve | burn（灼烧蔓延） | 同名保留 |
| gl.UndulatingBurnOut | dissolve | burn_wave（波边烧穿） | 同名保留 |
| slide | slide | slide（滑动） | 同名保留 |
| gl.SlideAwayRight | slide | reveal（右滑揭开） | 同名保留 |
| cross_zoom | cross_zoom | zoom（推近） | 同名保留 |
| gl.ScaleIn | cross_zoom | scale_in（缩放淡入） | 同名保留 |
| gl.SimpleZoom | cross_zoom | zoom_in（推近淡出） | 同名保留 |
| gl.SimpleZoomOut | cross_zoom | zoom_out（拉远） | zoom_quickness → zoom_out_zoom_quickness |
| gl.ZoomInCircles | cross_zoom | circles（圆环缩放） | 同名保留 |
| gl.ZoomWipeLeft | cross_zoom | left（推近左擦） | zoom_quickness → left_zoom_quickness |
| gl.ZoomWipeRight | cross_zoom | right（推近右擦） | zoom_quickness → left_zoom_quickness |
| gl.DreamyZoom | rotate_zoom | dreamy（梦幻旋转缩放） | 同名保留 |
| gl.RotateScaleFade | rotate_zoom | scale（旋转放大） | scale → scale_scale |
| gl.RotateScaleVanish | rotate_zoom | vanish（旋转消失） | 同名保留 |
| gl.RotateFade | rotate_zoom | fade（旋转溶解） | 同名保留 |
| gl.GlitchBands | glitch | bands（条带） | 同名保留 |
| gl.GlitchDisplace | glitch | displace（错位） | 同名保留 |
| gl.GlitchFlicker | glitch | flicker（闪烁） | 同名保留 |
| gl.GlitchMemories | glitch | memories（记忆） | 同名保留 |
| gl.DoomMelt | glitch | melt（熔化） | 同名保留 |
| gl.ColorCoords | glitch | color（色彩推挤） | 同名保留 |
| gl.ColorPhase | glitch | channels（分通道） | 同名保留 |
| gl.Revolve | swirl | revolve（旋涡卷入） | 同名保留 |
| gl.Swirl | swirl | swirl（漩涡溶解） | 同名保留 |
| gl.CrossWarp | swirl | cross（交叉扭曲） | 同名保留 |
| shaders.RippleWipe | ripple | wipe（涟漪擦除） | 同名保留 |
| gl.Ripple | ripple | dissolve（涟漪溶解） | 同名保留 |
| gl.Dreamy | ripple | dreamy（梦幻波动） | 同名保留 |
| gl.WaterDrop | ripple | drop（水滴） | amplitude → drop_amplitude；speed → drop_speed |
| gl.ButterflyWaveScrawler | ripple | butterfly（蝶翼波纹） | amplitude → butterfly_amplitude |
| gl.FadeGrayscale | luma_dissolve | grayscale（黑白溶解） | 同名保留 |
| gl.ColorDistance | luma_dissolve | color（按颜色切换） | 同名保留 |

删除而容错保留：gl.Bounce、gl.Rolls、gl.BookFlip、gl.StereoViewer、gl.Swap、gl.LeftRight、gl.TopBottom、gl.Squeeze、gl.Fold、shaders.PagePeel。

“更多”保留：gl.DirectionalWarp、gl.Hexagonalize、gl.FlyEye、gl.LissajousTiles、gl.Morph、gl.Kaleidoscope、gl.PowerKaleido、gl.ColorWrap、gl.HsvFade、gl.MultiplyBlend、gl.EdgeGlow、gl.DirectionalScaled、gl.SplitSlideInOutHorizontal、gl.SplitSlideInOutVertical。

## 独立审查与修复

干净上下文代理 u12_review，只交目标、文件及 diff、领域规则，1 轮。

1. 重要：精简目录后，默认过渡偏好若沿目录缩窄枚举，会把 {video:'gl.WaterDrop',audio:'constant_gain'} 整体清空。保留设置原枚举、写入时保存来源 ID，应用时换为对应目录项与方式；补了读取、新建及重复应用的回归。
2. 小问题：同一目录项的不同 shaders 方式若按 kind 去重，会漏预热。改用 shaderGraphStructureKey，验证 IrisWipe 与 DiamondWipe 均进入预热，同结构仍只一次。

同源排查范围：共用目录、参数与动画、创建／换种类／默认应用、手势及撤销、预热、剪辑读写、录制基线、混合播放及单侧播放、效果控件、通用实体说明、技能生成源。其余检查范围内未发现有证据的同源缺陷。

## 验证证据

验证分级 L2：修改共享过渡契约及两种持久格式，需要精确消费者测试、两套 TypeScript 和对应专项。没有运行全量 Vitest、Electron 构建或占用 9334 的实例。

- 核心精确测试：30 项通过；涵盖来源映射、动画数值、移除项、默认偏好及预热。
- 真实 GPU：videoEditBuiltinTransitions.gpu.test.ts + glTransitions/videoEditGlTransitions.gpu.test.ts，2 文件 8 项全部通过，像素比较尺寸 64×36；94 个来源中保留的方式比较双侧／入点／出点以及 0、25%、50%、75%、99% 的逐像素结果；原 GL 专项另验证全部来源的两端、透明单侧及选定的 rgba16float 输出。
- 设备：vgpu/node 的 adapter 返回 {name:'D3D12 driver version 32.0.16.1047',type:'gpu'}；未使用 mock 或软件适配器。
- check:assistant-capabilities：通过，结构检查及聚合回归 31 文件 237 项通过。
- check:persistence-compat：通过，66 种登记格式。
- verify:changed --level L2：通过，通过：显式 35 文件，合并后 12 个消费者文件 501 项断言、ESLint、双工程类型及相关专项门禁。合并前另有 491 项通过。
- 最新 main cd7d8443b 的渲染指纹／复核增量：追加 Renderer、过渡迁移及两份指纹消费者的 L2，4 文件 155 项断言、渲染层类型、格式基线与兼容门禁、助手结构检查均通过；未变化部分复用前述有效证据。
+- check:skill-sync：通过，5 个 skill、25 个共享文件一致；着色器技能生成物 --check 通过。

过程中的失败及处理：渲染层 tsc 默认 4 GB 堆耗尽，8 GB 重跑通过；历史测试使用移除的 PagePeel、已合法扩展的角度键、以及合并前的 iris_round 作为新建入口，已改为验证现存入口和确实未知的键；没有放宽数值或像素阈值。原始证据在本工作区 .tmp/u12-*.log（不提交日志）。

## 尚未完成与未验证

设计第 7 节要求溶解的“颗粒／方块／点阵／半调 + 亮边”复用 ticket 12 溶解显影工序。当前 main 未提供该工序，本次只有噪声、方块、灼烧蔓延、波边烧穿四个既有来源的无损合并，尚无点阵／半调及统一亮边参数。已向用户提出等依赖合入或本次补共用工序的范围选择，未收到答复，没有另写一套重复算法。此项是 U12 未达到“设计全部落实”的明确欠项。

没有真实 Electron 目视验收，也未做三种素材逐项观感及 1080p 耗时测量，不据 64×36 的像素专项宣称这些验收已通过；界面改动只涉及设计规定的目录／菜单与移除提示。没有运行付费调用、没有改真实工程，没有 npm install/ci/uninstall，没有删除 node_modules 或 FFmpeg 联接点，没有接触 D:/视频制作，没有操作 9334 开发实例。


## 审查修复 1

范围：审查第 1–8 条的运行逻辑修复；尚未收到 U13 合入通知，第 9 条的 main 合并、剪辑／录制重新登记与本机效果库版本顺延不在本轮抢号。第 7 条措辞交 Claude 复核。仅在 task/19-U12-过渡 追加提交，不推送、不合并到 main。

1. 参数键固定为 transitionCatalog.ts 的显式来源→持久键映射，完整保留已有键名；说明、参数排列和来源元数据不再参与键名推导。新方式只在末尾追加并登记键。黄金样本回归核对已存参数和动画键。
2. video_edit.default_transitions 的公开写入 schema 与说明从当前目录派生，接受并读回 radial_wipe、shape_wipe、rotate_zoom 等目录 ID；历史来源偏好读取时统一为目录 ID，音频偏好保留。默认动作采用目录的默认方式；已有实例的方式、参数和动画不改。
3. 设置存储、预设默认标记与效果库默认标记共同使用 videoEditDefaultTransitionKind 的目录换算；遍历全部可选视频条目验证设为默认后均能读回并标记。
4. 通用实体创建／换种类、手动创建／换种类、选择项与编辑点应用共用 assertVideoEditTransitionCreatable。移除来源报“已移除”，合并来源报目标条目与方式，并列出可用条目。历史移除实例仍可改时长、换成当前目录条目。
5. 收藏在唯一库读取入口把旧过渡与第一批合并效果引用换成目录引用并去重；未知、已移除和个人预设引用保留。评分只迁移 transition 命名空间，合并取最高评分（省略为 0）并保留默认标记；个人效果／文字预设及其重复记录原样保留。评分格式 v1→v2 的迁移、黄金样本、基线和发布承诺已登记；读取先备份、只在明确保存时写回。收藏读取不改写原存储，本机效果库的容器版本仍按裁定等 U13 合入后顺延登记。
6. 两处技能参考撤下 transition:shaders.组件名 写法，改为读取正式 transition:<目录条目> 与 mode 选项；搜索确认 assistant-skills 无旧转场引用写法残留。
7. 合并条目逐个登记方式的事实性画面描述，并同时供参数悬停与助手说明使用；不写使用场景推荐。最终措辞仍由 Claude 复核。
8. 只给现有“种类”下拉补 display 标签：移除项显示“已移除的过渡（按交叉溶解播放）”，未换算的可播放来源显示历史过渡名称；没有改布局、样式或加入可新建的旧选项。

### 独立审查与同源排查

干净上下文独立审查 2 轮：第一轮 1 项重要问题（省略评分合并出 NaN）、1 项小问题（个人预设 ID 被当作内置效果迁移）均修复并补回归；第二轮增量复核未发现新问题。另检查未知引用 effect:constructor 及个人重复记录，均保留。

实际排查覆盖共用目录及参数／动画映射、默认设置与读回、效果库／预设默认标记、通用和手动创建／换种类、所选片段／编辑点应用、历史剪辑与录制样本、收藏／评分加载与保存、技能引用及下拉标签。除已修复项，在上述范围未发现其他有证据的同源缺陷；未据单一入口通过宣称所有功能均已验收。

### 验证

- L2：显式列出本次 23 个实现／测试／格式／技能文件，10 个精确测试文件、365 项断言通过；改动文件 ESLint、渲染层与 Electron 类型、界面严格门禁、依赖图、主进程导入、格式基线全部通过。
- 最后收窄个人评分命名空间的增量：2 个精确文件 14 项通过，增量 ESLint 通过；最后方式说明只有事实性文案调整。
- 真实 GPU：videoEditBuiltinTransitions.gpu.test.ts 与 glTransitions/videoEditGlTransitions.gpu.test.ts，2 文件 8 项通过；保留原 64×36 逐像素比较、双侧／单侧和进度采样阈值，没有降低门槛。
- check:persistence-compat：通过，66 种格式；旧样本和已登记支持范围保留。
- check:assistant-capabilities：通过，覆盖测试 15 项、聚合回归 31 文件 238 项通过。
- check:skill-sync：通过，5 个 skill、25 个共享文件一致。

早期失败已修复：反射 schema 不支持 Zod transform，改为当前目录写入声明与历史读取规范化分工；恢复一处误删的渲染导入；修正新增设置测试对正式事务回执的断言。未改依赖、未放松断言或像素阈值。原始证据在本工作区 .tmp/u12-review-*.log，不提交日志。

没有启动 Electron／Reality 或做桌面目视；下拉标签由真实 Dropdown 的 jsdom 回归覆盖，不据此声称桌面观感或 1080p 性能已验收。没有占用 9334、没有执行 npm install / ci / uninstall、没有删除 node_modules 或 FFmpeg 联接点、没有访问 D:/视频制作。

待 U13 通知后的收尾：git merge main，保留 U13 的迁移与样本，在主线最新版本上顺延本机效果库及剪辑／录制版本和最低可读版本，重新生成本次样本并复验受影响范围；不在此前改写版本身份。

## 审查修复 2

完成审查第 5、9、10 条。先执行 `git merge main`，吸收 U13 的 `7b7fc9544`；版本、迁移与样本冲突按主线已发布身份处理，保留 U13 的原步骤和原样本，再追加 U12 步骤。仅在 `task/19-U12-过渡` 提交，不推送、不合并到 main。

### 版本与样本

| 格式 | main 版本 | 本次版本 | 最低可读版本 | 唯一新样本 |
|---|---:|---:|---:|---|
| 剪辑内容 `document.video_edit` | 49 | 50 | 50 | `v50.json` |
| 录制会话 `document.screen_recording` | 52 | 53 | 53 | `v53.json` |
| 本机效果库 `video-effect-library` | 4 | 5 | 5 | `v5.json` |
| 预设评分 `preset-preferences` | 1 | 2 | 2 | `v2.json` |

- 每种格式相对 main 只升一次。剪辑 49→50、录制 52→53、本机效果库 4→5、评分 1→2；ID 与参数语义变化使最低可读版本同步提高。预设包 12、风格库 8、风格包 11 等 U13 格式保留原登记。
- 本机效果库的正式 4→5 步骤迁移旧过渡与第一批旧效果收藏并去重；读取入口移除未登记的收藏换算，统一交给逐版本执行器。读取先备份、不改原键，明确保存后才写 v5 和最低可读版本；音频风格件与参数保持不变。
- 评分重复过渡取最高评分并保留默认标记；个人效果／文字预设评分、未知与已删除引用保持。正式入口与存储测试覆盖旧 ID→条目 ID、备份、原件未改及保存读回。
- 使用正式 `generatePersistenceFixtures` 生成上述四份样本，再执行 `npm run persistence:baseline`、`npm run persistence:release-snapshot`；保护基准使用 `HENJI_PERSISTENCE_RELEASE_REF=main`。样本同时包含 U13 音频内容、全部旧过渡案例和新增显影方式；U13 的 v49／v52／v4 及其余历史样本与发布承诺保持。

### 新方式与说明原文

溶解原有 `grain`、`blocks`、`burn`、`burn_wave` 的顺序、说明、来源与固定参数键全部保持，仅在末尾追加下列方式。四种方式共用 ticket 12 的图案场、亮边与发光工序；方块在同一图案场里按每格固定随机阈值切换。新增持久参数以 `reveal_` 开头，固定映射表仅追加四份来源映射，不改已有键。

| 方式 | 名称 | 说明原文 |
|---|---|---|
| `noise_reveal` | 颗粒显影 | 细碎颗粒按蓝噪声分布逐渐露出后一段，交界处可带亮边和光晕 |
| `blocks_reveal` | 方块显影 | 方格按各自的随机顺序逐块露出后一段，交界处可带亮边和光晕 |
| `dots` | 点阵 | 网格中的圆点各自先后扩大，露出后一段，交界处可带亮边和光晕 |
| `halftone` | 半调 | 规则网点逐渐扩大，后一段较亮的位置先显现，交界处可带亮边和光晕 |

Claude 措辞复核：四项均通过。CLI 未登录后，使用 browseros-neo 的已登录 Claude 网页会话（Opus 5.5 中等）完成，[复核原文](https://claude.ai/chat/14655599-f5c1-4754-8aa0-65b450709835)；没有把未执行的 CLI 复核记为通过。

### 验证与独立审查

- L2：显式 27 文件，`npm run verify:changed -- --level L2 <本次文件...> --test <直接消费者>` 通过；14 文件、388 项测试，以及改动文件 ESLint、渲染层／Electron 两套类型、依赖图、主进程导入、持久格式基线全部通过。清单 `.tmp/u12-review2-files.json`，完整日志 `.tmp/u12-review2-verify-pass.log`。
- `check:persistence-compat` 通过（66 种格式）；`check:assistant-capabilities` 通过（结构检查、覆盖测试及 31 文件／238 项聚合回归）；`check:skill-sync` 通过（5 个 skill、25 个共享文件一致）。三项门禁串行执行，日志为 `.tmp/u12-review2-check-*.log`。
- 相对 main 的 `git diff --check` 通过。以合并父分支比较暂存区时，main 带入的冻结 LICENSE 的 CRLF、原 GPU 测试和其他任务记录的末尾空行会触发空白提示；确认这些文件与 main 一致，保留原字节，不混入无关清理。
- 真实 GPU：内置过渡、GL 过渡与原显影风格效果共 3 文件、40 项。新增四种方式覆盖双侧切换、单侧透明、端点、图案差异、随机种子、统一亮边与光晕；正式过渡宿主验证中间帧为 `rgba16float`、恒等端点恢复输入精度。最终 L2 再完整执行内置过渡 7 项；其余两份未变 GPU 专项复用本轮有效证据，日志 `.tmp/u12-review2-gpu.log`、`.tmp/u12-review2-gpu-retry.log`。
- 独立干净上下文审查两轮，第二轮只审新增精度接入、类型守卫、构造器与测试增量；两轮均未发现有证据的重要或小问题。自查补齐过渡宿主的浮点输出，避免新增渐显和光晕提前量化。
- 实际同源排查覆盖固定映射与方式顺序、旧参数及动画、收藏／评分命名空间、正式迁移和备份保存、剪辑与录制基线、U13 音频样本保留、双侧／单侧／端点 GPU 合成，以及原显影效果与发光工序。在上述范围内没有遗留已知同源问题。
- 过程失败均已修复：样本拼装曾重复加入基础序列及实体 ID，改为保留来源案例、用正式构造器新建独立显影序列；旧测试直接解析合并前音频内容，改走正式逐版本入口；新参数缺悬停说明，补齐正式描述回退；精度测试曾越过半开窗口，改验宿主接受的端点进度；测试代码的 `unknown` 加入明确内容类型。没有降低断言、像素阈值或门禁，没有改依赖。

本轮不改 TSX、布局或下拉标签。没有启动 Electron／Reality，没有桌面目视或 1080p 性能结论，没有占用或重启 9334 开发版，没有执行 npm install／ci／uninstall、删除 node_modules／FFmpeg 联接点或访问 D:/视频制作。原始日志留在本工作区 `.tmp/`，不提交。
