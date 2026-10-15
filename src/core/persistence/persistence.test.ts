import { VIDEO_EDIT_DOCUMENT_VERSION } from './schemaVersions'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PERSISTENCE_FORMATS } from './formats'
import baseline from './schemaBaseline.json'
import { PersistenceError, migratePersistenceContent, upgradePersistenceContent } from './migrations'
import { persistenceSchemaStructure } from './fingerprint'
import { parseDocumentEnvelope, parseDocumentText } from '../documents/envelope'
import { videoEditDocumentSchema } from '../videoEdit/document'
import { decodeCodeAsset, encodeCodeAsset } from '../videoEdit/codeAsset'
import { parseVersionedPersistenceJson, readLocalPersistenceJson, readStoredPersistenceJson } from './versionedJson'
import { backupPersistenceSnapshot, persistenceBackupLocation } from './backup'
import { parseImageEditDocumentV3 } from '../imageEdit/v3/documentCodec'
import { imageWorkingCopySchema } from './imageSchemas'
import { IMAGE_WORKING_VERSION } from './schemaVersions'
import { IMAGE_EDIT_DOCUMENT_VERSION_V3 } from '../imageEdit/v3/documentTypes'
import { llmStoredConfigSchema } from './llmSchemas'
import { mcpConnectionStorageSchema } from './mcpConnectionSchema'
import { persistedCanvasNodeDataSchema, persistedStageSettingsSchema } from './businessSchemas'
import { createDefaultLlmConfig } from '../llm/defaults'
import type { VideoEditDocumentContent } from '../documents/kinds/videoEdit'

