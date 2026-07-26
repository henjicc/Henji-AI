# 交接说明

给**没有历史对话**的 AI 编程工具看的接手指引。开始任何工作前请先读完本文件。

## 一、这个任务在做什么

给 Henji-AI 建立一套可被 AI Agent 执行的 UI 设计系统，并迁移存量页面。背景与完整方案见：

1. `00-任务总览.md` — 总入口，看进度与任务跳转
2. `01-实施方案.md` — 稳定方案，看现状分析与技术策略
3. `重要记录.md` — 六条已确定的关键决策，**这是理解为什么这么做的关键**
4. 具体任务文件 — 在 `任务/第N阶段-.../` 下

## 二、必读的规则来源

**界面工作开始前必须先读 skill `.claude/skills/henji-ui-surface/SKILL.md`。** 它是 UI 规则的唯一权威来源（五级容器词汇表、卡片准入条件、决策树、复用对照表、自检清单）。任务文件只描述"改什么"，不重复规则本身。

项目通用约束见 `CLAUDE.md`，尤其：配置驱动、禁止跨层导入、原生标签只在 `primitives.tsx`、颜色只在三处改。

## 三、当前基础设施（已完成，不要重做）

本计划创建前已有两次提交奠定基线：

- `eb74657`：`UiPanel` 的 `inset`/`bare` 变体、`scripts/check-surface-tokens.cjs`、skill `henji-ui-surface`、生成进度瞬态 store（`src/stores/generationTaskProgressStore.ts`）
- `4800cf0`：`text-4xs/3xs/2xs` 字号令牌与 156 处迁移、`shadow-panel`、z-index 语义档位定义、排版五档令牌、`UiRegion/UiGroup/UiPageHeader/UiFormRow/UiToolbar`、`UiEmpty/UiLoading/UiError`、Settings 试点去卡片化

可用的组件与令牌落点：

| 用途 | 落点 |
|---|---|
| UI primitives（唯一原生标签落点） | `src/components/ui/primitives.tsx` |
| 零装饰布局容器 | `src/components/ui/layout.tsx` |
| 空/加载/错误状态 | `src/components/ui/states.tsx` |
| 视觉令牌（组件层） | `src/components/ui/styleTokens.ts` |
| 语义色/字号/阴影/层级 | `tailwind.config.js` |
| CSS 变量 | `src/index.css` |
| 统一导出口 | `src/components/ui/index.ts` |

## 四、常用检查命令

```bash
node scripts/check-surface-tokens.cjs      # 表面层级检查（告警式）
npm run check:surface:strict               # 同上，违规 exit 1
npm run check:colors                       # 颜色硬编码
npm run check:model-i18n                   # 模型 i18n
npm run lint                               # ESLint
npx tsc -p tsconfig.json --noEmit          # 渲染层类型检查
npx vitest run                             # 单元测试
```

基线：`vitest` 479 通过 / 11 跳过；双侧 `tsc` **全绿**（`webgpuRuntime.ts` 的存量 TS2206 已在 1.4 中修复）。

## 五、执行纪律（用户明确要求）

1. **手动测试项一律不由 AI 断言**，全部收集到 `test-report.md`，留到最后交用户统一执行。任务文件里的「需要用户手动验证的交互点」要同步汇总进去。
2. **必要时主动 `git commit`**，提交信息用简体中文（可保留 Conventional Commits 类型前缀与代码标识符）。
3. **每个阶段开始前与结束后**都要读/更新五个记录文件：`progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`。
4. 每次改完代码要明确告知用户**是否需要重启 `npm run electron:dev`**。
5. 性能类结论**禁止编造数据**，无法实测就如实说明需用户验证并给出可复现方法。
6. 不擅自重新编号已有任务；发现计划与实际不符先更新任务文件。
7. 只做当前任务范围内的事，不顺手做别的任务。

## 六、接手时的下一步

看 `00-任务总览.md` 的「当前进度」与「任务清单」，找到第一个非「已完成」的任务，读它的任务文件，按其「执行步骤」做。

## 七、第一阶段交接（2026-07-25）

**状态：第一阶段（1.1/1.2/1.3）全部完成，下一步进入第二阶段。**

第一阶段落地了什么（接手时可以直接用，不要重复建设）：

| 能力 | 怎么用 |
|---|---|
| `veil` 六档白色半透明 | `bg-veil-faint` / `border-veil-subtle` / `border-veil-soft` / `border-veil` / `border-veil-strong` / `from-veil-bright` |
| 具名特效阴影 | `shadow-panel`(浮层) / `shadow-node-selected` / `shadow-node-error` / `shadow-thumb` / `shadow-thumb-sm` |
| 字号档位 | `text-4xs/3xs/2xs/13/14/15` + `text-xs/sm/base+` |
| z-index 十档 | `z-raised/sticky/dropdown/panel/modal/viewer/toast/tooltip/drag/titlebar` |
| 内联 zIndex | `Z_LAYERS`（`src/core/theme/zLayers.ts`） |
| 画布节点描边 | `NODE_SELECTED_BORDER_CLASS` / `NODE_IDLE_BORDER_CLASS` / `NODE_IDLE_BORDER_STATIC_CLASS`（`src/features/canvas/ui/nodeControlStyles.ts`） |

