import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 素材库的表由迁移账本第 8 项建立（存储底座 2.3），定义在拥有该表的仓库旁边。
const dbSource = fs.readFileSync(path.resolve('electron/main/services/asset-library/schema.ts'), 'utf8')

describe('asset library schema migration', () => {
  it.each(['assets', 'asset_libraries', 'asset_library_items'])('creates %s idempotently', (table) => {
    expect(dbSource).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
  })

  it('enforces path uniqueness and constrained media values', () => {
    expect(dbSource).toContain('file_path TEXT NOT NULL UNIQUE')
    // 7dfeccb9 起代码资产（code）也是正式素材类型；旧库由迁移里的 upgradeAssetSources 补齐同一约束。
    expect(dbSource).toContain("media_type IN ('image', 'video', 'audio', 'code')")
  })

  it('cascades relations without defining physical file deletion', () => {
    expect(dbSource).toContain('REFERENCES asset_libraries(id) ON DELETE CASCADE')
    expect(dbSource).toContain('REFERENCES assets(id) ON DELETE CASCADE')
  })
})
