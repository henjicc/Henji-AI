做了什么：效果库第一批“合并现有效果”——模糊、锐化、调色、颗粒、暗角、马赛克各合成一个名字 + 方式，黑白保留；登记补软/硬范围（softMin/softMax），说明合成一份（description，悬停 1 秒），旧条目从效果目录、着色器目录、助手目录与技能文档里撤掉；预览页加了全部条目。
合并来源与方式：模糊＝高斯/方向/缩放模糊（内置+着色器）＋镜头虚化 → `blur` 四种方式（均匀/方向/放射/镜头，同一模糊度）；锐化＝锐化＋着色器锐度，补半径/阈值；调色＝亮度对比度、曝光、色温色调、色相饱和度＋着色器 6 个 → 全能调色（别名可搜）；颗粒＝两个合一（单色开关）；暗角＝两个合一，补颜色、±半级抖动；马赛克＝马赛克＋像素化。
观感与验证：均匀/方向与旧实现同一套工序（换算后同 σ，人眼无差别），放射按道迭代、镜头改降采样后观感一致，暗角黑色与旧公式逐像素一致（±1 抖动）；1080p 每帧 3.1–4.6 ms（镜头 7.6–8.6 ms，预览页含提交等待）；相关单测、5 个真实 GPU 文件、check:assistant-capabilities、check:persistence-compat、check:author-effects、L2 全部通过。

## 每个效果

| 效果 | ID | 合并来源 | 参数（主参数在前） | 做法 |
|---|---|---|---|---|
| 模糊 | `blur` | gaussian_blur、directional_blur、zoom_blur、lens_blur（作者图层专用）、shaders.Blur/LinearBlur/ZoomBlur/BokehBlur | 模糊度（软 0–100，硬 0–200，默认 40）、方式；按方式显示：模糊方向（均匀）、角度（方向）、中心（放射）、亮点加亮（镜头）；最后重复边缘像素 | 模糊度 → 等效高斯 σ（指数曲线，40≈画面高 0.9%）。均匀＝原 planGaussian；方向＝16 点直线 × N 道（至少 2 道，长拖影自动加道）长度 √12·σ；放射＝每道 16 点、间距 1/16 迭代到最外圈不到 1 像素，缩放量 2√12·σ（默认与旧缩放模糊一致）；镜头＝96 点黄金角圆盘半径 2σ，半径大时先 2×2 平均降采样（不再依赖输入 mip，片段上也能用，`layer-only` 空间删除） |
| 锐化 | `sharpen` | sharpen、shaders.Sharpness | 锐化量（软 0–100，硬 0–200）；细节：半径、阈值 | 反锐化掩模；与图片编辑调色锐化共用 unsharp 着色器，阈值 0 时逐位不变（快照测试保持） |
| 调色 | `color_grade` | brightness_contrast、exposure、white_balance、hue_saturation、shaders.BrightnessContrast/Exposure/Saturation/HueShift/Vibrance/Tint | 全能调色原样（未改参数） | 加搜索别名（亮度、对比度、曝光、色温、饱和度……） |
| 黑白 | `black_white` | 保留 | — | 说明改成一份；着色器入口独立（与原零饱和度结果相同） |
| 颗粒 | `film_grain`（名称“颗粒”） | film_grain、shaders.FilmGrain | 强度、大小、单色 | 原有“单色”开关即单色/彩色 |
| 暗角 | `vignette` | vignette、shaders.Vignette | 数量（0–100）、大小、羽化、颜色 | 混向所选颜色（黑＝旧暗角，白＝旧负数量的提亮）；被改动像素加 ±0.5/255 抖动，加在预乘值上（叠到底色后正好半级，不随透明度缩小） |
| 马赛克 | `mosaic` | mosaic、shaders.Pixelate | 块大小（软 0–100，硬 0–200） | 原实现 |

## 其他改动
- 登记：`ImagingParam` 加 `softMin/softMax`；`tooltip` 改可选，界面读 `tooltip ?? description`；效果定义可登记 `aliases`；`effectParam.amount/signed` 可给硬上限。效果控件的数字拖动（NumberInput `scrubMin/scrubMax`）与滑杆只走软范围，键入/助手按硬范围校验；参数名悬停 1000 ms 才弹出（ParamList → UiFormRow `infoDelay` → UiTooltipText `delay`）。助手读到的参数说明多 softMin/softMax。
- 智能预设：人脸/背景/文字模糊改用 `blur`（模糊度 61/44/55，等于原 σ）；背景压暗改为全能调色曝光 −1 档。
- 持久格式：剪辑内容 46→47、录制 49→50（minReader 47/50）把三种旧模糊换算成新参数（含关键帧逐点换算）；黄金样本 v47/v50；schemaBaseline、releasedCompatibility 已更新。其余被合并的效果按决定 6 不迁移。
- henji-effects 冻结 1.1.0（blur 一个工厂、带 mode；生成器去掉 blur 特例）。1.0.0 保留，但其 blur() 产出已删除的旧 ID，用了会报错（决定 6）。
- 技能文档：author-api、approach、color-texture、motion、recipes-glass-lines 改成 effect:blur / amount 写法。
- 文档：效果库.md 进度、assistant-status.md 推翻记录。

