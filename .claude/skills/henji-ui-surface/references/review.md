# 界面核对规范与操作工具

（`henji-ui-surface` 的参考文档。改完界面做视觉验收、按区域逐项核对全界面、判断“是不是旧界面残留”时读这份。）

## 1. 什么是“核对”

用程序真实打开软件（自动化测试实例），点到每一个界面和状态，在四个预设下截图，由 Agent 逐张打开看、按第 2 节挑问题，有问题就按根因修复，修完用同一套步骤再截图确认。

和“场景验收”的区别：清单是**穷举**的——每个界面 × 每个关键状态 × 每类数据变体（例如生成页要覆盖每一个模型的参数），每一行最后都要打勾，不靠抽样。判断标准是“用户能否一眼看清”，不只是“是否符合当时的规则”。

为什么必须穷举：2026-10-04 用户发现的三个问题（模式不在第一位、节点行悬停同色、选中项看不清）都漏过了已有验收——验收场景用的模型参数少、没截节点行的悬停态、没打开模式菜单，而且当时的规则本身（中性抬升选中态）就有问题。

## 2. 核对项（每张截图逐项看）

| 核对项 | 判据（任一不满足即记为问题） |
|---|---|
| 骨架 | 窗口顶到内容区最多两条带（命令带 + 从属带）；不套卡片；同一视图横向内边距一致 |
| 单行与收纳 | 工具条、底栏、命令带在 960 与 1440 下都不折行；放不下的按优先级收进“更多”浮层 |
| 顺序 | 决定其余参数含义的选择（渠道、模式、版本）排第一；主动作位置固定；同类界面顺序一致 |
| 状态可辨 | 选中、悬停、聚焦、按下、禁用一眼可辨且互不同色；选中用强调色指示（淡强调底 + 强调色文字/勾，或强调色指示条），悬停只用中性抬升；悬停或选中的容器里行内控件仍可区分 |
| 文字 | 常见中文选项与标签不截断，必须截断时悬停可看全；不竖排折行；数字与单位不分行；术语统一 |
| 对比度 | 像素审计通过（正文 ≥ 4.5，大字与图标 ≥ 3）；四个预设都可读，纸白下无发灰白纱 |
| 尺寸与对齐 | 控件高度只用 28/32/36（特例已登记）；字号只用登记档；圆角 6/8/12 且内层不大于外层；同一行基线对齐、同一列左缘对齐；间距成档 |
| 一致性 | 同类控件同一组件、同一尺寸；返回入口三种形态；同一动作在各处图标与文案一致 |
| 动作层级 | 一个表面只有一个强调色实底主动作；同组动作同档；破坏性动作静息静默 |
| 浮层 | 贴近触发点、不被裁切、宽度适配内容；Esc 关闭；嵌套浮层内操作不关父浮层；键盘可上下选择 |
| 滚动 | 滚动条样式统一；没有双滚动条或滚动陷阱；长列表不卡 |
| 三态 | 每个数据区的空、加载、错误都看到过，且走 `UiEmpty` / `UiLoading` / `UiError` |
| 信息准入 | 不展示内部 ID、版本、哈希、缓存或管线状态；技术限制写成用户能判断的后果 |
| 图标 | 只用 lucide 或确属图形的 SVG，同一条带图标尺寸与线宽一致；禁止 emoji 与符号字符 |
| 观感 | 打开、切换、滚动无可见卡顿、闪烁或无样式中间态 |

## 3. 什么算“旧界面残留”

- **代码残留**（脚本可数，`npm run ui:residue` 出报告）：旧 Tailwind 别名类与旧 CSS 变量；`text-[Npx]`、`h-[37px]` 这类任意值类；内联 `style` 写颜色或尺寸；调用点覆盖组件外观；`ui-surface-allow` 行级豁免（逐条复核理由）；`check:colors` 登记项；组件自带 CSS 里的私有变量与写死值；旧组件、平行实现与死代码；旧文案（如“工具箱”）。
- **视觉残留**（只能看出来）：仍是旧布局（卡片套卡片、多条带、逐项描边的选项）、旧按钮外观、蓝色实底选中、与同类新界面长得不一样、与设计稿关键结构不符。

