import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createContentTrustTestSession } from '../../electron/main/services/content-trust/test-support'
import { executeContentTrust as mainExecute } from '../../electron/main/services/content-trust/commands'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { ensureContentTrust, executeContentTrust, runForeignContent, subscribeContentTrustContext } from './contentTrust'
import { createApplicationHarness } from '@/tests/applicationHarness'
import type { ContentTrustCommand } from '@/core/contentTrust'
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ applicationControl: { contentTrust: (command: ContentTrustCommand) => mainExecute(command) } }), isDesktopRuntime: () => true }))
let fixture: ReturnType<typeof createContentTrustTestSession>
beforeEach(() => { fixture = createContentTrustTestSession(); useAlertDialogStore.setState({ queue: [] }) })
afterEach(() => { useAlertDialogStore.setState({ queue: [] }); fixture.dispose() })
const content = { id: 'shared', sourceName: '分享模板', sourceType: 'template' as const }
it('先发起的调用取消后其余等待者仍可确认；全部取消才关闭弹窗', async () => {
  const firstController = new AbortController()
  const first = ensureContentTrust({ contents: [content] }, firstController.signal).catch(error => error)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  const other = { ...content, id: 'remaining', sourceName: '仍在等待的模板' }
  const second = ensureContentTrust({ contents: [other] })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue[0].title).toContain(other.sourceName))
  firstController.abort(new Error('停止第一个预览'))
  expect(await first).toBeInstanceOf(Error)
  expect(useAlertDialogStore.getState().queue).toHaveLength(1)
  useAlertDialogStore.getState().confirmCurrent()
  await second
  expect(fixture.session.allows({ contents: [other] })).toBe(true)
  const lastController = new AbortController()
  const last = ensureContentTrust({ contents: [{ ...content, id: 'last' }] }, lastController.signal).catch(error => error)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  lastController.abort()
  await last
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
})
it('多内容共用三选一询问；仅这一次后不再问，助手能轮询等待阶段但不能选择', async () => {
  const controller = new AbortController(); const phases: string[] = []
  const unbind = bindApplicationConfirmation(controller.signal, async value => { phases.push(value.phase) })
  const first = ensureContentTrust({ contents: [content] }, controller.signal)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  const second = ensureContentTrust({ contents: [{ ...content, id: 'other', sourceName: '另一模板' }] })
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue[0].title).toContain('另一模板'))
  expect(useAlertDialogStore.getState().queue[0]).toMatchObject({ cancelLabel: '不运行', confirmation: { label: '仅这一次', projectLabel: '始终允许' } })
  expect(phases).toContain('awaiting_user_confirmation')
  useAlertDialogStore.getState().confirmCurrent()
  await Promise.all([first, second]); unbind()
  await ensureContentTrust({ contents: [content] })
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
})
it('不运行返回结构化占位，运行按钮会重新询问，始终允许写入总开关', async () => {
  const waiting = ensureContentTrust({ contents: [content] }).catch(error => error)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().dismissCurrent()
  expect(await waiting).toMatchObject({ name: 'ContentTrustRequiredError', contentTrust: { state: 'denied', records: [content] } })
  const run = vi.fn()
  const retry = runForeignContent(content, run)
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  expect(run).not.toHaveBeenCalled()
  useAlertDialogStore.getState().confirmCurrent(true)
  await retry
  expect(run).toHaveBeenCalledOnce()
  fixture.restart()
  expect((await executeContentTrust({ action: 'policy' })).allowExternalContentCode).toBe(true)
  await ensureContentTrust({ contents: [{ ...content, id: 'new-import' }] })
})
it('预览只响应相关内容的选择，总开关只影响含外来代码的预览', async () => {
  const retry = vi.fn(); const unsubscribe = subscribeContentTrustContext(() => [{ contents: [content] }], retry)
  try {
    const other = fixture.session.check({ contents: [{ ...content, id: 'other' }] })
    await executeContentTrust({ action: 'decide', challenge: other.challenge!, decision: 'once' })
    expect(retry).not.toHaveBeenCalled()
    const current = fixture.session.check({ contents: [content] })
    await executeContentTrust({ action: 'decide', challenge: current.challenge!, decision: 'once' })
    expect(retry).toHaveBeenCalledOnce()
  } finally { unsubscribe() }
})
it('总开关通过设置实体可读取，通用写入拒绝助手自我批准', async () => {
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'settings.registry', id: 'singleton' }
    const read = await app.read(ref, ['general.allow_external_content_code'])
    expect(read.properties).toMatchObject({ 'general.allow_external_content_code': false })
    const result = await app.change(ref, { 'general.allow_external_content_code': true })
    expect(result.ok).toBe(false)
    expect(fixture.session.policy()).toBe(false)
  } finally { app.dispose() }
})
