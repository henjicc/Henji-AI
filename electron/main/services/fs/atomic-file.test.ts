import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { replaceFileAtomically, writeBufferAtomically, type AtomicFileOperations } from './atomic-file'

describe('原子文件替换', () => {
  it('替换被拒绝时保留原路径和完整原件，不搬走原件；解除占用后可正常替换', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-atomic-'))
    const target = path.join(directory, 'document.json')
    try {
      await fs.writeFile(target, 'original')
      for (const code of ['EPERM', 'EEXIST', 'ENOTEMPTY']) {
        const operations: AtomicFileOperations = {
          rename: vi.fn(async () => { throw Object.assign(new Error('replace blocked'), { code }) }),
          remove: vi.fn(async () => undefined),
          access: vi.fn(async () => undefined),
        }
        await expect(writeBufferAtomically(target, Buffer.from('new'), operations)).rejects.toMatchObject({ code })
        expect(await fs.readFile(target, 'utf8')).toBe('original')
        expect(await fs.readdir(directory)).toEqual(['document.json'])
        // 短暂占用类错误会退避重试，其余错误立即失败；任何情况下都不搬走原件。
        expect(operations.rename).toHaveBeenCalledTimes(code === 'EPERM' ? 5 : 1)
        expect(operations.remove).not.toHaveBeenCalled()
      }
      await writeBufferAtomically(target, Buffer.from('new'))
      expect(await fs.readFile(target, 'utf8')).toBe('new')
    } finally { await fs.rm(directory, { recursive: true, force: true }) }
  })

  it('rename 已提交后目录 fsync 失败不谎报保存失败或触发回滚', async () => {
    const operations: AtomicFileOperations = {
      rename: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      access: vi.fn(async () => undefined),
      syncDirectory: vi.fn(async () => { throw new Error('directory fsync failed') }),
    }

    await expect(replaceFileAtomically('/tmp/output.tmp', '/tmp/output.tif', operations))
      .resolves.toBeUndefined()
    expect(operations.rename).toHaveBeenCalledOnce()
    expect(operations.remove).not.toHaveBeenCalled()
  })
})
