摘要：6 个本机模板与在用库样片已通过正式入口发布；两个剪辑文档和片子代码未改。
验收：四个纯 Canvas 模板停稳均为100%沿用、0次上传、0字节；章节CPU中位数/p90为0.50 / 0.70ms。
备份：D:\VibeCode\Henji-AI\tickets\21-组件库静止复用\backup-20261101-010550\video-edit-styles（整库36文件）；同级sha256.json逐项核对通过。

## 实际范围与发布

- 仅点阵信息本机风格库的6模板与库样片；未升级工程快照、工程模板、历史测试样片或片子源代码。
- 6份kit同步缓存ImageBitmap，精确几何参与knock键；脉冲、标签点/波纹、逐点闪烁拆小pose层，保留reverse/hold与各点相位。
- 样片将台面、标题、文本框、录屏/高亮、摘录/来源、对比、步骤、数据拆开；连续镜头与视差保留。颗粒对不透明底的multiply转为数学等价黑色衰减遮罩，作用于所有前景；逐帧对比保留取整差。
- 样片绑定逐帧视频时，场景与台面共用屏幕栅格，信号/闪烁仍是独立pose小层；避免视频与显影期反复上传高密度大纹理。无视频的正式库样片保持各场景拆层。
- 脉冲周期零点使用CPU最小正数保留纹理，上传GPU float32后严格为0；不改变透明像素，不新增宿主/协议实现。相关精确断言见content.test.cjs。
- 发布走change_application_entities写完整template.body与style.sample，再render_video_edit_style重生成预览/缩略图/锚点；回读sample一致且stale=false。无工程范围内的改指请求；库条目保留原ID，由正式保存入口维护作品版本与摘要。
- 正式导出备份：before.hjsty（首次发布前的原内容，不覆盖）；写入收据：evidence/publish/evidence.json、evidence/publish-final/evidence.json。

| 模板 | 原作品版本 | 当前作品版本 | 当前kit SHA-256 |
|---|---:|---:|---|
| 章节标题 | 1 | 2 | c09b639aabc686371faa231bedede4dfd295acfeb931c389d7b0790c0860fce4 |
| 花字节点 | 1 | 2 | c09b639aabc686371faa231bedede4dfd295acfeb931c389d7b0790c0860fce4 |
| 高亮 | 1 | 2 | c09b639aabc686371faa231bedede4dfd295acfeb931c389d7b0790c0860fce4 |
| 数据卡 | 1 | 2 | c09b639aabc686371faa231bedede4dfd295acfeb931c389d7b0790c0860fce4 |
| 录屏容器 | 3 | 4 | c09b639aabc686371faa231bedede4dfd295acfeb931c389d7b0790c0860fce4 |
| 台面背景 | 2 | 3 | c09b639aabc686371faa231bedede4dfd295acfeb931c389d7b0790c0860fce4 |

样片作品版本：11 → 13；包含首次发布及视频分支校正后的再次正式渲染。六模板均只升一次作品版本。画幅3840×2160、60fps、26秒与原锚点设置均保留。

## 逐模板主验收

同一正式生产构建，真实NVIDIA Lovelace硬件适配器（isFallbackAdapter=false），Electron/Chrome/驱动与特性状态见evidence/after/evidence.json。测试工程全部在隔离profile内。模板以10秒临时片段隔离，延长停稳段用于覆盖周期，原库durationSeconds没有改；样片仍26秒。花字lead=6、数据卡lead=4且count=20，其余使用默认参数，全部正式写入并回读。纯Canvas采样215–346帧，两个相接预热窗口后132个相邻帧稳态样本；sample为1255–1386帧。

