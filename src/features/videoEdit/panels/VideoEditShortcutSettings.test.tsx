// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/stores/settingsStore'
import { VideoEditShortcutSettings } from './VideoEditShortcutSettings'
// 文案走 i18n（任务 5.8，B-39）：断言按中文界面
beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
beforeEach(() => { useSettingsStore.getState().setVideoEditShortcuts({}) })
afterEach(cleanup)
it('实际录入保存、冲突保护及恢复默认共用持久设置', () => {
  render(<VideoEditShortcutSettings />)
  fireEvent.click(screen.getByRole('button', { name: '编辑快捷键' }))
  const key = screen.getByRole('button', { name: '选择工具键位' })
  fireEvent.click(key); fireEvent.keyDown(key, { code: 'KeyC', key: 'c' })
  expect(screen.getByRole('button', { name: '保存快捷键' }).hasAttribute('disabled')).toBe(true)
  expect(useSettingsStore.getState().videoEditShortcuts).toEqual({})
  fireEvent.click(key); fireEvent.keyDown(key, { code: 'F9', key: 'F9' })
  fireEvent.click(screen.getByRole('button', { name: '保存快捷键' }))
  expect(useSettingsStore.getState().videoEditShortcuts.select_tool?.code).toBe('F9')
  fireEvent.click(screen.getByRole('button', { name: '编辑快捷键' }))
  fireEvent.click(screen.getByRole('button', { name: '恢复 PR 默认' })); fireEvent.click(screen.getByRole('button', { name: '保存快捷键' }))
  expect(useSettingsStore.getState().videoEditShortcuts).toEqual({})
})
