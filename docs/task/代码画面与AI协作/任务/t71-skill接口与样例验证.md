# t71 skill 接口与样例验证

状态：已实现，定向验证完成，待总管理者审查。2026-10-08。渲染层 tsc 被非本任务的并行文件错误阻断，不能称全局类型检查通过。

## 实现与边界

以当前工作区 compiler/compilerV3、contract、evaluateV3、参数/曲线模型、shaderLibrary/catalog、fontReflection、标注反射与 observe/place 能力为真相源。未修改源码实现、SDK、其他任务记录或助手台账；总览仅更新 t71 行。没有 Git 写操作、构建、Reality、开发实例启停或付费调用。

- author-api 改为显式 apiVersion:1 + languageVersion:3，覆盖纯函数/repeat、全部图形字段、变换/渐变/效果、元素源码定位、单帧预算与错误；补充当前 t68 的只读 ctx.style 路径。
- 拆出 author-text-motion、author-shaders，分别覆盖排版/量字/逐字/数学色彩和可信图层/滤镜工序/原语/十项目录摘要。三份接口均 3–8 KiB，SKILL 仅增加三行分流，正文≤6 KiB。
- parameters-curves 说明六种真实参数、图片通用生成→library 放置→item.media_id→实例参数绑定、新版本引用与曲线；timeline-check 补齐标注叠加/筛选/裁切和元素高亮。
- annotations 说明 open 发现、真实取帧、固定源码定位、内容+append 回复+addressed 同事务和仅用户通过；type 替换 font 占位为正式分页/等值筛选/回读路径。
- examples 提供四份完整 v3 源码与每份插入/调参调用。样例颜色是作者画面数据；不是新增正式 UI 硬编码颜色。

实际核对后移除了旧参考中的 256 图形限制、4 次滤镜采样、4 个片段效果、256/2048 关键帧点数及 1800 秒声明限制。当前单份 v3 绘制/滤镜/GPU 预算仍保留，源时钟为 24 小时；工程数量不设上限。

## 样例与开源选型

采用已有 Vitest、Node 文件读取与正式 TypeScript AST 编译/封闭 IR 求值，无新依赖。比较独立复制样例字符串、快照和直接读取 Markdown：前两者无法发现文档与副本漂移，故递归读取技能全部 Markdown 的 ts 围栏。统一约定 ts 围栏为完整作者源码，text 为接口签名/片段，json 为工具输入。

新 skillExamples.test.ts 自动归入 scripts/lib/testSuites.cjs 的现有 src/**/*.test.{ts,tsx} unit glob；已核对 testSuiteForFile 和 unit include，不更改共享执行配置。测试保护六份完整源码、四例参数调用及量字/错峰/极光/数字终点。每份源码在进场、停留、末帧求值并检查确定性、有限数值和源码归属。Node 仅替换宿主字形 advance，保留真实布局、编译器与求值器，不冒称真实字库/GPU像素验收。

首轮测试暴露字符串 + 拼接不属于当前语言，已改章节前缀为两个 text、数字滚动为字符表+十进制位权+repeat，并修正文档。渐变 stop 当前允许非递减，未误写成必须严格递增。没有确认需要改运行时的实现缺陷。

收尾清理 EOF 时 Windows 写入 CRLF 暴露旧契约测试仅识别 LF 的围栏解析缺陷，已统一接受 LF/CRLF；没有通过改回换行掩盖问题。

## 设计自查

1. 助手只凭名称和说明能否用对？能。路由分清语法、文字、着色器、参数和标注，工具名/属性/调用由现有目录与契约测试核对。font 专用参数未接入，明确使用 text/choice，不把预留代码当可用契约。
2. 能否 AI 先做、人只确认？能。AI 编写并自动校验源码、观察画面后返修；用户只校正方向与通过 addressed 标注。没有替用户 resolved 或额外付费授权。
3. 产物能否直接流进其他工作区？能。产物仍是正式剪辑代码素材/实例，图片来自共用生成历史和素材库，观察结果为正式资产引用，沿原流转/导出路径使用。

应用能力分级：现有能力使用说明与契约覆盖核对，不新增状态、实体、工具、权限或入口，因此不新增 MCP 能力，也不改变 assistant-status 第零节的通/不通或欠账。没有应用运行时改动，不要求主进程重启。

## 检查证据

按 testing.md L0 文档引用核对 + L1 精确测试；修改 core 下测试按项目要求两套 tsc，修改 main 下加载测试按要求运行 main-imports。没有 L3 升级条件，不跑全量或 Reality。

- npx vitest run 四份明确测试 --silent：26/26 通过。skillExamples 12、videoEditCodeCreationSkill 4、MCP skills 4、embedded-agent skills 6。后者同步新路径与分流体积；正式契约测试仍核对工具/实体/属性、全部八份插入/调参输入与集合必填字段。
- 四份改动测试文件 eslint --report-unused-disable-directives --max-warnings 0：通过。
- npx tsc -p tsconfig.electron.json --noEmit：通过。
- npx tsc -p tsconfig.json --noEmit：失败。首轮为 videoEditStyleReference.ts 的 AbortSignal|undefined 和 VideoEditTypographyHosts.test.tsx 的 allCaps；最终复查为 13 处错误，来自并行 applicationDomain.ts、videoEditFields.ts、videoEditStyleKitCapabilities.ts、videoEditStyleReference.ts、videoEditTextPresetReflection.ts、VideoEditDock.tsx、VideoEditApp.tsx。包括风格实体/执行上下文类型、unknown 输入、缺失 VIDEO_EDIT_TEXT_STYLE_DESCRIPTION 导出、缺失 VideoEditStyleKitsPanel 模块及 style_kits scope。没有本任务测试类型错误，未越界修复，交总管理者整合。
- npm run check:main-imports：通过，扫描 570 个 main/preload 文件。
- unit 套件自动归属检查：通过。未重复执行无关全量套件或专项 UI/能力门禁。
- 本次明确文件 diff --check：清理 examples 多余 EOF 空行后通过，仅 LF/CRLF 提示。

## 文件清单与总管理者注意

独占技能范围：SKILL.md；references/author-api.md、author-text-motion.md、author-shaders.md、annotations.md、parameters-curves.md、timeline-check.md、type.md、examples.md。

新增 src/core/videoEdit/codeMaterial/skillExamples.test.ts；必要关联测试修改 src/core/application-control/domains/assistantSkill/videoEditCodeCreationSkill.test.ts、electron/main/services/mcp/skills.test.ts、electron/main/services/embedded-agent/skills.test.ts。另修改本记录及总览 t71 行。旧契约测试硬编码两份 v1 样例与 4.5KB 上限，保留其目录/可写性校验，源码求值统一交新增测试，避免重复副本。

接口参考每份≤8 KiB，完整四例集中在 examples（≤16 KiB），技能按需加载。最终精确大小随交付报告列出，不在此维护第二份易漂移尺寸表。

外部作者草稿未列本轮并行接入的 ctx.style。该草稿位于 D:/VibeCode/henji-codex-tasks/refs，当前沙箱只允许写 Henji-AI，本任务未写外部路径；总管理者需把本技能 author-api 的 ctx.style 路径及现有边界补回草稿。未因草稿差异改源码。

未验证真实字体形状、着色器 GPU 像素、Pi/MCP 模型决策或 Electron 视觉；本次自动证据限定于真实编译/求值及技能加载/正式 schema。字体专用参数缺口已属 t63/t62 集成边界，不自行实现。主进程无需因本任务重启；是否重建产物加载最新技能由总管理者集成决定。
