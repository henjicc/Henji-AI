# 测试报告

## 第二阶段（进行中）

- 任务 2.1：`npx tsc -p tsconfig.json --noEmit` 通过。
- 任务 2.1：核心契约、反射注册表与设置回归共 3 个文件、12 项测试通过。
- 设置测试中的 Zustand 持久化不可用提示为无浏览器存储测试环境的既有警告，不影响断言。
- 任务 2.2：`npx tsc -p tsconfig.json --noEmit` 通过。
- 任务 2.2：核心契约、反射注册表与观察查询共 3 个文件、13 项测试通过。
- 手动验收：继续统一记录在 `manual-test.md`，本阶段不分散登记。

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
