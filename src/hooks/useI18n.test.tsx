// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useI18n } from './useI18n'
afterEach(cleanup)
it('通用语言切换也归一英文地区标签，I18nText 消费方读到英文', async () => {
  const { result } = renderHook(() => useI18n())
  await act(async () => { await result.current.changeLanguage('en-AU') })
  expect(result.current.currentLanguage).toBe('en-US')
  expect(result.current.tText({ zh: '中文', en: 'English' })).toBe('English')
})