`ui:residue` 按类别、按文件、按区域（依据界面计划 5.1 盘点的界面表，未登记文件按目录归区域）输出 `.ui-tour/residue/residue-report.{md,json}`。它是报告模式：内联 style（端口类型色、拖动尺寸等动态值）、私有 CSS 类（画布 LOD/性能机制类）、零引用候选都要逐条判定，计数不等于都要删。

## 4. 操作规范

1. 只用自动化测试实例（共享启动器，已静音），放副屏（工具默认 `HENJI_DEV_DISPLAY_POINT=2561,1`，显示器变化时重新核对并用 `--display-point` 覆盖）；不操作、不静音、不结束用户自己的开发实例；结束后只关本次启动的测试进程树。
2. 默认临时资料目录 + 仓库夹具；要看真实模型列表或供应商配置时用 `--profile real` 只读，不带 `--allow-writes`。不触发真实付费生成：“生成中 / 完成 / 失败”等状态用夹具或场景内模拟结果；确需付费调用先问用户或主控。
3. 用已登记的开发导航参数、正式应用能力或界面点击进入，不猜 ID、不建无关工程；入口缺失就记为问题或补开发导航参数。
4. 按可访问名称与角色定位元素，不写死坐标；每步后等动画、字体、图片、浮层定位稳定再截图。
5. 用正式截屏（Electron `capturePage`），不在窗口缩放下用 CDP 裁剪。每个界面：石墨、深海、胶片、纸白 × 1440×900，加石墨 × 960×640（`--matrix review`）；数据变体多的（如全部模型）先在石墨 1440 + 960 全量跑（`--matrix screen`）并用自动指标（行数、溢出、截断）筛出可疑项，可疑项与代表项再跑 `--matrix review`。
6. Agent 必须打开每张截图看，配合像素对比度审计（`--contrast`）；DOM 断言与自动指标通过不等于视觉通过。
7. 每个区域任务里维护“核对清单”（每行一个界面 × 状态，逐项打勾）和“问题记录”（编号、级别、界面/状态、截图路径、现象、违反的核对项、根因、修复、复验截图）。截图放 `.ui-tour/` 下，不进仓库。
8. 问题分级：P0 不可用或有数据风险；P1 看不清、点错、错位、折行、截断、顺序错、状态不可辨、对比度不达标；P2 一致性与细节。P0、P1 必须修复复验；P2 同区域顺手修，跨区域的统一问题集中处理。
9. 按根因修共享组件、令牌或模型展示补丁，并排查同源问题；改了共享组件要在执行记录写明影响到的其他区域，后续区域核对时复看。有回归价值的路径固化为 `ui:tour` / Reality 场景或 `scripts/ui-review/` 步骤描述。

## 5. 单个区域的流程

读清单中本区域的行 → 写或复用操作步骤（第 6 节）→ `--matrix review` 截图（变体多的先 `--matrix screen` 筛）→ 逐张看并对照 `ui:residue` 的本区域报告 → 填问题记录 → 按根因修复与精确测试 → `electron:bundle` → 同一步骤复跑与复验截图 → 清单逐行打勾。

## 6. 操作工具：`ui:tour --steps`

不另起启动链：步骤描述编译成与 `ui:tour` / `check:ui-visual` 同一套的场景，复用共享启动器（隔离资料、静音、副屏）、窗口尺寸、正式截屏、运行时错误证据与多预设。

```bash
# 一个界面的标准五张 + 对比度审计 + 自动指标
npm run ui:tour -- --steps scripts/ui-review/generation-seedance-kie.json --matrix review --contrast --out .ui-tour/review/seedance
# 全部模型：石墨 1440 + 960 全量筛查，看 index.md 里的“自动指标可疑项”
npm run ui:tour -- --steps scripts/ui-review/generation-all-models.json --matrix screen --out .ui-tour/review/all-models
# 真实模型列表只读
npm run ui:tour -- --steps scripts/ui-review/generation-all-models.json --matrix screen --profile real
# 同一份步骤也能跑 DOM 规则审计
npm run check:ui-visual -- --steps scripts/ui-review/generation-seedance-kie.json --matrix review
```

