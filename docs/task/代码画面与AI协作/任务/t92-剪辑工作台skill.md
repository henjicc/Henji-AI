# t92 剪辑工作台 skill

## 范围与状态

新增内置 video-edit-workbench 操作说明、七份按需参考、唯一准入名单与三份精确测试；普通剪辑和跨工作区串联用本技能，代码画面仍用 video-edit-code-creation。仅复用现有正式领域能力，没有改业务实现、权限或付费审批。待总管理者审查与提交；本任务不执行 Git 写操作，不启动 Electron，不跑 Reality，不发生真实付费调用。

覆盖分级为“覆盖核对”：新增可发现的技能说明入口，业务实体、操作、稳定引用和执行链均不新增。内置 Pi 与外部 MCP 共用 agentSkillIndex/loadAgentSkill，正文与参考沿已有注册表按需读。electron-builder.yml 已递归打包 resources/assistant-skills，paths.ts 已分别定位开发/安装目录，无需增加第二份资源清单。

## 原文篇目对照与选型

原文只读，位于 `D:\VibeCode\AEPR控制测试\packages\knowledge\guides\`。

| 原篇目 | 提取方法 | 本项目落实 |
| --- | --- | --- |
| index.md | 入口短、原则、铁律、按阶段路由 | SKILL.md：七篇路由、标准流程、真实契约铁律；删除强制风格、强制停下来确认及自动建制作说明 |
| pr/editing.md | 序列轨道、命名、整理、修剪与速度 | timeline.md：通用实体、实际轨道号、嵌套/链接/标记；不搬QE/ExtendScript/固定PR索引 |
| pr/editing.md + direct/structure.md | 先粗排全片后精修、动作/语义/声画切点 | rhythm.md：多种风格刻度、场景批量应用、文本剪辑、多机位候选；不强制两秒钩子和定时换镜 |
| pr/editing.md | 配乐、回避、响度、口播气口 | sound.md：线性音量、同源回避/测量/标准化/静音检测，区分片段/混音PCM/最终编码证据 |
| recipes/captions.md | 分段、阅读、字幕与强调分工 | captions.md：正式识别/免费整理/付费翻译、原生字幕通用样式；花字和人名条代码转去t91技能，不搬MOGRT |
| pr/editing.md | 调色和转场意图 | color-transitions.md：全能调色、统计建议/参考匹配、已有LUT、HSL、真实内置与shaders目录；不搬Lumetri索引或固定硬切优先 |
| pr/editing.md + direct/review.md | 导出规格、三遍审查、回读结果 | deliver.md：正式预设/半开范围/队列/竖版/收录；不编造ProRes、VBR双次编码、成片复测工具 |
| cross-app.md | 先固定源目标、稳定身份、恢复避免重复插入 | cross-workspace.md：生成/画布/图片/口播到剪辑、剪辑到图片/画布、原地生成审批与落位；不搬Dynamic Link/matchName/AE桥接 |

选型：沿用t91已有Markdown分层资源、正式registry和Vitest契约测试，不引入新的技能加载器、流程引擎或依赖。原手册提供方法，项目的toolCatalog、BUILTIN_APPLICATION_CAPABILITY_REGISTRY和createVideoEditRegistrations提供唯一接口事实；开源通用工作流引擎不能替代已有领域schema与审批，因此没有新增自研运行算法或第三方运行依赖。shader效果只指导发现并使用项目已经接入的目录，不重新移植或编写渲染代码。

## 能力核对表

核对依据：`electron/main/services/application-runtime/toolCatalog.ts`、`src/core/application-control/builtinApplicationCapabilityRegistry.ts`、`src/features/videoEdit/application/videoEditReflection.ts`；参数细节读取其引用的正式领域能力声明与videoEditFields。契约测试反向枚举工具、事务种类及完整多级video_edit属性，JSON样例逐个使用该工具正式Zod输入校验，不维持技能专用schema。

| 操作 | 真实入口 / 关键契约 |
| --- | --- |
| 发现/读写 | list_documents；describe_application_contract / describe_application_entities / list_application_entities / read_application_entity / change_application_entities；Pi延迟披露load_application_tools |
| 普通结构 | video_edit.sequence/bin/item/track/clip/marker集合；create_items/set_properties/remove_items；轨道index/kind只读，时间线整数帧、源微秒 |
| 拆分/修剪/速度/嵌套 | split_video_edit；trim_video_edit_clip的mode/edge/frames；ripple_video_edit_clip_speed的speedPercent与durationFrames二选一；nest_video_edit_clips |
| 关联与时序 | clip.link_id/group_id、track.locked/sync_locked、document.timeline_view；普通duration是修剪，不是保持源内容变速 |
| 场景 | detect_video_edit_scenes → apply_video_edit_scenes，消费analysisId与split/markers/subclips，不逐点重放 |
| 按文本剪 | sequence.transcript/text_silences；ripple_delete_video_edit_text / extract_video_edit_text / insert_video_edit_text；词索引含首尾，语义选择由助手读稿完成 |
| 多机位 | create_video_edit_multicam（cameras、sync、audioCameraIndex）→ 通用片段插入；auto_switch_video_edit_multicam；clip.multicam_camera_id |
| 音量与回避 | clip.audio_role/volume/fade_in_frames/fade_out_frames/volume.keyframes；generate_video_edit_audio_ducking（musicClipRefs/settings） |
| 响度 | measure_video_edit_loudness / normalize_video_edit_loudness，clipRefs与targetLufs；export_video_edit的整片loudness与queue测量 |
| 停顿/语气词 | detect_video_edit_text_silence → ripple_delete_video_edit_text的silence/fillers；不能从字幕空格推静音 |
| 字幕 | prepare_video_edit_subtitle_audio → generate_video_edit_subtitles；segment_video_edit_subtitles；translate_video_edit_subtitles；caption.text/start/duration/translation/style与subtitle_preset；字体实体实际为font |
| 全能调色 | effect.definition_id=effect:color_grade，effect.parameters/frame_curves；analyze_video_edit_color自动建议或referenceClipRef匹配；document.color_luts只读 |
| 转场 | builtin_effect的transition目录 → transition集合kind/duration_frames/两端ID/alignment/frames_before_cut，具体shaders后缀从目录取 |
| 导出与竖版 | export_video_edit / query_video_edit_export / cancel_video_edit_export；export_preset；auto_reframe_video_edit（sequenceRef/clipRef二选一） |
| 结果收录 | collect_video_edit_output消费完成导出id/taskId，或当前已暂停节目帧；导出队列assetRef可直接复用 |
| 跨工作区 | place_video_edit_creative_result的document/generation/asset来源与placement联合；来源文档为documents.document，不冒充video_edit引用 |
| 节目帧外流 | send_video_edit_to_canvas的frame/clip联合；edit_video_edit_program_frame返回原目标与会话，回填原样使用frameEditSessionRef/returnPlacement，图片时长1帧 |
| 原地生成 | prepare_video_edit_in_place_generation → 正式审批 → generate_video_edit_in_place → wait_generation_task → get_video_edit_in_place_generation；cancel_generation_task；restore_video_edit_clip_take |
| 恢复/证据 | get_application_operation；save_video_edit；undo_video_edit/redo_video_edit；observe_video_edit_frame → read_application_media，不把附件引用当已看图 |

JSON样例覆盖字幕分段、多项导出、生成历史结果落位；均明确引用为占位，实际调用替换为发现结果，外部写入另带operationId。示例只验证schema，不声称对虚构引用执行过业务。

## 建议补的能力与说明债务

本任务只登记建议，不改业务源码或扩权限。

1. 任意无转录范围的波纹删除／全轨共同间隙整理：界面命令有范围和删除流程，但现有公开目录没有对应独立范围算法入口。不要让模型手算所有后续片段。现有文本波纹删除、波纹修剪和波纹变速仍照其真实语义使用。
2. LUT导入：document.color_luts只读，现有公开能力目录没有独立LUT导入入口；技能只使用已导入LUT，缺少时说明用户界面路径或使用已有参数。
3. 最终编码文件审查：现有节目离屏取帧与导出PCM响度报告不能证明最终编码成片的字幕、音画、AAC真峰值；建议沿正式导出任务结果提供成片取帧及编码后响度复测，不另开文件或网络旁路。
4. 能力说明陈旧：场景应用description仍出现500项上限，但sceneApplyOptionsSchema/sceneCutsSchema及applyVideoEditSceneCuts已无该上限；输出changedRefs仍有max(1500)的契约预算，应另行检查大批量结果的投影，不在技能自行截断素材。建议总管理者另行处理能力文案与大批量输出。本任务不动业务实现。字幕翻译原文单行已核对videoEditBilingualSubtitles.ts，仍是现有翻译执行器约束；普通字幕行数不设产品上限，技能只对双语流程指导maxLines=1。

## 设计自查

1. **助手只凭名称和说明能否用对？** 能：首轮description明确普通剪辑/跨工作区触发与代码创作分流；每篇先写何时读，再写选择条件、真实工具/属性、单位、引用与回读。契约测试核对名称和完整属性；三份样例使用正式schema。仍需真实模型任务验证语义选择质量，静态测试不保证模型一定选中。
2. **能否AI先做、人只确认？** 能：助手先做场景/停顿/多机位/回避/校色/重构候选，先粗剪再局部返修；用户校正语义、表演、听感与风格，不从零填参数。付费审批由正式宿主负责，不能由技能代替；用户已授权直接做完时不额外增加审美确认。
3. **产物能否直接流进其他工作区？** 能：place_video_edit_creative_result复用生成、画布、图片文档、口播、资产；send_video_edit_to_canvas与图片编辑帧会话保留实际引用和原目标；成片assetRef继续供已有正式消费方使用，不搬原始路径。

## 创意自由自查

逐句检查是否会导致不同项目千篇一律：未沿用原文“默认硬切”“每2–4秒变化”“两秒钩子”“只能两款字体”等强制审美；所有镜头、字幕、音量、淡化、Look与转场刻度均为尝试起点，明确快剪、长镜头、纪录、广告、综艺的例外与取舍。没有固定评分门槛或迭代次数上限。铁律只约束真实schema、授权、引用、恢复及证据真实性；没有额外审批、素材数量上限或自动文档流程。

## 验证记录

按testing.md的有界L2：新增可供Pi/MCP读取的注册资源，需验证两端加载/停用/路径与输入契约；未改变公共业务执行链，不升级全量或Reality。由于新增src/core测试，按本任务要求跑双工程tsc；注册名单位于electron/main，同时跑main-imports与四个改动TS文件eslint。

- 首轮：三份精确测试13项通过、2项失败。发现字体实体不是video_edit.font，已改为font；旧停用测试全文检索技能名误命中其他技能description中的路由，已改为检查索引name字段。
- 修正后：`npx vitest run src/core/application-control/domains/assistantSkill/videoEditWorkbenchSkill.test.ts electron/main/services/embedded-agent/skills.test.ts --silent`，3项契约＋7项Pi测试通过；`electron/main/services/mcp/skills.test.ts`首轮5项通过，复用有效协议/加载证据，合计15项通过。主文件5035字节，七篇参考均小于8KB，三份JSON样例正式schema通过。
- `npx eslint electron/main/services/assistant/skills/agentSkills.ts electron/main/services/embedded-agent/skills.test.ts electron/main/services/mcp/skills.test.ts src/core/application-control/domains/assistantSkill/videoEditWorkbenchSkill.test.ts --report-unused-disable-directives --max-warnings 0` 首轮通过；改过停用断言的Pi测试文件再次文件级eslint通过。`npm run check:main-imports`通过（扫描574个main/preload文件），相关已跟踪文件`git diff --check`通过。
- 渲染层 `npx tsc -p tsconfig.json --noEmit` 失败：`src/services/presets/PresetService.ts:141`，TS2322，`string | null | undefined`不能赋给`string | undefined`。该文件不是本任务改动，当前git diff显示并行持久化schema接入；归因与修复由总管理者处理。本任务未改它或SDK，不声称全工程类型检查通过。
- Electron `npx tsc -p tsconfig.electron.json --noEmit` 首轮通过；修改Pi测试后复查失败于并行新增的 `electron/main/services/documents/persistence-upgrade.test.ts:17`，TS2322，migrations的联合分支含可选undefined索引，不能赋给DocumentKindDescriptor要求的只读迁移函数字典。该文件属t94范围，本任务未修改；最终Electron工程类型检查存在共享工作区阻塞，不用首轮通过覆盖最新失败。

## 本任务文件清单

- resources/assistant-skills/video-edit-workbench/SKILL.md
- resources/assistant-skills/video-edit-workbench/references/timeline.md
- resources/assistant-skills/video-edit-workbench/references/rhythm.md
- resources/assistant-skills/video-edit-workbench/references/sound.md
- resources/assistant-skills/video-edit-workbench/references/captions.md
- resources/assistant-skills/video-edit-workbench/references/color-transitions.md
- resources/assistant-skills/video-edit-workbench/references/deliver.md
- resources/assistant-skills/video-edit-workbench/references/cross-workspace.md
- electron/main/services/assistant/skills/agentSkills.ts
- src/core/application-control/domains/assistantSkill/videoEditWorkbenchSkill.test.ts
- electron/main/services/embedded-agent/skills.test.ts
- electron/main/services/mcp/skills.test.ts
- docs/task/代码画面与AI协作/00-任务总览.md（只追加t92行）
- docs/task/代码画面与AI协作/任务/t92-剪辑工作台skill.md
- docs/rules/assistant-status.md（新增技能可发现/可读的证据索引，未宣称新业务能力）
