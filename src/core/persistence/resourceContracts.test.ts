import fs from 'node:fs'
import path from 'node:path'
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { decodePersistenceResource, resourcePersistenceContract, type PersistenceResourceId } from './resourceContracts'
import { readImageLayoutResource } from '../../../electron/main/services/image-editor-v3/layout-resources'
import type { ContentAddressedResourceStore } from '../../../electron/main/services/image-editor-v3/resource-store'
import { readMotionResource } from '../../features/videoEdit/application/videoEditMotionResources'

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { fs: { readFile } } }) }))
vi.mock('../../features/videoEdit/application/videoEditService', () => ({ requireVideoEditInstance: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const ids: PersistenceResourceId[] = ['capture-log-page', 'creative-intent-page', 'creative-intent-candidate', 'image-layout-page', 'image-layout-candidate']
const fixture = (id: PersistenceResourceId): Record<string, unknown> => JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/persistence', id, 'v1.json'), 'utf8')) as Record<string, unknown>

describe('不可变资源统一解码', () => {
  it.each(ids)('%s 预检版本、完整迁移链和最终schema，不修改原值', id => {
    const raw = fixture(id)
    expect(decodePersistenceResource(id, raw)).toEqual(raw)
    expect(() => decodePersistenceResource(id, { ...raw, version: 2 })).toThrowError(expect.objectContaining({ code: 'newer-version' }))
    expect(() => decodePersistenceResource(id, { ...raw, version: undefined })).toThrowError(expect.objectContaining({ code: 'invalid-content' }))
    const contract = resourcePersistenceContract(id), original = { ...contract }
    const step = vi.fn((value: unknown) => ({ ...(value as object), version: 2, migrated: true }))
    Object.assign(contract, { version: 2, schema: z.looseObject({ version: z.literal(2), migrated: z.literal(true) }), migrations: {} })
    try {
      expect(() => decodePersistenceResource(id, raw)).toThrowError(expect.objectContaining({ code: 'unsupported-version' }))
      Object.assign(contract, { migrations: { 1: step } })
      expect(decodePersistenceResource(id, raw)).toMatchObject({ version: 2, migrated: true })
      expect(raw).toEqual(fixture(id))
      Object.assign(contract, { migrations: { 1: () => ({ version: 2 }) } })
      expect(() => decodePersistenceResource(id, raw)).toThrowError(expect.objectContaining({ code: 'migration-failed', fields: ['migrated'] }))
    } finally { Object.assign(contract, original) }
  })

  it('随手摆真实读入口先核验原字节，再迁移；新内存内容不要求匹配旧摘要', async () => {
    const contract = resourcePersistenceContract('image-layout-page'), original = { ...contract }
    const bytes = Buffer.from(JSON.stringify(fixture('image-layout-page')))
    const readVerifiedBuffer = vi.fn().mockResolvedValue(bytes)
    const store = { readVerifiedBuffer } as unknown as ContentAddressedResourceStore
    const step = vi.fn((raw: unknown) => ({ ...(raw as object), version: 2, migrated: true }))
    Object.assign(contract, { version: 2, schema: z.looseObject({ version: z.literal(2), migrated: z.literal(true) }), migrations: { 1: step } })
    try {
      expect(await readImageLayoutResource(store, 'sha256:test')).toMatchObject({ version: 2, migrated: true })
      expect(readVerifiedBuffer.mock.invocationCallOrder[0]).toBeLessThan(step.mock.invocationCallOrder[0])
      step.mockClear(); readVerifiedBuffer.mockRejectedValue(new Error('digest mismatch'))
      await expect(readImageLayoutResource(store, 'sha256:test')).rejects.toThrow('digest mismatch')
      expect(step).not.toHaveBeenCalled()
    } finally { Object.assign(contract, original) }
  })

  it('剪辑共用读取入口覆盖采样和讲解页；摘要错误在任何迁移之前拒绝', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const bytes = Buffer.from(JSON.stringify(fixture('creative-intent-page')))
    const resource = { resourceId: 'test', path: 'synthetic.json', kind: 'page' as const, bytes: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
    readFile.mockResolvedValue(bytes)
    expect(await readMotionResource(resource)).toEqual(fixture('creative-intent-page'))
    const newer = Buffer.from(JSON.stringify({ ...fixture('creative-intent-page'), version: 2 }))
    readFile.mockResolvedValue(newer)
    await expect(readMotionResource(resource)).rejects.toThrow('已被修改')
    await expect(readMotionResource({ ...resource, bytes: newer.length, digest: `sha256:${createHash('sha256').update(newer).digest('hex')}` })).rejects.toMatchObject({ code: 'newer-version' })
  })
})
