import { VIDEO_EDIT_DOCUMENT_VERSION } from './schemaVersions'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PERSISTENCE_FORMATS } from './formats'

it('历史 imported 风格及模板升级只保留原数据，不赋予外来代码标记', () => {
  for (const [id, version] of [['video-style-library', 4], ['video-template-library', 3]] as const) {
    const format = PERSISTENCE_FORMATS.find(value => value.id === id)!
    const raw = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8')) as { content: Record<string, unknown> }
    const previous = { ...raw.content, imported: true }
    const current = upgradePersistenceContent(format, previous, version)
    expect(current).toEqual(previous)
    expect(current).not.toHaveProperty('foreign')
  }
})
import baseline from './schemaBaseline.json'
import { PersistenceError, upgradePersistenceContent } from './migrations'
import { persistenceSchemaStructure } from './fingerprint'
import { parseDocumentEnvelope, parseDocumentText } from '../documents/envelope'
import { videoEditDocumentSchema } from '../videoEdit/document'
import { codeImageReference } from '../videoEdit/codeMaterial/contract'
import { codeMaterialImageReferenceSchema } from '../videoEdit/codeMaterial/parameterValueSchema'
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
import { migrateEmbeddedVideoEditMotionBlurMaster, migrateVideoEditMotionBlurMaster } from '../videoEdit/motionBlurMigration'
import { parseGitCodeLocation } from '../storage/gitCodeLocation'

it('v6 排版库的嵌套格式拒绝旧读者，逐版本迁移保留旧代码接口与库版本', () => {
  const read = (id: string, version: number): Record<string, unknown> => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8')) as Record<string, unknown>
  for (const [id, previous] of [['code-author-api', 5], ['code-version', 4], ['document.video_edit', 37], ['document.screen_recording', 40], ['code-asset', 9]] as const) {
    const format = PERSISTENCE_FORMATS.find(format => format.id === id)!
    const old = read(id, previous)
    const input = id.startsWith('document.') ? old.content : old
    const original = structuredClone(input)
    const upgraded = upgradePersistenceContent(format, input, previous)
    expect(input).toEqual(original)
    if (id === 'code-asset') expect((upgraded as { sourceVersion: unknown }).sourceVersion).toEqual(old.sourceVersion)
    else expect(upgraded).toEqual(original)
    const latest = read(id, format.version)
    const content = id.startsWith('document.') ? latest.content : latest
    expect(format.schema.safeParse(content).success).toBe(true)
    const minimum = id.startsWith('document.') ? Number(latest.kindMinReaderVersion) : format.minReaderVersion ?? format.version
    expect(() => upgradePersistenceContent({ ...format, version: previous }, content, format.version, undefined, minimum)).toThrowError(expect.objectContaining({ code: 'newer-version' }))
  }
  const versionFormat = PERSISTENCE_FORMATS.find(format => format.id === 'code-version')!
  const record = read('code-version', versionFormat.version)
  expect(record.libraries).toMatchObject({ 'henji-layout': '1.0.0' })
  expect(versionFormat.schema.safeParse({ ...record, apiVersion: 5 }).success).toBe(false)
})

it('工程入口元数据是可选增量；保留旧记录并读回新黄金样本的完整闭包', () => {
  const format = PERSISTENCE_FORMATS.find(value => value.id === 'code-version')!
  const old = JSON.parse(fs.readFileSync('tests/fixtures/persistence/code-version/v2.json', 'utf8'))
  expect(upgradePersistenceContent(format, old, 2)).toEqual(old)
  const current = JSON.parse(fs.readFileSync('tests/fixtures/persistence/code-version/v3.json', 'utf8'))
  expect(format.schema.parse(current)).toEqual(current)
  expect(current.project).toEqual({ commit: 'a'.repeat(40), entry: 'entries/title.ts' })
  expect(parseGitCodeLocation(current.files[0].location)).toMatchObject({ oid: current.project.commit, filepath: current.project.entry })
  for (const [id, version, minimum] of [['video_edit', 35, 34], ['screen_recording', 38, 37]] as const) {
    const envelope = parseDocumentText(fs.readFileSync(`tests/fixtures/persistence/document.${id}/v${version}.json`, 'utf8'))
    expect(envelope.kindMinReaderVersion).toBe(minimum)
    expect(JSON.stringify(envelope.content)).toContain('entries/title.ts')
  }
})

