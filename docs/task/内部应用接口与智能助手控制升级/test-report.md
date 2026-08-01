# 测试报告

## 第五阶段（进行中）

### 任务 5.1

- 验证级别：L2；设置与 Surface 为共享公共入口，涉及 revision、撤销、导航状态与多个直接消费者。
- 设置注册、统一事务、Surface 导航与展示策略：4 个测试文件、13 项测试通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- 本次改动文件 ESLint：通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。
- 测试环境中的 Zustand 持久化不可用提示为既有无浏览器存储警告，不影响断言。

### 任务 5.2

- 验证级别：L2；涉及画布正式服务、反射、原子变更、批量提交和多个助手适配消费者。
- 画布应用服务、批量事务、反射、能力处理器与 Surface：5 个测试文件、18 项测试通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- 本次改动文件 ESLint：通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。
- 人工拖拽、真实连线和旧项目读取统一记录到 `manual-test.md`，本任务未要求用户立即执行。

### 任务 5.3

- 验证级别：L2；涉及素材 PAL 读取、工具注册表、图片编辑预览事务、分镜关系和多个能力适配器。
- 新增/迁移专项：9 个测试文件、28 项测试通过。
- 既有素材收录与 Store、媒体入画布、图片编辑执行与会话、分镜文档：6 个测试文件、15 项测试通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- 本次改动文件 ESLint：通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。
- 图片编辑提交失败会保留预览供重试，成功后才清理；公开素材查询不含本地文件路径，均有自动化断言。

## 第四阶段（已完成）

- 验证级别：L3。原因是本阶段跨越三维领域服务、持久状态、公共控制契约、助手能力、运行时导航和结构化验证。
- 三维服务、反射、场景分析、运镜与视口观察首轮专项：5 个文件、33 项测试通过。
- 控制注册、能力覆盖与 Surface 联动专项：3 个文件、12 项测试通过；严格反射注册 4 项、Surface 注册 5 项、设置控制回归均通过。
- `npm run lint`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。
- `npm run check:surface`：通过。
- `npm run test:assistant-production`：通过；模型兼容 10 个文件/57 项、评测 43 个文件/243 项、结算 2 个文件/2 项、持久化 35 项全部通过。
- `npm run test`：最终 173 个测试文件、801 项测试通过；8 个文件、36 项按环境跳过，无失败。
- 全量测试曾暴露两项真实集成问题：控制注册表静态导入宿主存储、反射属性 ID 使用驼峰；均已修复并由最终全量测试覆盖。
- 补充执行 `npx vitest related --run CameraStageApp.tsx CameraStageProjectList.tsx` 时，Vitest/Rollup 对 TSX 依赖给出 `const declarations must be initialized` 并在关闭时超时；该辅助扫描不作为产品失败，随后渲染 lint、TypeScript、Surface 门禁、生产评测和最终全量测试均通过。
- 未执行 `npm run electron:build`：本阶段未修改 Electron IPC、preload、打包配置或原生依赖，L3 所需双端静态检查、生产评测与全量测试已覆盖本次风险。
- 人工验收：全部集中到 `manual-test.md`，按用户要求在所有任务完成后执行。

## 第三阶段（已完成）

### 任务 3.1

- `npm run lint`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- 路由、任务图与运行时契约共 3 个文件、26 项测试通过。
- 联动 Runner 回归共 6 个文件、45 项通过、1 项失败；失败仍为阶段前已记录的长循环基线，实际在 2 轮/3 次调用后终止。
- 为遵守文件体积规则，将 `runner.ts` 从 575 行拆至 499 行；拆分后主进程 TypeScript 与 Electron lint 通过。

### 任务 3.2

- `npm run lint`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- 批量发现、目录激活、路由上下文、原生能力与覆盖清单共 5 个文件、40 项测试通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。

### 任务 3.3 与第三阶段收尾

