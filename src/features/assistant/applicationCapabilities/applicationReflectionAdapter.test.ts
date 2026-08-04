import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  describe: vi.fn(),
  listDeclaredPropertyPermissions: vi.fn(() => ['assets:read', 'assets:write', 'storyboard:read']),
  plan: vi.fn(),
  commit: vi.fn(),
}))

vi.mock('./applicationControlRegistry', () => ({
  getApplicationReflectionRegistry: () => ({
    describe: mocks.describe,
    listDeclaredPropertyPermissions: mocks.listDeclaredPropertyPermissions,
  }),
  getApplicationControlExecutionEngine: () => ({
    plan: mocks.plan,
    commit: mocks.commit,
  }),
}))

import { APPLICATION_REFLECTION_APPLICATION_CAPABILITIES } from '@/core/assistant/capabilities/applicationReflectionApplicationCapabilities'

import { applicationReflectionHandlers } from './applicationReflectionAdapter'

const context = { signal: new AbortController().signal, requestId: 'reflection-adapter-test' }

describe('应用反射通用能力适配器', () => {
  it('内部领域权限完全从反射注册源派生', async () => {
    mocks.describe.mockReturnValueOnce({ catalogVersion: 'application-capabilities/v2', entities: [], properties: [] })
    await applicationReflectionHandlers.describeEntities({ domains: [], entityTypes: [] }, context)

    const accessContext = mocks.describe.mock.calls[0]?.[1] as { permissions: Set<string> }
    expect([...accessContext.permissions]).toEqual(expect.arrayContaining([
      'application:read', 'application:write', 'assets:read', 'assets:write', 'storyboard:read',
    ]))
  })

  it('mutate_properties 原样传递 append/remove 等属性操作', async () => {
    mocks.plan.mockResolvedValueOnce({ planRef: 'plan-1' })
    mocks.commit.mockResolvedValueOnce({
      status: 'completed',
      transactionRef: 'transaction-1',
      resultingRevisions: { assets: 2 },
      producedRefs: [],
      evidence: [],
    })

    await applicationReflectionHandlers.changeEntities({
      summary: '调整素材集合归属',
      expectedRevisions: { assets: 1 },
      changes: [{
        kind: 'mutate_properties',
        target: { kind: 'asset', id: 'asset-1' },
        entityType: 'asset',
        mutations: [
          { propertyId: 'asset.library_refs', operation: 'append', value: { kind: 'asset.library', id: 'lib-1' } },
          { propertyId: 'asset.library_refs', operation: 'remove', value: { kind: 'asset.library', id: 'lib-2' } },
        ],
      }],
    }, context)

    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      steps: [expect.objectContaining({
        kind: 'mutation',
        mutations: [
          { propertyId: 'asset.library_refs', operation: 'append', value: { kind: 'asset.library', id: 'lib-1' } },
          { propertyId: 'asset.library_refs', operation: 'remove', value: { kind: 'asset.library', id: 'lib-2' } },
        ],
      })],
    }), expect.any(Object))
  })

  it('公开能力 schema 接受 mutate_properties，拒绝缺失 value 的 append', () => {
    const capability = APPLICATION_REFLECTION_APPLICATION_CAPABILITIES
      .find((item) => item.id === 'change_application_entities')
    if (!capability) throw new Error('CHANGE_APPLICATION_ENTITIES_MISSING')
    const base = {
      summary: '修改素材', expectedRevisions: { assets: 1 },
      changes: [{
        kind: 'mutate_properties', target: { kind: 'asset', id: 'asset-1' }, entityType: 'asset',
        mutations: [{ propertyId: 'asset.library_refs', operation: 'append', value: 'lib-1' }],
      }],
    }
    expect(capability.inputSchema.safeParse(base).success).toBe(true)
    expect(capability.inputSchema.safeParse({
      ...base,
      changes: [{
        kind: 'mutate_properties', target: { kind: 'asset', id: 'asset-1' }, entityType: 'asset',
        mutations: [{ propertyId: 'asset.library_refs', operation: 'append' }],
      }],
    }).success).toBe(false)
  })
})
