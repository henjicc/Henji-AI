// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n/config'
import { requestAlertConfirmation, showAlertDialog, useAlertDialogStore } from '@/stores/alertDialogStore'
import { useUiStore } from '@/stores/uiStore'
import { GlobalAlertDialog } from './GlobalAlertDialog'

describe('GlobalAlertDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAlertDialogStore.setState({ queue: [] })
    useUiStore.setState({ isSettingsOpen: false, settingsTarget: null })
  })

  afterEach(() => cleanup())

  it('二次确认只显示明确的确认和取消动作，取消后不能趁退出动画确认', async () => {
    const pending = requestAlertConfirmation({ title: '克隆费用', message: '首次正式合成另收 138 元', confirmLabel: '确认费用，开始克隆' })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['取消', '确认费用，开始克隆'])
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '确认费用，开始克隆' })).toBeNull()
    await expect(pending).resolves.toBe(false)
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
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)

    expect(screen.getAllByRole('button').map((button) => button.textContent))
      .toEqual(['关闭', '去配置'])

    fireEvent.click(screen.getByRole('button', { name: '去配置' }))
    expect(useUiStore.getState()).toMatchObject({
      isSettingsOpen: true,
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  })
  it('多个动作时关闭在最左、主动作固定在最右，错误用圆形警示图标（任务 5.7）', () => {
    showAlertDialog({
      title: '生成失败',
      message: '供应商返回错误',
      type: 'error',
      detail: 'stack',
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels[0]).toBe('关闭')
    expect(labels.at(-1)).toBe('去配置')
    expect(screen.getByRole('alertdialog').querySelector('.lucide-circle-alert')).not.toBeNull()
  })
})
