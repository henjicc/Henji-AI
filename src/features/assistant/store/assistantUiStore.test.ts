/** @vitest-environment jsdom */
import { expect, it } from 'vitest'
import { useAssistantUiStore } from './assistantUiStore'

it('内置助手默认开放全部操作，用户改成只读后关闭面板与重新加载仍保留选择', async () => {
  expect(useAssistantUiStore.getState().embeddedAccess).toBe('full')
  useAssistantUiStore.getState().setEmbeddedAccess('read')
  useAssistantUiStore.getState().setOpen(false)
  useAssistantUiStore.getState().setOpen(true)
  await useAssistantUiStore.persist.rehydrate()
  expect(useAssistantUiStore.getState().embeddedAccess).toBe('read')
  expect(JSON.parse(localStorage.getItem('henji-assistant-ui')!).state.embeddedAccess).toBe('read')
})
