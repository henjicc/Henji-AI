# 测试报告

## 2026-07-24 · 第一阶段开始前基线

- 命令：`npm run test:assistant-eval`
- 结果：通过。
- 测试文件：9 个通过，共 9 个。
- 测试项：33 项通过，共 33 项。
- 已覆盖：生成、诊断、画布、工具网关、能力目录、日志诊断、最小评测聚合。
- 待补齐：模糊澄清、跨工作区、模型偏好证据、分类型错误恢复、写入验证、长会话状态保持。
- 待确认：真实 Provider、真实 Agent Profile、费用、真实延迟、鼠标交互、日志窗口和长稳。

## 2026-07-24 · 第一阶段完成

- 命令：`npm run test:assistant-eval`
- 结果：通过。
- 测试文件：9 个通过，共 9 个。
- 测试项：34 项通过，共 34 项。
- 数据集：新增生成、模糊澄清、跨工作区、模型偏好、工具恢复、写入验证和长会话七类基线。
- 静态格式：`git diff --check` 通过。
- 真实模型结果：待确认；本阶段没有调用真实 Provider，不记录虚构的成功率、费用或延迟。

## 2026-07-24 · 第二阶段开始前

- 自动化基线：9 个测试文件、34 项测试通过。
- 代码格式：`git diff --check` 通过。
- 本阶段重点：路由领域一致性、结构化宿主输入、模型选择证据、工具语义与安全并行、结果验证与分类型恢复。

## 2026-07-24 · 2.1

- 命令：`npx vitest run electron/main/services/agent-runtime/context/context.test.ts src/core/assistant/generationPreparation.test.ts electron/main/services/agent-runtime/runner/runner.test.ts`
- 结果：3 个测试文件、17 项测试通过。
- 命令：`npx tsc -p tsconfig.electron.json --noEmit`
- 结果：通过。
- 真实模型跨域路由与模型选择质量：待最终手动测试。

## 2026-07-24 · 2.2

- 命令：`npx vitest run electron/main/services/agent-runtime/context/catalog.test.ts electron/main/services/agent-runtime/runner/tool-call-scheduler.test.ts electron/main/services/agent-runtime/runner/runner.test.ts electron/main/services/agent-runtime/runner/runner-canvas.test.ts electron/main/services/agent-runtime/tools/gateway.test.ts`
- 结果：5 个测试文件、16 项测试通过。
- 命令：`npx tsc -p tsconfig.electron.json --noEmit`
- 结果：通过。
- 真实模型并行调用质量和 UI 事件显示：待最终手动测试。

## 2026-07-24 · 2.3 与第二阶段完成

- `npm run test:assistant-eval`：12 个测试文件、43 项测试通过。
- `npm test`：83 个测试文件、373 项测试通过；2 个测试文件、6 项测试因环境条件跳过。
- `npm run lint`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npm run check:model-i18n`：通过。
- `npm run gen:model-manifest`：成功生成 65 个模型清单。
- `git diff --check`：通过。
- 文件体积：`runner.ts` 为 495 行；工具调度、结果验证和审批等待已拆为独立模块。
- 待手动：真实模型跨域路由、真实 Provider 状态措辞、审批拒绝/过期、未知副作用恢复、并行查询、验证/澄清日志事件。