describe('持久格式逐版本链', () => {
  const schema = z.object({ label: z.string(), count: z.number() }).strict()
  it('按顺序升级且不修改输入；中途失败保留原内容与步骤证据', () => {
    const original = { title: '旧标题' }
    const first = vi.fn((raw: unknown) => ({ label: (raw as typeof original).title }))
    const second = vi.fn((raw: unknown) => ({ ...(raw as object), count: 2 }))
    const contract = { id: 'test', name: '剪辑', version: 3, schema, migrations: { 1: first, 2: second } }
    expect(upgradePersistenceContent(contract, original, 1, '/backup')).toEqual({ label: '旧标题', count: 2 })
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0])
    expect(original).toEqual({ title: '旧标题' })
    const fail = { ...contract, migrations: { 1: (raw: unknown) => { (raw as Record<string, unknown>).title = 'mutated'; return raw }, 2: () => { throw new Error('step failed') } } }
    expect(() => upgradePersistenceContent(fail, original, 1, '/backup')).toThrowError(expect.objectContaining({ code: 'migration-failed', formatId: 'test', fromVersion: 2, toVersion: 3, backupPath: '/backup' }))
    expect(original).toEqual({ title: '旧标题' })
  })
  it('缺少任一步明确拒绝；更新版本、内容不匹配与损坏JSON分开', () => {
    const contract = { id: 'test', name: '剪辑', version: 3, schema, migrations: { 1: vi.fn() } }
    expect(() => upgradePersistenceContent(contract, {}, 1)).toThrowError(expect.objectContaining({ code: 'unsupported-version', fromVersion: 2, toVersion: 3 }))
    expect(contract.migrations[1]).not.toHaveBeenCalled()
    expect(() => upgradePersistenceContent(contract, {}, 4)).toThrow('更新版本')
    expect(() => upgradePersistenceContent(contract, {}, 3)).toThrowError(expect.objectContaining({ code: 'invalid-content', fields: ['label', 'count'] }))
    expect(() => parseDocumentText('{')).toThrow('损坏')
  })
  it('迁移结果不能通过当前schema时，返回字段证据与原备份位置', () => {
    const contract = { id: 'test', name: '剪辑', version: 2, schema, migrations: { 1: () => ({ label: 'new' }) } }
    expect(() => upgradePersistenceContent(contract, {}, 1, '/saved-original')).toThrowError(expect.objectContaining({ code: 'migration-failed', fields: ['count'], backupPath: '/saved-original' }))
  })
  it('本机库升级先备份、只读升级、不覆盖已有备份，备份写入失败不调用迁移', () => {
    const values = new Map([['library', '{"version":1,"content":[1]}']])
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const step = vi.fn((raw: unknown) => { expect(values.get('library:backup:v1')).toBe(values.get('library')); return raw })
    const contract = { id: 'test', name: '本机创作库', version: 2, schema: z.array(z.number()), migrations: { 1: step } }
    const raw = values.get('library')!
    expect(readLocalPersistenceJson(raw, 'library', contract, storage)).toEqual([1])
    expect(values.get('library')).toBe(raw)
    expect(readLocalPersistenceJson(raw, 'library', contract, storage)).toEqual([1]); expect(values.size).toBe(2)
    const blocked = { ...storage, getItem: () => null, setItem: () => { throw new Error('quota') } }
    step.mockClear(); expect(() => readLocalPersistenceJson(raw, 'library', contract, blocked)).toThrow('quota'); expect(step).not.toHaveBeenCalled()
    expect(() => parseVersionedPersistenceJson([1], contract)).toThrow('旧版本格式')
  })
  it('SQLite设置值先备份原行，迁移失败保留原件与备份键', async () => {
    const raw = '{"version":1,"content":[1]}'
    const values = new Map([['library', raw]])
    const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value) } }
    const step = vi.fn(() => { expect(values.get('library:backup:v1')).toBe(raw); throw new Error('failed') })
    await expect(readStoredPersistenceJson(raw, 'library', { id: 'test', name: '音色库', version: 2, schema: z.array(z.number()), migrations: { 1: step } }, storage)).rejects.toMatchObject({ code: 'migration-failed', backupPath: 'library:backup:v1' })
    expect(values.get('library')).toBe(raw)
  })
  it('桌面PAL快照备份使用同一定位规则，独占发布不覆盖旧备份，内容不一致时拒绝', async () => {
    const contract = { id: 'test', name: '代码资产', version: 2, migrations: { 1: (raw: unknown) => raw } }
    const content = new TextEncoder().encode('original')
    const files = new Map<string, Uint8Array>()
    const io = { mkdir: vi.fn(async () => {}), readFile: async (name: string) => files.get(name)!, exists: async (name: string) => files.has(name), writeFile: vi.fn(async (name: string, bytes: Uint8Array) => { if (files.has(name)) throw new Error('exists'); files.set(name, bytes) }) }
    const backup = await backupPersistenceSnapshot('D:/project/code.henji-code', contract, 1, content, io)
    expect(backup?.replaceAll('\\', '/')).toContain('/.henji/backups/code.henji-code.v1.')
    expect(await backupPersistenceSnapshot('D:/project/code.henji-code', contract, 1, content, io)).toBe(backup)
    expect(files.size).toBe(1)
    files.set(backup!, new TextEncoder().encode('different'))
    await expect(backupPersistenceSnapshot('D:/project/code.henji-code', contract, 1, content, io)).rejects.toMatchObject({ code: 'backup-failed' })
    expect(persistenceBackupLocation('/project/.henji/project.json', 1, 'a'.repeat(64)).directory).toBe('/project/.henji/backups')
  })
})

