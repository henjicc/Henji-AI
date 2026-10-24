import { beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PresetService } from './PresetService'
import { presetInsertSchema } from '@/core/localRecords/requests'

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

it('新建预设发给写库通道的内容符合主进程的严格写入结构（不带 useCount 等仓库字段）', async () => {
  database.getPresetById.mockImplementation(async (id: string) => ({ id, name: '海边日落', params: { prompt: '日落' }, useCount: 0 }))
  await new PresetService().createPreset({ name: '海边日落', params: { prompt: '日落' } })
  const sent = database.insertPreset.mock.calls[0][0]
  expect(presetInsertSchema.safeParse(sent).success).toBe(true)
})
