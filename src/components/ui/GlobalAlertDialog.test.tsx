// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n/config'
import { showAlertDialog, useAlertDialogStore } from '@/stores/alertDialogStore'
import { useUiStore } from '@/stores/uiStore'
import { GlobalAlertDialog } from './GlobalAlertDialog'

describe('GlobalAlertDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAlertDialogStore.setState({ queue: [] })
    useUiStore.setState({ isSettingsOpen: false, settingsTarget: null })
  })

  afterEach(() => cleanup())

  it('密钥提示只显示关闭和去配置，并精确跳转到密钥设置', () => {
    showAlertDialog({
      title: '还没有配置密钥',
      message: '你还没有配置密钥，你需要去配置一下。',
      type: 'info',
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    render(<GlobalAlertDialog onAskAssistant={() => undefined} />)

    expect(screen.getAllByRole('button').map((button) => button.textContent))
      .toEqual(['去配置', '关闭'])

    fireEvent.click(screen.getByRole('button', { name: '去配置' }))
    expect(useUiStore.getState()).toMatchObject({
      isSettingsOpen: true,
      settingsTarget: { tab: 'models', sectionId: 'models-providers' },
    })
    expect(useAlertDialogStore.getState().queue).toHaveLength(0)
  })
})
