# 测试报告

## 第一阶段

- 状态：任务 1.1 专项检查通过；存在 1 项阶段前基线失败。
- `npm run lint`：通过。
- `npx tsc -p tsconfig.json --noEmit`：通过。
- `npx vitest run src/core/application-control/contracts.test.ts src/core/assistant/applicationCapabilities.test.ts src/core/assistant/applicationControlMapping.test.ts`：3 个文件、10 项测试通过。
- `npm run check:assistant-capabilities`：通过。
- `npm run test:assistant-production`：失败；`runner.test.ts` 的“默认循环超过旧 12 轮和 24 次工具后仍由模型最终答复自然结束”预期完成，实际 2 轮/3 次调用后失败。临时恢复 `application-capabilities/v1` 后单独复跑仍同样失败，确认不是任务 1.1 引入。
- 手动验收：统一记录在 `manual-test.md`，本阶段不分散登记。
