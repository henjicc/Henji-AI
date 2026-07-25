# 进度记录

按时间倒序记录每次执行的实际进展。详细验收看各任务文件的「执行记录」，本文件只保留跨任务可见的进度线。

---

## 2026-07-25

### 第一阶段开始

- 三项待确认决策已由用户确认（记录 003 豁免 / 004 两步走 / 005 按倾向方案），`重要记录.md` 已全部转为「已确定」。
- 建立本阶段五个记录文件：`progress.md`、`decisions.md`、`handoff.md`、`changed-files.md`、`test-report.md`。
- 阶段目标：把剩余未登记视觉数值收进令牌，统一 z-index，建立可执行门禁。
- 阶段开始前基线（实测）：

  | 项 | 数值 |
  |---|---|
  | `check:surface` | 20 处违规 / 8 个文件 |
  | `rounded-[` | 25 |
  | `z-[` | 24 |
  | `shadow-[` | 15 |
  | `border-[` | 40 |
  | `text-[` | 20 |
  | `vitest` | 479 通过 / 11 跳过 |
  | `tsc` | 仅存量 `webgpuRuntime.ts` 报错 |

### 1.1 视觉令牌登记制补齐 — 已完成（提交 `45748d7`）

- 登记令牌：`veil` 六档白色半透明色阶、四档具名特效阴影、`fontSize 13/14/15`、`borderRadius hairline`、`borderWidth 1.5`
- 迁移 71 处 / 24 个文件：`shadow-[`、`border-[`、`bg/from/to-[rgba(` 全部归零
- 字号 `text-[12/13/14/15/16px]` 全部归零；12px→`text-xs` 已实测像素等价（`leading-*` 在生成的 CSS 中后置，胜出）
- 收敛重复实现：画布节点选中/空闲描边此前在 11 个节点文件各写一遍，收敛为 `NODE_SELECTED_BORDER_CLASS` / `NODE_IDLE_BORDER_CLASS`
- **附带修复两个既有缺陷**（详见 `decisions.md` D-001、D-002）

### 1.2 z-index 层级体系统一 — 已完成（提交 `b024761`）

- 层级档位由实际层序需求反推，扩到 11 档（modal 之上补 viewer/toast/tooltip/drag/titlebar）
- 24 处 `z-[...]` 归零，含 `z-[2147483647]`、`z-[12000]`、`z-[9999]`
- 全局 fixed 浮层的裸 `z-50/40/30` 一并纳入契约
- 新增 `src/core/theme/zLayers.ts` 供内联 `zIndex` 使用；画布内部明确为独立局部刻度

### 1.3 自动化门禁 — 已完成（提交 `5dad5fc`）

- ESLint 新增五类硬拦截，每条均经探针反向验证
- 规则上线即抓出两处 `.ts` 遗漏（`createSuggestionRenderer` 的 `z-[1000]`）
- `check:surface` 新增规则 C「手写弹窗」，基线 15 处
- `check:surface` 接入 `build` / `electron:build`（非阻断）

### 第一阶段结束状态

| 项 | 阶段开始 | 阶段结束 |
|---|---|---|
| `rounded-[` | 25 | 19（全部为 `var(--node-radius)`/`inherit` 合法项） |
| `z-[` | 24 | 0 |
| `shadow-[` | 15 | 0 |
| `border-[` | 40 | 0 |
| `text-[` | 20 | 5（全部为 `em`/`length:var()` 合法项） |
| rgba 字面量 | 49 | 0 |
| 静默失效的透明度类 | 8（未知） | 0 |
| `check:surface` | 20 处 / 8 文件 | 表面 8 文件 + 新增弹窗检查 15 处 |
| `vitest` | 479 通过 | 479 通过 |
| ESLint 视觉规则 | 1 类（颜色） | 6 类 |

第一阶段目标已达成。第二阶段可开始，五个迁移任务互不依赖可并行。

**遗留待确认（阻塞 1.3 的 CI 部分）**：`.github/workflows/build.yml` 仍是 Tauri 时代产物，
引用已删除的 `src-tauri/` 与 `tauri:build:ci` 脚本，实际已失效。未改动，见 `重要记录.md` 记录 007。

---

## 2026-07-25（续）：CI 迁移 + 第二、三阶段

### 1.4 CI 迁移到 Electron — 待验证（`d9d33af`）

用户确认后新增的任务。旧工作流整份是 Tauri 残留（引用已删的 `src-tauri/`、调用不存在的 `tauri:build:ci`），只在推标签时触发所以一直没暴露。
重写为 `checks`（每次 push/PR 跑全套门禁）+ `build`（标签/手动触发出安装包）两个 job。
顺带修掉两个阻塞项：`webgpuRuntime.ts` 的 TS2206（此前渲染层 tsc 与 `npm run build` 一直失败）、`release.cjs` 硬编码推 `feat/electron-migration` 分支。
**真实 runner 上的打包与发布未验证**，需用户手动触发确认。

### 第二阶段 — 全部完成

| 任务 | 提交 | 要点 |
|---|---|---|
| 2.1 助手侧栏 | `3cd2b0d` | 用户消息 inset、助手消息去容器；发现执行计划卡/工具活动卡等用 `bg-layer`/`bg-surface-dark` 比父级更亮，统一降为 inset |
| 2.2 任务卡 | `5a5a1d1` | 四个内联状态块 → `UiEmpty`/`UiLoading`/`UiError`，保留 h-64 防列表跳动；徽标收敛为令牌 |
| 2.4 播放器 | `6f4ffb5` | `AudioPlayer` 新增 `surface` 变体，表面由宿主决定；视频控件条走面板令牌 |
| 2.5 日志面板 | `a00073d` | 两处表面改 inset；**推翻**原定的画布节点预标注（见 D-006） |
| 2.3 弹窗 | `5404f79` | 11 处转 `UiModal`，4 处豁免；`data-dialog` 上移到 `UiModal` |

第二阶段结束时 `check:surface` 三类问题全部归零，**门禁按记录 004 转为 strict**，接入 build 链路与 CI。

### 第三阶段 — 3.1/3.3 完成，3.2 已分析待测量

| 任务 | 提交 | 结论 |
|---|---|---|
| 3.1 长列表 | `57d176c` | 改用 `content-visibility` 而非虚拟化（D-007）；删除零引用的 `MessageList` |
| 3.3 装饰开销 | `9e1cd9e` | `transition-all` 归零；阴影收敛到登记档位；`backdrop-blur` 21→11 |
| 3.2 resize 重排 | — | `contain: layout` 被证据否决（工作区内有 9 个 fixed 元素），且 3.1 已覆盖主要成本，**待用户实测再决定**（D-008） |

### 最终统一检查（全部通过）

`check:colors` / `check:surface:strict` / `check:model-i18n` / 双侧 ESLint / 双侧 tsc / vitest（479 通过）/ `npm run electron:build` 完整构建。
