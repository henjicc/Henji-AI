摘要：U13 已按设计收整为 17 个音频效果，复用原 DSP，界面只调整目录、分组和参数条目。
摘要：工程、预设、音频风格件与收藏均有精确迁移；独立审查 1 轮的 2 项重要问题和 1 项小问题全部修复。
摘要：相关测试、音频专项和全部指定门禁通过；任务分支提交 ca3e67f80，未推送，未合并回 main。

# U13 音频整理与合并

- 分支：`task/19-U13-音频`
- 提交：`ca3e67f80b20a47923424f9c5cee38777e16a42e`
- 实现基线：提交前反复执行 `git merge main`，最终吸收至 `d475ecd48`；最后一次新增仅为票据文档，未改变已验证源码。
- 本次精确暂存并提交 49 个文件。任务工作区 Git 状态干净。
- 交付记录按要求写在本文件，未在其他位置创建总结文档。

## 落实范围

目录为：增益与声道、压缩器、限幅器、语音音量级别、噪声门、去齿音、延迟与回声、均衡器、滤波、调制、降噪、去除嗡嗡声、混响、扭曲、人声增强、立体声扩展、音调变换。

分组采用设计第 13 节：振幅与声道、动态、延迟、均衡与滤波、调制、修复、空间、特殊、时间与变调。立体声扩展归振幅与声道。剪辑、口播效果目录与助手目录继续读取同一份定义；未添加专用助手工具，也未改布局、样式或 TSX。

继续使用现有逐样本处理器，包括 RNNoise、RBJ 双二阶滤波、Freeverb、smbPitchShift 与既有动态/调制算法；没有引入依赖或重写算法。预览、导出和口播仍共用音频效果链。方式切换重建状态，数值参数更新保持状态；方式不接受关键帧。预读长度按实际方式选择。

## 精确映射

| 来源 ID | 目标 ID / 方式 | 参数与曲线 |
|---|---|---|
| gain_balance | gain_balance | 原键保留；新增反相默认关闭 |
| polarity_invert | gain_balance | channels → invert |
| compressor | compressor / single | 原键保留 |
| multiband_compressor | compressor / multi | 各键加 multi_ 前缀 |
| delay | delay_echo / delay | 各键加 delay_ 前缀 |
| echo | delay_echo / echo | 各键加 echo_ 前缀 |
| parametric_eq | equalizer / parametric | 各键加 simple_ 前缀 |
| eq_bands | equalizer / parametric | 原键保留 |
| graphic_eq | equalizer / graphic | 各键加 graphic_ 前缀 |
| high_pass、low_pass、notch | audio_filter / 对应方式 | 各键加对应方式前缀及下划线 |
| chorus、flanger、phaser | modulation / 对应方式 | 各键加对应方式前缀及下划线 |

迁移冻结来源默认值；静态参数和曲线一起改键，不重新采样关键帧。效果顺序、开关、强度、自定义名称、曲线控制点与锚点、其他字段保留。默认效果名称按新目录归并；用户自定义名称保持原样。

收藏中的旧 `effect:<ID>` 映射后去重。风格件旋钮根据效果实例引用同步改参数键，映射控制点和量纲不变。转换为纯函数、不修改输入、重复读取不会重复加前缀。

## 持久格式

ticket 13 在实现期间合入 main，占用了原拟使用的版本，并新增可携带音频风格件的风格容器。吸收后顺延登记如下：

| 格式 | main 版本 → U13 版本 | 最低可读版本 |
|---|---|---|
| 剪辑内容 | 48 → 49 | 49 |
| 录制会话 | 51 → 52 | 52 |
| 口播工程 | 6 → 7 | 7 |
| 本机效果库 | 3 → 4 | 4 |
| 剪辑预设包 | 11 → 12 | 12 |
| 风格库 | 7 → 8 | 8 |
| 风格分享包 | 10 → 11 | 11 |