describe('Schema结构指纹', () => {
  it('当前图片黄金样本保留 float32 区域与原子历史检查点', () => {
    const raw = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/image-working-copy/v${IMAGE_WORKING_VERSION}.json`, 'utf8'))
    const parsed = imageWorkingCopySchema.parse(raw)
    const shape = parsed.document.namedRegions.find(region => region.id === 'golden-float32')?.selection.operations[0].shape
    expect(shape).toMatchObject({ type: 'mask', runs: [[0, 1, Math.fround(.123456789)], [1, 1, Math.fround(.50000006)], [2, 1, 1]] })
    expect(parsed.historyCheckpoint?.version).toBe(2)
  })
  it('图片高斯黄金样本保留 canonical 参数，旧半径字段明确拒绝', () => {
    const raw = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/image-working-copy/v${IMAGE_WORKING_VERSION}.json`, 'utf8')) as { document: { layers: Array<{ type: string; effectId?: string; params?: Record<string, unknown> }> } }
    const effect = raw.document.layers.find(layer => layer.effectId === 'gaussian_blur')
    expect(effect?.params).toEqual({ sigma_fraction_height: .009, axis: 'horizontal', edge_mode: 'transparent' })
    expect(imageWorkingCopySchema.safeParse(raw).success).toBe(true)
    if (!effect) throw new Error('缺少 canonical 高斯黄金样本')
    effect.params = { radius: 12, mip: 0 }
    expect(imageWorkingCopySchema.safeParse(raw).success).toBe(false)
  })
  it('V3 黄金样本的标注、几何可读，V2 文档、legacy 载荷及旧模糊不能进入当前落盘', () => {
    const raw = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/image-working-copy/v${IMAGE_WORKING_VERSION}.json`, 'utf8'))
    expect(parseImageEditDocumentV3(raw.document)).toMatchObject({ geometry: { orientation: { rotate: 90, mirrored: true }, crop: { width: 32, height: 40 } }, layers: [{ type: 'smart' }, {}, {}, { type:'shape',id:'golden-quick-marks' }, { type: 'smart' }] })
    const effect = raw.document.layers.find((layer: { type: string }) => layer.type === 'effect')
    effect.legacyOperation = { sourceVersion: 2, operation: { type: 'blur' } }
    expect(imageWorkingCopySchema.safeParse(raw).success).toBe(false)
    expect(() => parseImageEditDocumentV3(raw.document)).toThrow()
    delete effect.legacyOperation
    effect.effectId = 'image.blur'
    expect(imageWorkingCopySchema.safeParse(raw).success).toBe(false)
    expect(() => parseImageEditDocumentV3({ version: 2, operations: [] })).toThrow()
  })
  it('字段声明顺序不影响；类型、默认值、必填/可选和未知字段策略变化都会改变', () => {
    const hash = (schema: z.ZodType): string => persistenceSchemaStructure({ data: schema })
    const base = z.object({ label: z.string(), count: z.number().default(1) }).strict()
    expect(hash(base)).toBe(hash(z.object({ count: z.number().default(1), label: z.string() }).strict()))
    for (const schema of [z.object({ label: z.number(), count: z.number().default(1) }).strict(), z.object({ label: z.string().optional(), count: z.number().default(1) }).strict(), z.object({ label: z.string(), count: z.number().default(2) }).strict(), z.object({ label: z.string(), count: z.number().default(1) }).passthrough()]) expect(hash(schema)).not.toBe(hash(base))
    expect(() => hash(z.date())).toThrow()
  })
})

describe('所有登记格式的黄金样本', () => {
  it.each([
    ['document.video_edit', 9, 10],
    ['document.screen_recording', 11, 12],
    ['code-asset', 1, 2],
    ['title-templates', 3, 4],
    ['video-preset-package', 2, 3],
    ['subtitle-manifest', 5, 6],
  ] as const)('%s 参数类型拓宽只升级版本，完整保留旧样本与内嵌内容', (id, from, to) => {
    const format = PERSISTENCE_FORMATS.find(value => value.id === id)!
    expect(format.version).toBe(to)
    const raw = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${from}.json`, 'utf8')) as unknown
    const before = structuredClone(raw)
    const content = id.startsWith('document.') ? parseDocumentEnvelope(raw).content
      : id === 'title-templates' ? (raw as { content: unknown }).content : raw
    const expected = ['code-asset', 'video-preset-package', 'subtitle-manifest'].includes(id)
      ? { ...(content as object), version: to } : content
    expect(migratePersistenceContent(format, content, from)).toEqual(expected)
    expect(upgradePersistenceContent(format, content, from)).toEqual(format.schema.parse(expected))
    expect(raw).toEqual(before)
  })
  it('剪辑 v2–v7 按完整链升至当前版本，旧原稿、曲线、字幕与归档不丢失，读取不修改输入', () => {
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
    expect(baseline.formats['document.video_edit'].supportedFrom).toBe(2)
    for (const version of [2, 3, 4, 5, 6, 7]) {
      const raw = parseDocumentEnvelope(JSON.parse(fs.readFileSync(`tests/fixtures/persistence/document.video_edit/v${version}.json`, 'utf8')))
      const before = structuredClone(raw.content) as VideoEditDocumentContent
      const upgraded = upgradePersistenceContent(format, raw.content, version) as VideoEditDocumentContent
      expect(raw.content).toEqual(before)
      expect(upgraded.creativeIntents).toEqual(before.creativeIntents)
      expect(upgraded.codeMaterials).toEqual(before.codeMaterials)
      expect(upgraded.sequences[0].clips).toEqual(before.sequences[0].clips)
      expect(upgraded.sequences[0].captions).toEqual(before.sequences[0].captions)
      if (version < 4) expect(upgraded.sequences[0]).toMatchObject({ captionTrackEnabled: true, captionTrackLocked: false })
      if (version === 2) expect(upgraded.exportHistory?.[0]).toMatchObject({ presetName: '已完成导出', rangeSource: 'content' })
    }
  })
  for (const format of PERSISTENCE_FORMATS) {
    const directory = path.resolve('tests/fixtures/persistence', format.id)
    for (const file of fs.readdirSync(directory).filter(file => /^v\d+\.json$/.test(file))) {
      const version = Number(file.slice(1, -5))
      const floor = baseline.formats[format.id as keyof typeof baseline.formats]?.supportedFrom ?? 1
      if (format.storage === 'sqlite-ledger') {
        it(`${format.id} ${file}记录内容由SQL账本升级，黄金样本只校验独立内容schema`, () => {
          expect(format.schema.safeParse(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))).success).toBe(true)
        })
        continue
      }
      if (version < floor) {
        it(`${format.id} ${file}低于支持下限v${floor}，明确拒绝为旧版本`, () => {
          const raw: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
          expect(() => upgradePersistenceContent(format, raw, version)).toThrowError(expect.objectContaining({
            code: 'unsupported-version', formatId: format.id, fromVersion: version,
          }))
          expect(() => upgradePersistenceContent(format, raw, version)).toThrow('旧版本格式')
        })
        continue
      }
      it(`${format.id} ${file}读取后升级至v${format.version}，通过当前schema`, () => {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
        let content = raw
        if (format.id.startsWith('document.')) content = parseDocumentEnvelope(raw).content
        else if (format.id === 'settings' || format.id === 'theme') content = (raw as { state: unknown }).state
        else if ((format.storage === 'local-storage' && !['model-defaults', 'onboarding'].includes(format.id)) || ['voice-library', 'llm-config'].includes(format.id)) content = (raw as { content: unknown }).content
        const upgraded = upgradePersistenceContent(format, content, version)
        expect(format.schema.safeParse(upgraded).success).toBe(true)
        if (format.id === 'document.video_edit') {
          const document = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...(upgraded as object) })
          const clip = document.sequences[0].clips[0]
          expect(document.codeMaterials?.[0].versions[0].files[0].hash).toHaveLength(64)
          expect(clip.effects?.map(effect => effect.builtin?.id)).toEqual(['color_grade', 'gaussian_blur'])
          expect(clip.curves?.opacity?.[1].value).toBe(1)
          expect(document.sequences[0].captions?.[0].translation).toBe('Golden caption')
          expect(document.sequences[0].transitions?.[0].rightClipId).toBe(clip.id)
          // v7：自动缩放的缩放区间（源时间、档位、跟随/固定焦点）与录屏画框参数原样读回。
          if (version >= 7) {
            const effects = document.sequences[0].clips.find(value => value.id === 'golden-cursor-clip')?.effects ?? []
            expect(effects.map(effect => effect.builtin?.id)).toEqual(['recording_cursor', 'recording_zoom', 'recording_frame'])
            expect(effects[1].builtin?.regions?.map(region => [region.startUs, region.endUs, region.depth, region.focus])).toEqual([[500000, 1500000, 3, 'cursor'], [2000000, 2800000, 5, { x: 0.8, y: 0.2 }]])
            expect(effects[2].builtin?.params).toMatchObject({ background: 'solid', padding: 6 })
          }
          // v9：风格是说明书加参考示例，原样读回且序列仍绑定它；更早的参数式风格快照与绑定被丢弃。
          if (version >= 9) {
            const kit = document.styleKits?.[0]
            expect(document.sequences[0].styleKitId).toBe('golden-kit')
            expect(kit?.guide).toContain('## 必须'); expect(kit?.examples).toHaveLength(1)
          } else {
            expect(document.styleKits).toBeUndefined(); expect(document.sequences.every(sequence => sequence.styleKitId === undefined)).toBe(true)
          }
        }
        // style-kits v1/v2：参数式风格不再适用，升级后清空。
        if (format.id === 'style-kits' && version < 3) expect(upgraded).toEqual([])
        if (format.id === 'code-asset') expect(decodeCodeAsset(encodeCodeAsset(format.schema.parse(upgraded) as ReturnType<typeof decodeCodeAsset>)).sourceVersion.files[0].hash).toHaveLength(64)
        if (format.id === 'image-working-copy' || format.id === 'image-package') {
          const working = format.id === 'image-package' ? (upgraded as { document: unknown }).document : upgraded
          const image = parseImageEditDocumentV3((working as { document: unknown }).document)
          expect(image.version).toBe(IMAGE_EDIT_DOCUMENT_VERSION_V3)
          expect(image.layers[0]).toMatchObject({ type: 'smart', fillOpacity: .7, maskAttachment: { linked: false, density: .6 }, filters: [{ effectId: 'exposure', params: { stops: .4 } }] })
        }
      })
    }
  }
  it('只豁免已明确登记的接入前历史版本；当前版本样本始终存在', () => {
    for (const format of PERSISTENCE_FORMATS) {
      expect(fs.existsSync(path.resolve('tests/fixtures/persistence', format.id, `v${format.version}.json`))).toBe(true)
      const floor = baseline.formats[format.id as keyof typeof baseline.formats]?.supportedFrom ?? 1
      if (floor > 1) expect(baseline.devBreaks.some(item => item.format === format.id && item.reason.length > 0)).toBe(true)
    }
    expect(PersistenceError.prototype).toBeInstanceOf(Error)
  })
})

