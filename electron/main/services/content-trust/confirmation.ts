import { randomUUID } from 'node:crypto'
import type { ContentTrustQuery } from '../../../../src/core/contentTrust'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'
import { getMainWindow } from '../../window'
import type { ApplicationOperationCoordinator } from '../application-runtime/operationCoordinator'
import { contentTrust } from './runtime'
import type { ApplicationResult } from '../../../../src/core/application-control/invocation'

const pending = new Map<string, () => Promise<void>>()
let coordinator: ApplicationOperationCoordinator | undefined
export function configureContentTrustConfirmations(operations: ApplicationOperationCoordinator): void { coordinator = operations }
/** 原生技能读取也复用操作账本；用户确认在应用窗口完成，调用方只拿等待回执。 */
export async function withNativeContentTrust<T>(callerId: string, query: ContentTrustQuery, input: Record<string, unknown>, run: () => Promise<ApplicationResult<T>>): Promise<ApplicationResult<T>> {
  const checked = contentTrust().check(query)
  if (checked.state === 'allowed') return run()
  if (checked.state === 'denied') contentTrust().assert(query)
  const operations = coordinator
  if (!operations) throw new Error('操作账本尚未就绪，代码尚未运行。')
  const operationId = randomUUID()
  const confirmation = applicationUserConfirmation({ title: checked.records.map(record => record.sourceName).join('、'), message: '这份内容包含代码，是否允许运行？', confirmLabel: '仅这一次' })
  operations.store.prepare({ operationId, callerId, capabilityId: 'load_assistant_skill', input, inputDigest: JSON.stringify(input), state: 'awaiting_user_confirmation', verificationState: 'unresolved', confirmation })
  const expire = () => {
    pending.delete(operationId)
    const record = operations.store.get(operationId, callerId)
    if (record?.state === 'awaiting_user_confirmation') operations.store.save({ ...record, state: 'not_executed', verificationState: 'verified', confirmation: undefined, result: { ok: false, error: { code: 'CONFIRMATION_EXPIRED', message: '等待信任已超时，代码尚未运行。' } } })
  }
  const timer = setTimeout(expire, Math.max(0, confirmation.expiresAt! - Date.now()))
  timer.unref()
  pending.set(operationId, async () => {
    const record = operations.store.get(operationId, callerId)
    if (confirmation.expiresAt! <= Date.now()) { expire(); return }
    if (!record || contentTrust().check(query).state === 'awaiting_user_confirmation') return
    pending.delete(operationId)
    clearTimeout(timer)
    try {
      contentTrust().assert(query)
      operations.store.save({ ...record, state: 'executing', confirmation: undefined })
      const result = await run()
      operations.store.save({ ...record, state: 'completed', verificationState: 'verified', confirmation: undefined, result })
    } catch (error) {
      operations.store.save({ ...record, state: 'not_executed', verificationState: 'verified', confirmation: undefined, result: { ok: false, error: { code: 'CONTENT_NOT_TRUSTED', message: error instanceof Error ? error.message : String(error) } } })
    }
  })
  getMainWindow()?.webContents.send('application:content-trust:request', { query })
  return { ok: false, operationId, executionState: 'awaiting_user_confirmation', verificationState: 'unresolved', confirmation }
}
export async function resumeContentTrustConfirmations(): Promise<void> { for (const resume of [...pending.values()]) await resume() }
