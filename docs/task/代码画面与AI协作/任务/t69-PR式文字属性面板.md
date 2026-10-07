# t69 PR式文字属性面板

状态：2026-10-08 已实现，待总管理者审查；不执行 Git 写操作。精确验证、两工程tsc、显式文件eslint及本任务相关静态门禁通过。未运行 Electron、Reality、真实 Pi/MCP 或付费模型，不宣称真实桌面验收通过。

## 设计自查

1. 助手只凭名称和说明能否用对？能。共享样式通过 clip.text_style、graphic_object.text_style、caption.style 和 title_template.definition 公开，schema/字段说明标出单位、枚举、范围与画幅换算；video_edit.text_preset 沿通用实体读改增删，不新增设置型工具。JSON属性整体替换，先读完整对象再修改。
2. 能否 AI 先做、人只确认？能。助手可读取当前样式和本机预设，修改/应用共享样式；用户在同一面板预览、微调和撤销。复杂文字排版与外观由同一渲染器完成，不新增模型付费调用。
3. 产物能否直接流进其他工作区？能沿既有节目帧观察、导出与资产流转入口消费新样式；文字/图形仍是可编辑项目数据，标题模板/预设可继续应用。本任务未新建跨工作区转移流程，也未实跑导出/跨工作区往返。

## 实现与覆盖分级

