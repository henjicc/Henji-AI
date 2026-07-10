# 简易模式时间轴重做 · 测试报告（第一阶段：1.1 + 1.2 + 1.3；第二阶段：2.1 + 2.2 + 2.3）

## 第二阶段自动化检查结果（2.3 完成时的最终状态）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm run test`（vitest） | ✅ 9 个测试文件、76 条用例全部通过 |
| 前端 lint | `npm run lint` | ✅ 0 error / 0 warning |
| 主进程类型检查 | `npx tsc -p tsconfig.electron.json --noEmit` | ✅ 无报错 |
| 颜色规范 | `npm run check:colors` | ✅ 未检测到十六进制颜色直写 |
| 原生控件检查 | 人工 grep `<button\|<input\|<select\|<textarea>` | ✅ 新增/修改文件零命中，均走 `Ui*` primitives |
| Electron 主进程 lint（2.3 阶段收尾要求） | `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | ✅ 0 报错（本阶段未改动 electron 目录，回归确认无影响） |
| 文件行数治理（2.3 阶段收尾要求） | 人工检查 `cameraStage/simple` 下 `.ts/.tsx` | ✅ 新增文件均 ≤400 行（`useClipTrim.ts` 133 行、`useClipReorder.ts` 144 行）；目录内无 >500 行文件 |

## 第二阶段新增测试文件

| 文件 | 用例数 | 覆盖内容 |
|---|---|---|
| `simple/timeline/useClipReorder.test.ts` | 6 | `computeInsertIndex` 纯函数：最左/最右边界、相邻中线之间、恰好等于中线、空数组、单候选左右两侧 |

## 第二阶段阶段性运行记录（按任务完成时间点）

- 2.1+2.2 完成时：`npm run test` 76/76 通过（新增 6 条 `useClipReorder` 用例）
- 2.3 完成时：`npm run test` 仍为 76/76（本任务无新增用例，纯回归确认无破坏）

## 第二阶段未覆盖 / 需要人工验证的部分

trim 拖拽、重排拖拽、滚轮缩放均为鼠标交互，`computeInsertIndex` 之外的拖拽会话逻辑（阈值判定、pointer capture、实时预览、提交时机）未做自动化测试，需要用户在真实 Electron 窗口（`npm run electron:dev`）手动验证，具体步骤见 `2.1-块边缘拖拽调时长.md`/`2.2-变宽块拖拽重排.md`/`2.3-滚轮缩放与阶段打磨.md` 的"执行记录"章节：

- 2.1：右边缘拖拽调时长按帧吸附、最小 1 帧（静止）/0 帧（过渡）、拖拽实时预览、后续块顺移、一次拖拽一条撤销记录、Escape 取消、过渡拖到 0 帧变硬切再拖回
- 2.2：块身拖拽重排顺序正确、过渡跟随、拖到自身位置无变化、点击/双击/边缘 trim 不受影响、一次重排一条撤销记录、Escape 取消
- 2.3：Alt+滚轮缩放锚点不漂移、缩放范围受 40~600px/s 约束、打开工程默认自适应铺满、200px/s 以上标尺切帧刻度、整体流畅度

## 已知非本任务引入的问题

- `npm run electron:smoke` 存在上一任务计划遗留的资源 403 问题（见 `01-实施方案.md` 风险节），本阶段快速检查清单未要求跑该脚本，未验证是否命中，不算本任务引入。

---

# 第一阶段：1.1 + 1.2 + 1.3

## 自动化检查结果（1.3 完成时的最终状态）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npm run test`（vitest） | ✅ 8 个测试文件、70 条用例全部通过 |
| 前端 lint | `npm run lint` | ✅ 0 error / 0 warning |
| 前端类型检查 | `npx tsc --noEmit` | ✅ 无报错 |
| 主进程类型检查 | `npx tsc -p tsconfig.electron.json --noEmit` | ✅ 无报错 |
| 颜色规范 | `npm run check:colors` | ✅ 未检测到十六进制颜色直写 |
| 原生控件检查 | 人工 grep `<button\|<input\|<select\|<textarea>` | ✅ 新增/修改文件零命中，均走 `Ui*` primitives |

## vitest 用例明细（新增/改动的测试文件）

| 文件 | 用例数 | 覆盖内容 |
|---|---|---|
| `simple/timeline/shotClipGeometry.test.ts` | 20 | 帧量化边界、hold/transition 钳制、`buildClipLayout` 布局与 0 帧过渡零宽块、`findClipAtTime` 边界命中、`isTimeInShotStaticSegment`/`isTimeInTransition` 静止段/过渡段判断与半帧容差 |
| `simple/timeline/shotTimecodeFormat.test.ts` | 5 | 纯秒/纯帧/秒:帧三种格式化、循环切换顺序、负数钳制 |
| `store/shotSlice.test.ts` | 8（新增 1） | 存量 7 条 + 新增"播放头不在选中卡静止段内时不捕获编辑"回归用例 |
| 其余存量（`shotCompiler.test.ts` 等） | 37 | 未改动，确认无回归 |

## 阶段性运行记录（按任务完成时间点）

- 1.1 完成时：`npm run test` 59/59 通过（新增 15 条 `shotClipGeometry` 用例）
- 1.2 完成时：`npm run test` 64/64 通过（新增 5 条 `shotTimecodeFormat` 用例）
- 1.3 完成时：`npm run test` 70/70 通过（新增 5 条 `shotClipGeometry` 只读段判断用例 + 1 条 `shotSlice` 捕获守卫回归用例）

## 未覆盖 / 需要人工验证的部分

自动化测试只覆盖纯函数（`shotClipGeometry.ts`/`shotTimecodeFormat.ts`）与 store 分片逻辑（`shotSlice.ts`）；以下均为鼠标交互/视觉表现，需要用户在真实 Electron 窗口（`npm run electron:dev`）手动验证，具体步骤已写在对应任务文件"执行记录"章节：

- 1.2：块宽比例是否准确、标尺 scrub、点击/双击/悬浮删除、添加片段插入位置
- 1.3：过渡气泡开关与定位、硬切竖线可点击可恢复、gizmo 隐藏与只读提示条、过渡段编辑不误录、新建卡后立即编辑是否生效（决策 D1 回归点）

## 已知非本任务引入的问题

- `npm run electron:smoke` 存在上一任务计划遗留的资源 403 问题（见 `01-实施方案.md` 风险节），本阶段快速检查清单未要求跑该脚本，未验证是否命中，不算本任务引入。
