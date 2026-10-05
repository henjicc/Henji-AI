import { deleteGenerationSubmission, inspectGenerationSubmission } from '../services/ai-runtime/generation-submissions'
import { isAutomationTestMode } from '../services/automationMode'
import { parseStringField, registerIpcHandler } from './registry'

/*
 * 测试夹具通道（存储底座 2.3）：真实性测试脚本需要核对或清理、但正式界面没有入口的记录，
 * 经拥有该表的仓库函数访问，不写 SQL。只在自动化 / 隔离测试模式下注册，正常启动不可用。
 */
export function registerTestFixturesIpc(): void {
  if (!isAutomationTestMode()) return
  registerIpcHandler('testFixtures:generationSubmission:inspect', (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => inspectGenerationSubmission(requestId))
  registerIpcHandler('testFixtures:generationSubmission:delete', (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => deleteGenerationSubmission(requestId))
}