- Facet 进展、调度守卫、最终验证、工作摘要和回归数据共 5 个专项文件、28 项测试通过。
- Runner 长链路和外部续接夹具已对齐当前工具激活快照；2 个文件、13 项回归通过。
- `npm run lint`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。
- `npm run test:assistant-production`：通过；模型兼容、评测、结算和持久化 4 组检查全部通过。
- `npm run test`：164 个测试文件、774 项测试通过；8 个文件、36 项按环境跳过，无失败。
- `npm run electron:build`：通过；包含 seeds/manifest、颜色/Surface/图标/模型 i18n、能力门禁、主进程 TypeScript 与三端 Vite 构建。
- 设置测试中的 Zustand 持久化不可用提示为无浏览器存储测试环境的既有警告，不影响断言。
- 手动验收：统一记录在 `manual-test.md`，按用户要求在全部任务完成后执行。

## 第二阶段（已完成）

- 任务 2.1：`npx tsc -p tsconfig.json --noEmit` 通过。
- 任务 2.1：核心契约、反射注册表与设置回归共 3 个文件、12 项测试通过。
- 任务 2.2：`npx tsc -p tsconfig.json --noEmit` 通过。
- 任务 2.2：核心契约、反射注册表与观察查询共 3 个文件、13 项测试通过。
- 任务 2.3 与阶段专项：6 个测试文件、23 项测试通过，覆盖契约、注册、观察、冲突、权限变化、幂等、补偿、撤销、风险审批、验证失败和设置适配。
- `npm run lint`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npm run check:assistant-capabilities`：通过；覆盖门禁 4 项测试通过。
- `npm run electron:build`：通过；包含 seeds/manifest、颜色/Surface/图标/模型 i18n、能力门禁、主进程 TypeScript 与三端 Vite 构建。
- `npm run test:assistant-production`：失败；56 项通过、1 项失败后停止。失败仍为 `runner.test.ts` 已记录的长循环基线，预期 14 轮/26 次调用完成，实际 2 轮/3 次调用失败。
- `npm run test`：158 个测试文件、750 项测试通过；2 项失败，另有 8 个文件/36 项测试跳过。
- 全量失败 1：`external-continuation-coordinator.test.ts` 的旧夹具缺少 `pinnedToolNames`，对 `undefined.filter` 抛错。
- 全量失败 2：`runner.test.ts` 的长循环用例仍在 2 轮/3 次调用后失败。
- 两项失败均与第一阶段记录一致，位于第二阶段未修改的 `electron/main/services/agent-runtime/`；第二阶段新增与联动专项均通过。
- 设置测试中的 Zustand 持久化不可用提示为无浏览器存储测试环境的既有警告，不影响断言。
- 手动验收：统一记录在 `manual-test.md`；本阶段无需手动测试。

## 第一阶段

- 状态：第一阶段专项检查全部通过；全量测试存在 2 项阶段前基线失败。
- `npm run lint`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npx vitest run src/core/application-control/contracts.test.ts src/core/assistant/applicationCapabilities.test.ts src/core/assistant/applicationControlMapping.test.ts`：3 个文件、10 项测试通过。
- `npm run check:assistant-capabilities`：通过。
- `npm run test:assistant-production`：失败；`runner.test.ts` 的“默认循环超过旧 12 轮和 24 次工具后仍由模型最终答复自然结束”预期完成，实际 2 轮/3 次调用后失败。临时恢复 `application-capabilities/v1` 后单独复跑仍同样失败，确认不是任务 1.1 引入。
- 手动验收：统一记录在 `manual-test.md`，本阶段不分散登记。

## 任务 1.2 与第一阶段收尾

- `npm run check:assistant-capabilities`：通过；包含 4 项真实注册表覆盖测试。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npm run lint`：通过。
- `npm run test`：154 个测试文件、735 项测试通过；2 项失败，另有 8 个文件/36 项测试跳过。
- 失败 1：`external-continuation-coordinator.test.ts` 的“从激活目录移除创建工具并拒绝模型重复提交”，旧测试夹具没有 `pinnedToolNames`，运行时直接调用 `.filter`。
- 失败 2：`runner.test.ts` 的长循环用例，预期 14 轮/26 次调用完成，实际 2 轮/3 次调用后失败；任务 1.1 已确认恢复 v1 目录后仍复现。
- 两项失败均位于第一阶段未修改的 `electron/main/services/agent-runtime/`，记录为阶段前基线，不在契约/覆盖任务中扩大范围修复。
- 第一阶段新增测试：5 项核心契约、1 项状态映射、4 项覆盖门禁，共 10 项通过；另联动复跑 4 项既有能力注册表测试，阶段专项验证共 14 项通过。
