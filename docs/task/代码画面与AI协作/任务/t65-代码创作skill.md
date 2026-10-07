# t65 代码创作 skill：设计与方法

状态：实现与精确验证完成，待总管理者审查。仅修改工作区；Git 暂存、提交和推送由总管理者负责。

## 范围与覆盖分级

本任务重写 `resources/assistant-skills/video-edit-code-creation/SKILL.md`，新增十份方法参考及来源／许可说明。保留 author-api、parameters-curves、timeline-check、examples 四份接口参考，内容未改；作者语言 v3、字体工具名、风格包及接口样例由 t71 汇合更新。

按 assistant-capability 规则，本次属于已有运行时技能的知识与工作流改写，没有新增用户数据、业务操作、页面或工具。读取、修改、撤销、观察继续使用现有正式实体与应用能力，不新增专用 Agent 工具。除了独占目录与指定任务记录，唯一必要的范围外改动是 `electron/main/services/mcp/skills.test.ts`：原测试写死四份参考路径，需同步为十四份并验证每份实际经 MCP 可读。没有改加载器、运行时代码、`src/core/**` 或 `packages/ai-sdk/**`。

## 结构与渐进读取

入口为“总原则 → 铁律 → 按任务分流 → 七阶段导演流程 → 执行边界”。先建立画面意图，静态关键画面确认后再扩展；用户明确要求不用停时自行选方向。每个阶段通常只读一两份 reference，不递归展开全部材料。

| 文件 | 职责 |
|---|---|
| SKILL.md | 短入口、五原则、五铁律、十四条路由、七阶段流程 |
| references/brief-concept.md | 简报五问、视觉想法＋母题、1–3 方向与拆解参考 |
| references/styles.md | 五轴坐标与六档起点、系列统一及局部变化 |
| references/layout.md | 画幅、安全框、网格、层级、十一种版式与构图张力 |
| references/type.md | 字号阶梯、行距字距、中英混排、字体气质与真实查询 |
| references/color-texture.md | 色彩角色、面积比例、明度／对比、渐变颗粒与光影分寸 |
| references/motion.md | 缓动语义、时长幅度、错峰接力、因果和转场 |
| references/structure.md | 能量曲线、节拍表、信息变画面、真实声画与粗排 |
| references/review.md | 三遍看、program/source 取帧、连续帧、批注、A/B、评分与自检 |
| references/templates.md | 真实量字驱动尺寸、完整文案布局、五种压力文案与恢复验证 |
| references/preferences.md | 读长期口味、优先级、明确偏好合并写共享记忆 |
| references/author-api.md | 现有作者接口，保留原文，t71 更新 |
| references/parameters-curves.md | 现有参数与关键帧契约，保留原文，t71 更新 |
| references/timeline-check.md | 现有时间线操作与恢复契约，保留原文，t71 更新 |
| references/examples.md | 现有完整接口样例，保留原文，t71 更新 |
| NOTICE／LICENSE.hyperframes | 来源、改写范围及 Apache 2.0 许可；不索引进参考列表 |

## 来源与选型取舍

只读参考用户自有 `AEPR控制测试/packages/knowledge/guides/` 的全部 Markdown，重点 index、direct、design、motion、recipes 的模板／文字／字幕／图标线条。AE、PR、跨软件与代码效果资料用于辨认应剔除的执行契约。HyperFrames 使用本机参考仓库的 hyperframes、hyperframes-creative、motion-graphics、hyperframes-animation、DESIGN.md、frame-presets 及相关设计参考。没有安装库、导入外部执行器或复制脚本。

| 内容 | 采用／改写／舍弃与原因 |
|---|---|
| frameflow 的短入口、任务分流、按需读 | 采用组织方式，避免一次加载所有设计和接口知识 |
| 五问、母题、五轴六档、版式／文字／运动尺度 | 改写为中文规则、起步数值和适用条件；每条说明服务什么信息与检查什么 |
| 先样张、改原作品、取帧再判断、三遍看片 | 采用原则；样张确认尊重“不用停”的授权，小修改不重复定方向 |
| 图层、预合成、关键帧 | 改写为代码图形／分组、独立代码素材、参数关键帧或已公开的作者动画语法；不假设 v3 接口已经可用 |
| frameflow 取帧、桥接回读、编号定位 | 改写为正式实体引用、read_application_entity、observe_video_edit_frame、read_application_media，不猜 ID 与函数 |
| 模板按字号比例量字、极端文案与修改后恢复 | 采用方法；不复制 Canvas／DOM 测量调用，没有公开量字接口就不能宣称自适应完成 |
| frameflow 偏好目录、评分循环 | 改写为项目共享记忆与带时间证据的评分；不新增偏好文件，不用固定轮数宣布通过 |
| ExtendScript、matchName、ae_frame、MOGRT、QE、CUDA、插件、动态链接、安装与路径搬运 | 舍弃：属于 Adobe／另一项目运行时，痕迹AI受限作者语言不能执行这些契约 |
| HyperFrames 资产先行、语义动词、统一设计规则、可重复帧检查 | 借鉴思想并独立中文表述，优先真实素材、母题和可执行尺度 |
| HyperFrames 强制双焦点、每景多层、持续背景运动、装饰数量／字体黑名单 | 舍弃：与单焦点、阅读停留和用户品牌约束冲突，易产生重复的“AI 味” |
| HyperFrames CLI、HTML／GSAP、下载、网络字体筛选、多代理与审批流程 | 舍弃：不属于本项目正式操作路径，也不扩大本任务授权 |

