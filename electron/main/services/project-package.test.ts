import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  exportProjectPackage,
  importProjectMediaEntriesAtomically,
  replaceFileAtomically,
} from './project-package'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-project-package-'))
  tempDirs.push(dir)
  return dir
}

async function* entries(values: Array<{ fileName: string; uncompressedSize: number }>) {
  for (const value of values) yield value
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('项目包原子性', () => {
  it('第二个媒体读取失败时回滚本次已导入文件', async () => {
    const importedDir = tempDir()
    const input = entries([
      { fileName: 'media/first.png', uncompressedSize: 5 },
      { fileName: 'media/broken.png', uncompressedSize: 6 },
    ])

    await expect(importProjectMediaEntriesAtomically(
      input,
      importedDir,
      async (_entry, entryName) => {
        if (entryName.endsWith('broken.png')) throw new Error('媒体条目损坏')
        return Buffer.from('first')
      },
    )).rejects.toThrow('媒体条目损坏')
    expect(fs.readdirSync(importedDir)).toEqual([])
  })

  it('总量越限时只回滚本次新建文件并保留已有同哈希文件', async () => {
    const importedDir = tempDir()
    const existingBytes = Buffer.from('existing')
    const existingName = 'afafb16ac47b9b3d.png'
    fs.writeFileSync(path.join(importedDir, existingName), existingBytes)
    const input = entries([
      { fileName: 'media/existing.png', uncompressedSize: existingBytes.length },
      { fileName: 'media/new.png', uncompressedSize: 1 },
      { fileName: 'media/overflow.png', uncompressedSize: 16 * 1024 * 1024 * 1024 },
    ])

    await expect(importProjectMediaEntriesAtomically(
      input,
      importedDir,
      async (_entry, entryName) => Buffer.from(entryName.endsWith('existing.png') ? 'existing' : 'new'),
    )).rejects.toThrow(/total media size|too large/i)
    expect(fs.readdirSync(importedDir)).toEqual([existingName])
  })

  it('导出失败不留目标半包或临时包', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'project.henjiproj')

    await expect(exportProjectPackage(
      JSON.stringify({ formatVersion: 1 }),
      [{ srcPath: path.join(dir, 'missing.png'), packagePath: 'media/missing.png' }],
      target,
    )).rejects.toBeTruthy()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('跨平台替换已有目标后不保留备份或暂存文件', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'project.henjiproj')
    const staged = path.join(dir, 'project.tmp')
    fs.writeFileSync(target, 'old')
    fs.writeFileSync(staged, 'new')

    await replaceFileAtomically(staged, target)

    expect(fs.readFileSync(target, 'utf8')).toBe('new')
    expect(fs.readdirSync(dir)).toEqual(['project.henjiproj'])
  })

  it('替换已有目标失败时恢复旧包且不留下半包', async () => {
    const dir = tempDir()
    const target = path.join(dir, 'project.henjiproj')
    const staged = path.join(dir, 'project.tmp')
    fs.writeFileSync(target, 'old')
    fs.writeFileSync(staged, 'new')
    let renameCount = 0

    await expect(replaceFileAtomically(staged, target, async (source, destination) => {
      renameCount += 1
      if (renameCount === 2) throw new Error('replace failed')
      await fs.promises.rename(source, destination)
    })).rejects.toThrow('replace failed')

    expect(fs.readFileSync(target, 'utf8')).toBe('old')
    expect(fs.readFileSync(staged, 'utf8')).toBe('new')
    expect(fs.readdirSync(dir).sort()).toEqual(['project.henjiproj', 'project.tmp'])
  })
})