**第二阶段要注意的几个坑（都是第一阶段踩出来的）：**

1. **透明度修饰符只能用 Tailwind 刻度值（步进 5）**。`bg-black/72`、`border-white/42` 这类不生成任何 CSS，既不报错也没效果。需要精确值用 `bg-black/[0.72]`。第一阶段已修 8 处这类静默失效。
2. **ESLint 现在会硬拦** 内联字号/阴影/z-index/圆角/rgba 字面量。写了会直接报错，按提示改用登记档位。
3. **`grep` 排查时不要只扫 `.tsx`**。第一阶段就因此漏掉了 `.ts` 里的 `z-[1000]`，靠 ESLint 才发现。
4. **改共享组件优先于逐页面改**。Settings 试点已验证：`SectionCard` 一处改动覆盖 15 个调用点。第二阶段的 2.3（弹窗）、2.4（播放器）同样应先找杠杆点。
5. **`check:surface` 的 `[C]` 手写弹窗基线是 15 处**，其中 3 个媒体查看器已确认豁免（记录 003），2.3 的目标是把剩余 12 处清掉。

**未达成/遗留：**

- 圆角标准类之间的档位收敛（约 285 处）**有意未做**，见 `decisions.md` D-003。
- CI 未接入，因为 `.github/workflows/build.yml` 本身已失效（Tauri 残留），见 `重要记录.md` 记录 007。
- 第一阶段的手动验证清单在 `test-report.md` 第二部分，**用户尚未执行**。若用户反馈某项有问题，先修再推进第二阶段。

## 八、全部阶段完成后的交接（2026-07-25）

**状态：三个阶段的代码工作全部完成，等待用户手动验证。**

新增的可复用能力（在此基础上继续开发，不要重复造）：

| 能力 | 用法 |
|---|---|
| 内嵌表面 | `<UiPanel variant="inset">`；非 div 元素用 `UI_INSET_SURFACE_CLASS` |
| 元信息徽标 | `UI_META_BADGE_CLASS` / `UI_META_BADGE_ACCENT_CLASS` |
| 长列表跳过渲染 | `UI_LIST_ITEM_SKIP_TALL_CLASS` |
| 播放器表面 | `<AudioPlayer surface="plain">`（宿主已有层级时） |
| 弹窗 | 一律 `UiModal`；它已自带 `data-dialog`、portal、过渡 |

**门禁已是强制的**：`check:surface:strict` 进了 `build` / `electron:build` / CI，
ESLint 硬拦内联字号/圆角/阴影/z-index/rgba。写违规写法会直接构建失败。

**三条踩过的坑，别再踩：**

1. **Tailwind 只认字面量类名**。`` `[contain-intrinsic-size:auto_${h}]` `` 这种运行时拼接
   扫描不到，CSS 根本不生成。令牌一律写成字面量常量。
2. **透明度修饰符只能用刻度值**（步进 5）。`/42`、`/72` 这类不生成任何 CSS。
3. **JSX 注释不能放在表达式位置**。`{cond ? ( {/* c */} <El/> ) : null}` 是语法错误；
   注释要放在 `{cond ? (` 这一行之上，或写成 `className={/* c */ "..."}`。

**未完成/待用户决定：**

- 3.2 是否还需进一步优化 —— 看用户对 `test-report.md` **L 组**的实测感受（D-008）
- CI 在真实 runner 上的打包与发布未验证（`test-report.md` **M 组**）
- 圆角标准类之间的档位收敛（约 285 处）有意未做（D-003）

## 九、收尾：选项集合静息态（2026-07-26）

用户对着截图反问"鼠标没停留、也不是选中项时是不是不该有边框背景"，由此追加的一轮收敛。

新增能力：**`<UiOptionButton variant="menu">`** —— 容器内并列可点项的标准写法，
静息无边框无底色，hover 出 `bg-layer`，选中态实底。判据与 12 个刻意保留边框的位置见 D-009，
长期规则已写进 skill 的「选项集合的静息态：不描边」一节。

**第四条坑（新增，和第 1、2 条同源）：**

4. **同一 CSS 属性上叠两个工具类时，胜负看 Tailwind 产物顺序，不看 className 顺序**。
   `menu` 变体因此刻意不写 `bg-transparent`（button 的透明背景本来就由 preflight 保证），
   否则会和调用方补的 `bg-veil-faint` 打架。要叠之前先用 `npx tailwindcss` 生成 CSS 确认谁在后面。

**记录缺口已补**：`test-report.md` 此前只覆盖第一阶段，第二三阶段的手动验证项散在各任务文件里。
现已汇总为 A~N 共 14 组，并在文件开头给出「组 → 来源任务」对照表。

**继续开发时的落点**：新写"一堆并列可点项"的界面，先看 skill 那一节的两条判据，
不要再在调用点手写 `!border-transparent !bg-transparent hover:!bg-layer`。
