// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n/config'
import { requestAlertConfirmation, showAlertDialog, useAlertDialogStore } from '@/stores/alertDialogStore'
import { useUiStore } from '@/stores/uiStore'
import { GlobalAlertDialog } from './GlobalAlertDialog'
import { UiModal } from './UiModal'

describe('GlobalAlertDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAlertDialogStore.setState({ queue: [] })
    useUiStore.setState({ isSettingsOpen: false, settingsTarget: null })
  })

  afterEach(() => cleanup())

  it('从已打开的编辑器弹窗发起全局确认时，确认位于同层末尾且不关闭编辑器', async () => {
    render(<><GlobalAlertDialog /><UiModal isOpen title="图片编辑器" onClose={() => undefined}>作品</UiModal></>)
    let pending!: Promise<boolean>
    await act(async () => { pending = requestAlertConfirmation({ title: '转写', message: '使用讲解', confirmLabel: '允许本次' }) })
    const editor = screen.getByRole('dialog', { name: '图片编辑器' }), confirmation = screen.getByRole('alertdialog')
    expect(editor.parentElement).toBe(confirmation.parentElement)
    expect(editor.compareDocumentPosition(confirmation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '允许本次' }))
    await expect(pending).resolves.toBe(true)
    expect(screen.getByRole('dialog', { name: '图片编辑器' })).toBe(editor)
  })

  it('二次确认只显示明确的确认和取消动作，取消后不能趁退出动画确认', async () => {
    const pending = requestAlertConfirmation({ title: '克隆费用', message: '首次正式合成另收 138 元', confirmLabel: '确认费用，开始克隆' })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['取消', '确认费用，开始克隆'])
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '确认费用，开始克隆' })).toBeNull()
    await expect(pending).resolves.toBe(false)
  })

  it('破坏性确认用危险实底按钮，普通确认仍是主按钮', async () => {
    const pending = requestAlertConfirmation({ title: '删除模型', message: '确定要删除这个模型吗？', confirmLabel: '删除', confirmTone: 'danger' })
    const view = render(<GlobalAlertDialog />)
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('ui-btn-danger-solid')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await expect(pending).resolves.toBe(false)
    view.unmount()
    const plain = requestAlertConfirmation({ title: '克隆费用', message: '费用说明', confirmLabel: '开始克隆' })
    render(<GlobalAlertDialog />)
    expect(screen.getByRole('button', { name: '开始克隆' }).className).not.toContain('ui-btn-danger-solid')
    fireEvent.click(screen.getByRole('button', { name: '开始克隆' }))
    await expect(plain).resolves.toBe(true)
  })

  it('明确确认才接受本次提交', async () => {
    const pending = requestAlertConfirmation({ title: '克隆费用', message: '费用说明', confirmLabel: '开始克隆' })
    render(<GlobalAlertDialog />)
    fireEvent.click(screen.getByRole('button', { name: '开始克隆' }))
    await expect(pending).resolves.toBe(true)
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  })

  it('连续相同确认按请求隔离，取消前一个后重新挂载下一个弹窗', async () => {
    const request = { title: '克隆费用', message: '费用说明', confirmLabel: '开始克隆' }
    const first = requestAlertConfirmation(request)
    const second = requestAlertConfirmation(request)
    render(<GlobalAlertDialog />)
    const original = screen.getByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await expect(first).resolves.toBe(false)
    expect(screen.getByRole('alertdialog')).not.toBe(original)
    fireEvent.click(screen.getByRole('button', { name: '开始克隆' }))
    await expect(second).resolves.toBe(true)
  })

  it('密钥提示只显示关闭和去配置，并精确跳转到密钥设置', () => {
    showAlertDialog({
      title: '还没有配置密钥',
      message: '你还没有配置密钥，你需要去配置一下。',
      type: 'info',
      settingsTarget: { tab: 'providers', sectionId: 'providers' },
    })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)

    expect(screen.getAllByRole('button').map((button) => button.textContent))
      .toEqual(['关闭', '去配置'])

    fireEvent.click(screen.getByRole('button', { name: '去配置' }))
    expect(useUiStore.getState()).toMatchObject({
      isSettingsOpen: true,
      settingsTarget: { tab: 'providers', sectionId: 'providers' },
    })
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  })
  it('多个动作时关闭在最左、主动作固定在最右，错误用圆形警示图标（任务 5.7）', () => {
    showAlertDialog({
      title: '生成失败',
      message: '供应商返回错误',
      type: 'error',
      detail: 'stack',
      settingsTarget: { tab: 'providers', sectionId: 'providers' },
    })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels[0]).toBe('关闭')
    expect(labels.at(-1)).toBe('去配置')
    expect(screen.getByRole('alertdialog').querySelector('.lucide-circle-alert')).not.toBeNull()
  })
})


afterEach(() => { cleanup(); useAlertDialogStore.setState({ queue: [] }) })

it.each([
  ['zh-CN', '请核对已执行的修改', '已核对，继续编辑', '稍后处理'],
  ['en-US', 'Review the changes already made', 'Reviewed; continue editing', 'Review later'],
])('已执行核对仅提供确认和稍后（%s）', async (language, title, confirm, later) => {
  cleanup()
  await i18n.changeLanguage(language)
  useAlertDialogStore.setState({ queue: [] })
  const decisions: string[] = []
  const review = { operationId: 'secret-operation', callerId: 'secret-caller', executed: true, resolve: (decision: 'completed' | 'not_executed' | 'later') => { decisions.push(decision) } }
  showAlertDialog({ title: '内部标题', message: '请查看海报素材。', review })
  const view = render(<GlobalAlertDialog />)
  expect(screen.getByText(title)).toBeTruthy()
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([confirm, later])
  expect(screen.getByRole('alertdialog').textContent).not.toMatch(/secret|revision/)
  fireEvent.click(screen.getByRole('button', { name: confirm }))
  expect(decisions).toEqual(['completed'])
  view.unmount()
  useAlertDialogStore.setState({ queue: [] })
  await i18n.changeLanguage('zh-CN')
})

it('英文付费确认由结构化费用拼句，核对标题与三个动作均翻译', async () => {
  await i18n.changeLanguage('en-US')
  useAlertDialogStore.setState({ queue: [] })
  const pending = requestAlertConfirmation({ title: 'Approval', message: 'Send the request?', confirmLabel: 'Allow', paidConfirmation: true,
    paidDetails: { estimatedCny: 1.25, dailySpentCny: 3, category: 'generation', modelName: 'Example model' } })
  const view = render(<GlobalAlertDialog />)
  expect(screen.getByText(/Estimated cost: CNY 1.25/)).toBeTruthy()
  expect(screen.getByText(/Generation · Example model/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
  await expect(pending).resolves.toBe(false)
  view.unmount()
  showAlertDialog({ title: '旧标题', message: 'Review the document.', review: { operationId: 'operation', callerId: 'caller', resolve: () => {} } })
  render(<GlobalAlertDialog />)
  expect(screen.getByText('Did this change take effect?')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'No change; allow a retry' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'The change took effect' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Review later' })).toBeTruthy()
  useAlertDialogStore.setState({ queue: [] })
  await i18n.changeLanguage('zh-CN')
})
