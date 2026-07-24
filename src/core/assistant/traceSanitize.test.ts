import { describe, expect, it } from 'vitest'

import {
  sanitizeAgentTraceHeaders,
  sanitizeAgentTraceUrl,
  sanitizeAgentTraceValue,
} from './traceSanitize'

describe('assistant trace sanitizer', () => {
  it('脱敏凭据但保留 Token 计数和模型限制', () => {
    expect(sanitizeAgentTraceValue({
      apiKey: 'secret-key',
      access_token: 'secret-token',
      inputTokens: 123,
      maxOutputTokens: 456,
    })).toEqual({
      apiKey: '***',
      access_token: '***',
      inputTokens: 123,
      maxOutputTokens: 456,
    })
  })

  it('脱敏请求头与 URL 查询参数', () => {
    expect(sanitizeAgentTraceHeaders({
      Authorization: 'Bearer secret',
      Cookie: 'session=secret',
      'Content-Type': 'application/json',
    })).toEqual({
      Authorization: '***',
      Cookie: '***',
      'Content-Type': 'application/json',
    })
    expect(sanitizeAgentTraceUrl('https://example.test/v1/chat?api_key=secret&region=cn'))
      .toBe('https://example.test/v1/chat?api_key=***&region=cn')
    expect(sanitizeAgentTraceValue(
      '请求失败：Authorization: Bearer secret-token，api_key=secret-key'
    )).not.toContain('secret')
  })

  it('大媒体与裸 base64 只保存摘要', () => {
    const dataUri = `data:image/png;base64,${'A'.repeat(2_000)}`
    const rawBase64 = 'B'.repeat(2_000)
    const sanitized = sanitizeAgentTraceValue({ dataUri, rawBase64 }) as Record<string, string>
    expect(sanitized.dataUri).toContain('data-uri')
    expect(sanitized.rawBase64).toContain('base64')
    expect(sanitized.dataUri.length).toBeLessThan(dataUri.length)
  })
})
