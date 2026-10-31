import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { PERSISTENCE_FORMATS } from '../persistence/formats'
import { upgradePersistenceContent } from '../persistence/migrations'
import { migrateVideoEditExportEntries } from './exportEncodingMigration'
import { videoEditExportQualityEncoding } from './exportEncoding'
import { VIDEO_EDIT_EXPORT_PRESETS, videoEditExportSettingsSchema } from './exportPresets'

it('历史码率按曾实际压制的值迁移，HEVC 非法级别修正，迁移不修改输入', () => {
  const entry = { settings: { codec: 'hevc', videoBitrateMbps: 50, encoding: { ...videoEditExportQualityEncoding('hevc', 'high'), rateControl: 'vbr', bitrateMbps: 8, level: '4.2' } } }
  const before = structuredClone(entry)
  const expected = { settings: { ...entry.settings, videoBitrateMbps: 8, encoding: { ...entry.settings.encoding, level: 'auto' } } }
  delete (expected.settings.encoding as Partial<typeof entry.settings.encoding>).bitrateMbps
  expect(migrateVideoEditExportEntries([entry])).toEqual([expected])
  expect(entry).toEqual(before)
  expect(migrateVideoEditExportEntries([{ settings: { videoBitrateMbps: 50 } }])).toEqual([{ settings: { videoBitrateMbps: 50 } }])
})

it.each([0.05, 300])('历史合法目标码率 %s Mbps 迁移后仍可读取且不截断', bitrateMbps => {
  const settings = { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, encoding: { ...videoEditExportQualityEncoding('avc', 'high'), rateControl: 'vbr', bitrateMbps } }
  const [entry] = migrateVideoEditExportEntries([{ settings }]) as Array<{ settings: unknown }>
  expect(videoEditExportSettingsSchema.parse(entry.settings).videoBitrateMbps).toBe(bitrateMbps)
})

it.each([['document.video_edit', 45], ['document.screen_recording', 48], ['export-presets', 3], ['export-memory', 1]] as const)('%s v%i 历史黄金样本可经正式迁移读取且保留高级编码', (id, version) => {
  const raw = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/persistence', id, `v${version}.json`), 'utf8')) as { content: unknown }
  const contract = PERSISTENCE_FORMATS.find(format => format.id === id)!
  const migrated = upgradePersistenceContent(contract, raw.content, version)
  expect(contract.schema.safeParse(migrated).success).toBe(true)
  expect(JSON.stringify(migrated)).not.toContain('"bitrateMbps"')
  if (JSON.stringify(raw.content).includes('"encoding"')) expect(JSON.stringify(migrated)).toContain('"encoding"')
})