提高最低可读版本的原因相同：旧程序会拒绝新音频 ID，或忽略 mode，把多段压缩等按另一算法解释；这属于已有内容含义变化。各格式的历史支持下限保持不变，既有迁移步骤、发布指纹和历史黄金样本未改写。

每个变化均追加独立版本步骤。黄金样本覆盖所有合并来源、片段/音轨/主轨、录制嵌入基线、口播链、全局预设、风格预设与旋钮。当前样本由正式迁移、schema 和文档外壳构造器产生；历史来源另存于 `tests/fixtures/audio-effect-merge/`。读取只升级内存，明确保存才写新版本；本机库沿 ticket 13 的正式备份与保存入口。

## 独立审查与修复

独立干净上下文只读审查 1 轮，检查共享 DSP、文档与嵌套链、预设读写、曲线与状态切换、收藏及相关规则。

1. 重要：预设仍写旧版本，可能误读算法。已补版本、最低读者、逐版本迁移和黄金样本；合入 ticket 13 后继续覆盖新增的音频风格容器。
2. 重要：mode 允许关键帧，可能逐块重置算法并丢失调制相位。已禁止方式关键帧，原数值参数曲线全部保留，并验证方式切换和参数更新的不同状态行为。
3. 小问题：旧收藏未映射。已按合并关系映射、去重，并验证读取、保存、重开。

合并最新 main 后还补查了旋钮引用的参数键，追加同步迁移与样本。没有再派第二轮审查。

## 验证证据

- `npm run verify:changed -- --level L2 <显式本次文件> --test <直接消费者>`：通过。21 个测试文件、387 项；文件 ESLint、渲染层/Electron 两套 tsc、依赖图、主进程导入边界、持久基线均通过。
- 音频专项：15 个来源 ID，各默认和调整后参数共 30 组；迁移前冻结的 PCM 输出 SHA-256 与迁移后逐位相同，处理延迟不变。执行真实 DSP；另跑正式 `VideoEditRenderer.mixAudio` 的预览/导出、分块、定位及调制相位一致性。
- `npm run check:persistence-compat`：通过，66 种登记格式。
- `npm run check:assistant-capabilities`：结构检查通过；覆盖 15 项、不变量 237 项全部通过。
- `npm run check:skill-sync`：通过，5 个技能、25 个共享文件一致。
- `git diff --check` 和暂存区检查：通过，暂存范围与本次 49 文件精确一致。

类型检查首次遇到 Node 默认 4 GB 堆上限，随后仅为验证进程设置 8 GB 堆，双工程检查通过，未改项目配置。过程中修复了样本时间戳类型、测试残留旧 ID、测试函数参数类型，以及 ticket 13 测试把“未来版本”写死为 4 的问题；未来版本测试已改为从当前版本推导，仍验证未知字段保存。

### L2 命令的显式范围

