摘要：U0 登记骨架、两个追加索引、规划/精度/预览派生、参数空间与共用 WGSL 数学已实现；尚未完成验收与提交。
摘要：独立干净上下文审查 1 轮，确认 1 项重要问题：正式 ParamList.tsx 尚需委托共享显隐函数；因用户“本次不写 .tsx 界面”约束，等待最小例外答复。
摘要：相关精确测试、真实 GPU、持久格式/助手能力/作者效果门禁已有通过证据；最终 L2 仅做了 dry-run，未声明通过；任务分支未提交、未推送、未合并回 main。

## 当前状态

工作目录：`D:\VibeCode\Henji-AI-t19u0`。
任务分支：`task/19-U0-登记骨架`。
本次执行了 `git merge main`，从 `f1febc4de` 快进至 `4fbc233a1`；这是把 main 吸收进任务分支，未修改主工作区、未反向合并。
所有实现改动仍在当前任务分支工作区，尚无本任务提交。
未安装、卸载或重装依赖；未删除 node_modules、FFmpeg 联接点；未使用 9334；未访问 D:\视频制作。

## 已落地条目

- `core/videoEdit/effectIndex.ts`：只追加定义导出，每行可以导出单个定义或一个定义数组；`builtinEffects.ts` 自动展开。原有行内效果移到 `basicEffects.ts`，共用参数构造移到 `effectParams.ts`，避免登记时的运行依赖环。
- `engine/effectPlannerIndex.ts`：只追加规划登记导出。每个登记含 `id`、`plan(params, frame, instance)`、`entries`、`wgsl`，可选不可过滤入口和独立预览标记；原生效果各自的登记随实现放在同一文件。基础内联效果收在 `basicEffectPlanners.ts` / `basicEffectShaders.ts`。
- `planVideoEditBuiltinEffect` 按规划 Map 的 id 分发。共用规划结构与 Planner 在 `effectPlan.ts`，现有过渡与作者散焦复用它。
- 工序入口、不可过滤入口、完整 WGSL 和预览可选条目从规划登记与效果定义生成；开发预览没有独立效果 ID 白名单。
- 效果定义新增 `stage`、`precision(params, plan)`；当前浮点白名单迁回各效果定义。仅在精度谓词读取工序时才创建规划，纯参数判定不额外建立调色表。
- 参数新增 `spaces`；片段字段缺省走 clip，字段生成可指定 layer/frame；作者工厂生成会排除不支持 layer 的参数，作者描述显式传入片段专用参数会报错。
- `visibleWhen.all`：声明、作者解析/比较值校验、说明、包含效果的键前缀、独立预览已共用纯函数。作者接口 v8 起接受 all，旧接口保持旧语法。
- 目录新增“生成”“更多”类别，以及设计第 13 节的视频小组；现有效果挂到对应分组，目录按分组排列。第二批尚未实现的效果不预先创建空条目，着色器旧目录的最终撤下仍归 U16。
- 共用 WGSL：提取项目既有有符号 OkLab/sRGB 数学；新增颜色插值、二维单形噪声与四次双线性 B 样条取样；hash、值噪声、退化 ramp 从现有着色器提取。
- 作者生成产物随定义重生成；没有冻结或发布新的 henji-effects 版本。

后续效果单的接法：在自己的 core 文件导出定义、engine 文件导出规划登记，然后向两个索引分别追加一条 re-export。参数/目录/精度/预览/着色器装配读取同一登记链。

## 持久格式

在吸收当时 main 后顺延：

| 格式 | main → 当前 | 最低可读版本 |
|---|---|---|
| code-author-api | 7 → 8 | 8 |
| code-version | 8 → 9 | 9 |
| code-asset | 13 → 14 | 14 |
| document.video_edit | 48 → 49 | 49 |
| document.screen_recording | 51 → 52 | 52 |

