import { describe, expect, it, vi } from 'vitest'
import { ApplicationEntityNotFoundError } from '../registry/types'
import { ApplicationTransactionVerifier } from './verifier'
import { createFixture, context } from './engineTestFixture'

describe('正式验证必须绑定原目标', () => {
  it('相同字段值的旧快照不能验证当前写入；新读取也必须覆盖执行后的版本', async () => {
    const fixture = createFixture()
    const read = vi.spyOn(fixture.registry, 'readEntity')
    const verifier = new ApplicationTransactionVerifier(fixture.registry)
    const now = new Date()
    const target = { kind: 'sample.item', id: 'A' }
    const condition = { kind: 'property_equals' as const, target, propertyId: 'sample.value', expected: 6 }
    const snapshot = { ref: target, entityType: target.kind, properties: { 'sample.value': 6 },
      revisions: { 'sample.scope': 2 }, capturedAt: now.toISOString() }
    read.mockResolvedValueOnce({ ...snapshot, capturedAt: new Date(now.getTime() - 1).toISOString() })
    expect(await verifier.verify([condition], [], context(), now, { 'sample.scope': 2 })).toMatchObject({ verified: false })
    read.mockResolvedValueOnce({ ...snapshot, revisions: { 'sample.scope': 1 } })
    expect(await verifier.verify([condition], [], context(), now, { 'sample.scope': 2 })).toMatchObject({ verified: false })
    read.mockResolvedValueOnce({ ...snapshot, capturedAt: 'not-a-date' })
    expect(await verifier.verify([condition], [], context(), now, { 'sample.scope': 2 })).toMatchObject({ verified: false })
    read.mockResolvedValueOnce({ ...snapshot, revisions: { 'unrelated.scope': 10 } })
    expect(await verifier.verify([condition], [], context(), now, { 'sample.scope': 2 })).toMatchObject({ verified: false })
    read.mockResolvedValueOnce(snapshot)
    expect(await verifier.verify([condition], [], context(), now, { 'sample.scope': 2 })).toMatchObject({ verified: true })
  })
  it('读取 B 的相同字段值不能验证 A；失败提示中出现 NOT_FOUND 不能证明 A 已删除', async () => {
    const fixture = createFixture()
    const read = vi.spyOn(fixture.registry, 'readEntity')
    const verifier = new ApplicationTransactionVerifier(fixture.registry)
    read.mockResolvedValueOnce({ ref: { kind: 'sample.item', id: 'B' }, entityType: 'sample.item',
      properties: { 'sample.value': 6 }, revisions: { 'sample.scope': 1 }, capturedAt: new Date().toISOString() })
    expect(await verifier.verify([{ kind: 'property_equals', target: { kind: 'sample.item', id: 'A' },
      propertyId: 'sample.value', expected: 6 }], [], context(), new Date())).toMatchObject({ verified: false })
    for (const error of [new Error('RESOURCE_NOT_FOUND:preview'), new Error('ENTITY_NOT_FOUND:A'),
      new ApplicationEntityNotFoundError({ kind: 'sample.item', id: 'B' }, 'B 不存在')]) {
      read.mockRejectedValueOnce(error)
      expect(await verifier.verify([{ kind: 'entity_absent', target: { kind: 'sample.item', id: 'A' } }],
        [], context(), new Date())).toMatchObject({ verified: false })
    }
    read.mockRejectedValueOnce(new ApplicationEntityNotFoundError({ kind: 'sample.item', id: 'A' }, 'A 不存在'))
    expect(await verifier.verify([{ kind: 'entity_absent', target: { kind: 'sample.item', id: 'A' } }],
      [], context(), new Date())).toMatchObject({ verified: true })
  })
})
