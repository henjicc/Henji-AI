/** @vitest-environment jsdom */
import { expect, it } from 'vitest'
import { useAssistantUiStore } from './assistantUiStore'

it('是否打开不记忆：打开后不写入本地记录，旧版本存下的 open 重新加载时也不采用', async () => {
  useAssistantUiStore.getState().setOpen(true)
  expect(JSON.parse(localStorage.getItem('henji-assistant-ui')!).state).not.toHaveProperty('open')
  useAssistantUiStore.getState().setOpen(false)
  localStorage.setItem('henji-assistant-ui', JSON.stringify({ state: { open: true, mode: 'right' }, version: 1 }))
  await useAssistantUiStore.persist.rehydrate()
  expect(useAssistantUiStore.getState().open).toBe(false)
})
