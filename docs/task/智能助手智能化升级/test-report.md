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

## 2026-07-24 · 第三阶段开始前

- 自动化基线：助手专项 12 个测试文件、43 项通过；完整测试 83 个测试文件、373 项通过，另有 2 个测试文件、6 项因环境条件跳过。
- 本阶段自动化重点：上下文分层与注入边界、结构化压缩、会话恢复、未知副作用保护、分层记忆召回和冲突处理。
- 手动测试策略：只持续记录测试项，全部任务完成后统一执行，不在第三阶段中途提醒。

## 2026-07-24 · 3.1

- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- 上下文、结构化压缩、工作摘要和工具调度专项：4 个测试文件、20 项通过。
- 已覆盖：system 消息过滤、来源边界、预算报告、旧指令不进入摘要、工具调用与结果配对。
- 待最终手动：真实模型长会话中的目标保持、上下文 token 变化与供应商兼容性。

## 2026-07-24 · 3.2

- 结构化摘要、工具消息配对、恢复状态和未知写入保护测试通过。
- 已覆盖：中断时清除旧审批、未收敛只读操作可重查、未知写入必须先验证、revision 变化提示、失效产物引用过滤。
- SQLite 持久化用例已编写；普通 Node 测试环境因 Electron `better-sqlite3` 原生条件不满足而跳过，保留到 Electron 最终验收。

## 2026-07-24 · 3.3 与第三阶段完成

- `npm run test:assistant-eval`：18 个测试文件、57 项通过。
- `npm test`：89 个测试文件、387 项通过；2 个测试文件、7 项因 Electron SQLite 环境条件跳过。
- `npm run lint`：通过。
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`：通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：通过。
- `npm run check:model-i18n`：通过。
- `git diff --check`：通过。
- 此前本阶段实现完成后的 `npm run electron:build`：通过，生成 65 个模型清单；仅有既有分块和动态导入警告。

### 最终统一手动测试保留项

- 长会话达到压缩阈值后，确认当前目标、活动步骤、最近成功/失败证据仍准确，日志能看到压缩前后 token、保留层和丢弃层。
- Electron 重载或 utility process 异常恢复后，确认旧审批不被复用，只读操作可重新查询，未知写入不会自动重复执行。
- 恢复前切换工作区/项目或令历史产物失效，确认使用最新 revision，且助手不会引用失效产物声称验证成功。
- 在用户指令中写供应商/模型自然语言偏好，再用当前消息明确纠正，确认当前明确要求优先，推荐模型只作为兼容候选的软优先级。
- 建立全局、工作区和项目级已确认记忆，确认仅召回当前任务相关内容；过期、删除、不同作用域和无关记忆不进入回答。
- 关闭记忆或模拟召回失败，确认主任务继续执行且日志记录安全回退；密钥、令牌、Cookie、密码和覆盖安全规则的内容仍不能写入长期记忆。
- 在历史消息、用户指令和工具输出中放入伪 system 指令，确认不能改变审批、安全边界或工具权限，终端不再出现 AI SDK system messages 安全警告。
