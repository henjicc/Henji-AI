import { describe, expect, it, vi } from 'vitest'
import { createRegisteredSecretStreamRedactor, redactLogCredentials, redactRegisteredSecrets, registerLogSecret, sanitizeCredentialText, sanitizeLogPayload, unregisterLogSecret } from './sanitize'

describe('日志凭据脱敏', () => {
  it('覆盖嵌套字段、头列表、错误 cause 与循环对象', () => {
    const input = { apiKey: 'private', nested: { 'Set-Cookie': 'sid=hidden', accessToken: 'token-value', secretAccessKey: 'private' }, headers: [['Authorization', 'Bearer hidden'], ['Cookie', 'sid=hidden']], error: new Error('api_key=hidden', { cause: new Error('Cookie: sid=hidden') }) }
    expect(JSON.stringify(redactLogCredentials(input))).not.toMatch(/private|hidden|token-value/)
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    expect(redactLogCredentials(cycle)).toEqual({ self: '[circular]' })
  })
  it.each([
    'request Authorization: Bearer abcdef\nnext line',
    'headers={"Authorization":"Basic dXNlcjpwYXNz"}',
    'Cookie: sid=abcdef; session=ghijkl\nnext line',
    'Set-Cookie: sid=abcdef; HttpOnly; Path=/',
    'failed apiKey="abcdef"; token=ghijkl',
    'https://test.invalid?api_key=abcdef&next=ok',
    'key sk-proj-abcdefghijklmnop',
    'key ghp_abcdefghijklmnopqrstuvwxyz',
    'key eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
  ])('脱敏自由文本：%s', text => {
    const safe = sanitizeCredentialText(text)
    expect(safe).toContain('***')
    expect(safe).not.toMatch(/abcdef|ghijkl|dXNlcjpwYXNz|eyJ/)
  })
  it('任意格式的实际凭据即使没有字段名也脱敏', () => {
    registerLogSecret('opaque-fixture-credential')
    expect(sanitizeCredentialText('供应商拒绝 opaque-fixture-credential')).toBe('供应商拒绝 ***')
  })
  it('保留普通文字、令牌计数、标记、URL 和模型信息', () => {
    const input = { message: 'API key 配置成功；cookie 已更新；token count 42；Bearer 是认证方案', inputTokens: 100, output_tokens: 20, tokenCount: 120, max_tokens: 300, captureToken: 2, apiKeyUrl: 'https://example.com/keys', tokenizer: '模型分词器', model: 'gpt-4.1', text: '普通文本与 abcdef0123456789' }
    expect(redactLogCredentials(input)).toEqual(input)
  })
  it('短凭据不登记，替换和删除释放旧值，同值共享槽仍受保护', () => {
    registerLogSecret('1', 'short')
    registerLogSecret('12345678901', 'short')
    expect(sanitizeCredentialText('1 12345678901')).toBe('1 12345678901')
    registerLogSecret('opaque-original-value', 'slot-a')
    registerLogSecret('opaque-original-value', 'slot-b')
    registerLogSecret('opaque-replacement-value', 'slot-a')
    expect(sanitizeCredentialText('opaque-original-value opaque-replacement-value')).toBe('*** ***')
    unregisterLogSecret('slot-b')
    expect(sanitizeCredentialText('opaque-original-value opaque-replacement-value')).toBe('opaque-original-value ***')
    registerLogSecret('short', 'slot-a')
    expect(sanitizeCredentialText('opaque-replacement-value')).toBe('opaque-replacement-value')
  })
  it('结构字段保留普通值与正则形似凭据的标识，仍替换已登记密钥', () => {
    const key = 'fixture-identifier-value'
    registerLogSecret(key)
    const structure = { timestamp: '2026-10-29T00:00:00Z', event: 'request.started', level: 'info', domain: 'main.test', source: 'renderer', id: 'sk-proj-abcdefghijklmnop', runId: 'chain-1' }
    expect(redactLogCredentials({ ...structure, requestId: `request-${key}`, context: { nested: { trace_id: key, event: key } }, [key]: key })).toEqual({ ...structure, requestId: 'request-***', context: { nested: { trace_id: '***', event: '***' } }, [key]: '***' })
    expect(redactRegisteredSecrets({ password: 'ordinary', text: key, list: ['token', 'ordinary'], name: key, [key]: 'plain' })).toEqual({ password: 'ordinary', text: '***', list: ['token', 'ordinary'], name: '***', [key]: 'plain' })
    expect(redactLogCredentials({ context: { structuredOutput: { name: key, message: key, code: key } } })).toEqual({ context: { structuredOutput: { name: '***', message: '***', code: '***' } } })
  })
  it('不误伤分页令牌、单数计数及普通二元数组', () => {
    const input = { maxToken: 20, pageToken: 'page-a', nextPageToken: 'page-b', values: [['token', 'one'], ['secret', 'two'], ['password', 'three']] }
    expect(redactLogCredentials(input)).toEqual(input)
  })
  it('按明确凭据后缀覆盖常见字段，排除分页、计数与采集标记', () => {
    const fields = ['sessionToken', 'accessKeySecret', 'appSecret', 'authToken', 'apiKeys', 'APIKeys', 'service_api_keys', 'serviceCredential', 'providerPassword', 'secretAccessKey']
    expect(redactLogCredentials(Object.fromEntries(fields.map(key => [key, 'hidden'])))).toEqual(Object.fromEntries(fields.map(key => [key, '***'])))
    const ordinary = { maxToken: 20, max_token: 20, pageToken: 'page-a', page_token: 'page-a', nextPageToken: 'page-b', next_page_token: 'page-b', tokenCount: 20, captureToken: 2, apiKeyUrl: '/keys', secretariat: 'text', credentialsCount: 2 }
    expect(redactLogCredentials(ordinary)).toEqual(ordinary)
  })
  it('在访问深层字段前截断，一次遍历共享对象', () => {
    const read = vi.fn(() => 'plain')
    const shared = { get value() { return read() } }
    const input = { left: shared, right: shared }
    expect(sanitizeLogPayload(input)).toEqual({ left: { value: 'plain' }, right: '[circular]' })
    expect(read).toHaveBeenCalledTimes(1)
    let deep: unknown = { get value() { throw new Error('不应访问截断后的字段') } }
    for (let depth = 0; depth < 100; depth++) deep = { child: deep }
    expect(() => sanitizeLogPayload(deep)).not.toThrow()
    expect(JSON.stringify(sanitizeLogPayload(deep))).toContain('[depth-limited]')
  })
  it('跨任意片段脱敏，普通文本即时返回，结尾只释放未匹配的前缀', () => {
    const key = 'opaque-split-credential'
    registerLogSecret(key, 'split-fixture')
    const stream = createRegisteredSecretStreamRedactor()
    expect(stream.write('普通文本 ')).toBe('普通文本 ')
    const output = [...key].map(character => stream.write(character)).join('')
    expect(output + stream.flush()).toBe('***')
    expect(stream.write('opaque-split-')).toBe('')
    expect(stream.write('ordinary')).toBe('opaque-split-ordinary')
    expect(stream.write('opaque-split-')).toBe('')
    expect(stream.flush()).toBe('opaque-split-')
    expect(stream.flush()).toBe('')
  })
  it('凭据替换时仍完成已暂存片段的匹配，完成后释放候选', () => {
    registerLogSecret('pending-fixture-credential', 'pending-fixture')
    const stream = createRegisteredSecretStreamRedactor()
    expect(stream.write('pending-fixture-')).toBe('')
    unregisterLogSecret('pending-fixture')
    expect(stream.write('credential')).toBe('***')
    expect(stream.write('pending-fixture-credential')).toBe('pending-fixture-credential')
  })
  it('对象型错误标识继续脱敏并处理循环，仅字符串标识保留', () => {
    const code: Record<string, unknown> = { apiKey: 'private' }
    code.self = code
    for (const error of [{ name: 'Error', message: 'failed', code }, Object.assign(new Error('failed'), { code })]) {
      const safe = redactLogCredentials(error)
      expect(safe).toMatchObject({ name: 'Error', code: { apiKey: '***', self: '[circular]' } })
      expect(() => JSON.stringify(safe)).not.toThrow()
      expect(JSON.stringify(safe)).not.toContain('private')
    }
  })
})
