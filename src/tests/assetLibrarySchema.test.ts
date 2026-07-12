import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dbSource = fs.readFileSync(path.resolve('electron/main/services/db.ts'), 'utf8')

describe('asset library schema migration', () => {
  it.each(['assets', 'asset_libraries', 'asset_library_items'])('creates %s idempotently', (table) => {
    expect(dbSource).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
  })

  it('enforces path uniqueness and constrained media values', () => {
    expect(dbSource).toContain('file_path TEXT NOT NULL UNIQUE')
    expect(dbSource).toContain("media_type IN ('image', 'video', 'audio')")
  })

  it('cascades relations without defining physical file deletion', () => {
    expect(dbSource).toContain('REFERENCES asset_libraries(id) ON DELETE CASCADE')
    expect(dbSource).toContain('REFERENCES assets(id) ON DELETE CASCADE')
  })
})
