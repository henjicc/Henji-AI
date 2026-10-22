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

it('是否打开不记忆：打开后不写入本地记录，旧版本存下的 open 重新加载时也不采用', async () => {
  useAssistantUiStore.getState().setOpen(true)
  expect(JSON.parse(localStorage.getItem('henji-assistant-ui')!).state).not.toHaveProperty('open')
  useAssistantUiStore.getState().setOpen(false)
  localStorage.setItem('henji-assistant-ui', JSON.stringify({ state: { open: true, mode: 'right' }, version: 1 }))
  await useAssistantUiStore.persist.rehydrate()
  expect(useAssistantUiStore.getState().open).toBe(false)
})
