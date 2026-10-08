import { beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PresetService } from './PresetService'

const database = vi.hoisted(() => ({ insertPreset: vi.fn(), getPresetById: vi.fn() }))
vi.mock('@/services/database/DatabaseService', () => ({ databaseService: database }))
beforeEach(() => { database.insertPreset.mockReset(); database.getPresetById.mockReset() })

it('正式导入黄金预设保留内容；更新版本、无版本、截断和字段缺失分别拒绝且不写库', async () => {
  const raw = fs.readFileSync(path.resolve('tests/fixtures/persistence/preset-export/v1.json'), 'utf8')
  database.getPresetById.mockResolvedValue({ name: '黄金生成预设', params: { prompt: '黄金样本' } })
  const service = new PresetService()
  await expect(service.importPreset(raw)).resolves.toMatchObject({ name: '黄金生成预设', params: { prompt: '黄金样本' } })
  expect(database.insertPreset).toHaveBeenCalledWith(expect.objectContaining({ name: '黄金生成预设', params: { prompt: '黄金样本' } }))
  database.insertPreset.mockClear()
  for (const [json, code] of [
    [raw.replace('"1.0"', '"2.0"'), 'newer-version'],
    ['{}', 'invalid-content'],
    ['{"version":"1.0"}', 'invalid-content'],
    ['{', 'corrupt'],
  ]) await expect(service.importPreset(json)).rejects.toMatchObject({ code, formatId: 'preset-export' })
  expect(database.insertPreset).not.toHaveBeenCalled()
})