成熟资料优先：选择完整 frameflow 方法而非另造导演体系；HyperFrames 用来交叉检查静态设计与运动的分工。没有新增可运行功能，因此不引入动画库或渲染框架。版权说明采用本目录相邻技能的 NOTICE／许可文件方式；HyperFrames 来源为 https://github.com/heygen-com/hyperframes，随目录保留本机上游 Apache 2.0 原文。本次没有逐段复制其英文文本或代码。

## 与实际能力的接点

- 字体：先“查询可用字体”，明确这是名称占位而非可调用工具；不猜安装家族，t63／t71 接真实能力名。
- 取帧：program 的 sequenceRef＋整数 frame，source 的 itemRef＋整数 timeUs；maxWidth 256–3840、默认 1920。媒体引用必须真正续读、看图；没有联系表或批量 times 参数。连续帧与接缝检查逐次调用，抽样不能证明完整播放、听感或编码质量。
- 标注：提供“目标／时间｜问题｜观众影响｜具体改法｜复查点”格式；先留对话，写应用前发现正式可写字段。t64 实体接入由 t71 更新，不发明工具与保存格式。
- 偏好：已检查 `src/features/assistant/memory` 与 sharedMemoryReflection，assistant.shared_memory／singleton 的 content 通过通用工具读写，最多 800 字；关闭、无权限时不写，不推断用户未表达的长期口味。
- 数量：方向数、字体组合、每轮返修数、字号／时长／安全区均为创作起点，不是素材、批注、序列或工程容量上限。真实资源约束沿既有接口，不自行追加。

## 加载与副本核查

检查 `src/core/assistant/skills.ts`、skills/registry、agentSkills、assistantSkillApplicationCapabilities、applicationToolDispatcher、toolCatalog，以及“原生代码素材与智能剪辑／重要记录”记录 008、027。

运行时 SKILL 正文上限 65,536 字节；合并技能最多 100，单技能 reference 最多 64、深度 8；安装上限 32 文件／1,048,576 字节。单份 reference 的加载没有额外正文大小门槛。当前只有 17 文件、14 reference、一级目录，总量远低于门槛，无需改加载器。既有精确测试更严格：入口小于 5,000、每份 reference 小于 4,500 字节；本次遵守而未放宽测试。

运行时源只在 resources 下，没有另一个源 SKILL 副本；`.codex`／`.claude` 的开发技能同步不覆盖这个目录。electron-builder.yml 已整体复制 resources/assistant-skills，不新增清单。内置 Pi 与外部 MCP 共用已准入技能列表；外部通过 tools/list 发现 load_assistant_skill，通过 describe_application_contract 的技能元数据选技能，不传 path 读入口，传 references/*.md 读单份。许可文件不进入 referencePaths。

## 设计自查

1. 助手只凭名称和说明能否用对？可以，description 限定代码画面场景，分流表把概念、风格、排版、动画、审查和真实操作参考分开；API 只引用正式接口，不把设计数值误当字段。
2. 能否 AI 先做、人只确认？可以，助手先盘点、提概念和关键画面，用户校正方向；明确允许不停时自行完成，修改后取帧复查，避免把机械参数选择交回用户。
3. 产物能否直接流进其他工作区？产物仍是原剪辑内可编辑代码素材与实例，观察／导出／收录沿现有能力；本技能不制造外部工程或搬文件流程。具体跨区操作依当前正式能力，不宣称新增通路。

## 验证记录（2026-10-08）

按 testing.md 裁剪为运行时技能相关的精确验证，不跑全量、Reality、构建、真实助手任务或开发实例。

- `npx vitest run --silent electron/main/services/assistant/skills/registry.test.ts electron/main/services/embedded-agent/skills.test.ts electron/main/services/mcp/skills.test.ts src/core/application-control/domains/assistantSkill/videoEditCodeCreationSkill.test.ts`：4 文件、30 测试通过。覆盖真实技能扫描、内置加载、全部 14 路径经外部 MCP 读取、路径拒绝／停用／撤销、入口及引用长度、正式工具名和保留样例契约。
- `npx eslint electron/main/services/mcp/skills.test.ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npm run check:main-imports`：通过，扫描 566 个 main／preload 文件。
- `npm run check:assistant-capabilities:structure`：通过。没有新增业务能力，未升级到全量能力测试。
- 四份保留接口参考的定向 git diff 为空；入口 4,926 字节，新增 reference 各 3,495–4,469 字节。无接口重写、无加载器变更。
- 不涉及 core 或运行时 TS 实现改动，仅测试期望同步，未触发两套 tsc、UI 检查或 Electron 环境维护。

这些检查证明按需加载与文档契约成立，不证明模型实际美术质量。t71 需更新四份旧接口与新能力接点，t72 再做获准的真实创作／取帧效果验收。本任务没有真实付费调用。
