import { createInstance } from 'i18next'
import { expect, it } from 'vitest'
import zh from '@/i18n/locales/zh-CN/history.json'
import en from '@/i18n/locales/en-US/history.json'
import { taskErrorMessage } from './taskErrorMessage'

it('统一展示 SDK 用户说明和运行时包装的错误，原始供应商报文不会进入历史列表', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { history: zh }, 'en-US': { history: en } } })
  const raw = 'Continue polling failed for kie-eleven-turbo-2.5-tts: [provider_task_failed] Internal Error, Please try again later.'
  expect(taskErrorMessage(raw, 'kie', i18n.t)).toBe(zh.failure.kieInternal)
  expect(taskErrorMessage('[provider_internal_error] KIE 服务内部错误，可稍后手动重试。', 'kie', i18n.t)).toBe(zh.failure.kieInternal)
  expect(taskErrorMessage('Generation failed for model: [provider_task_failed] 内容审核未通过，请调整提示词。', 'fal', i18n.t)).toBe('内容审核未通过，请调整提示词。')
  expect(taskErrorMessage('Continue polling failed for model: [polling_timeout] timed out', 'fal', i18n.t)).toBe(zh.failure.timeout)
  expect(taskErrorMessage('unknown vendor response: requestId=private', 'fal', i18n.t)).toBe(zh.failure.unknown)
  expect(taskErrorMessage(undefined, undefined, i18n.t)).toBe(zh.failure.unknown)
  await i18n.changeLanguage('en-US')
  expect(taskErrorMessage(raw, 'kie', i18n.t)).toBe(en.failure.kieInternal)
})