- text.ts 是唯一样式 schema。图形、字幕和标题复用；删除旧字体/颜色/锚点字段及字幕重复描边图形，不做旧数据兼容。
- 文字排版支持家族/字形、仿粗斜、大小写、上下标、下划线、段落/垂直对齐、字距/字偶距、行距/基线/tsume；外观支持填充、多层内/外/居中描边、圆角背景、多阴影。未做可选RTL、制表符、文本蒙版、渐变和中文竖排。
- 字体家族直接使用 t63 UiFontPicker；完整字形别名以400/normal加载文件内字形，避免重复合成。吸管使用 EyeDropper API，取消不写入；浏览器不支持时面板提供明确错误。
- 四宿主共用 VideoEditTypographyPanel；文字/图形复用已有关键帧行与可拖动数值控件。字幕/模板参数隐藏无意义的变换组。图形沿已有对象列表增加眼睛开关，不复制图层列表。现有运动为等比缩放，链锁表示当前约束，未新增独立X/Y比例模型。
- UI、Pi和MCP共用领域编辑与通用实体：共享字段扩展属现有实体覆盖；本机文字预设属新增实体/通用集合覆盖；自定义标题definition原为只读，补齐通用写入。内置标题/字幕目录仍只读。目标样式应用进入项目撤销栈，本机预设库维护不进入项目编辑历史，公共事务可补偿/撤销。
- 本机预设复用 t68 VideoEditLocalLibrary 的统一存储、日志与关闭写屏障；先存储成功才发布，损坏数据不覆盖。数组不设产品数量上限；32项/8项是单次公共事务批量，目录分页，不限制库存总数。
- 字号/空间属性8192像素上界与既有最大画幅边长对应；字体权重等采用真实CSS范围。原逐字形GPU路径预算已失效，删除预算实现及调用；字幕三行和模板行数/库存数量限制移除。
- 预览、导出、离屏取帧共用既有 compositor/codeSources 链路；文字片段和含复杂文字的图形先画原生 Canvas 遮罩，缓存为 ImageBitmap，再由既有GPU纹理缓存消费。只含形状的图形维持原路径；字体资源实际加载/释放改变缓存签名。属性不变、播放或片段运动不重画文字。
- 描边按外延由大到小绘制：外侧 destination-out 去掉字形，内侧 destination-in 与字形相交，居中使用真实居中宽度；多阴影独立合成。排版未改动字形推进时保持原生整段 shaping，否则用字素边界计算推进。
- 选型依据：查阅 [Fabric Text API](https://www.fabricjs.com/api/classes/fabrictext/)、[Konva Text](https://konvajs.org/api/Konva.Text.html)、[Konva Shadow](https://konvajs.org/docs/styling/Shadow.html) 和 [描边性能建议](https://konvajs.org/docs/performance/Optimize_Strokes.html)。现成文本对象主要使用单描边/阴影，内外多层仍需遮罩扩展；本项目已有文本布局、项目事务与GPU纹理缓存，引入第二套对象/事件系统不能直接解决契约。因此保留原生Canvas shaping，补齐必要遮罩合成并复用现有缓存，未新增第三方依赖。

## 精确验证

验证级别L2：共享公共模型、四宿主直接消费者、本机持久化与通用事务。以下均静音精确Vitest，未使用 related、全量测试或 Reality；同一代码通过后不重复扩大范围。

- core：text.test.ts 5项、graphics.test.ts 9项、titleTemplates.test.ts 4项、fonts.test.ts 2项、autoSubtitles.test.ts 10项通过。
- engine：videoEditTextSurface.test.ts 4项、videoEditGpuCompositor.test.ts 15项、videoEditTypographyCache.test.ts 1项通过；videoEditCodeSources.test.ts 20项有效证据通过。并行t68绑定最初使固定program缓存用例失败，对方修复无风格时保持program身份后该项定向复验通过，另19项全文件运行通过。
- platform：fontFaces.test.ts 3项通过。
- application：videoEditGraphicTextBudget.test.ts 1项、videoEditTitleDescription.test.ts 4项、videoEditSubtitleCompletion.test.ts 9项、videoEditAutoSubtitles.test.ts 16项、videoEditTextPresets.test.ts 1项、videoEditTitleTemplates.test.ts 4项通过。
- panels：VideoEditTypographyPanel.test.tsx 2项、VideoEditTypographyHosts.test.tsx 4项、VideoEditTextOverlay.test.tsx 12项、VideoEditSubtitleFont.test.tsx 1项、VideoEditTitleTemplatesPanel.test.tsx 2项、CodeParameterPanel.test.tsx 14项通过。
- 能力：applicationControlCoverage.test.ts、propertyCoverage.test.ts、collectionCoverage.test.ts 共25项通过；check:assistant-capabilities:structure通过。完整check:assistant-capabilities聚合还包含跨领域不变量套件，按本任务不扩大测试要求未跑完整聚合。
- 两套tsc与本任务显式文件eslint通过。标题schema说明补充后的渲染层复验曾被t68的videoEditStyleReference.test.ts:24阻塞（kind:'media'不属于项目项类型）；对方改为kind:'image'后，仅重跑失败检查并通过，未修改该并行测试。标题core/应用/描述三文件最新12项复验通过。
- check:surface、check:icons通过。
- check:colors最终通过。最初失败源于t68的styleKitPresets.ts新增38处rgb字面量及VideoEditStyleKitPreview.tsx的bg-surface旧/无效令牌；对方改用集中颜色常量和bg-raised后定向重跑门禁通过。本任务未修改这些并行文件，也未被颜色门禁报告。
- 标题通用写入新增测试曾提交半份样式导致补默认值后与整体替换验证不相等；改为提交完整schema结果后通过。保留完整替换约定，不把部分JSON写入宣称为受支持的补丁。

## 修改文件清单

- `src/core/videoEdit/text.ts`：定义唯一文字样式、原生字形度量、分行和空间缩放。
- `src/core/videoEdit/text.test.ts`：覆盖样式契约、字距、行距、基线、大小写和空间缩放。
- `src/core/videoEdit/graphics.ts`：文字对象复用共享样式，并增加可见性、比例和锚点变换。
- `src/core/videoEdit/graphics.test.ts`：验证共享文字对象、可见性和变换绘制。
- `src/core/videoEdit/subtitleStyle.ts`：字幕复用共享样式并生成单个多行文字对象。
- `src/core/videoEdit/titleTemplates.ts`：标题模板改用共享样式，换算源画幅及1080p参数空间量。
- `src/core/videoEdit/titleTemplates.test.ts`：验证模板字体样式、组合缩放与多行标题。
- `src/core/videoEdit/fonts.ts`：字体收集读取文字对象的共享样式。
- `src/core/videoEdit/fonts.test.ts`：验证四类宿主的字体收集。
- `src/core/videoEdit/timedContent.ts`：字幕解析改用共享样式并移除三行限制。
- `src/core/videoEdit/autoSubtitles.test.ts`：验证多行字幕整理和原有识别边界。
- `src/core/application-control/domains/videoEdit/videoEditTitleTemplateCapabilities.ts`：更新标题能力参数说明，使用统一textStyle。
- `src/features/videoEdit/engine/videoEditTextSurface.ts`：实现原生文字遮罩、多层内外描边、多阴影及排版渲染。
- `src/features/videoEdit/engine/videoEditTextSurface.test.ts`：验证描边合成指令、阴影层、排版、大小写和背景。
- `src/features/videoEdit/engine/videoEditGraphicSurface.ts`：为含复杂文字的图形绘制共享离屏位图。
- `src/features/videoEdit/engine/videoEditCodeSources.ts`：缓存图形文字位图并在样式或字体资源变化时失效。
- `src/features/videoEdit/engine/videoEditGpuCompositor.ts`：文字片段纹理缓存纳入完整样式与字体资源版本。
- `src/features/videoEdit/engine/videoEditCompositeProbe.ts`：观察探针兼容图形位图与代码图形。
- `src/features/videoEdit/application/videoEditService.ts`：移除已失效的旧字形绘制预算入口。
- `src/features/videoEdit/application/videoEditGraphicTextBudget.ts`：删除旧逐字形绘制预算实现。
- `src/features/videoEdit/application/videoEditGraphicTextBudget.test.ts`：改为验证新文字契约的发布、撤销和非法输入拒绝。
- `src/features/videoEdit/application/videoEditProgramText.ts`：文字创建使用verticalAlign共享属性。
- `src/features/videoEdit/application/videoEditGraphics.ts`：统一图形文字样式和可见性编辑及手势事务。
- `src/features/videoEdit/application/videoEditCompositeEntities.ts`：图形文字实体创建/修改共用共享样式校验。
- `src/features/videoEdit/application/videoEditFields.ts`：公开全部共享样式、图层可见性及单位范围说明。
- `src/features/videoEdit/application/videoEditReflection.ts`：登记文字预设并按对象类型公开文字样式。
- `src/features/videoEdit/application/applicationDomain.ts`：接入文字预设与标题模板通用事务，独立本机库不触发项目保存。
- `src/features/videoEdit/application/videoEditTextPresets.ts`：实现共享本机文字预设库与持久化CRUD。
- `src/features/videoEdit/application/videoEditTextPresetReflection.ts`：通过通用实体提供预设读取、创建、修改、删除与回滚。
- `src/features/videoEdit/application/videoEditAutoSubtitles.ts`：共享字幕样式并移除三行相关应用校验。
- `src/features/videoEdit/panels/VideoEditTypographyPanel.tsx`：提供四类宿主共用的文本、外观、变换插槽和链接样式面板。
- `src/features/videoEdit/panels/VideoEditGraphicTextStylePanel.tsx`：连接图形文字事务、字体预览和六向画幅对齐。
- `src/features/videoEdit/panels/useVideoEditTypographyGesture.ts`：复用项目手势形成一次撤销并在取消/卸载时回滚。
- `src/features/videoEdit/panels/VideoEditTextStylePanel.tsx`：文字片段接入共享面板及现有关键帧控件。
- `src/features/videoEdit/panels/VideoEditTextOverlay.tsx`：文字编辑叠层接入共享字体、字距与大小写样式。
- `src/features/videoEdit/panels/VideoEditGraphicPanel.tsx`：复用对象列表显示文字类型/眼睛开关并接入共享面板。
- `src/features/videoEdit/panels/VideoEditClipPropertySections.tsx`：复用运动/不透明度开关及关键帧行，加入六向文字对齐。
- `src/features/videoEdit/panels/VideoEditTitleTemplatesPanel.tsx`：标题模板接入共享面板并换算参数/实例样式空间量。
- `src/features/videoEdit/panels/VideoEditTitleTemplatesPanel.test.tsx`：更新标题面板共享字体与样式交互断言。
- `src/features/videoEdit/panels/VideoEditSubtitleActions.tsx`：字幕样式接入共享面板、预设和可取消事务。
- `src/core/videoEdit/autoSubtitles.ts`：移除自动字幕原文/译文的三行限制。
- `src/platform/fontFaces.ts`：字体资源加载/释放增加版本回调供文字缓存失效。
- `src/features/videoEdit/application/videoEditSubtitlePresets.ts`：自定义字幕样式复用文字预设库，保留内置字幕目录。
- `src/features/videoEdit/application/videoEditSubtitlePresetReflection.ts`：明确共享预设的通用读写入口。
- `src/features/videoEdit/application/videoEditSubtitleCompletion.test.ts`：验证共享预设持久化故障、字幕投影和多行图形。
- `src/features/videoEdit/application/videoEditAutoSubtitles.test.ts`：验证多行字幕应用与共享样式事务。
- `src/features/videoEdit/application/videoEditTextPresets.test.ts`：验证正式通用实体预设CRUD及图形样式读回撤销。
- `src/features/videoEdit/panels/VideoEditTextOverlay.test.tsx`：更新叠层样式契约与共享面板交互断言。
- `src/features/videoEdit/panels/VideoEditTypographyPanel.test.tsx`：验证排版开关、多层外观、吸管取消和预设CRUD。
- `src/features/videoEdit/panels/VideoEditTypographyHosts.test.tsx`：验证文字、图形、标题、字幕四宿主接入与一步撤销。
- `src/features/videoEdit/engine/videoEditGpuCompositor.test.ts`：更新复杂文字离屏上下文替身。
- `src/features/videoEdit/engine/videoEditTypographyCache.test.ts`：验证4K配置下缓存身份复用、失效及位图释放。
- `src/features/videoEdit/panels/CodeParameterPanel.test.tsx`：更新两处图形文字断言，不修改并行任务的组件实现。
- `src/features/videoEdit/application/videoEditTitleTemplateReflection.ts`：为自定义标题名称/definition提供通用写入和事务回滚。
- `src/features/videoEdit/application/videoEditTitleTemplates.test.ts`：验证完整标题样式的通用修改、回读和集合删除。
- `docs/rules/assistant-status.md`：登记共享文字/本机预设能力，撤回字幕三行现状限制并标明旧字形预算证据已经历史化。
- `docs/task/代码画面与AI协作/00-任务总览.md`：只修改t69行状态。
- `docs/task/代码画面与AI协作/任务/t69-PR式文字属性面板.md`：记录本任务设计、选型、修改范围、验证和交接边界。

## 总管理者注意

- 本任务不暂存、不提交、不推送；未修改packages/ai-sdk、t67受保护组件或t74 codeMaterial/GPU实现。
- 与t63共享fonts.ts、fontFaces.ts、字体/文字面板；与t68共享applicationDomain.ts、videoEditCodeSources.ts及fonts.ts。保留并行改动，不把这些文件整个diff都视为t69所有。
- 必须一起接入t63新增字体文件和t68新增videoEditLocalLibrary.ts；后者由t68维护，本任务只引用，未修改。videoEditTitleTemplateLibrary.ts由t68改为共享库，本任务未保留自身修改，不列为t69负责文件。
- applicationDomain 的本机库保存排除必须包含text_preset及title_template，否则修改本机UUID模板会被错误当成项目引用；同时保留t68的style_preset注册/排除。
- CodeParameterPanel.test.tsx仅改两处旧图形文字参数断言；不要覆盖t67正在改的实际组件。
- 缓存测试证明3840×2160配置下位图身份复用、失效和关闭；Canvas指令替身证明合成逻辑。没有真实4K耗时/显存、抗锯齿像素、预览/编码/离屏成片、透明编辑光标在复杂样式下的IME对齐或真实Pi/MCP证据，不能据此宣称桌面视觉/性能完成验收。
- 未启动/重启开发环境，没有本任务主进程代码改动；总管理者若做真实桌面验收，应按项目规则生成新运行产物。