原因：all 是新增作者语法，旧宿主无法解析；关联容器接受新作者接口。每个格式都有逐版本迁移和正式生成的新黄金样本；迁移保留旧源码、作者接口及库锁定，不把历史代码自动改成 v8。新样本的源码含 all 声明。既有黄金样本与发布承诺条目未改写，支持下限保持不变。
已运行 baseline 与 release-snapshot，再运行 `check:persistence-compat`，66 种格式通过。提交前仍需再次 `git merge main`，若期间 main 前进并占用版本，按新的 main 顺延并重验。

## 审查与唯一待决项

独立子代理使用全新上下文做一轮只读审查，检查两个索引、六个效果包装、WGSL 装配/数学、精度、作者参数空间、目录、版本迁移与样本。
正式报告：1 项重要问题，未发现第二项有证据的正确性问题。

重要问题位置：`src/components/ui/params/ParamList.tsx:34`。其 `paramVisible` 仍按单条件访问 `.param` / `.in`，面对 `{all:[...]}` 会始终显示，并触发 TypeScript 联合类型错误。

所需最小修复已明确：导入 `@/core/imaging/parameterVisibility` 的 `parameterVisible`，将当前 `paramVisible` 的函数体委托为 `return parameterVisible(field.visibleWhen, values)`。这是正式共用参数控件必须的一处接线；尚未修改任何 .tsx 文件。
已通过异步提问请求用户允许这一处最小例外，尚未收到答复；不能把等待时间当作许可。
对应正式面板回归用例已放在 `.ts` 文件 `src/components/ui/params/parameterVisibility.test.ts`，等待接线后执行。
审查另提醒纯参数精度判定无需每次生成完整规划，已用惰性 passes 访问处理；精度与登记精确测试随后通过。

## 验证证据

已通过：

- 现有规划与精度：2 文件 14 项。
- 登记接入/参数 all/作者声明：3 文件 11 项。
- 持久格式、代码资产、作者效果、色彩数学、作者参数入口：5 文件 292 项。
- 作者 bundle、作者类型检查、既有共用参数面板：3 文件 45 项。
- 最后一次内置登记、精度、追加索引接入回归：3 文件 8 项。
- 真实 GPU 内置效果：原有 29 项通过。
- 新共用数学真实 GPU：OkLab 往返、两种插值、退化 ramp、值噪声/单形噪声连续性、B 样条与完整 4×4 卷积比较通过。
- 最后一次真实 GPU 定向：共用数学 + 作者效果→层栈→片段→amount/mask→转场的浮点链，共 2 项通过，其余明确未选择。
- `npm run check:assistant-capabilities`：整体退出码 0，结构/覆盖/不变量全部通过；不变量部分 31 文件 237 项。
- `npm run check:author-effects`：通过。
- `npm run check:persistence-compat`：通过，66 种格式。
- 本次相关新增源、生成脚本与预览脚本的文件级 ESLint；预览素材原有颜色归到正式颜色令牌文件，CLI 输出使用 stdout。
- `git diff --check`：通过。

尚未通过/未执行：

- 渲染层完整类型检查：首次因 Node 默认 4 GiB 堆不足退出；提高单进程内存额度后暴露登记类型循环推导，已修复。后续输出还包括目录 map 推导错误（已加返回类型修复）与上述 ParamList 的 all 未接线错误；尚未完成最终类型检查。
- Electron 类型检查、最终 L2 及其依赖图/主进程传递导入等专项尚未完成。
- `verify:changed --level L2` 已对显式 72 个本次文件 dry-run，计划可解析；正式运行脚本保存在忽略目录 `.tmp/u0-verify.ps1`。它明确传入精确消费者测试，不扫描别的任务。
- 正式共用面板的新增 all 切换用例尚未执行；当前实现下不能声称它通过。
- 没有启动正式 Electron 窗口做界面验收，也没有作 1080p 性能结论；本任务已有真实 GPU 数值证据。

## 数学来源与选型