describe('稳定业务字段的持久契约', () => {
  it('真实助手默认配置可读，权限和模型设置类型受保护，开放扩展区保留', () => {
    const raw = createDefaultLlmConfig()
    expect(llmStoredConfigSchema.parse(raw)).toEqual(raw)
    expect(llmStoredConfigSchema.safeParse({ ...raw, policy: { allowedTools: 'all' } }).success).toBe(false)
    const invalid = structuredClone(raw) as unknown as { agentProfiles: { settings: { maxOutputTokens: unknown } }[] }
    invalid.agentProfiles[0].settings.maxOutputTokens = '4096'
    expect(llmStoredConfigSchema.safeParse(invalid).success).toBe(false)
    expect(llmStoredConfigSchema.parse({ ...raw, extension: { keep: true } })).toHaveProperty('extension.keep', true)
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/persistence/mcp-connections/v2.json', 'utf8')) as { connections: { allowPaid: unknown }[] }
    expect(mcpConnectionStorageSchema.parse(sample).connections[0]).toMatchObject({ allowWrites: true, allowPaid: false, allowDestructive: false })
    sample.connections[0].allowPaid = 'yes'
    expect(mcpConnectionStorageSchema.safeParse(sample).success).toBe(false)
  })
  it('画布稳定字段和场景设置约束类型，但保留模型及工具扩展', () => {
    const node = { prompt: '画面', modelId: 'synthetic', params: { futureParameter: [1, 2] }, extension: { custom: true } }
    expect(persistedCanvasNodeDataSchema.parse(node)).toEqual(node)
    expect(persistedCanvasNodeDataSchema.safeParse({ ...node, serverTaskId: 12 }).success).toBe(false)
    const scene = { sky: { color: 'white', environmentImageUrl: null, extension: 1 }, render: { style: 'depth' }, extension: true }
    expect(persistedStageSettingsSchema.parse(scene)).toEqual(scene)
    expect(persistedStageSettingsSchema.safeParse({ sunlight: { enabled: 'yes' } }).success).toBe(false)
  })
})
