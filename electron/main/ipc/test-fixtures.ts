import { deleteGenerationSubmission, inspectGenerationSubmission } from '../services/ai-runtime/generation-submissions'
import { isAutomationTestMode } from '../services/automationMode'
import { parseStringField, registerIpcHandler } from './registry'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { assertTrustedApplicationSender } from './application-control'
import { closeRecordingControl, openRecordingControl, recordingControl } from '../services/screen-recording/runtime'

/*
 * 测试夹具通道（存储底座 2.3）：真实性测试脚本需要核对或清理、但正式界面没有入口的记录，
 * 经拥有该表的仓库函数访问，不写 SQL。只在自动化 / 隔离测试模式下注册，正常启动不可用。
 */
export function registerTestFixturesIpc(): void {
  if (!isAutomationTestMode()) return
  const calls: Record<string, number> = {}
  registerIpcHandler('testFixtures:recordingControl', input => z.enum(['setup', 'read', 'cleanup']).parse(input), async (action, event) => {
    if (action === 'cleanup') { await closeRecordingControl(); return { snapshot: null, calls: { ...calls }, protected: false, sourceId: '' } }
    if (action === 'setup') {
      for (const key of Object.keys(calls)) delete calls[key]
      const operation = (name: string) => async (): Promise<void> => { calls[name] = (calls[name] ?? 0) + 1 }
      openRecordingControl(event.sender, randomUUID(), { start: operation('start'), pause: operation('pause'), resume: operation('resume'), mark: operation('mark'), stop: operation('stop'), cancel: operation('cancel') })
    }
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=recording-control'))
    return { snapshot: recordingControl.snapshot(), calls: { ...calls }, protected: win?.isContentProtected() ?? false, sourceId: BrowserWindow.fromWebContents(event.sender)?.getMediaSourceId() ?? '' }
  }, assertTrustedApplicationSender)
  registerIpcHandler('testFixtures:generationSubmission:inspect', (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => inspectGenerationSubmission(requestId))
  registerIpcHandler('testFixtures:generationSubmission:delete', (input) => ({ requestId: parseStringField(input, 'requestId') }),
    ({ requestId }) => deleteGenerationSubmission(requestId))
}
