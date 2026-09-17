import { expect, it } from 'vitest'
import { assistantErrorMessage } from './assistantErrorPresentation'

it.each([
  ['OpenAI API error (402): {"message":"Insufficient Balance"}', '余额不足'],
  ['429 insufficient_quota', '余额不足'],
  ['401 Unauthorized', '认证失败'],
  ['429 Too many requests', '过于频繁'],
  ['fetch failed ECONNRESET', '连接助手模型服务失败'],
  ['maximum context length exceeded', '长度限制'],
  ['503 Service unavailable', '暂时无法响应'],
  ['Unexpected xyz', '未能完成'],
])('将 %s 转为可理解的助手错误', (raw, expected) => {
  expect(assistantErrorMessage(raw)).toContain(expected)
  expect(assistantErrorMessage(raw)).not.toContain('OpenAI')
})
it('保留应用自身的恢复提示', () => {
  expect(assistantErrorMessage('请先在设置中选择助手模型。')).toBe('请先在设置中选择助手模型。')
})
