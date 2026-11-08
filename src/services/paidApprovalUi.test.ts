// @vitest-environment jsdom
import i18n from '@/i18n'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GlobalAlertDialog } from '@/components/ui/GlobalAlertDialog'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installPaidApprovalTestBridge } from '@/tests/paidApprovalTestKit'
import { withPaidOperation, prepareGenerationPaidApproval } from './paidApproval'
import { llmChatStream } from '@/commands/llmRuntime'
import { FAL_IMAGE_UTILITY_EXECUTION_MODELS } from '@/core/modelCatalog/falUtilityExecutionModels'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { notifyUser } from '@/contexts/NotificationContext'
import { UI_PAID_CAPABILITIES } from '@/core/application-control/paidApproval'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { approvePaidOperation } from '../../electron/main/services/application-runtime/paidApprovalPolicy'

const ports = vi.hoisted(() => ({ complete: vi.fn(), chatStream: vi.fn(), cancelTask: vi.fn(), verifyModelCapabilities: vi.fn(), findDocument: vi.fn(), findProject: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => ({ applicationControl: ports, llmRuntime: ports }) }))
vi.mock('@/features/documents/documentOperations', () => ({ getDocumentOperations: () => ports }))
vi.mock('@/contexts/NotificationContext', () => ({ notifyUser: vi.fn() }))
let bridge: ReturnType<typeof installPaidApprovalTestBridge>
beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.clearAllMocks(); useAlertDialogStore.setState({ queue: [] })
  ports.findDocument.mockResolvedValue({ container: { kind: 'project', projectId: 'project' } })
  ports.findProject.mockResolvedValue({ id: 'project', name: '作品' })
  bridge = installPaidApprovalTestBridge({})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useAlertDialogStore.setState({ queue: [] }) })

it.each(Object.entries(UI_PAID_CAPABILITIES))('界面入口 %s 超出额度也直接执行，记 user 身份、项目、预留和完成账本', async (capability, category) => {
  const work = vi.fn(async () => 'result')
  expect(await withPaidOperation({ category, capabilityId: capability as keyof typeof UI_PAID_CAPABILITIES, documentId: 'doc', estimatedCny: 50 }, work)).toBe('result')
  expect(work).toHaveBeenCalledOnce()
  expect([...bridge.records.values()]).toMatchObject([{ origin: { actor: 'user' }, state: 'completed',
    approval: { decision: 'auto', reason: '用户亲自发起' }, paidReservations: [{ category, estimatedCny: 50, project: { id: 'project' } }] }])
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(notifyUser).not.toHaveBeenCalled()
})

it('用户发起的超额与未知价格操作不占助手每日额度；助手随后超额仍询问', async () => {
  bridge.setSettings({ singleLimitCny: 2, dailyLimitCny: 2, unlimited: false })
  for (let index = 0; index < 3; index++) await withPaidOperation({ category: 'translation', documentId: 'doc', estimatedCny: 5 }, async () => undefined)
  await withPaidOperation({ category: 'title' }, async () => undefined)
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(bridge.store.generationSpendSince(0)).toBe(0)
  const agent = (id: string) => bridge.store.prepare({ operationId: id, callerId: 'agent', capabilityId: 'ui_translate_subtitles', input: {}, inputDigest: id, state: 'preparing', origin: { at: Date.now(), actor: 'external' } })
  expect(approvePaidOperation(bridge.store, agent('agent-within'), { category: 'translation', estimatedCny: 2 }).decision).toBe('auto')
  expect(approvePaidOperation(bridge.store, agent('agent-over'), { category: 'translation', estimatedCny: 1 })).toMatchObject({ decision: 'ask', dailySpentCny: 2 })
})

it('批次继承本次回执且不重复预留；派发后失败保留费用', async () => {
  await expect(withPaidOperation({ category: 'translation', estimatedCny: 1 }, async signal => {
    await withPaidOperation({ category: 'translation' }, async () => undefined, signal)
    throw new Error('供应商回执丢失')
  })).rejects.toThrow('回执丢失')
  expect([...bridge.records.values()]).toHaveLength(1)
  expect([...bridge.records.values()][0]).toMatchObject({ state: 'unknown', paidReservations: [{ estimatedCny: 1 }] })
})

it('助手仍走原调用上下文，不创建 user 副账本', async () => {
  const controller = new AbortController()
  const sink = vi.fn(async () => ({ decision: 'auto', reason: '额度内', estimatedCny: 1, dailySpentCny: 0 }))
  const release = bindApplicationConfirmation(controller.signal, sink)
  try { await withPaidOperation({ category: 'recognition', estimatedCny: 1 }, async () => undefined, controller.signal) } finally { release() }
  expect(sink).toHaveBeenCalledOnce(); expect(bridge.records.size).toBe(0)
})

it('受控图片工具模型与普通生成共用正式估价，保持隐藏模型的可执行性', async () => {
  const model = FAL_IMAGE_UTILITY_EXECUTION_MODELS[0]
  const paid = await prepareGenerationPaidApproval(model.meta.id, { prompt: 'test' }, 'project')
  expect([...bridge.records.values()][0].paidReservations?.[0]).toMatchObject({ category: 'generation', project: { id: 'project' } })
  await paid.reject()
  expect([...bridge.records.values()][0].state).toBe('not_executed')
})

it('流已发出后信号中止，连主进程的请求一起取消', async () => {
  const controller = new AbortController()
  let finish = (): void => undefined
  ports.chatStream.mockImplementation((_request: unknown, onEvent: (event: { type: string; data: string }) => void) => new Promise<void>((resolve) => {
    finish = () => { onEvent({ type: 'Error', data: 'cancelled' }); resolve() }
  }))
  ports.cancelTask.mockImplementation(async () => finish())
  const pending = llmChatStream({ requestId: 'bench-column' } as Parameters<typeof llmChatStream>[0], () => {}, { category: 'generation', estimatedCny: 0.01, signal: controller.signal })
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(ports.chatStream).toHaveBeenCalledOnce())
  controller.abort()
  await rejected
  expect(ports.cancelTask).toHaveBeenCalledWith('bench-column')
})

it.each(['generation', 'recognition', 'translation', 'title', 'explanation'] as const)('助手 %s 超额时共用英文结构化费用展示，拒绝不派发', async category => {
  await i18n.changeLanguage('en-US')
  const work = vi.fn(async () => undefined)
  const controller = new AbortController()
  const release = bindApplicationConfirmation(controller.signal, async progress => progress.phase === 'paid_approval'
    ? { decision: 'ask', reason: '超出额度', estimatedCny: progress.request.estimatedCny, dailySpentCny: 0 } : undefined)
  const pending = withPaidOperation({ category, estimatedCny: category === 'title' ? null : 1.25 }, work, controller.signal).finally(release)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  render(createElement(GlobalAlertDialog))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog.textContent).not.toMatch(/[\u3400-\u9fff]|\[object Object\]/)
  expect(dialog.textContent).toContain(category === 'title' ? 'Cost cannot be estimated yet' : 'Estimated cost: CNY 1.25')
  expect(dialog.textContent).toContain('Spent today: CNY 0.00')
  expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
  await rejected
  expect(work).not.toHaveBeenCalled()
  expect(bridge.records.size).toBe(0)
})
