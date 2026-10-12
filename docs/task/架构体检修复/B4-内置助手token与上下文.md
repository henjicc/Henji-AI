# B4：内置助手 token 与上下文

工作区 `D:\VibeCode\henji-wt-b4`，分支 `codex/b4`，基线 `742267af`。本批只修改工作区，Git 审查、提交、合并与推送交总管理者；未改总览、SDK、dispatcher、外部契约版本或目录指纹。

## 复核与修复

证据来源：`D:\VibeCode\henji-codex-tasks\runs\r4.md`，逐项对照当前源码。

| 问题 | 复核 | 根因与处理 |
| --- | --- | --- |
| r4① | 属实 | 图片技能与交付参考声称 Pi 能调用 internal 截图工具，但 Pi 共用过滤后的目录。删除错误路线，改为结构/保存回读，画布来源用正式导出桥梁产生结果节点后 `read_application_media`。独立文档没有公开截图、通用扁平导出的缺口明确保留。 |
| r4② | 属实 | 三个技能及图片/剪辑宿主提示建议全领域加载。改为按步骤给精确 names：修剪/保存/撤销，主体选区/修补/导出，代码素材普通 CRUD/取帧。没有修改固定系统提示、工具声明排序或公共目录。 |
| r4③ | 属实 | 原结果完整进入模型，上游字符数÷4会低估中文。新增独立预算投影：每轮扣除实际系统提示、当前活动工具、模型最大输出与 5%（至少 1024 token）协议余量；ASCII 单词按三字符、标点逐个、非 ASCII 按 UTF-8 字节保守估算。大结果先保留事实摘要和最多 4000 估算 token 首段，再按本轮剩余窗口分配。原文留在当前 Pi 会话的非模型 custom entry，避免进入自动压缩提示；图像归一化替换 details 也不丢原文。错误仍为错误，部分完成与原操作身份保留，续取不重放操作。 |
| r4④ | 属实 | 原素材项/总引用/片段首段没有完整语义。发送时采集完整 selectedRefs、selectedClipRefs、targetTrackRefs，经过内部 DTO 与队列传入 Pi；模型只看到每组 8 项、完整 count、hasMore、capturedAt 与分页引用。续取绑定当时快照，支持冷恢复，不随前台选择变化，不限制选择总数。高频宿主摘要只遍历首段，完整快照只在发送时采集。 |

只读 `read_assistant_context` 是 Pi 会话传输辅助工具，只能读取当前分支已经收到的结果/选区，不是业务能力，不能访问路径、其他会话或重新请求应用。单页 2000 估算 token 是模型传输预算；offset/nextOffset 可持续续读，不是产品数量上限。全文字符分页不切断 Unicode 代理对，选区按引用条目分页。

固定系统前缀未修改，工具仍由原披露器稳定按名称排序。新增会话读取工具有固定定义，每轮不会随任务改写。仍允许显式 domains 加载，但技能不再推荐整图片/剪辑域。

## 参考 token 实测

从正式 `buildApplicationToolCatalog`、六技能启用索引与 `PiToolDisclosure` 实际选出的工具定义取样，Python 已安装的 `tiktoken 0.12.0 / o200k_base` 测量紧凑 JSON（name/description/parameters）。完整授权，包括新增 Pi 会话续读工具；不是 DeepSeek 或其他供应商的精确计费，也不包含技能正文、系统及历史消息。

| 任务 | 初始工具数 / token | 整领域工具数 / token | names 组合工具数 / token | 对比整领域减少 |
| --- | --- | --- | --- | --- |
| 剪辑修剪、保存、撤销 | 9 / 3863 | 63 / 55310 | 12 / 5757 | 49553 / 89.59% |
| 图片主体选区、纹理修补、画布导出 | 7 / 2596 | 27 / 24131 | 10 / 4620 | 19511 / 80.85% |

