import { afterEach, beforeEach, expect, it } from 'vitest'
import { createContentTrustTestSession } from './test-support'
import { contentTrustCommandSchema } from '../../../../src/core/contentTrust'
let fixture: ReturnType<typeof createContentTrustTestSession>
beforeEach(() => { fixture = createContentTrustTestSession() })
afterEach(() => fixture.dispose())
const content = { id: 'imported', sourceName: '分享内容', sourceType: 'template' as const }
it('本机与旧内容没有标记就直接执行，外来标记在首次执行前被拦下', () => {
  expect(() => fixture.session.assert({ contents: [] })).not.toThrow()
  expect(() => fixture.session.assert({ contents: [content] })).toThrow('等待用户确认')
})
it('仅这一次在本次进程可复用，重启失效；不运行只拦外来内容，运行入口能再次询问', () => {
  const query = { contents: [content] }
  fixture.session.decide(fixture.session.check(query).challenge!, 'once')
  expect(() => fixture.session.assert(query)).not.toThrow()
  fixture.restart()
  const pending = fixture.session.check(query)
  fixture.session.decide(pending.challenge!, 'deny')
  expect(() => fixture.session.assert(query)).toThrow('尚未运行')
  expect(fixture.session.check(query).challenge).toBeUndefined()
  expect(fixture.session.retry([content]).challenge).toEqual(expect.any(String))
  expect(() => fixture.session.assert({ contents: [] })).not.toThrow()
})
it('始终允许只保存总开关，重启后任何外来代码都不再询问；同时触发合并成一次', () => {
  const first = fixture.session.check({ contents: [content] })
  const second = fixture.session.check({ contents: [{ ...content, id: 'other' }] })
  expect(second.challenge).toBe(first.challenge)
  expect(second.records).toHaveLength(2)
  fixture.session.decide(first.challenge!, 'always')
  fixture.restart()
  expect(fixture.session.policy()).toBe(true)
  expect(() => fixture.session.assert({ contents: [{ ...content, id: 'anything' }] })).not.toThrow()
})
it('执行输入不能携带批准参数，选择只从独立的应用内询问入口进入', () => {
  expect(contentTrustCommandSchema.safeParse({ action: 'check', query: { contents: [content], trusted: true } }).success).toBe(false)
  expect(contentTrustCommandSchema.safeParse({ action: 'prepare', sourceType: 'skill', id: 'example', trusted: true }).success).toBe(false)
})