| 对象 | 改前沿用率 | 改后沿用率 | 改前上传字节（132帧） | 改后上传字节（132帧） | CPU改前 中位/p90 ms | CPU改后 中位/p90 ms |
|---|---:|---:|---:|---:|---:|---:|
| 章节标题 | 60.00% | 100.00% | 1331237952 | 0 | 3.00 / 5.00 | 0.50 / 0.70 |
| 花字节点 | 0.00% | 100.00% | 127176192 | 0 | 0.90 / 1.20 | 0.40 / 0.60 |
| 高亮 | 33.33% | 100.00% | 156524544 | 0 | 1.20 / 1.70 | 0.40 / 0.50 |
| 数据卡 | 71.43% | 100.00% | 1555312704 | 0 | 2.60 / 3.70 | 1.80 / 2.40 |
| 录屏容器 | 33.33% | 100.00% | 1742560512 | 0 | 0.70 / 1.10 | 0.30 / 0.60 |
| 台面背景 | 不适用 | 不适用 | 0 | 0 | 0.20 / 0.30 | 0.10 / 0.20 |
| sample | 0.00% | 97.58% | 4379443200 | 4379449600 | 38.70 / 55.50 | 10.90 / 26.50 |

- 原生GPU背景没有Canvas沿用分母；“不适用”不代表无GPU工作。录屏主表为未绑定媒体的占位分支，真实视频与冻结输入见下表。
- 样片持续运镜，背景仍需上传；97%左右沿用率是局部层的真实沿用，不承诺整片零上传。首次出现的脉冲纹理单列为正常暖机。
- 逐帧静止层实测：章节7/7、花字4/4、高亮5/5、数据卡29/29沿用；样片保留背景动态上传，标题、答案、文本框、录屏占位、摘录、对比、步骤、数据主体与已出现的小信号层沿用，详细计数见observations逐帧layers。
- 原始performance包含reused/redrawn/direct/video、uploads/uploadBytes、CPU/GPU墙钟、preparation、sampling；保留在各evidence.json的observations，未用图像缓存命中替代相邻帧测量。

## 基线稳定性与实际播放

补测在evidence/before-stable/evidence.json：用相同132帧工作量CPU均值的连续两轮差异≤5%判断环境稳定性；0.1ms时钟对亚毫秒中位数的量化会放大相对差。原始中位数、p90和GPU墙钟全部保留。此口径不改变第9节的99%、零上传及章节中位/p90<2ms门槛。

| 对象 | 改前热播漏帧/期望帧 | 改后热播漏帧/期望帧 | 改前CPU+GPU p90 ms | 改后CPU+GPU p90 ms |
|---|---:|---:|---:|---:|
| 章节标题 | 2/180 | 0/180 | 16.90 | 7.90 |
| 花字节点 | 0/180 | 0/180 | 8.10 | 6.80 |
| 高亮 | 0/180 | 0/180 | 9.40 | 7.00 |
| 数据卡 | 18/180 | 16/180 | 10.80 | 7.70 |
| 录屏容器 | 0/180 | 0/180 | 7.50 | 5.00 |
| 台面背景 | 0/180 | 0/180 | 11.20 | 10.70 |
| sample | 150/240 | 67/240 | 208.50 | 104.70 |

数据卡默认20点以每点一层保留各自相位；请结合总合成p90与漏帧判断，不能单凭沿用率作性能结论。GPU数值是包含队列完成的墙钟，非硬件时间戳。

## 视频与冻结输入单列

输入input-video.mp4为FFmpeg生成的640×400、60fps、26秒测试图；仅用于隔离验收，不写入用户素材。

| 模式 | 对象 | 沿用率 | 上传次数/字节（132帧） | CPU 中位/p90 ms | GPU 中位/p90 ms |
|---|---|---:|---:|---:|---:|
| before-video | 录屏容器 | 0.00% | 132/1742560512 | 0.80 / 1.00 | 8.10 / 10.00 |
| before-video | sample | 0.00% | 132/4379443200 | 21.40 / 34.60 | 25.00 / 31.90 |
| before-video-matched | sample | 0.00% | 132/4379443200 | 27.40 / 51.30 | 28.60 / 44.70 |
| after-video | sample | 96.91% | 133/4379449600 | 38.80 / 54.50 | 29.90 / 46.90 |
| after-video | 录屏容器 | 66.67% | 132/1273132608 | 1.10 / 1.40 | 6.90 / 8.80 |
| before-freeze | 录屏容器 | 0.00% | 132/1742560512 | 1.90 / 2.50 | 6.50 / 10.70 |
| after-freeze | 录屏容器 | 100.00% | 0/0 | 1.70 / 2.60 | 0.50 / 1.40 |