参数：`--steps <文件>`（可重复或逗号分隔；有它时只跑步骤描述，仍受 `--only` 过滤）；`--matrix review|screen`（与 `--size` / `--theme-preset` 互斥）；`--contrast`（每张截图后做像素对比度审计，写 `contrast.json`）；`--display-point <x,y|none>`。运行产物仍要是最新的（`electron:bundle`）。

产物：每个预设一个目录，`index.md`（截图索引、自动指标可疑项、对比度不达标、失败场景）、`metrics.json`、`contrast.json`、`evidence.json`、截图 `<尺寸>-<场景id>-<后缀>.png`。

### 文件格式（JSON 或导出同结构对象的 .cjs）

```jsonc
{
  "id": "review-generation-seedance-kie",   // 小写字母、数字、连字符
  "surface": "生成", "name": "核对-Seedance 2.0 KIE 底栏与模式菜单",
  "checklist": ["G07"],                     // 可选：对应清单行，只作记录
  "writesUserData": false,                  // 写业务数据（如画布夹具工程）时必须 true；real 模式下会被跳过
  "expectedLogEvents": [],                  // 可选：场景有意制造的失败日志事件（如助手替身返回 HTTP 500），记入证据不判失败
  "launchArgs": [], "launchEnv": {},        // 只在本次只运行这一个场景时生效
  "prepare": [ /* 步骤：变体开始前执行一次 */ ],
  "variants": [ { "modelId": "…", "providerId": "…" } ]   // 或 { "source": "generation-models", "include": ["/seedance/i"], "exclude": [], "limit": 0 }
  "steps": [ /* 步骤：每个变体执行一次；字符串里 {{字段}} 替换为变体字段 */ ]
}
```

每个步骤是 `{ "动作": 参数 }`，可加 `"optional": true`（失败只记跳过）、`"timeout": 毫秒`（默认 8000）、`"ifPresent": 定位`（该元素此刻不可见就整步跳过，例如只在 960 出现的“更多”）。

| 动作 | 参数 | 说明 |
|---|---|---|
| `enter` | `"generation"`/`"canvas"`/`"toolbox"`/`"assets"`，或 `{ "surface": "tool.image_edit", "media": "docs/ref/test01.jpg" }` | 工作区标签页；surface 走开发导航参数重载渲染层 |
| `click` / `doubleClick` / `rightClick` / `hover` | 定位 | |
| `focus` | 定位，或 `{ "target": 定位, "keyboard": false }` | 默认先按一次 Shift，让 `:focus-visible` 生效 |
| `press` | `"Escape"` 或 `{ "key", "target"? }` | |
| `fill` | `{ "target": 定位, "text": "…" }` | |
| `open` | 触发器定位，或 `{ "trigger": 定位, "expect": 定位? }` | 点开浮层并等它出现（默认等任一菜单/列表/面板/对话框） |
| `drag` | `{ "from": 定位, "to": 定位 或 { "dx", "dy" }, "steps": 8, "release": true }` | `release: false` 时按住不放，可截拖动中状态，再用 `release` |
| `scroll` | `{ "target": 定位, "dy": 240 }` | 鼠标滚轮 |
| `waitFor` | 定位，或 `{ "target", "state": "visible"/"hidden" }` | |
| `waitStable` | `{}` 或 `{ "target": 定位 }` | 字体就绪、图片解码完、有限次动画与过渡结束、目标几何连续两次一致 |
| `wait` | 毫秒 | 只用于确实没有可等条件的场合 |
| `escape` | `{}` | 关闭浮层与弹窗（与正式场景同一实现） |
| `selectModel` | `{ "modelId", "providerId", "search"? }` | 生成页模型面板里按 `data-model-id` / `data-provider-id` 点选 |
| `seedCanvas` | `{ "nodes": [...], "edges": [], "viewport": {…} }` | 把节点写进巡检专用画布工程并打开（需 `writesUserData: true`） |
| `seedAssistant` | `{ "replies": [...], "capabilities"?: ["image"], "memory"?: "…", "newConversation"?: true }` | 本机流式模型替身 + 隔离助手模型配置（不访问外部模型、不产生费用）；每轮回复可含 `thinking`、`partial`（暂停前先流出的半截正文）、`content`、`tool`（只读工具）、`error`（HTTP 状态）、`hold`（暂停到 `releaseAssistant`）。要在打开助手侧栏前执行；场景结束自动停止助手、关闭替身、恢复模型配置（需 `writesUserData: true`） |
| `releaseAssistant` | `{}` | 放行 `hold` 暂停中的那一轮回复 |
| `setFiles` | `{ "target": 定位, "files": ["resources/icons/icon.png"] }` | 给文件输入（默认可定位隐藏元素）设值，等同用户选了文件；路径相对仓库根目录 |
| `capture` | `"后缀"` 或 `{ "name": "后缀", "metrics": 指标目标? }` | 正式截屏；带 metrics 时同时记自动指标 |
| `metrics` | `{ "name": "后缀", …指标目标 }` | 只记指标不截图 |