it('视频参数取帧时间表是可选增量：嵌入它的格式只升版本、最低可读版本不变，旧样本原样升上来，新样本读回时间表', () => {
  const versioned = (id: string) => PERSISTENCE_FORMATS.find(value => value.id === id)!
  for (const [id, previous] of [['document.video_edit', 35], ['document.screen_recording', 38], ['code-asset', 7], ['title-templates', 6], ['video-preset-package', 6], ['video-template-library', 1], ['video-style-package', 4], ['subtitle-manifest', 20]] as const) {
    const format = versioned(id)
    const raw = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${previous}.json`, 'utf8')) as { content?: unknown }
    const content = id.startsWith('document.') ? parseDocumentText(JSON.stringify(raw)).content : ['title-templates', 'video-template-library', 'video-style-package'].includes(id) ? raw.content : raw
    const upgraded = upgradePersistenceContent(format, structuredClone(content), previous)
    expect(format.schema.safeParse(upgraded).success).toBe(true)
    // 版本戳之外原样保留。
    const unstamped = (value: unknown): unknown => { if (!value || typeof value !== 'object' || Array.isArray(value)) return value; const { version: _version, minReaderVersion: _minimum, ...rest } = value as Record<string, unknown>; return rest }
    expect(unstamped(upgraded)).toEqual(unstamped(content))
  }
  const current = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v36.json', 'utf8'))
  const parse = (content: unknown) => videoEditDocumentSchema.safeParse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...(content as object) })
  const parsed = parse(current.content)
  expect(parsed.success).toBe(true)
  expect(parsed.data?.sequences[0].clips[0].code?.parameters.screen).toEqual({ kind: 'video', mediaId: 'golden-screen', spans: [{ from: 0, to: 1, src: 0 }, { from: 1, to: 1.5, src: 1, rate: 0, cursor: false }, { from: 2, to: 2.5, src: 1, rate: 3 }] })
  // 时间表与固定时刻互斥、必须按 from 升序且不重叠。
  const withScreen = (screen: unknown): unknown => {
    const content = structuredClone(current.content) as { sequences: Array<{ clips: Array<{ code?: { parameters: Record<string, unknown> } }> }> }
    content.sequences[0].clips[0].code!.parameters.screen = screen
    return content
  }
  expect(parse(withScreen({ kind: 'video', mediaId: 'golden-screen', time: 1, spans: [{ from: 0, to: 1, src: 0 }] })).success).toBe(false)
  expect(parse(withScreen({ kind: 'video', mediaId: 'golden-screen', spans: [{ from: 0, to: 2, src: 0 }, { from: 1, to: 3, src: 0 }] })).success).toBe(false)
  expect(parse(withScreen({ kind: 'video', mediaId: 'golden-screen', spans: [{ from: 0, to: 1, src: 0 }] })).success).toBe(true)
})

it('剪辑内容 v41：网页画面引用是可选增量，v40 样本原样升上来；新样本读回网页引用，落盘 schema 与运行时校验对非法取景一致拒绝', () => {
  const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
  const v40 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v40.json', 'utf8'))
  expect(upgradePersistenceContent(format, structuredClone(v40.content), 40)).toEqual(v40.content)
  const v41 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v41.json', 'utf8'))
  const parse = (content: unknown) => videoEditDocumentSchema.safeParse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...(content as object) })
  const parsed = parse(v41.content)
  expect(parsed.success).toBe(true)
  expect(parsed.data?.sequences[0].clips[0].code?.parameters.page).toEqual({ kind: 'web', path: '/persistence-project/素材/网页/知多少/index.html', width: 1920, height: 1080, region: [640, 360, 640, 360], scale: 6, spans: [{ from: 0, to: 2, src: 0 }, { from: 2, to: 3, src: 2, rate: 0 }], boxes: ['#send'] })
  // 文档里参数值的联合也接受普通结构值，非法引用在那里不报错；这里核对图片引用自身的 schema 与运行时校验。
  const agree = (page: unknown): boolean => {
    const stored = codeMaterialImageReferenceSchema.safeParse(page).success
    let runtime = true
    try { codeImageReference(page, '网页') } catch { runtime = false }
    expect(runtime).toBe(stored)
    return stored
  }
  // 4K 推近 3 倍（取景 640 宽、6 倍）合法；整幅 6 倍超出纹理上限、取景出视口、time 与 spans 同给、混入素材 ID 都拒绝。
  expect(agree({ kind: 'web', path: '/p/index.html', region: [1280, 0, 640, 360], scale: 6, time: 1 })).toBe(true)
  expect(agree({ kind: 'web', path: '/p/index.html', scale: 6 })).toBe(false)
  expect(agree({ kind: 'web', path: '/p/index.html', region: [1500, 0, 640, 360] })).toBe(false)
  expect(agree({ kind: 'web', path: '/p/index.html', time: 1, spans: [{ from: 0, to: 1, src: 0 }] })).toBe(false)
  expect(agree({ kind: 'web', path: '/p/index.html', mediaId: 'golden-screen' })).toBe(false)
})

it('剪辑内容 v37：片段停用、片子数据与内置库，旧样本原样升上来；新样本经内容外形与完整 schema 读回不丢字段', () => {
  const versioned = (id: string) => PERSISTENCE_FORMATS.find(value => value.id === id)!
  const unstamped = (value: unknown): unknown => { if (!value || typeof value !== 'object' || Array.isArray(value)) return value; const { version: _version, minReaderVersion: _minimum, ...rest } = value as Record<string, unknown>; return rest }
  const read = (id: string, version: number): unknown => JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v${version}.json`, 'utf8'))
  for (const [id, previous] of [['document.video_edit', 36], ['document.screen_recording', 39], ['code-version', 3], ['code-asset', 8], ['subtitle-manifest', 21], ['code-author-api', 4]] as const) {
    const raw = read(id, previous)
    const content = id.startsWith('document.') ? parseDocumentText(JSON.stringify(raw)).content : raw
    expect(unstamped(upgradePersistenceContent(versioned(id), structuredClone(content), previous))).toEqual(unstamped(content))
  }
  const envelope = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v37.json', 'utf8'))
  expect(envelope).toMatchObject({ kindVersion: 37, kindMinReaderVersion: 37 })
  // 主进程按内容外形解析后落盘：外形不能剥掉片子数据。
  expect(versioned('document.video_edit').schema.parse(envelope.content)).toEqual(envelope.content)
  const document = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...(envelope.content as object) })
  expect(document.scenes?.[0].records.find(record => record.id === 'fk-1')).toMatchObject({ parent: 'fo-1', values: { at: { src: 0.8 }, win: 'win-demo' }, tuned: ['target'] })
  expect(document.sequences[0].clips.find(clip => clip.id === 'golden-clip')?.code?.parameters.film).toEqual({ kind: 'scene', sceneId: 'golden-scene' })
  expect(document.sequences[0].clips.find(clip => clip.id === 'golden-sound-clip')?.enabled).toBe(false)
  expect(document.codeMaterials?.[0].versions[0]).toMatchObject({ apiVersion: 5, libraries: { three: '0.186.1' } })
  const recording = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.screen_recording/v40.json', 'utf8'))
  expect(recording).toMatchObject({ kindVersion: 40, kindMinReaderVersion: 40 })
  expect(JSON.stringify(versioned('document.screen_recording').schema.parse(recording.content))).toContain('"libraries":{"three":"0.186.1"}')
  expect((versioned('subtitle-manifest').schema.parse(upgradePersistenceContent(versioned('subtitle-manifest'), read('subtitle-manifest', 22), 22)) as { soundClips: Array<{ enabled?: boolean }> }).soundClips[0].enabled).toBe(false)
  const record = read('code-version', 4) as Record<string, unknown>
  expect(versioned('code-version').schema.parse(record)).toEqual(record)
  // 内置库从作者接口 v5 起才有；空对象与省略同义，读入即规范成省略。
  expect(versioned('code-version').schema.safeParse({ ...record, apiVersion: 4 }).success).toBe(false)
  expect(JSON.stringify(versioned('code-version').schema.parse({ ...record, libraries: {} }))).not.toContain('libraries')
  const asset = decodeCodeAsset(new TextEncoder().encode(JSON.stringify(read('code-asset', 9))))
  expect(decodeCodeAsset(encodeCodeAsset(asset)).sourceVersion.libraries).toEqual({ three: '0.186.1' })
})