复用项目现有 OkLab WGSL；新二维单形噪声移植 [Ashima/webgl-noise 官方实现](https://github.com/ashima/webgl-noise/blob/master/src/noise2D.glsl)，MIT 版权及许可完整保留在源码注释中。B 样条使用设计指定的 [Sigg 与 Hadwiger 2005 / NVIDIA GPU Gems 2 第 20 章](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-20-fast-third-order-texture-filtering)。没有新增运行依赖。分发需保留 MIT 许可；本次不作专利法律结论。

## Claude 裁定：ParamList 显隐接线（11-01）
允许改 `src/components/ui/params/ParamList.tsx`，只限删掉其中本地的 `paramVisible` 判断，改为调用 `@/core/imaging/parameterVisibility` 的 `parameterVisible`（同一条件语义只留一份）。这是显隐逻辑，不是外观，不动布局、样式、文案。顺带 grep 其他 .tsx/.ts 里有没有自写的 visibleWhen 判断（`src/components/params/paramVisibility.ts` 若是模型参数的另一种条件格式则不动），有就同样改成共用函数并列在 result。

## 审查修复 1

U0 登记骨架已完成修复、最终 L2、提交及吸收最新 main。本节为当前交付状态，上文“尚未完成”的记录保留为历史过程。

### 修复与同源排查

- 删除 `src/components/ui/params/ParamList.tsx` 的本地 `paramVisible`，字段订阅快照直接调用共用 `parameterVisible(field.visibleWhen, props.values)`。布局、样式、文案未改；本任务仅修改这一处 `.tsx`。
- `parameterVisibility.test.ts` 覆盖作者参数与内置参数、form 与 property 两种正式共用排布：第二个条件不满足时隐藏，全部满足时显示，第一个条件变化后再次隐藏。先在未接线实现上实跑得到 2 项失败，接线后两项通过；连同核心条件测试共 3 项通过。
- 检索 `src/**/*.ts`、`src/**/*.tsx` 及 `scripts/effect-preview` 中的 `visibleWhen` 判断。独立预览已调用共用函数，未发现其他同语义的本地显隐实现；作者声明解析、说明和包含参数前缀映射保持各自职责。`src/components/params/paramVisibility.ts` 使用模型参数的另一种条件与联动格式，按裁定保留。
- 最终门禁首次执行在颜色检查失败：ticket 12 的 `videoEditStyleEffects.gpu.test.ts` 有两处硬编码着色输入。将完全相同的色值集中登记到现有 `colorTokens.ts`，测试引用令牌并删除失效的 ESLint 豁免；没有更新像素断言或快照，快照工作区与 HEAD 的 blob 摘要一致。该文件 30 项真实 GPU 测试通过后纳入最终 L2。
- 暂存区检查发现两个新增文件末尾多余空行，已清理；`git diff --cached --check` 和收尾 `git diff --check` 均通过。

### 最终验证

- `npm run verify:changed -- --level L2 <显式本次文件...>`：通过。清单为 74 个路径（其中蓝噪声生成文件内容未变，实际实现提交为 73 个文件），使用精确消费者测试而非扫描整个脏工作区。复现脚本为任务工作目录忽略区 `.tmp/u0-verify.ps1`，最终输出在 `.tmp/u0-final-checks.log`。
- L2 精确测试：19 文件、439 项通过，零失败/跳过；包含内置效果与风格效果两组共 60 项真实 GPU 测试。渲染层及 Electron 类型检查、文件级 ESLint、表面/颜色/图标/界面残留/间距动效、依赖图、主进程传递导入及登记基线全部通过。表面检查的既有启发式告警不构成阻断，未调低任何门槛。
- `npm run check:persistence-compat`：通过，66 种格式。
- `npm run check:assistant-capabilities`：整体退出码 0；结构通过，覆盖测试 1 文件 15 项，不变量测试 31 文件 237 项全部通过。
- `npm run check:skill-sync`：通过，5 个 skill、25 个共享文件一致。
- 独立干净上下文审查共 3 轮：首轮唯一重要问题为 ParamList 显隐接线，已修复；第 2 轮只审接线及回归测试，第 3 轮只审颜色门禁修复，两轮均无新增问题。

### 提交与 main 同步

- 实现提交：`60d656152`，`feat(video-edit): 建立效果定义与规划登记骨架`。
- `git merge main` 吸收 `d529d407f`（包括 15、21 等已合并内容），产生 `07a6ba536`，无冲突。main 未占用本次新增的持久版本，未额外升版。
- 合并后的受影响验证：11 文件 304 项通过，包含 72 项真实 GPU 测试，覆盖登记/精度、属性面板、作者程序、代码输出键与复用、渲染会话及渲染器。渲染层类型和合并后依赖图门禁再次通过。完整输出在 `.tmp/u0-post-merge.log`。GPU 的格式不匹配日志来自既有主动验证拒绝行为的用例，该用例通过。
- 验证期间 main 又增加纯进度文档提交 `fde217903`，再次执行 `git merge main`，产生最终 HEAD `3fba9c4d9`，无冲突；这一增量仅改进度文档，复用已通过的运行时验证。最终祖先检查确认最新 main 已包含在任务分支中。
- 最终仍在 `task/19-U0-登记骨架`，任务工作区干净；只在本分支提交，未反向合并 main、未推送。未安装/卸载依赖，未删除 node_modules 或 FFmpeg 联接点，未启动或占用 9334，未访问 `D:\视频制作`。除本结果文件外未修改主工作区。
- 未新增真实 Electron 窗口或性能结论；本次属性显隐由正式组件精确测试取证，着色器与效果链由真实 GPU 数值测试取证。

## 审查修复 2

本节对应 `review-U0.md` 末尾“Claude 裁定（11-01）”，以 `3fba9c4d9` 为起点，9 条均已处理。本节为当前交付状态。

### 九条修复与精确证据

| 条目 | 修复 | 精确验证 |
|---|---|---|
| 1 版本撞号 | 保留 U13 的音频迁移与 U12 的过渡迁移；U0 作者语法步骤位于剪辑 50→51、录制 53→54。正式生成器生成 v51/v54，重新生成 baseline 与发布承诺 | `effectRegistrationMigration.test.ts`、`persistence.test.ts`、`transitionMigration.test.ts`；四份 main 旧样本逐字节相同，66 种格式门禁通过 |
| 2 重复 id | 定义与规划共用 `registerEffects`，重复立即抛错，指出导出名和数组位置；共享 design.md 第 15 节及任务分支同一格均改为反相在 `basicEffects.ts` / `basicEffectPlanners.ts` 原地替换 | `effectRegistration.test.ts` 实际向两个索引各注入重复条目，两个入口均拒绝，并检查两处来源 |
| 3 顺序 | 新增 `core/videoEdit/effectCatalog.ts`，显式排列 id 与分组；定义数组、按 id 查询、“可用：…”提示、助手共用目录和面板均使用其投影。原生组按第 13 节，全能调色位于颜色组首项，画面与着色器效果先于音频 | 反转输入 Map 后顺序不变；目录与登记全覆盖、无重复；漏排新 id 抛错；面板与定义顺序一致 |
| 4 空文件夹 | `VideoEditEffectsLibraryPanel.tsx` 的筛选改为始终要求 `entries.length`，无搜索也隐藏空文件夹 | `videoEditEffectsLibraryVisibility.test.ts` 覆盖初始、无匹配搜索和有匹配搜索；自写 TSX 增量仅此显隐一行 |
| 5 共享 WGSL | `effectShaderPrelude.ts` 显式装配颜色数学、效果数学及基础 ABI，按块名去重，异文同名报错；从全能调色规划移走基础着色器和高斯不可过滤入口；补齐 binding、16/24 float、图层及过渡参数说明 | 共享块重复引用仅拼一次；冲突块名拒绝；全部登记入口在真实 GPU 编译，完整 GPU 专项通过 |
| 6 定义循环 | `effectIndex.ts` 写明定义模块不得直接或间接引用 `builtinEffects.ts` 的值，允许 type 导入 | 测试逐个独立导入当前索引指向的定义模块，每次清空模块缓存，不依赖 builtinEffects 预先初始化 |
| 7 入口类型 | `definePlanner` 用 const 泛型保留入口字面量；现有规划均接入。装配处额外拒绝整个入口并集被放宽为 string | 不写 `as const` 的内联入口仍推导成字面量；错误入口有编译期反例，两套 tsc 通过 |
| 8 spaces | `normalizeVideoEditBuiltinParams` 默认按片段校验，作者显式走 layer；静态诊断对动态值也检查空间；`validateVideoEditLook` 在名称解析校验期检查成员参数、曲线及旋钮目标，早于动画求值 | 片段拒绝 layer/frame 专用参数与非法 base；作者工厂/描述静态诊断拒绝 clip 参数；look 成员显式参数及停用成员曲线在校验期拒绝 |
| 9 基础规划 | 用 `passPlan` 收口工序容器与结果，删除重复 plan/finish、空 entries/wgsl、多余作用域与无用参数 | 既有规划/精度精确测试，以及真实 GPU 逐位比较 |

### 给 U1、U2、U3、U9 等叠加单元的接入说明

1. 两个索引继续按现有的一行 `export { ... } from '...'` 格式登记。本次没有重排或改写登记行，`effectIndex.ts` 仅增加依赖约束注释，`effectPlannerIndex.ts` 未改。新文件与两个索引的并行接入方式保持一致。
2. **新增第三处登记文件 `src/core/videoEdit/effectCatalog.ts`**：把新 id 插进第 13 节对应组的 `ids` 数组和位置。颜色组在反相后插入渐变映射、色调分离、胶片模拟；其他组同理。目录是显示顺序与分组的来源，不依赖导出名字母序，也不提供漏排回退。每个登记 id 必须出现且只出现一次。
3. 规划使用辅助函数，不给导出的对象再注解成宽 `EffectPlanner`：

   ```ts
   import { definePlanner } from './effectPlanner'
   import { EFFECT_MATH_BLOCK } from './effectShaderPrelude'

   export const EXAMPLE_PLANNER = definePlanner({
     id: 'example',
     entries: ['example_entry'],
     shared: [EFFECT_MATH_BLOCK],
     wgsl: EXAMPLE_WGSL,
     plan: (params, frame) => planExample(params, frame.width, frame.height),
   })
   ```

   内联 `entries` 无须 `as const`。已有常量元组也可直接传入。没有自有入口或 WGSL 时省略相应属性；基础公共入口由前导块提供。新模块自己的规划函数保留正式返回类型，避免通过整个登记数组反推结果类型。
4. **共享块只声明引用，不内嵌文本**：公共块为 `COLOR_MATH_BLOCK`、`EFFECT_MATH_BLOCK`、`BASIC_EFFECT_BLOCK`；它们已由全局前导块提供，再引用也只拼一次。其他共用函数定义成 `{ name, wgsl }` 具名块，通过 `shared` 引用；同一块名必须对应相同内容。效果自己的 `wgsl` 只放自有函数和入口，不能再次插入 `${EFFECT_SHADER_MATH_WGSL}`、`${COLOR_MATH_WGSL}` 或基础 ABI 文本。
5. 定义模块只依赖纯定义/参数/几何模块，不从 `builtinEffects.ts` 或会回到它的 `compositing.ts`、`keyframes.ts`、`smartRegionPresets.ts` 取运行时值。参数构造从 `effectParams.ts` 取；类型可以 `import type`。
6. U2 替换反相时删除或原地替换已有定义、规划项，不保留第二份同 id；目录里保留唯一 `invert`。空间专用参数请声明 `spaces`，缺省参数不会把不适用空间的字段补进作者描述。
7. 当前内容版本为剪辑 **51**、录制 **54**；作者接口 **8**、代码版本记录 **9**、代码资产 **14**。后续格式变更按当时 main 顺延，不能复用已登记编号。

### 合并与门禁失败的根因处理

- 开始吸收 `022259db8` 时，按裁定保留 U13 的 v49/v52。期间 main 又合入 U12 `535d9bd7f`，占用 v50/v53，因此再次 `git merge main` 并把 U0 顺延为 v51/v54；没有修改 U13/U12 的四份既有样本或承诺。
- 生成器合并曾让旧音频夹具覆盖作者 v8/all，新迁移用例实际报错，独立审查也指出这一重要问题。最终生成器保留完整音频持久位置，由当前正式构造器提供作者定义与内联 all 声明，再接入 U12 的过渡案例；新样本同时覆盖三者。音频测试仍严格比较迁移输出、全部音频序列、曲线、预设及非作者字段；合法演进的作者源码与接口由独立迁移用例验证。
- 旧存档测试直接把 v47 原始内容交给当前 schema，碰到 U13 已合并的旧音频 id。测试改用正式逐版本迁移入口，再验证移除效果与越界参数；未放宽生产 schema 或原有断言。
- U12 新增的 `transitionCatalog.ts` 直接访问 `visibleWhen.in`，与 all 联合类型不兼容。该处负责扩展方式条件，增加 `in` 类型收窄即可保持原行为；沿剪辑 core、engine、面板与独立预览检索同类属性访问，其他同语义入口已使用共用函数，未发现第二处漏接。

### 最终验证与边界

- `npm run verify:changed -- --level L2 <显式本次文件...>`：**通过**。显式清单 48 个运行时/测试/产物路径，结果为 **18 文件、419 项测试通过，零失败/跳过**；文件级 ESLint、渲染层 tsc、Electron tsc、界面表面/颜色/图标/残留/间距动效、依赖图、主进程传递导入与格式基线全部通过。设计所有权单格修改另按 L0 核对。
- 真实 GPU：正式专项 **31 项通过**，包含所有登记入口编译。修复前在 `3fba9c4d9` 保存了 **20 个原生效果默认画面**，最终代码再次渲染，逐字节比较完全相同，共 184,320 字节；未改变阈值或更新像素快照。比较探针已移除，正式编译回归保留。
- `check:author-effects`：通过，四份作者生成声明/工厂只调整目录顺序，接口内容不变。
- `check:persistence-compat`：通过，66 种格式；baseline、release-snapshot 使用实际合并父提交的不可变承诺作保护基准，避免运行期间 main 前移影响比较。提交后另用默认 HEAD 保护检查确认最终承诺。
- `check:assistant-capabilities`：整体退出码 0；结构检查通过，覆盖 **1 文件 15 项**、不变量 **31 文件 238 项**全部通过。
- 独立干净上下文审查 **3 轮**：第一轮无问题；第二轮 1 项重要问题为黄金样本覆盖新版作者语法，已修复；第三轮无新增重要或小问题。后续完整门禁发现的音频样本覆盖与旧夹具入口、过渡联合类型问题也已修复并通过匹配验证。
- 精确范围涵盖两个登记表、全部当前定义模块、目录投影、共享着色器、基础规划、片段/作者/风格件参数空间及合并后的音频/过渡迁移。没有新增真实 Electron 窗口或性能验收结论。
- 可复现清单与日志位于任务工作目录忽略区：`.tmp/u0-final-files.json`、`.tmp/u0-final-verify.ps1`、`.tmp/u0-final-checks-complete.log`、`.tmp/u0-required-gates.log`；GPU 基线为 `.tmp/u0-gpu-*.bin`，采集/比较注入脚本为 `.tmp/u0-edit.py`。运行正式 L2 不依赖这些二进制基线；只有重新注入比较探针时才读取它们。

### 提交与交付状态

- 修复登记骨架：`839a879b5`。
- 吸收 U13 并处理首轮顺延：`7d2bda4a7`。
- 吸收 U12、最终顺延和门禁修复：`94893a6cb`。
- **最后一步 `git merge main`** 吸收其后仅含 U9 审查记录的 `ea7bdbefb`，产生最终 **HEAD `2e520e03d`**；无冲突、无运行时代码增量，复用已通过证据。祖先检查确认最新 main 已包含。
- 最终分支仍为 `task/19-U0-登记骨架`，任务工作区干净；只在该分支提交，未合并到 main、未切分支、未推送。未安装/卸载依赖，node_modules/FFmpeg 联接点未删除，未占用 9334，未访问 `D:\视频制作`。主工作区的直接修改仅为用户允许的共享 `tickets/19` 下本结果文件与 design.md 的 U2 单格。
