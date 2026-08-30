import { describe, expect, it, vi } from 'vitest'

import { replaceFileAtomically, type AtomicFileOperations } from './atomic-file'

function compatibilityError(): Error & { code: string } {
  return Object.assign(new Error('replace unsupported'), { code: 'EPERM' })
}

describe('图片编辑 V3 原子文件替换', () => {
  it('新目标发布后即使旧备份删除失败也保持成功且不回滚', async () => {
    const renames: Array<[string, string]> = []
    let first = true
    const operations: AtomicFileOperations = {
      rename: vi.fn(async (source, target) => {
        renames.push([source, target])
        if (first) {
          first = false
          throw compatibilityError()
        }
      }),
      remove: vi.fn(async () => { throw new Error('backup busy') }),
      access: vi.fn(async () => undefined),
      syncDirectory: vi.fn(async () => undefined),
    }

    await expect(replaceFileAtomically('/tmp/output.tmp', '/tmp/output.tif', operations))
      .resolves.toBeUndefined()

    expect(renames).toHaveLength(3)
    expect(renames[1]?.[0]).toBe('/tmp/output.tif')
    expect(renames[2]).toEqual(['/tmp/output.tmp', '/tmp/output.tif'])
  })

  it('新目标发布失败时才尝试恢复旧备份', async () => {
    const renames: Array<[string, string]> = []
    let call = 0
    const operations: AtomicFileOperations = {
      rename: vi.fn(async (source, target) => {
        renames.push([source, target])
        call += 1
        if (call === 1) throw compatibilityError()
        if (call === 3) throw new Error('publish failed')
      }),
      remove: vi.fn(async () => undefined),
      access: vi.fn(async () => undefined),
    }

    await expect(replaceFileAtomically('/tmp/output.tmp', '/tmp/output.tif', operations))
      .rejects.toThrow('publish failed')

    expect(renames).toHaveLength(4)
    expect(renames[3]?.[0]).toContain('/tmp/output.tif.')
    expect(renames[3]?.[1]).toBe('/tmp/output.tif')
  })
})