选型：复用现有 Pi SessionManager/custom entry 和 Zod，不新增存储服务或依赖。对照 [OpenAI tiktoken](https://github.com/openai/tiktoken) 的模型编码机制；它不能充当所有已接供应商的精确 tokenizer。本机 tiktoken 仅用于上述离线比较，运行时采用明确标注的保守多语估算。未安装、重装或改写共享 node_modules。估算可高估，不能拿它当账单用量。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| `electron/main/services/embedded-agent/contextBudget.ts` | 多语估算、事实摘要、Unicode 截取与模型窗口预算。 |
| `electron/main/services/embedded-agent/contextBudget.test.ts` | 一条 r4③ 回归覆盖中文超长结果、窗口变化、事实保留、无损分页、会话隔离及预算拒绝。 |
| `electron/main/services/embedded-agent/contextReader.ts` | 当前 Pi 会话原文归档、选区摘要及只读分页。 |
| `electron/main/services/embedded-agent/contracts.ts` | utility process 消息携带完整发送选区。 |
| `electron/main/services/embedded-agent/piEngine.ts` | 接入归档、预算和分页工具，保存不可变选区来源。 |
| `electron/main/services/embedded-agent/piEngine.test.ts` | 两条新增回归覆盖 r4② names 组合与 r4④ 冷恢复分页，调整固定工具数断言。 |
| `electron/main/services/embedded-agent/service.ts` | 队列发送原选区 DTO。 |
| `electron/main/services/embedded-agent/skills.test.ts` | 一条 r4① 回归防止重新推荐不可调用截图。 |
| `electron/main/services/embedded-agent/toolDisclosureProfiles.ts` | 图片和剪辑流程提示改为精确工具名。 |
| `resources/assistant-skills/image-edit-workbench/SKILL.md` | 图片任务工具组合与真实视觉核对边界。 |
| `resources/assistant-skills/image-edit-workbench/references/layers-export.md` | 删除 Pi 截图误导，说明当前可执行媒体路径。 |
| `resources/assistant-skills/video-edit-workbench/SKILL.md` | 修剪、取帧、导出按需 names 组合。 |
| `resources/assistant-skills/video-edit-code-creation/SKILL.md` | 代码普通 CRUD 与取帧、保存、撤销的精确加载。 |
| `src/core/assistant/embeddedAgent.ts` | 新增内部选区快照 schema，数组不设产品数量上限。 |
| `src/features/application-control/hostContext/hostContext.ts` | 完整发送快照与有界高频摘要共用采集路径。 |
| `src/features/application-control/hostContext/hostScopeRevisions.test.ts` | 扩展现有口播测试至 80 个真实词块选择，验证首段与原快照独立。 |
| `src/features/assistant/embedded/EmbeddedConversation.tsx` | 普通发送附带完整选区快照。 |
| `src/features/assistant/embedded/EmbeddedConversation.test.tsx` | 更新现有宿主替身的采集接口。 |
| `docs/rules/assistant-status.md` | 第五节记录图片截图说明的纠正与剩余缺口。 |
| `docs/task/架构体检修复/B4-内置助手token与上下文.md` | 本批记录。 |

## 设计自查

1. **助手只凭名称和说明能否用对？** names 组合直接使用现有正式工具名称；摘要直接给 reference、读取工具和下一页位置，批量操作前提示续读全部引用，避免猜测工具与对象。
2. **能否 AI 先做、人只确认？** 工具选择、结果裁剪、完整选区续取由运行时和助手完成。没有追加授权闸门、手工分页工作或产品数量限制；既有业务授权保持原样。
3. **产物能否直接流进其他工作区？** 不改变业务产物与引用。图片结果继续通过正式画布导出/媒体读取/剪辑落位桥梁流转；会话分页只减少传输体积，不复制作品状态。

## 验证

按 testing.md 的 L2（内部公共 DTO、跨 renderer/utility process 消费者）选择精确检查；没有运行全量测试、Reality、构建、electron:dev 或真实模型调用。

- 精确测试：`contextBudget.test.ts`、`piEngine.test.ts`、`skills.test.ts`、`service.test.ts`、`EmbeddedConversation.test.tsx`、`hostScopeRevisions.test.ts`，合计 6 文件 69 项。最终状态见下方验证结论。
- 两套 tsc：`npx tsc -p tsconfig.json --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit`。
- 所有改动 TS/TSX 文件的 ESLint（`--report-unused-disable-directives --max-warnings 0`）。
- `npm run check:main-imports`：通过。
- `npm run check:dependency-graph`：通过，未新增依赖环/跨层边/首屏重模块。
- `npm run check:surface`：通过。
- `npm run check:assistant-capabilities`：通过；该既有脚本内部额外串行运行覆盖 14 项及不变量 31 文件 208 项，未另跑全量测试。该脚本未透传 silent，产生既有诊断日志；手动精确 Vitest 全部带 `--silent`。
- `git diff --check`：通过（仅读取，无 Git 写操作）。

首次验证出现过技能正文 6447 字节超出既有 6144 字节上限、Pi AgentMessage 非直接依赖导入、预算转义重复计量及测试可选 surface 类型错误，均修复；没有提高既有技能长度门槛。选区测试初次把结构化消息当字符串的断言也已修正。

## 集成边界与未验项

- 所有权外的必要修改只有 `src/core/assistant/embeddedAgent.ts` 的内部 DTO（约 13–27 行）及用户要求的台账第五节。未改 B3 dispatcher、外部业务工具 catalog、EXTERNAL_CONTRACT_VERSION 或目录指纹；Pi 独有会话读取工具不进入外部目录。
- 未改任何已登记作品/设置格式或 SQLite 结构，不需要 N→N+1、`persistence:baseline` 或数据库版本升级。新增数据写入既有 Pi JSONL 的标准 custom/custom_message/details 扩展；没有新文件存储格式或迁移分支。总管理者应留意其会话体积仍随原文/选区规模增长。
- 已检查三份相关技能、图片交付参考、图片/剪辑宿主提示、普通/错误/带图结果投影、原始结果续取、口播/剪辑选区及会话恢复。没有扩展成全项目审计。
- 预设入口显式传入 prepared.context 时继续尊重该入口固定的目标，不拿当前前台选择覆盖它；这类入口的专用上下文完整性不在本批扩展。普通聊天发送具有完整选区快照。
- 当前预算是保守估算；图片预留 4096 token/张不是供应商精确图像计费。多模态附件上传后的供应商精确 token、超大长会话压缩和真实模型是否依提示逐页读完，未付费实测。
- 固定工具/不可裁剪历史已超模型窗口时明确停止，不截断用户指令、不重放业务操作；需更大窗口模型或新的精确任务会话。
- 独立图片视觉核对仍缺公开截图与通用扁平导出，本批纠正指引，没有冒充已接通。
- 改动包含主进程/utility process 代码，合并后需要总管理者安排重新生成产物与重启才能人工查看。按用户要求，本批未启停任何开发实例。

验证结论：6 个精确文件合计 69 项全部通过；两套 tsc、改动文件 ESLint 与上述专项检查全部通过。失败修正后只复跑受影响项目/文件，未重复已通过且未再修改的检查。工作区保留本批改动待总管理者审查，没有 Git 写操作。