## 1080p 每帧（预览页，夜景素材，中位数，含等待显卡完成；约 3 ms 是提交等待下限）
均匀 4.6 / 均匀模糊度 100 4.6 / 方向 3.4 / 放射 3.5 / 镜头 8.6（40）、7.6（100）/ 锐化 3.2 / 调色 4.1 / 黑白 3.2 / 颗粒 3.1 / 暗角 3.7 / 马赛克 3.7 / 发光 5.6 ms。

## 观感对比
- 均匀、方向：工序与旧实现相同，模糊度按同一 σ 换算，像素级一致（单测核对 σ 与降采样计划；旧锐化快照未改）。
- 放射：默认模糊度与旧缩放模糊同量（缩放量 0.06）、同两道；只在长拖影时多一道，减少重影。
- 镜头：降采样代替 mip，GPU 用例里光斑亮度、能量、二阶矩半径都在旧基线 3% 内；预览页大半径无条纹。
- 暗角：黑色与旧公式逐像素一致（±1 抖动），预览页暗底一行像素 1/2 交错，无一圈圈色带。

## 验证
- 单测：videoEdit core / application / engine / panels、persistence、ParamList、NumberInput（新增软范围拖动用例）、blurMigration（新增）等；剩余失败均为 main 上已有：videoEditOutputs ×10、videoEditLoudness ×3、videoEditPresetPreview ×1、videoEditAuthorModules ×2（在 main 工作区同样失败）；videoEditRenderCache 两条负载下偶发，单跑通过。
- 真实 GPU：videoEditBuiltinEffects（29，新增颗粒单色/彩色、暗角旧公式与白色、暗角抖动按最终画面、四方式亮度守恒与透明边、锐化阈值）、gaussianHosts、shaderGraph、videoEditContentPrecision、videoEditColorGrade 全过。
- check:assistant-capabilities、check:persistence-compat、check:author-effects、persistence-golden（electron）通过；tsc（渲染层）通过；改动文件 eslint 通过。
- verify:changed L2（显式 19 个消费者测试）：12 步全部通过（Vitest、ESLint、渲染层与 Electron 增量类型检查、界面四项严格门禁、依赖图、主进程导入、持久格式基线）。
- 提交前审查一轮（全新上下文子代理）：无重要问题；小问题已修：方向模糊长拖影加道、助手/界面里残留的旧效果说法（motion.md、smartRegions、transitionParams）、库面板双句号、迁移注释写准“关键帧之间按模糊度插值”。

## 偏离与待定
1. **效果预设库与风格包/模板未迁移**：本机效果预设（localStorage 整库读取）里只要有一条含旧 ID（gaussian_blur、亮度与对比度等）或负数暗角，整库读取失败、之后无法保存。ticket 13 正在升级预设格式，建议在它的迁移里复用 `migrateVideoEditMergedBlur`（`src/core/videoEdit/blurMigration.ts`）；风格包与模板库同理未核对。
2. **整体转色相没有落点**：旧“色相与饱和度”的色相旋转、着色器 HueShift 并入全能调色后没有对应参数（全能调色只有分色相与曲线）。要不要给全能调色加“色相”需要定（会动图片编辑共用参数与持久格式）。
3. **henji-effects 版本号**：本分支冻结了 1.1.0；ticket 13 若也要冻结新版本，合并时后合的一方改用下一个版本号。
4. 着色器目录里的发光（Glow）与镜头色差（ChromaticAberration）仍单列（上一张发光票遗留）；Reality 场景 08-shader-effect 依赖“镜头色差”，本票没动。
5. tsc 首次运行时把增量缓存写进了共享的 node_modules/.henji-renderer.tsbuildinfo（之后改用 scratchpad）；verify:changed 的 L2 增量类型检查也会写这类缓存。
6. 开发版与 Reality 未跑；真实应用里的效果控件（软范围拖动、1 秒悬停、按方式显隐）需目视。

