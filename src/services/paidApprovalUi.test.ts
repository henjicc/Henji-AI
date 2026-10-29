// @vitest-environment jsdom
import i18n from '@/i18n'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GlobalAlertDialog } from '@/components/ui/GlobalAlertDialog'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installPaidApprovalTestBridge } from '@/tests/paidApprovalTestKit'
import { withPaidOperation, prepareGenerationPaidApproval } from './paidApproval'
import { llmChatStream, llmVerifyModelCapabilities, llmCancelTask } from '@/commands/llmRuntime'
import { FAL_IMAGE_UTILITY_EXECUTION_MODELS } from '@/core/modelCatalog/falUtilityExecutionModels'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { notifyUser } from '@/contexts/NotificationContext'
import { UI_PAID_CAPABILITIES } from '@/core/application-control/paidApproval'
import { bindApplicationConfirmation } from '@/core/application-control/userConfirmation'

const ports = vi.hoisted(() => ({ complete: vi.fn(), chatStream: vi.fn(), verifyModelCapabilities: vi.fn(), findDocument: vi.fn(), findProject: vi.fn() }))
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

it.each(Object.entries(UI_PAID_CAPABILITIES))('界面入口 %s 共用策略、user 身份、项目授权、预留和完成账本', async (capability, category) => {
  const work = vi.fn(async () => 'result')
  expect(await withPaidOperation({ category, capabilityId: capability as keyof typeof UI_PAID_CAPABILITIES, documentId: 'doc', estimatedCny: 1 }, work)).toBe('result')
  expect(work).toHaveBeenCalledOnce()
  expect([...bridge.records.values()]).toMatchObject([{ origin: { actor: 'user' }, state: 'completed',
    approval: { decision: 'auto' }, paidReservations: [{ category, estimatedCny: 1, project: { id: 'project' } }] }])
  expect(bridge.store.generationSpendSince(0)).toBe(1)
  expect(notifyUser).toHaveBeenCalledOnce()
  expect(notifyUser).toHaveBeenCalledWith({ key: 'autoApprovedEstimate', values: { amount: '1.00' } })
})

it('ask 取消 / 等待时中止：零模型执行、零费用', async () => {
  bridge.setSettings({ singleLimitCny: 0, unlimited: false })
  const work = vi.fn(async () => undefined)
  for (const cancel of ['dismiss', 'abort'] as const) {
    const controller = new AbortController()
    const pending = withPaidOperation({ category: 'recognition', estimatedCny: 1 }, work, controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
    expect(useAlertDialogStore.getState().queue[0].confirmation?.paid).toBe(true)
    if (cancel === 'dismiss') useAlertDialogStore.getState().dismissCurrent()
    else controller.abort()
    await rejected
  }
  expect(work).not.toHaveBeenCalled()
  expect(bridge.store.generationSpendSince(0)).toBe(0)
  expect([...bridge.records.values()].every(record => record.state === 'not_executed')).toBe(true)
})

it('所有项目共用每日额度，超额仍询问，未知价格不伪装零元', async () => {
  bridge.setSettings({ singleLimitCny: 2, dailyLimitCny: 2, unlimited: false })
  const run = () => withPaidOperation({ category: 'translation', documentId: 'doc', estimatedCny: 1 }, async () => undefined)
  await run()
  await run()
  const third = run(); const rejected = expect(third).rejects.toThrow()
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue[0].paidDetails).toMatchObject({ estimatedCny: 1, dailySpentCny: 2, category: 'translation' }))
  useAlertDialogStore.getState().dismissCurrent(); await rejected
  expect(bridge.store.generationSpendSince(0)).toBe(2)
  const unknown = withPaidOperation({ category: 'title' }, async () => undefined)
  const unknownRejected = expect(unknown).rejects.toThrow()
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue[0].paidDetails).toMatchObject({ estimatedCny: null, category: 'title' }))
  useAlertDialogStore.getState().dismissCurrent(); await unknownRejected
})

it('批次继承本次回执且不重复预留；派发后失败保留费用', async () => {
  await expect(withPaidOperation({ category: 'translation', estimatedCny: 1 }, async signal => {
    await withPaidOperation({ category: 'translation' }, async () => undefined, signal)
    throw new Error('供应商回执丢失')
  })).rejects.toThrow('回执丢失')
  expect([...bridge.records.values()]).toHaveLength(1)
  expect([...bridge.records.values()][0].state).toBe('unknown')
  expect(bridge.store.generationSpendSince(0)).toBe(1)
})

it('助手仍走原调用上下文，不创建 user 副账本', async () => {
  const controller = new AbortController()
  const sink = vi.fn(async () => ({ decision: 'auto', reason: '额度内', estimatedCny: 1, dailySpentCny: 0 }))
  const release = bindApplicationConfirmation(controller.signal, sink)
  try { await withPaidOperation({ category: 'recognition', estimatedCny: 1 }, async () => undefined, controller.signal) } finally { release() }
  expect(sink).toHaveBeenCalledOnce(); expect(bridge.records.size).toBe(0)
})

it.each(['文本处理 / 提示词优化', '模型能力测试'])('%s 的正式命令在统一确认拒绝后不发出模型请求', async entry => {
  bridge.setSettings({ singleLimitCny: 0, unlimited: false })
  const pending = entry === '模型能力测试'
    ? llmVerifyModelCapabilities({} as Parameters<typeof llmVerifyModelCapabilities>[0])
    : llmChatStream({} as Parameters<typeof llmChatStream>[0], () => {})
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  useAlertDialogStore.getState().dismissCurrent(); await rejected
  expect(ports.chatStream).not.toHaveBeenCalled(); expect(ports.verifyModelCapabilities).not.toHaveBeenCalled()
  expect(bridge.store.generationSpendSince(0)).toBe(0)
})

it('受控图片工具模型与普通生成共用正式估价，保持隐藏模型的可执行性', async () => {
  const model = FAL_IMAGE_UTILITY_EXECUTION_MODELS[0]
  const paid = await prepareGenerationPaidApproval(model.meta.id, { prompt: 'test' }, 'project')
  expect([...bridge.records.values()][0].paidReservations?.[0]).toMatchObject({ category: 'generation', project: { id: 'project' } })
  await paid.reject()
  expect(bridge.store.generationSpendSince(0)).toBe(0)
})

it('提示词优化在等待费用确认时取消，撤下弹窗且不发模型请求', async () => {
  bridge.setSettings({ singleLimitCny: 0, unlimited: false })
  const pending = llmChatStream({ requestId: 'optimizer' } as Parameters<typeof llmChatStream>[0], () => {})
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  await llmCancelTask('optimizer'); await rejected
  expect(ports.chatStream).not.toHaveBeenCalled()
  expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  expect(bridge.store.generationSpendSince(0)).toBe(0)
})


it.each(['generation', 'recognition', 'translation', 'title', 'explanation'] as const)('%s 共用英文结构化费用展示，拒绝不派发', async category => {
  await i18n.changeLanguage('en-US')
  bridge.setSettings({ singleLimitCny: 0, unlimited: false })
  const work = vi.fn(async () => undefined)
  const pending = withPaidOperation({ category, estimatedCny: category === 'title' ? null : 1.25 }, work)
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
  expect(bridge.store.generationSpendSince(0)).toBe(0)
})
