import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ContentAddressedResourceStore } from './resource-store'

let rootDir = ''
let store: ContentAddressedResourceStore

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-resource-'))
  store = new ContentAddressedResourceStore(rootDir)
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('ContentAddressedResourceStore', () => {
  it('按 SHA-256 去重并拒绝与声明哈希不一致的内容', async () => {
    const bytes = Buffer.from('same immutable pixels')
    const expected = crypto.createHash('sha256').update(bytes).digest('hex')
    const first = await store.putBuffer(bytes, { mediaType: 'application/octet-stream' })
    const second = await store.putBuffer(bytes)

    expect(first.id).toBe(`sha256:${expected}`)
    expect(first.created).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.created).toBe(false)
    expect((await store.verify(first.id)).byteLength).toBe(bytes.byteLength)

    await expect(store.putBuffer(Buffer.from('tampered'), { expectedSha256: expected }))
      .rejects.toThrow('SHA-256 mismatch')
  })

  it('GC 保留活跃 lease，释放后只删除不在 live set 中的资源', async () => {
    const kept = await store.putBuffer(Buffer.from('referenced'))
    const leased = await store.putBuffer(Buffer.from('leased'))
    const orphan = await store.putBuffer(Buffer.from('orphan'))
    const lease = await store.acquireLease([leased.id])

    const first = await store.garbageCollect(new Set([kept.id]), { minimumAgeMs: 0 })
    expect(first.deleted).toContain(orphan.id)
    expect(first.retainedByLease).toEqual([leased.id])
    expect(await store.has(kept.id)).toBe(true)
    expect(await store.has(leased.id)).toBe(true)
    expect(await store.has(orphan.id)).toBe(false)

    await lease.release()
    await lease.release()
    const second = await store.garbageCollect(new Set([kept.id]), { minimumAgeMs: 0 })
    expect(second.deleted).toEqual([leased.id])
    expect(await store.has(leased.id)).toBe(false)
  })

  it('重复写入会校验既有对象，并隔离后重建损坏内容', async () => {
    const bytes = Buffer.from('authoritative pixels')
    const first = await store.putBuffer(bytes)
    await fsp.writeFile(store.getFilesystemPath(first.id), 'truncated')

    const repaired = await store.putBuffer(bytes)
    expect(repaired).toMatchObject({ id: first.id, created: true, byteLength: bytes.byteLength })
    expect(await store.verify(first.id)).toMatchObject({ id: first.id, byteLength: bytes.byteLength })
  })

  it('在流式写入越过硬上限前停止，且不遗留暂存文件', async () => {
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('1234')
      yield Buffer.from('5678')
    }

    await expect(store.putReadable(chunks(), { maxBytes: 7 }))
      .rejects.toThrow('exceeds maximum byte length')
    await expect(fsp.readdir(path.join(rootDir, '.staging'))).resolves.toEqual([])
    await expect(store.putBuffer(Buffer.from('ok'), { maxBytes: 0 }))
      .rejects.toThrow('positive safe integer')
  })
})