下列为最终执行范围，PowerShell 执行前先设置 `$env:NODE_OPTIONS='--max-old-space-size=8192'`，再运行 npm 部分：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run verify:changed -- --level L2 resources/assistant-skills/audio-edit-workbench/SKILL.md scripts/generate-persistence-fixtures.ts src/core/audio/effects/audioEffectChain.test.ts src/core/audio/effects/audioEffectChain.ts src/core/audio/effects/audioEffectDefinitions.ts src/core/audio/effects/processors/audioEffects.testSupport.ts src/core/audio/effects/processors/filters.test.ts src/core/audio/effects/processors/processors.test.ts src/core/audio/effects/processors/stereo.ts src/core/audio/essentialSound.test.ts src/core/audio/essentialSound.ts src/core/audioEdit/effectCatalog.ts src/core/audioEdit/effects.test.ts src/core/documents/kinds/audioEdit.ts src/core/documents/kinds/screenRecording.ts src/core/documents/kinds/videoEdit.ts src/core/persistence/persistence.test.ts src/core/persistence/releasedCompatibility.json src/core/persistence/schemaBaseline.json src/core/persistence/schemaVersions.ts src/core/videoEdit/builtinEffects.ts src/core/videoEdit/mergedEffectsMigration.ts src/features/audioEdit/preview/audioEditScrubSource.test.ts src/features/videoEdit/application/videoEditAudioEffects.test.ts src/features/videoEdit/application/videoEditEffectPresets.test.ts src/features/videoEdit/application/videoEditFields.ts src/features/videoEdit/application/videoEditPresetCatalog.ts src/features/videoEdit/engine/videoEditRendererAudioEffects.test.ts src/core/audio/effects/__fixtures__/merge-baseline.json src/core/audio/effects/mergedEffectsMigration.test.ts src/core/audio/effects/mergedEffectsMigration.ts tests/fixtures/audio-effect-merge/audio_edit.json tests/fixtures/audio-effect-merge/video_edit.json tests/fixtures/audio-effect-merge/screen_recording.json tests/fixtures/persistence/document.audio_edit/v7.json tests/fixtures/persistence/document.screen_recording/v52.json tests/fixtures/persistence/document.video_edit/v49.json src/core/videoEdit/presetPackage.ts src/core/persistence/formats.ts src/core/persistence/formatMigrations.ts tests/fixtures/audio-effect-merge/preset_package.json tests/fixtures/persistence/video-preset-package/v12.json src/core/videoEdit/styles/templateSchemas.ts tests/fixtures/audio-effect-merge/effect_library.json tests/fixtures/audio-effect-merge/style_library.json tests/fixtures/audio-effect-merge/style_package.json tests/fixtures/persistence/video-effect-library/v4.json tests/fixtures/persistence/video-style-library/v8.json tests/fixtures/persistence/video-style-package/v11.json --test src/core/audio/effects/audioEffectChain.test.ts --test src/core/audio/effects/processors/filters.test.ts --test src/core/audio/effects/processors/processors.test.ts --test src/core/audio/effects/processors/stereo.test.ts --test src/core/audio/effects/processors/special.test.ts --test src/core/audio/effects/processors/dynamics.test.ts --test src/core/audio/effects/processors/delay.test.ts --test src/core/audio/effects/processors/modulation.test.ts --test src/core/audio/effects/mergedEffectsMigration.test.ts --test src/core/audio/essentialSound.test.ts --test src/core/audioEdit/effects.test.ts --test src/core/persistence/persistence.test.ts --test src/features/audioEdit/preview/audioEditScrubSource.test.ts --test src/features/videoEdit/application/videoEditAudioEffects.test.ts --test src/features/videoEdit/application/videoEditEffectPresets.test.ts --test src/features/videoEdit/engine/videoEditRendererAudioEffects.test.ts --test src/features/videoEdit/application/videoEditStyles.test.ts
```

运行日志保存在任务工作区 `.tmp/u13-verify.log`、`.tmp/u13-persistence.log`、`.tmp/u13-skills.log`、`.tmp/u13-capabilities.log`，均未提交。

## 排查边界与约束

已修复：合并 ID/方式/参数及曲线、预设容器版本、方式动画、收藏、风格件旋钮映射。同源检查覆盖剪辑片段/音轨/主轨、录制基线、口播效果链、基本声音生成、全局与风格预设、正式助手读写入口。模板库未发现本次需要转换的音频风格件结构，保持原版本。

本轮没有过渡代码改动；音频证据是确定性 PCM、真实 DSP 与正式混音函数的数值验证，不代表物理音频设备或主观听感评审。未启动桌面窗口或占用 9334 开发版。未删除 node_modules/FFmpeg 联接点，未执行 npm install/ci/uninstall，未访问 D:\视频制作。重任务串行执行。只提交本任务分支，没有推送或合并回 main。


## 审查修复 1

状态：第 3、4、5、6 条已实现；第 1 条尚未实施，等待身份兼容的设计裁定。本节不表示五条已全部完成。第 2 条说明文案未改。

- 分支仍为 `task/19-U13-音频`，通过 `git merge main` 吸收至 `30bfc826a`，没有合并冲突；没有切分支、合并回 main 或推送。
- 第 3 条：均衡器拆出默认的“简易”方式；“参数”方式只运行参数均衡，“图形 10 段”保持原算法。历史两组参数同时有效的实例迁到显式“简易与参数”方式，保留顺序、混合强度及曲线，声音逐位相同。省略 mode 的历史稀疏参数按原默认 parametric 恢复；当前方式切换不做历史重解释。
- 第 4 条：两处工作区的 design.md 版本表同步 U13 实际版本 49 / 52 / 7、4 / 12 / 8 / 11；本轮方式语义变更另追加到 50 / 53 / 8、5 / 13 / 9 / 12，最低可读版本同步提高。U14 在其上顺延。历史迁移、黄金样本和发布承诺不改写；本轮追加七个正式迁移生成的黄金样本。
- 第 5 条：删除 `audio_stereo` 分组类型和名称，立体声扩展仍归振幅与声道。
- 第 6 条：ModeProcessor 每个实例复用参数投影对象与键对，方式切换时重建；图形均衡也复用同一路径，兼容组合方式的简易投影对象只创建一次。没有新依赖或另写 DSP。

第 1 条待裁定的原因：字幕侧车的 sequence signature 与口播逐阶段缓存只有哈希，无法从哈希反解迁移前的参数表示，仅改写工程里的文字稿绑定不能同时保住它们。已向用户提出保留迁移来源快照、声音参数未改时沿用原身份的方案；它会增加可选持久字段，因此按“改设计方向才停下”的约束等待确认，没有擅自实施。原裁定的重算并改写方案也可继续，但需要扩大到存储适配与侧车/缓存迁移边界。

独立审查两轮：第一轮两个重要问题（稀疏 mode、隐藏简易增益）已修复并加回归；第二轮指出移除通用迁移会连带删除视觉旧效果兼容，已撤回该移除，预设目录文件及视觉迁移文件恢复原行为。没有未处理的审查重要问题；第 1 条仍是明确未完成项。

验证记录：精确测试 8 文件 329 项通过；最终 L2 的音频、持久迁移、共享处理器、基本声音、口播、剪辑助手读写、风格件与正式混音共 18 文件 384 项通过。音频专项包括原 15 个来源的默认/调整参数 30 组 PCM SHA-256 逐位等价，以及新简易方式的均衡迁移、稀疏参数、曲线与方式切换。最终显式 26 文件的 L2 全套通过（ESLint、双工程 tsc、依赖图、主进程导入、持久基线）；`check:persistence-compat` 通过（66 格式），`check:assistant-capabilities` 通过（覆盖 15 项、不变量 237 项）。没有降低任何门槛。

排查覆盖剪辑片段/音轨/主轨、录制基线、口播效果链、全局预设与风格预设、共享 ModeProcessor 全部方式。没有启动桌面或占用 9334，没有操作联接点、安装依赖或访问 D:\视频制作。日志在任务工作区 `.tmp/u13-review-*.log`，不提交。

分支追加提交：`c4b204c78`（`fix(audio): 拆分均衡方式并复用参数投影`）。提交范围精确 26 文件，提交后任务工作区干净；未推送。第 1 条待用户裁定，因此本次不是五条全部完成的交付。

## 审查修复 2

状态：第 1 条已按 11-01 裁定完成。迁移保存迁移前的音频效果表示作为身份别名，字幕侧车、嵌套文字稿及离线处理缓存接受当前或历史身份。只在完整 builtin 参数和曲线仍匹配迁移结果时使用别名；实际参数、曲线、时序、源素材或混音变化使相关历史匹配失效。没有改变声音算法、说明文案或依赖。

实现复用既有音频内容投影、正式 DSP、文档逐版本迁移和缓存发布入口。两次等声迁移按历史时点回溯，最多比较当前与两个历史表示，不展开逐效果的别名组合。基本声音生成的高通、均衡也保留来源表示；轨道及主轨保留别名供身份投影使用。重新识别时在文字稿合并入口合并当前与历史等价身份，保留局部覆盖语义，避免旧词源遮蔽新词。内容索引、停顿读取与转录恢复中的共享比较同步接入。

### 可选字段与格式登记

本轮仅新增可选字段；旧字段、迁移步骤、历史黄金样本、既有发布指纹及支持下限均保留。版本在 main 与上一轮 U13 已用编号之后顺延；最低可读版本不提高。字幕回填记录包含完整片段，因嵌套 schema 同样需要登记。

| 格式 | 当前写出版本 | 最低可读版本 |
|---|---:|---:|
| 剪辑内容 | 51 | 50 |
| 录制会话 | 54 | 53 |
| 口播工程 | 9 | 8 |
| 本机效果库 | 6 | 5 |
| 剪辑预设包 | 14 | 13 |
| 风格库 | 10 | 9 |
| 风格分享包 | 13 | 12 |
| 字幕回填记录 | 25 | 24 |

八个新黄金样本由正式构造器、迁移与 schema 生成，发布承诺只追加。兼容目标是读取迁移前内容时记录当时的身份；本轮没有从已经丢失来源表示的历史哈希反解参数，也没有另建文件系统修复通道。

### 验证与失败修复

- 合并 main 后执行 `npm run verify:changed -- --level L2 <本分支全部 85 个显式文件> --test <直接消费者>`：全部通过。31 文件、527 项精确测试；文件 ESLint、渲染层与 Electron 两套 tsc、依赖图、主进程导入、持久基线全部通过。完整命令在 `.tmp/u13-identity-verify-final.log`，文件清单在 `.tmp/u13-identity-verify-files-final.json`，明确选择的测试在 `.tmp/u13-identity-verify-tests.json`。
- 音频专项包含在上述测试中：原 15 个来源 ID 的默认/调整参数共 30 组 PCM SHA-256 逐位等价、延迟不变；正式 `VideoEditRenderer.mixAudio` 的预览/导出、分块和定位一致性通过。
- 新回归冻结实际迁移前版本的两份声音身份（`ca3e67f80^` 与 `ca3e67f80` 源码生成），覆盖启用的片段效果、曲线、轨道、主轨和基本声音。嵌套文字稿与内容索引继续绑定，保存重开后保持匹配；真实声音变化拒绝旧身份，重转录读回新词。
- 字幕回填使用已识别内容及历史侧车签名，保存重开后恢复成功，没有再次调用识别。口播以迁移前、均衡方式拆分前、当前三个时点的实际缓存文件验证逐阶段命中，重命名、剪切及重开不处理；参数变化仅重算受影响阶段。历史缓存命中时效果 Worker 与口水音处理调用数均为零。
- 断牙：仅在临时 Vitest 转换配置中禁用别名回溯，2 文件中 5 项失败、1 项通过，失败指向冻结身份/文字稿绑定和历史缓存重算；正式实现相同 6 项全部通过。未改正式源码或门槛。日志为 `.tmp/u13-identity-red.log`、`.tmp/u13-identity-green.log`。
- 合并后的 `npm run check:persistence-compat`：通过，66 格式；`npm run check:assistant-capabilities`：结构检查、15 项覆盖、31 文件 237 项业务不变量通过。日志为 `.tmp/u13-identity-persistence-final.log`、`.tmp/u13-identity-capabilities-final.log`。
- 验证中修正了原测试把最低读者钉死为写出版本的断言，保留拒绝迁移前算法读者的保护；修正贝塞尔回归的元组类型。没有降低格式、音频或类型门槛。`git diff --check main` 通过；主线冻结 LICENSE 的原有 CRLF 字节保持原样，没有为暂存区的行尾提示改写冻结发布物。

### 独立审查与实际排查范围

独立干净上下文共审查三轮，第二、三轮仅审增量。重要问题两项已处理：历史词源遮蔽重转录结果，在正式合并入口修复并补回归；部分曲线字段被当作元数据忽略，收回该放宽，最终别名 guard 比较完整 builtin（含 bezier、easeValues），并验证控制柄、裁剪锚点及曲线值修改均拒绝历史别名。

已修复并验证的共享范围：剪辑片段/音轨/主轨、嵌套序列、基本声音、录制内嵌基线、口播有序效果链、字幕侧车、文字稿读取与重新合并、内容索引、停顿读取比较、全局预设和风格容器。没有为这些入口复制第二套身份或处理链。

另发现原有问题：`src/core/videoEdit/audioContent.ts::points` 的当前声音身份投影未包含 `bezier`、`easeValues`，仅编辑这些控制信息可能不改变当前签名。这是本轮引入前的另一条签名失效缺陷，未并入本轮迁移表示兼容修复；本轮别名 guard 没有忽略这两个字段。物理音频设备、主观听感及真实窗口未验收，本轮证据为确定性 DSP、正式混音及正式领域入口的精确测试。

### 提交与约束

- 修复提交：`0656bf8ae`（`fix(audio): 保留等声迁移前的绑定与缓存身份`），在 `c4b204c78` 后追加，43 文件。
- 随后执行 `git merge main`，吸收至 `d529d407f`（含 ticket 12、15、21）。唯一内容冲突在混音测试：保留 U13 的 `equalizer` ID，并采用 main 的渲染器 options 构造接口；合并结果已完成上述最终验证。
- 合并提交：`5e5d0d55a`（`chore(video-edit): 合并主线并适配音频混音验收`）。分支保持 `task/19-U13-音频`，工作区干净；未切分支、未合并回 main、未 push。
- 只向主工作区本目录的既有 result 追加本节；没有改说明文案、操作 D:\视频制作、占用或重启 9334 开发版，没有删除 node_modules/FFmpeg 联接点，没有执行 npm install/ci/uninstall。

## 审查修复 3

状态：按 11-01 合并前裁定完成未发布版本收拢。每种格式相对 main 只升一次，唯一的 N→N+1 步骤完成效果合并、均衡方式拆分与身份别名；没有改声音算法、界面、定稿说明文案或依赖。

### 格式版本与最低可读版本

本轮基准 main 为 `fde2179032018130839556e6dc3a94849b6f95d1`。最低可读版本按合并后的效果含义设为新版本；兼容起点与历史支持下限保持不变。

| 格式 | main → 新版本 | 最低可读版本 |
|---|---:|---:|
| 剪辑内容 document.video_edit | 48 → 49 | 49 |
| 录制会话 document.screen_recording | 51 → 52 | 52 |
| 音频编辑 document.audio_edit | 6 → 7 | 7 |
| 字幕回填记录 subtitle-manifest | 24 → 25 | 25 |
| 本机效果库 video-effect-library | 3 → 4 | 4 |
| 剪辑预设包 video-preset-package | 11 → 12 | 12 |
| 风格库 video-style-library | 7 → 8 | 8 |
| 风格分享包 video-style-package | 10 → 11 | 11 |

- 删除本分支新增的 14 个未发布中间样本；七种收拢后的样本由 `scripts/generate-persistence-fixtures.ts` 经正式迁移重新生成，字幕 v25 同样用该工具核对生成，业务内容保持一致。八种受影响格式都是 JSON，没有需要新增的归档格式样本，因此未改写 `generate-persistence-packages.ts` 管理的已有包样本。
- `tests/fixtures/audio-effect-merge` 的七份来源样本本来即对应 main 的 48 / 51 / 6 / 3 / 11 / 7 / 10，逐份核对后保留，不能把迁移前的效果表示标成迁移后版本。目标样本与测试通过当前格式版本动态定位到 49 / 52 / 7 / 4 / 12 / 8 / 11；原有全部 ID、参数、曲线、旋钮与声音身份覆盖保留。
- 从 main 的基线与发布承诺出发执行 `npm run persistence:baseline`、`npm run persistence:release-snapshot`，全程使用 `HENJI_PERSISTENCE_RELEASE_REF=main`；没有手改指纹。逐项核对每种格式只追加一个 versions/readers 条目和一个样本摘要，main 的全部历史承诺及旧样本保持不变。七份新样本的业务内容及身份别名与收拢前最新样本完全相同，仅格式版本戳调整。
- 最终 `git diff main...HEAD -- tests/fixtures/persistence` 恰为八个新增样本，每种格式一个，无 main 旧样本修改或删除。

### 验证、排查与审查

- L2 理由：本轮改变共享持久格式与迁移链，需要直接消费者精确测试、双工程类型检查和持久化专项。最终 `npm run verify:changed -- --level L2 <本次显式 32 文件> --test <直接消费者>` 全部通过：27 文件、488 项精确测试、改动文件 ESLint、渲染层和 Electron 两套 tsc、持久化基线。完整命令与输出：`.tmp/u13-collapse-verify-final.log`；显式文件清单：`.tmp/u13-collapse-files.json`。
- 音频专项包含于上述精确测试：15 个来源 ID、默认与调整参数共 30 组 PCM SHA-256 逐位等价及延迟不变；均衡方式、稀疏参数、混合强度、曲线、切换、正式混音的预览/导出/分块/定位继续通过。历史身份、嵌套文字稿、内容索引、字幕恢复不重识别、逐阶段缓存不重处理及真实声音变化后的失效测试均通过。
- 合并 main 后再次执行 `HENJI_PERSISTENCE_RELEASE_REF=main npm run check:persistence-compat`，66 种格式通过；日志 `.tmp/u13-collapse-persistence-final.log`。`npm run check:assistant-capabilities` 全部通过：结构检查、15 项覆盖、31 文件 237 项业务不变量；日志 `.tmp/u13-collapse-capabilities.log`。`git diff --check main...HEAD` 通过。
- 首次直接用 Node 加载黄金样本生成器时缺少 `import.meta.env`，改用项目 vite-node 执行正式生成器后通过。首次类型检查命中 Node 默认约 4GB 堆上限，临时设置 `NODE_OPTIONS=--max-old-space-size=8192` 后从头完成 L2 验证；没有修改依赖、门槛或项目配置。
- 自查修正字幕格式仍保留的最低可读版本 24，将其设为裁定要求的 25，并用正式脚本重建基线与发布快照后重验。独立干净上下文审查两轮，第二轮仅审该增量及生成结果；无遗留重要或小问题。
- 实际排查覆盖三种文档、字幕回填记录、本机收藏与效果库、预设导入、风格库及风格包，以及片段/音轨/主轨/基本声音、嵌套序列、文字稿、字幕恢复和离线缓存的共享迁移调用方，未发现其他同源版本遗漏。物理音频设备、主观听感和真实窗口不在本轮纯格式收拢验收范围；未运行或占用 9334 开发版。

### 提交与合并

- 修复提交：`7ee2d395b`（`fix(persistence): 收拢音频格式的未发布迁移版本`），精确提交上述 32 文件。
- 最后执行 `git merge main`，吸收 `fde217903` 的进度更新；无冲突，仅合入一份进度文档，不影响已验证运行代码。合并提交：`4378e7f7e`（`chore(video-edit): 合并主线进度更新`）。
- 分支保持 `task/19-U13-音频`，任务工作区干净；没有切分支、合并到 main 或 push。主工作区仅向本目录既有 result 文件追加本节；没有操作 node_modules/FFmpeg 联接点、执行 npm install/ci/uninstall 或访问 D:\视频制作。定稿音频效果说明与 `b96a9a264` 的对应文件一致。