| 真实视频热播 | 漏帧/期望帧 | CPU+GPU p90 ms |
|---|---:|---:|
| before-video 录屏容器 | 0/180 | 17.70 |
| before-video sample | 106/240 | 97.30 |
| before-video-matched sample | 151/240 | 159.60 |
| after-video sample | 141/240 | 132.40 |
| after-video 录屏容器 | 0/180 | 16.90 |

before-video-matched是在最终视频实现复测前补取的相近时间旧版样片基线；原before-video亦完整保留，两个基线均使用同一视频和工作负载。禁止从多轮中挑最好成绩，本表固定取各次完整测量的第二轮热播。

视频分支按真实绑定输入与逐帧变化核对；冻结使用同一视频首帧导出的frozen-input.png绑定为图片，仅为验收对照，原模板、用户样片与任何片子都未冻结。额外固定时刻video(time=0)诊断仍有宿主输入纹理更新，原始证据在before-fixed-video/after-fixed-video，不拿它冒充零上传通过；本轮不改宿主运行时。

## 画面对比与截图路径

- 逐帧像素统计：evidence/pixels.json，包含全画幅尺寸、差异数、最大差和差异边界；未用缩小联系表代替原图检查，也未把非零像素差当成逐像素一致。
- 每个模板的运动帧：evidence/before/<模板>-30.png 对 evidence/after/<模板>-30.png；停稳帧：同目录<模板>-220.png。另保留90、350、585（reverse中段）、599（末尾）帧。
- 样片对应原图：evidence/before/sample-{30,220,480,800,1000,1170,1260,1440}.png 与 evidence/after/同名文件；覆盖标题、连续运镜、录屏/高亮、来源、步骤、数据与收尾。
- 视频对应原图在evidence/before-video与after-video；冻结对应原图在before-freeze与after-freeze。
- 人眼结论：各模板运动30帧/停稳220帧、样片八个时刻及真实视频运镜帧对照，未见内容、布局、点阵相位、裁切、拖影或颗粒覆盖变化。原图按1:1查看，并检查变化区域；局部上下对照（上改前、下改后）在evidence/visual：花字节点-30-detail.png、花字节点-220-detail.png、高亮-220-detail.png、数据卡-30-detail.png、数据卡-220-detail.png。
- 台面原生GPU与占位录屏六帧逐像素一致。拆层后部分边缘有抗锯齿/纹理重采样差；样片大面积低幅差包括最终颗粒合成的8位取整，文字边缘还含pose纹理重采样，不能把较大的单点差解释成颗粒取整。各帧最大差、>16像素数与全幅差异边界均原样保留于pixels.json，没有扩大阈值来宣称逐像素一致。

## 审查、修复与验证

- 独立干净上下文只读审查1轮。4项重要问题均修复：录屏cut分支T变量、章节答案下划线冻结过早、样片录屏引线bounds裁切、样片答案晶化冻结过早。小问题中的阈值断言已补；视频分支另行取证。
- 自查共享范围：6份相同kit、4个持续动画模板全部调用方、录屏两种入场、样片全部7个场景与颗粒合成；测试覆盖空答案、lead=0/非零、长文、count=0/20/40/9999、隐藏矩阵、hold/reverse、跳入倒退及两种尺寸。
- 检查后未发现遗漏的不同kit补丁或内置风格同源入口；仓库6套内置风格没有本任务的kit/knock实现，不改。主片、暗色文档、工程登记副本、独立测试素材及历史样片均未做升级或画面验收，不能从本机库通过推断它们同步完成。
- content.test.cjs：5项通过，覆盖参数求值、原版脉冲等价、位图复用与精确几何失效、零点GPU透明度、相同内容键不允许不同绘制指令、当前媒体在draw内读取。
- 正式test:reality定向场景、相关作者运行时单测和verify:changed L2的最终命令及结论见下面追加记录。
- 原有宿主取证问题：observation.image不能经本分支read_application_media解析，截图在隔离实例通过saveToAssets=true正式输出再读取；未修改用户素材。原有关闭会话警告与少数暂停定位竞态不并入本次内容改造，原始日志保留。