## 交叉审查后修复（第二个提交）
1. **贝塞尔曲线连续性**：三种旧模糊里非线性换算的参数（标准差、长度、强度）的关键帧，改为用播放时同一个求值函数逐帧求旧值再换算成线性关键帧，再按 0.1 模糊度（约 0.2% 标准差）的容差合并中间点；贝塞尔、修剪后的 easeRange/easeValues、线性、定格段都覆盖。回归测试：修剪贝塞尔 + 线性 + 定格的旧曲线，0–60 帧每帧标准差与旧值相差 < 0.5%（`blurMigration.test.ts`）。
2. **读取不能失败**（不做数值迁移）：登记侧新增可复用的 `isRemovedVideoEditBuiltinEffect`、`storedVideoEditBuiltinEffectNotes`，存档校验 `videoEditBuiltinEffectIssue` / `assertVideoEditBuiltinCurves` 改为读取口径——已移除的效果、已不存在的参数、超出当前范围的数值都照样读入原样保留，只有类型不对才算损坏；使用时 `resolveVideoEditBuiltinParams` 与关键帧求值按当前范围钳制。新写入仍严格：参数走 normalize/validate，关键帧写入新增 `validateVideoEditBuiltinCurves`（助手 frame_curves 两个写入口已接上）。渲染（`activeVideoEditEffects`）、剪辑混音、音频编辑效果链跳过已移除的效果；关键帧行、拆分/修剪、助手读回不再因它报错；应用本机预设时跳过已移除的效果；效果控件里显示一行灰字“此效果已在新版本中移除，不再生效；设置已保留，可以删除。”（删除走原有效果头部）；打开剪辑时记一次日志 `video_edit.document.stored_effects_tolerated`（已移除的 ID 与被钳制的参数）。工程、本机预设库、风格包、模板都经同一个效果 schema，所以一并容错；没改任何格式版本。ticket 13 合并时直接复用这几个函数即可。测试：`removedEffects.test.ts`（含旧 ID、着色器旧效果、负数暗角的工程能打开，其余内容正常，不渲染、可拆分，写入仍拒绝，类型错仍报错；音频链同理）、`videoEditEffectPresets.test.ts`（预设库含旧 ID 与负数暗角照样读入，应用时跳过）。
3. **调色不做映射**。能力差异：旧“亮度与对比度”的亮度（编码值上的加减）、“色相与饱和度”的整体色相旋转与明度、着色器 HueShift，在全能调色里没有一一对应的参数；饱和度 −100 的灰度算法也不同（全能调色按 OkLCh）。其中**整体色相旋转**全能调色完全缺失，记为后续项（要动图片编辑共用的调色参数与持久格式，单独排期）。
4. **模糊硬范围**：上限从 200 放宽到 450（标准差约 100 个画面高，再大画面只是整幅平均色），软范围仍 0–100；迁移不再截断，旧值换算后即使超过上限也原样存入，使用时钳制。冻结的 henji-effects 1.1.0 里 JSDoc 仍写着“硬范围 0–200”（冻结产物不可改；运行与静态检查读的是当前登记，不受影响），下次发版时随之更新。

验证：相关单测（videoEdit core/application/engine/panels、audioEdit、components/ui 等 4300+；失败的只有 main 上原有的导出/响度/预览/作者库测试，以及负载下偶发、单跑通过的 videoEditExportQueue、videoEditRenderCache）；真实 GPU videoEditBuiltinEffects 29 项全过；check:persistence-compat、check:assistant-capabilities、check:author-effects 通过；verify:changed L2 12 步全部通过。

## /code-review 后修复（第三个提交）
1. 旧模糊 ID 运行时映射：换算表 `RETIRED_BLUR_EFFECTS` / `retiredBlurParams` 只在 `core/videoEdit/blur.ts` 一处（含 lens_blur），`resolveAuthorEffects` 把冻结 1.0.0 的 blur() 与直接写的旧 ID 换成 blur；静态诊断按源码锁定的 henji-effects 版本走（1.0.0 的 blur 按当时 mode/参数换算后检查）；生成的类型加 `RetiredBlurDescriptor`，1.0.0 源码类型检查通过。
2. 读取 helper：`migrateVideoEditMergedEffects`（`mergedEffectsMigration.ts`，原 blurMigration 改名）——剪辑 46→47、录制 49→50 迁移与本机效果库、预设包导入、风格库（风格/模板/旧本机风格包）、风格包导入读取时共用，格式版本不变；ticket 13 合并时接到新格式的读取上即可。
3. `updateVideoEditBuiltinEffect` 写曲线走 `validateVideoEditBuiltinCurves` 严格校验（已移除的效果除外）。
4. 外扩封顶：模糊度先按上限钳制，均匀/方向/镜头外扩都封顶在一个画面对角线（再远只剩极淡一层），放射本身有界。
5. resample 改为线性一遍：逐帧样本用斜率区间法合成线性关键帧，每个样本只看一次。
6. 已移除的效果：重置只恢复开关/强度/清关键帧，参数原样保留；关键帧行删光写回静态值、时间线关键帧取默认值与边界都不再要求登记。
7. 换算公式只在 blur.ts；迁移与作者运行时都调用它。
8. 两处“不再”注释改写（shaderGraph/effects.ts、videoEditEffectPresets.ts）。
9. 暗角旧负值无损迁移：amount=|a|、color=白色（关键帧一起换；正负都有的曲线保留原值、使用时按 0 钳制），取代钳制。
验证：相关单测（4400+，剩余失败均为 main 上原有：导出/响度/预览/作者库模块、时间线字幕选中）、真实 GPU videoEditBuiltinEffects 29 项、check:persistence-compat、check:assistant-capabilities、check:author-effects、L2 通过（见提交）。冻结 1.1.0 的 JSDoc 未含 RetiredBlurDescriptor 与 0–450，不影响运行与检查。
