import { describe, expect, it, vi } from 'vitest'

/*
 * 内容身份与路径写法（3.1 查明 Reality 场景 video-edit-creative-results 的失败原因）：
 * 资产路径存成位置写法后，读出时作品目录部分保留原大小写，而按路径核对用规范化（Windows 上全小写）的路径。
 * 两边的内容身份必须一致，否则作品目录里新生成的文件（编辑帧渲染、生成结果）一律被判为“内容已改变”。
 */

const mocks = vi.hoisted(() => ({ stat: vi.fn(), realpath: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { stat: mocks.stat, realpath: mocks.realpath } }))
vi.mock('../db', () => ({ getDb: () => db }))
vi.mock('../db-locations', async () => ({ databaseLocations: (await import('../db-locations-identity.test-support')).identityDatabaseLocations }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => '/program/thumbnails' }))
vi.mock('../../protocol', () => ({ allowMediaRoot: vi.fn(), isPathWithinAllowedMediaRoots: () => true }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
// 与正式实现一样：Windows 风格路径规范化为全小写
vi.mock('./mediaInspection', () => ({
  inspectMedia: async () => ({ mimeType: 'image/png', sizeBytes: 100, width: 64, height: 64, durationSeconds: null, fileModifiedAt: 42 }),
  normalizeAssetPath: (value: string) => value.toLowerCase(),
}))
vi.mock('./thumbnailService', () => ({ ensureAssetThumbnail: async () => null }))

// 位置写法换回来的路径：作品目录部分保留原大小写，其余部分是存进去时的小写
const STORED_PATH = 'D:/Users/Me/Documents/痕迹AI/项目/短片/生成结果/frame.png'
const row: Record<string, unknown> = {
  id: 'asset-1', media_type: 'image', display_name: '帧', file_path: STORED_PATH, source: 'canvas',
  mime_type: null, size_bytes: null, width: null, height: null, duration_seconds: null, thumbnail_name: null,
  inspection_status: 'pending', inspection_error: null, file_modified_at: null, content_identity: null, last_used_at: null, created_at: 1, updated_at: 1,
}
const db = {
  prepare(sql: string) {
    if (sql.startsWith('SELECT * FROM assets')) return { get: () => ({ ...row }) }
    if (sql.startsWith('SELECT t.name') || sql.startsWith('SELECT library_id')) return { all: () => [] }
    if (sql.startsWith('UPDATE assets SET ')) return { run: (...values: unknown[]) => {
      const assignments = sql.slice('UPDATE assets SET '.length, sql.indexOf(' WHERE')).split(',')
      let offset = 0
      for (const assignment of assignments) {
        const [key, expression] = assignment.split('=')
        row[key.trim()] = expression === '?' ? values[offset++] : expression === 'NULL' ? null : expression.replace(/^'|'$/g, '')
      }
      return { changes: 1 }
    } }
    throw new Error(`UNSUPPORTED_SQL:${sql}`)
  },
}

import { inspectAsset, inspectAssetFileContent } from './index'

describe('资产内容身份', () => {
  it('库里读出的路径与规范化路径大小写不同，按路径核对得到的内容身份仍与资产记录一致', async () => {
    mocks.stat.mockResolvedValue({ size: 100, mtimeMs: 42, ctimeMs: 42, dev: 1, ino: 7, isFile: () => true })
    mocks.realpath.mockImplementation(async (value: string) => value)
    const asset = await inspectAsset('asset-1')
    expect(asset.inspectionStatus).toBe('ready')
    expect(asset.filePath).toBe(STORED_PATH)
    const checked = await inspectAssetFileContent(STORED_PATH, 'image')
    expect(checked.contentIdentity).toBe(asset.contentIdentity)
  })
})