it('Git 引用格式提高最低可读版本；旧引用纯迁移不做 I/O、不丢文件位置或哈希', () => {
  const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
  const before = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v33.json', 'utf8'))
  const original = structuredClone(before.content)
  expect(upgradePersistenceContent(format, before.content, 33)).toEqual(original)
  expect(before.content).toEqual(original)
  const current = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v34.json', 'utf8'))
  expect(current.kindMinReaderVersion).toBe(34)
  const content = current.content as { codeMaterials: { versions: { files: { location: string; hash: string }[] }[] }[] }
  const file = content.codeMaterials[0].versions[0].files[0]
  expect(parseGitCodeLocation(file.location)).toMatchObject({ repository: 'henji:/代码', filepath: '素材/标题/main.ts' })
  expect(file.hash).toMatch(/^[a-f0-9]{64}$/)
  const referenceFormat = PERSISTENCE_FORMATS.find(value => value.id === 'code-git-location')!
  expect(referenceFormat.schema.safeParse('git:bad').success).toBe(false)
  expect(referenceFormat.schema.safeParse(file.location).success).toBe(true)
})

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
    expect(() => parseVersionedPersistenceJson([1], contract)).toThrow('早于当前版本可读取的最低版本')
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
  it('运动模糊改为序列总开关：剪辑 v31、录制会话 v34 提高最低可读版本；关着的旧序列迁移成打开总开关、有变换动画的片段单独关掉', () => {
    const versioned = (id: string) => PERSISTENCE_FORMATS.find(value => value.id === id)!
    expect(versioned('document.video_edit').version).toBeGreaterThanOrEqual(31)
    expect(versioned('document.video_edit').minReaderVersion).toBeGreaterThanOrEqual(31)
    expect(versioned('document.screen_recording').version).toBeGreaterThanOrEqual(34)
    expect(versioned('document.screen_recording').minReaderVersion).toBeGreaterThanOrEqual(34)
    const v31 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v31.json', 'utf8'))
    const sequence = (v31.content as { sequences: Array<{ motionBlur?: boolean; clips: Array<{ id: string; motionBlur?: boolean }> }> }).sequences[0]
    expect(sequence.motionBlur).toBe(true)
    expect(sequence.clips.find(clip => clip.id === 'golden-clip')?.motionBlur).toBe(false)
    const v26 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v26.json', 'utf8'))
    const upgraded = upgradePersistenceContent(versioned('document.video_edit'), v26.content, 26) as { sequences: Array<{ motionBlur?: boolean }> }
    expect(upgraded.sequences.every(value => value.motionBlur === true)).toBe(true)
  })

  it('录屏 v26/v27 升级保持内容；v27 的内嵌风格偏好不提高最低可读版本，v28 的新批注形状、v29 的非等比缩放提高最低可读版本', () => {
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.screen_recording')!
    const previous = JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.screen_recording/v26.json', 'utf8'))
    const original = JSON.stringify(previous)
    expect(format.version).toBeGreaterThanOrEqual(34)
    expect(format.minReaderVersion).toBeGreaterThanOrEqual(34)
    expect(upgradePersistenceContent(format, previous.content, 26)).toEqual(migrateEmbeddedVideoEditMotionBlurMaster(previous.content))
    expect(JSON.stringify(previous)).toBe(original)
    const current = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.screen_recording/v27.json', 'utf8'))
    expect(current).toMatchObject({ kindVersion: 27, kindMinReaderVersion: 26, content: { scriptCapture: { baselines: [{ content: { styles: [{ userPreferences: [{ content: '标题少用装饰线。' }] }] } }] } } })
  })

  it('剪辑 v24 原样升到 v25；v25 样本带箭头、椭圆、文字、编号圆点批注与颜色', () => {
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
    const previous = JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v24.json', 'utf8'))
    expect(upgradePersistenceContent(format, previous.content, 24)).toEqual(migrateVideoEditMotionBlurMaster(previous.content))
    const current = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v25.json', 'utf8'))
    expect(current).toMatchObject({ kindVersion: 25, kindMinReaderVersion: 25 })
    const marks = (current.content as { sequences: Array<{ annotations: Array<{ target: { kind: string }; style?: { color: string } }> }> }).sequences[0].annotations
    expect(marks.map(mark => mark.target.kind)).toEqual(['region', 'arrow', 'ellipse', 'text', 'marker'])
    expect(marks.map(mark => mark.style?.color ?? 'red')).toEqual(['red', 'orange', 'blue', 'red', 'green'])
  })

  it('剪辑 v26 原样升到 v27；v27 样本序列开着运动模糊与帧混合', () => {
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
    const previous = JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v26.json', 'utf8'))
    expect(upgradePersistenceContent(format, previous.content, 26)).toEqual(migrateVideoEditMotionBlurMaster(previous.content))
    const current = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v27.json', 'utf8'))
    expect(current).toMatchObject({ kindVersion: 27, kindMinReaderVersion: 27, content: { sequences: [{ motionBlur: true, frameBlend: true }] } })
  })

  it('剪辑 v25 原样升到 v26；v26 样本带非等比缩放与粗线批注；字幕回填记录 v16 只改版本号升到 v17', () => {
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
    const previous = JSON.parse(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v25.json', 'utf8'))
    expect(upgradePersistenceContent(format, previous.content, 25)).toEqual(migrateVideoEditMotionBlurMaster(previous.content))
    const current = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v26.json', 'utf8'))
    expect(current).toMatchObject({ kindVersion: 26, kindMinReaderVersion: 26 })
    const sequence = (current.content as { sequences: Array<{ clips: Array<{ id: string; scaleAspect?: number }>; annotations: Array<{ style?: { weight?: string } }> }> }).sequences[0]
    expect(sequence.clips.find(clip => clip.id === 'golden-clip')?.scaleAspect).toBe(1.2)
    expect(sequence.annotations.map(mark => mark.style?.weight ?? 'regular')).toEqual(['regular', 'bold', 'regular', 'regular', 'regular'])
    const manifest = PERSISTENCE_FORMATS.find(value => value.id === 'subtitle-manifest')!
    const v16 = JSON.parse(fs.readFileSync('tests/fixtures/persistence/subtitle-manifest/v16.json', 'utf8'))
    expect(upgradePersistenceContent(manifest, v16, 16)).toEqual({ ...v16, version: manifest.version })
  })

  it('剪辑 v29：音频编辑动态链接的字幕段与成品时间线是可选字段，最低可读版本不变；v28 原样升上来', () => {
    const v29 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v29.json', 'utf8'))
    expect(v29).toMatchObject({ kindVersion: 29, kindMinReaderVersion: 28 })
    const content = v29.content as { media: Array<{ id: string; linkedTimeline?: unknown }>; sequences: Array<{ captions: Array<{ id: string; linkedCaptionId?: string }> }> }
    expect(content.media.find(media => media.id === 'golden-voice')?.linkedTimeline).toEqual({ sampleRate: 48000, spans: [0, 48000, 96000, 192000] })
    expect(content.sequences[0].captions.find(caption => caption.id === 'golden-linked-caption')?.linkedCaptionId).toBe('transcript-0')
    const format = PERSISTENCE_FORMATS.find(value => value.id === 'document.video_edit')!
    const v28 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v28.json', 'utf8'))
    expect(upgradePersistenceContent(format, v28.content, 28)).toEqual(migrateVideoEditMotionBlurMaster(v28.content))
  })

  it('样片画布放宽到 4K60：剪辑 v30、录制会话 v33、风格库 v3、风格包 v3 只放宽范围，最低可读版本不变；旧样本原样升上来', () => {
    const versioned = (id: string) => PERSISTENCE_FORMATS.find(value => value.id === id)!
    const v30 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v30.json', 'utf8'))
    expect(v30).toMatchObject({ kindVersion: 30, kindMinReaderVersion: 28, content: { styles: [{ sample: { width: 3840, height: 2160, fps: 60 } }] } })
    const v29 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v29.json', 'utf8'))
    expect(upgradePersistenceContent(versioned('document.video_edit'), v29.content, 29)).toEqual(migrateVideoEditMotionBlurMaster(v29.content))
    const recording = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.screen_recording/v32.json', 'utf8'))
    expect(upgradePersistenceContent(versioned('document.screen_recording'), recording.content, 32)).toEqual(migrateEmbeddedVideoEditMotionBlurMaster(recording.content))
    for (const id of ['video-style-library', 'video-style-package']) {
      const format = versioned(id)
      expect(format.version).toBeGreaterThanOrEqual(3)
      const previous = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v2.json`, 'utf8')) as { content: unknown }
      expect(upgradePersistenceContent(format, previous.content, 2)).toEqual(previous.content)
      const current = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v3.json`, 'utf8')) as { minReaderVersion: number; content: { sample?: unknown; style?: { sample: unknown } } }
      expect(current.minReaderVersion).toBe(1)
      expect(current.content.sample ?? current.content.style?.sample).toMatchObject({ width: 3840, height: 2160, fps: 60 })
    }
  })

  it('样片放宽到 30 秒、锚点 10 张：剪辑 v32、录制会话 v35、风格库 v4、风格包 v4 只放宽范围，最低可读版本不变；旧样本原样升上来', () => {
    const versioned = (id: string) => PERSISTENCE_FORMATS.find(value => value.id === id)!
    expect(versioned('document.video_edit').version).toBeGreaterThanOrEqual(32)
    expect(versioned('document.video_edit').minReaderVersion).toBeGreaterThanOrEqual(31)
    expect(versioned('document.screen_recording').version).toBeGreaterThanOrEqual(35)
    expect(versioned('document.screen_recording').minReaderVersion).toBeGreaterThanOrEqual(34)
    const v32 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v32.json', 'utf8'))
    expect(v32).toMatchObject({ kindVersion: 32, kindMinReaderVersion: 31, content: { styles: [{ sample: { durationSeconds: 24 } }] } })
    expect((v32.content as { styles: Array<{ sample: { anchors: number[] } }> }).styles[0].sample.anchors).toHaveLength(9)
    const v31 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v31.json', 'utf8'))
    expect(upgradePersistenceContent(versioned('document.video_edit'), v31.content, 31)).toEqual(v31.content)
    const recording = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.screen_recording/v34.json', 'utf8'))
    expect(upgradePersistenceContent(versioned('document.screen_recording'), recording.content, 34)).toEqual(recording.content)
    for (const id of ['video-style-library', 'video-style-package']) {
      const format = versioned(id)
      expect(format.version).toBeGreaterThanOrEqual(4)
      const previous = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v3.json`, 'utf8')) as { content: unknown }
      expect(upgradePersistenceContent(format, previous.content, 3)).toEqual(previous.content)
      const current = JSON.parse(fs.readFileSync(`tests/fixtures/persistence/${id}/v4.json`, 'utf8')) as { minReaderVersion: number; content: { sample?: unknown; style?: { sample: unknown } } }
      expect(current.minReaderVersion).toBe(1)
      expect(current.content.sample ?? current.content.style?.sample).toMatchObject({ durationSeconds: 24, anchors: [1.2, 3.2, 5.2, 6.4, 7.8, 12.4, 15, 18.2, 23.2] })
    }
  })

  it('过渡加入 gl-transitions 转场：剪辑 v33、录制会话 v36 只放宽种类，最低可读版本不变；旧样本原样升上来', () => {
    const versioned = (id: string) => PERSISTENCE_FORMATS.find(value => value.id === id)!
    const v33 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v33.json', 'utf8'))
    expect(v33).toMatchObject({ kindVersion: 33, kindMinReaderVersion: 31 })
    expect((v33.content as { sequences: Array<{ transitions: Array<{ kind: string }> }> }).sequences[0].transitions.map(item => item.kind)).toContain('gl.Cube')
    const v32 = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v32.json', 'utf8'))
    expect(upgradePersistenceContent(versioned('document.video_edit'), v32.content, 32)).toEqual(v32.content)
    const recording = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.screen_recording/v35.json', 'utf8'))
    expect(upgradePersistenceContent(versioned('document.screen_recording'), recording.content, 35)).toEqual(recording.content)
  })

  for (const format of PERSISTENCE_FORMATS) {
    const directory = path.resolve('tests/fixtures/persistence', format.id)
    for (const file of fs.readdirSync(directory).filter(file => /^v\d+\.json$/.test(file))) {
      const version = Number(file.slice(1, -5))
      const floor = baseline.formats[format.id as keyof typeof baseline.formats]?.supportedFrom ?? 1
      // 带内容迁移的 SQLite 值与正式读取入口一致，先升级再校验。
      if (format.storage === 'sqlite-ledger' && !Object.keys(format.migrations ?? {}).length) {
        it(`${format.id} ${file}记录内容由SQL账本升级，黄金样本只校验独立内容schema`, () => {
          expect(format.schema.safeParse(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))).success).toBe(true)
        })
        continue
      }
      if (version < floor) {
        it(`${format.id} ${file}低于支持下限v${floor}，明确拒绝为旧版本`, () => {
          const raw: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
          let failure: unknown
          try { upgradePersistenceContent(format, raw, version) } catch (error) { failure = error }
          expect(failure).toBeInstanceOf(PersistenceError)
          if (!(failure instanceof PersistenceError)) throw new Error('旧版本必须返回正式持久化错误。')
          expect(failure.fromVersion).toBeGreaterThanOrEqual(version)
          expect(failure.fromVersion).toBeLessThan(floor)
          expect(failure.toVersion).toBe(failure.fromVersion + 1)
          expect(() => upgradePersistenceContent(format, raw, version)).toThrowError(expect.objectContaining({
            code: 'unsupported-version', formatId: format.id,
          }))
          expect(() => upgradePersistenceContent(format, raw, version)).toThrow('早于当前版本可读取的最低版本')
        })
        continue
      }
      it(`${format.id} ${file}读取后升级至v${format.version}，通过当前schema`, () => {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
        let content = raw
        if (format.id.startsWith('document.')) content = parseDocumentEnvelope(raw).content
        else if (format.id === 'settings' || format.id === 'theme') content = (raw as { state: unknown }).state
        else if ((format.storage === 'local-storage' && !['model-defaults', 'onboarding'].includes(format.id)) || ['voice-library', 'llm-config', 'sound-library-folders', 'video-style-library', 'video-template-library', 'video-style-package'].includes(format.id)) content = (raw as { content: unknown }).content
        const upgraded = upgradePersistenceContent(format, content, version)
        expect(format.schema.safeParse(upgraded).success).toBe(true)
        if (format.id === 'audio-capture-recovery') expect(upgraded).toEqual({ ...(raw as object), version: 2 })
        if (format.id === 'document.video_edit') {
          const document = videoEditDocumentSchema.parse({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'golden', name: '黄金样本', revision: 0, ...(upgraded as object) })
          const clip = document.sequences[0].clips[0]
          expect(document.codeMaterials?.[0].versions[0].files[0].hash).toHaveLength(64)
          expect(clip.effects?.map(effect => effect.builtin?.id)).toEqual(['color_grade', 'gaussian_blur'])
          // v18：全能调色参数格式 v2；旧样本经迁移保留曝光，不再出现旧色温键。
          expect(clip.effects?.[0].builtin?.params.exposure).toBe(.25)
          expect(clip.effects?.[0].builtin?.params).not.toHaveProperty('temperature')
          if (version >= 18) expect(clip.effects?.[0].builtin?.curves?.temperature_kelvin?.map(point => point.value)).toEqual([5600, 6200])
          expect(clip.curves?.opacity?.[1].value).toBe(1)
          // v21：音频重构子片段的参数与原始源范围随片段保存；旧样本没有该字段。
          const sound = document.sequences[0].clips.find(value => value.id === 'golden-sound-clip')
          expect(sound?.gainDb ?? 0).toBe(version >= 23 ? 19 : 0)
          if (version >= 21) expect(sound?.remix).toMatchObject({ id: 'golden-remix', granularity: 'bar', sourceOutUs: 3000000 })
          else expect(sound?.remix).toBeUndefined()
          expect(document.sequences[0].captions?.[0].translation).toBe('Golden caption')
          if (version >= 11) {
            expect(document.sequences[0].captions?.[0].speech).toMatchObject({ aligned: true, words: [{ clipId: 'golden-sound-clip', text: '字幕', startUs: 166667, endUs: 700000 }, { clipId: 'golden-sound-clip', text: '原文', startUs: 700000, endUs: 1500000 }] })
            expect(document.sequences[0].captions?.[0].reviewReasons).toEqual(['translation'])
          }
          if (version >= 12) expect(clip.contentAnchor).toEqual({ ranges: [{ clipId: 'golden-sound-clip', itemId: 'golden-sound-item', fromUs: 0, toUs: 3000000 }], startOffsetSeconds: 0, endOffsetSeconds: 0 })
          expect(document.sequences[0].transitions?.[0].rightClipId).toBe(clip.id)
          // v19：速度曲线、帧混合与变调原样读回；更早的样本没有这些字段，片段仍是常数速度。
          const remapped = document.sequences[0].clips.find(value => value.id === 'golden-time-remap')
          if (version >= 19) {
            expect(remapped?.timeRemap?.points.map(point => [point.offsetUs, point.speed, point.interpolation])).toEqual([[0, 1, 'ease'], [600000, 0.25, 'hold'], [900000, 0.25, 'linear'], [1500000, 2, 'linear']])
            expect([remapped?.frameInterpolation, remapped?.pitchSemitones, remapped?.preservePitch, remapped?.speed]).toEqual(['blend', 2, true, undefined])
          } else expect(document.sequences.flatMap(sequence => sequence.clips).some(value => value.timeRemap || value.frameInterpolation || value.pitchSemitones)).toBe(false)
          // v7：自动缩放的缩放区间（源时间、档位、跟随/固定焦点）与录屏画框参数原样读回。
          if (version >= 7) {
            const effects = document.sequences[0].clips.find(value => value.id === 'golden-cursor-clip')?.effects ?? []
            expect(effects.map(effect => effect.builtin?.id)).toEqual(['recording_cursor', 'recording_zoom', 'recording_frame'])
            expect(effects[1].builtin?.regions?.map(region => [region.startUs, region.endUs, region.depth, region.focus])).toEqual([[500000, 1500000, 3, 'cursor'], [2000000, 2800000, 5, { x: 0.8, y: 0.2 }]])
            expect(effects[2].builtin?.params).toMatchObject({ background: 'solid', padding: 6 })
          }
          // v9：风格是说明书加参考示例，原样读回且序列仍绑定它；更早的参数式风格快照与绑定被丢弃。
          // v22：说明书风格换成风格副本——旧栏目并入新栏目、参考示例成为样片并记进“样片与代码”，序列绑定改名 styleId。
          if (version >= 22) {
            expect(document.styles?.[0]).toMatchObject({ id: 'golden-style', version: 2 }); expect(document.sequences[0].styleId).toBe('golden-style')
            expect(document.templates?.map(template => [template.id, template.body.kind, template.origin?.version ?? null])).toEqual([['golden-code-template', 'code', 3], ['golden-native-template', 'native', null]])
            expect(document.sequences[0].clips.find(value => value.id === 'golden-native-instance')?.templateId).toBe('golden-native-template')
          } else if (version >= 9) {
            const style = document.styles?.[0]
            expect(document.sequences[0].styleId).toBe('golden-kit'); expect(style?.name).toBe('黄金风格')
            expect(style?.guide).toContain('硬约束（原“必须”）'); expect(style?.guide).toContain('### 开场标题')
            expect(style?.sample.code.files[style.sample.code.entry]).toContain('黄金代码'); expect(document.templates).toBeUndefined()
          } else {
            expect(document.styles).toBeUndefined(); expect(document.sequences.every(sequence => sequence.styleId === undefined)).toBe(true)
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
          // 全能调色 v2：旧样本的色轮与曲线原样保留，旧色温/创意分离色调键经迁移消失。
          const grade = image.layers.find(layer => layer.id === 'golden-shared-grade') as { params: Record<string, unknown> }
          expect(grade.params).toMatchObject({ exposure: .25, shadow_hue: 230, shadow_strength: 12 })
          expect(Object.keys(grade.params).filter(key => key === 'temperature' || key.startsWith('creative_'))).toEqual([])
        }
      })
    }
  }
  it('兼容起点之后不再有开发期豁免；每种格式从支持下限到当前版本都有样本', () => {
    expect(baseline.releasedCompatibility).toBe(true)
    expect(baseline.devBreaks).toEqual([])
    for (const format of PERSISTENCE_FORMATS) {
      const entry = baseline.formats[format.id as keyof typeof baseline.formats]
      expect(entry.minReaderVersion).toBe(format.minReaderVersion ?? format.version)
      for (let version = entry.supportedFrom; version <= format.version; version++) {
        expect(fs.existsSync(path.resolve('tests/fixtures/persistence', format.id, `v${version}.json`))).toBe(true)
      }
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
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/persistence/mcp-connections/v2.json', 'utf8'))
    const contract = PERSISTENCE_FORMATS.find(value => value.id === 'mcp-connections')!
    const migrated = upgradePersistenceContent(contract, sample, 2)
    expect(migrated).toMatchObject({ connections: [{ id: sample.connections[0].id, token: sample.connections[0].token }] })
    expect(mcpConnectionStorageSchema.parse(migrated).connections[0]).not.toHaveProperty('allowPaid')
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
