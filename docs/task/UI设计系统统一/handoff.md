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

基线：`vitest` 479 通过 / 11 跳过；`tsc` 仅存量 `src/core/imageEdit/worker/webgpuRuntime.ts` 报错（与本任务无关，可忽略）。

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

（本文件在阶段交接时更新）