## 回滚与未触碰内容

回滚优先通过before.hjsty正式导入同ID备份；需要字节级回退时先停写并留存当前库，再将backup-20261101-010550/video-edit-styles恢复到本机库根，核对sha256.json并重载。新旧作品版本不可混当持久格式版本。
protected-sha256.json记录两份只读剪辑文件原哈希；收尾再次核对。D:\视频制作全程只读；9334没有连接、关闭或重启。本次构建与验收均使用t21产物和隔离profile；发布时只将获准风格库接入独立实例，其数据库、设置、工程、端口保持隔离。未安装/卸载依赖，未删除node_modules或FFmpeg联接点。

## Git与最终验证记录

分支：task/21-组件库静止复用；HEAD：32e62e3580731503bfcaa9651942e6bf71e027b2。本任务不合并main、不切分支、不push。

验证分级：按testing.md的L2处理正式文件I/O与共享MCP测试封装；新增场景为显式环境变量启用，不改变默认巡检集合、宿主运行时或持久格式。仅CJS脚本，没有所属TypeScript工程变更。

```powershell
npm run verify:changed -- --level L2 scripts/lib/uiInspectionScenes.cjs scripts/lib/uiInspectionSceneVideoEditStyleReuse.cjs scripts/lib/uiInspectionMcpClient.cjs --test src/features/videoEdit/engine/videoEditAuthorRuntimeResolution.test.ts --test src/features/videoEdit/engine/videoEditAuthorCanvasRecorder.test.ts
node --test D:\VibeCode\Henji-AI\tickets\21-组件库静止复用\content.test.cjs
```

- 最终L2：共享MCP客户端Node测试3项、CanvasRecorder 14项、RuntimeResolution 5项，共22项通过，退出0，原始记录verify-L2.log。作者内容专项5项通过。
- electron:bundle成功（707秒）；本任务无运行时源码改动，不重复构建，不升级全量electron:build或全仓测试。
- Reality统一入口：npm run test:reality -- --suite ui --only =video-edit-style-reuse --size 1440x900 --allow-writes --out <ticket内证据目录>。设置HENJI_STYLE_REUSE_ROOT为本ticket目录，MODE为before/after/publish；脚本里保留全部取证与发布逻辑。
- 最终真实应用证据：reality-after-final、reality-after-video-complete、reality-before-video-matched、reality-publish-final各自index.md；冻结输入证据在evidence/after-freeze/evidence.json。
- 动态视频性能有跨批次波动：初次旧版与相近时间补测均保留；以相近时间补测评估实际播放时，p90与漏帧改善，但不宣称全部CPU/GPU单指标均下降，也不承诺4K样片实时60fps。

发布后只读核验：通过；整库备份36文件哈希不变；真实库变化17文件，新增0文件，范围仅6模板及该风格派生媒体；两份hjvid哈希不变、片子HEAD仍aa02525cea41f0a2f7fc8fdc507fca4d87f622c8。详evidence/final-audit.json。
样片正式预览：1920×1080、60fps、1560帧、26秒，缩略图与8锚点文件均非空；正式读回stale=false。

> 证据截图、像素统计、审计脚本与风格库整库备份（含 SHA-256）已移到本机忽略目录 `.tmp/t21-evidence/`（风格库备份目录名 backup-20261101-010550），不进仓库；回滚时从该备份恢复。
