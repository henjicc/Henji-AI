import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 数据目录迁移的失败语义（5.8）：任何文件没复制成功、或文件清单读不全，迁移都必须整体失败，
 * 而且绝不能走到最后一步删除旧目录——此前复制失败只记日志、照样删旧目录，数据库没拷过去就丢了。
 */
const fs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  failCopy: new Set<string>(),
  failReadDir: false,
  removed: [] as string[],
}))

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({}) }))
vi.mock('@/services/database/DatabaseService', () => ({ databaseService: { getSetting: vi.fn(), setSetting: vi.fn() } }))
vi.mock('@/commands/assetLibrary', () => ({ rebaseAssetDataRoot: vi.fn(async () => undefined) }))
vi.mock('@/platform/desktopApi', () => {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const parent = (value: string) => norm(value).split('/').slice(0, -1).join('/')
  return {
    appDirectories: async () => ({ folderNames: { generated: '生成结果', uploads: '上传素材' } }),
    join: async (...parts: string[]) => parts.map(norm).join('/'),
    dirname: async (value: string) => parent(value),
    basename: (value: string, ext = '') => norm(value).split('/').pop()!.replace(ext, ''),
    extname: (value: string) => /\.[^./]+$/.exec(value)?.[0] ?? '',
    mkdir: async () => undefined,
    exists: async (value: string) => [...fs.files.keys()].some((file) => file === norm(value) || file.startsWith(`${norm(value)}/`)),
    readDir: async (value: string) => {
      if (fs.failReadDir) throw new Error('权限不足')
      const base = norm(value)
      const names = new Map<string, boolean>()
      for (const file of fs.files.keys()) {
        if (!file.startsWith(`${base}/`)) continue
        const rest = file.slice(base.length + 1).split('/')
        names.set(rest[0], rest.length > 1)
      }
      return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }))
    },
    readFile: async (value: string) => fs.files.get(norm(value)) ?? new Uint8Array(),
    writeFile: async (value: string, data: Uint8Array) => { fs.files.set(norm(value), data) },
    copyFile: async (from: string, to: string) => {
      if ([...fs.failCopy].some((name) => norm(from).endsWith(name))) throw new Error('目标磁盘空间不足')
      fs.files.set(norm(to), fs.files.get(norm(from)) ?? new Uint8Array())
    },
    remove: async (value: string) => {
      fs.removed.push(norm(value))
      for (const file of [...fs.files.keys()]) if (file === norm(value) || file.startsWith(`${norm(value)}/`)) fs.files.delete(file)
    },
  }
})

import { migrateData } from './dataPath'

describe('数据目录迁移失败语义', () => {
  beforeEach(() => {
    fs.files.clear()
    fs.failCopy.clear()
    fs.failReadDir = false
    fs.removed.length = 0
    for (const name of ['henji.db', 'history.json', 'presets.json', 'Media/a.png']) fs.files.set(`/old/${name}`, new Uint8Array([1]))
  })

  it('有文件复制失败：迁移失败，旧目录原样保留', async () => {
    fs.failCopy.add('henji.db')
    await expect(migrateData('/old', '/new')).rejects.toThrow(/1 个文件没能复制到新目录（henji.db）/)
    expect(fs.removed).not.toContain('/old')
    expect(fs.files.has('/old/henji.db')).toBe(true)
  })

  it('文件清单读不全：迁移失败，不删旧目录', async () => {
    fs.failReadDir = true
    await expect(migrateData('/old', '/new')).rejects.toThrow('权限不足')
    expect(fs.removed).not.toContain('/old')
  })

  it('全部复制成功才删除旧目录', async () => {
    await migrateData('/old', '/new')
    expect(fs.files.has('/new/henji.db')).toBe(true)
    expect(fs.removed).toContain('/old')
  })
})