**定位**（优先 role + name，最后才用 selector）：`role`、`name`（字符串或 `"/正则/i"`）、`exact`、`text`、`label`、`placeholder`、`selector`、`hasText`、`within`（在另一个定位里找）、`nth`（序号或 `"last"`，默认第一个可见的）、`closest`（向上找最近的 CSS 匹配祖先）、`commonAncestorWith`（与另一个定位的最近公共祖先，适合“包含模型触发器和生成按钮的那一条底栏”）、`includeHidden`。

**指标目标**：定位字段 + `maxRows`（默认 1：工具条、底栏、命令带必须单行；表单、菜单传 `null` 不判行数）。自动指标包括：视觉行数（可交互件按竖直重叠分行）、容器与件超出容器/窗口、文字截断（并区分悬停能否看全）、≤12 字短标签折行。可疑项列在 `index.md` 最前面，先看这些截图；指标只用来筛，不能替代目视。

每项指标还带 `texts`（目标里可见文字，用来列出“底栏上有哪些参数 / 收进更多参数的是哪些”）、`triggerCount`（下拉与面板触发器个数）和 `slack`（容器宽减去直接子元素宽度之和，单行收纳容器 `[data-ui-overflow-row]` 上就是还空着的宽度）。

**变体来源** `generation-models`：从真实模型选择面板读出全部可选的“模型 × 渠道”，每个变体带 `modelId`、`providerId`、`name`、`id`（截图后缀前缀）。单个变体失败不中断其余变体，最后汇总报失败。有变体时 `ui:tour` 另写 `variants.md`：按“变体 × 尺寸”列出底栏行数、收纳行空余、底栏可见参数、收进“更多参数”的参数与可疑原因（折行、溢出、截断、短标签折行、收纳行空余 ≥ 120px 却仍把选择器收进“更多参数”）。指标名约定 `bar` / `row` / `more` / `first-menu`；对旧输出目录补汇总用 `node scripts/lib/uiReviewSummary.cjs <输出目录>`。

样例：`scripts/ui-review/assistant-sidebar.json`（助手侧栏空态、思考中、工具调用、长 Markdown、流式、排队、错误、历史、记忆、附件，用 `seedAssistant` 夹具）、`scripts/ui-review/generation-seedance-kie.json`（底栏、模式触发器悬停、模式菜单、960 的“更多参数”）、`canvas-image-node-rows.json`（画布图片生成节点的行悬停、触发器悬停、选中后行悬停、参数菜单）、`generation-all-models.json`（全部模型底栏行数与首个参数菜单截断）。
