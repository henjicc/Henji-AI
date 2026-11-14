// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from './applicationHarness'
import { installHarnessNativeStorage, registerHarnessAudioEditProject, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { registerPersistedImageEditTestSession } from './imageEditPersistenceTestSession'
import fs from 'node:fs'
import { createVideoEditTestProject, closeAllVideoEdits, openSeededVideoEdit } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { parseDocumentText } from '@/core/documents/envelope'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '@/core/persistence/schemaVersions'
import { PERSISTENCE_FORMATS } from '@/core/persistence/formats'
import { upgradePersistenceContent } from '@/core/persistence/migrations'
import { parseVideoEditDocument } from '@/core/videoEdit/documentValidation'
import { createImageEditDocumentV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'
import { imageEditV3DocumentRef } from '@/features/imageEdit/v3/application/imageEditDocumentRefs'
import { resetAudioEditProjectInstancesForTests } from '@/features/audioEdit/application/audioEditProjectInstances'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { VIDEO_EDIT_VIEW_STATE_PROPERTY_IDS } from '@/features/videoEdit/application/videoEditReflection'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { projectApplicationToolResult } from '../../electron/main/services/application-runtime/resultProjection'

type Ref = { kind: string; id: string }
interface Node { ref: Ref; properties?: Record<string, unknown>; children?: Record<string, Node[]>; more?: unknown[] }
interface Snapshot { root: Node; types: Record<string, { create?: { under: string[]; required: Record<string, string> }; properties?: Record<string, string>; shared?: Record<string, unknown>; unset?: string[]; onRequest?: string[] }>; entityCount: number; notExpanded?: string[] }

const disposers: Array<() => void> = []
beforeEach(() => { installHarnessNativeStorage() })
afterEach(async () => { disposers.splice(0).reverse().forEach(dispose => dispose()); await closeAllVideoEdits(); await resetAudioEditProjectInstancesForTests(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function harness() {
  const app = createApplicationHarness(); disposers.push(app.dispose)
  /** 交给模型的字符数：与 Pi、MCP 同一份结果投影。 */
  const delivered = async (id: string, input: Record<string, unknown>): Promise<{ data: Record<string, unknown>; chars: number }> => {
    const data = await app.requireResult(id, input)
    return { data, chars: JSON.stringify(projectApplicationToolResult(id, input, { ok: true, data }).data).length }
  }
  const snapshot = async (input: Record<string, unknown>): Promise<Snapshot> => await app.requireResult('read_application_snapshot', input) as unknown as Snapshot
  /** 不带基线直接写：读回的引用与属性键原样使用。 */
  const write = async (changes: unknown[]): Promise<void> => {
    const result = await app.call('change_application_entities', { summary: '按整份读回的结果修改', changes })
    expect(result.ok, JSON.stringify(result)).toBe(true)
  }
  /** 节点的有效属性：自己的值优先，其次是该类型共有的值。 */
  const value = (result: Snapshot, node: Node, key: string): unknown => node.properties?.[key] ?? result.types[node.ref.kind].shared?.[key]
  return { app, delivered, snapshot, write, value }
}

it('剪辑：一次读回序列、轨道、片段与标记，读回的引用和属性键直接用于写入，写入后再读回已变；体积远小于逐个读取', async () => {
  const owner = await createVideoEditTestProject()
  const { app, delivered, snapshot, write, value } = harness()
  const root = { kind: 'video_edit.document', id: owner.document.id }

  // 空时间线：读回里已有新建素材项、片段与标记要的父实体和必填属性
  const empty = await snapshot({ root })
  const sequence = empty.root.children!['video_edit.sequence'][0]
  expect(empty.types['video_edit.clip'].create).toMatchObject({ under: ['video_edit.sequence'], required: { item_id: expect.any(String) } })
  expect(Object.keys(empty.types['video_edit.marker'].create!.required)).toEqual(['frame', 'name'])
  const videoTrack = sequence.children!['video_edit.track'].find(track => value(empty, track, 'kind') === 'video')!

  // 2 条轨道、8 个片段、3 个标记：全部按读回给出的必填项经通用写入建出来
  await write([{ kind: 'create_items', parent: root, entityType: 'video_edit.item', items: [{ properties: { name: '标题', kind: 'text' } }] }])
  const item = (await snapshot({ root, entityTypes: ['video_edit.item'] })).root.children!['video_edit.item'][0]
  // 素材项写成读回的完整引用 id 或它的后半段都可以
  const itemId = item.ref.id.slice(owner.document.id.length + 1)
  await write([
    { kind: 'create_items', parent: sequence.ref, entityType: 'video_edit.clip', items: Array.from({ length: 8 }, (_, index) => ({ properties: { item_id: index % 2 ? itemId : item.ref.id, track: value(empty, videoTrack, 'index'), start: index * 30, duration: 30 } })) },
    { kind: 'create_items', parent: sequence.ref, entityType: 'video_edit.marker', items: [15, 45, 75].map((frame, index) => ({ properties: { frame, name: `标记 ${index + 1}` } })) },
  ])

  const input = { root }
  const after = await delivered('read_application_snapshot', input)
  const result = after.data as unknown as Snapshot
  const timeline = result.root.children!['video_edit.sequence'][0]
  expect(timeline.children!['video_edit.track']).toHaveLength(2)
  const clips = timeline.children!['video_edit.clip']
  expect(clips.map(clip => clip.properties?.start)).toEqual([0, 30, 60, 90, 120, 150, 180, 210])
  expect(timeline.children!['video_edit.marker'].map(marker => marker.properties)).toEqual([{ frame: 15, name: '标记 1' }, { frame: 45, name: '标记 2' }, { frame: 75, name: '标记 3' }])
  // 八个片段相同的值只写一次，仍读得到当前值
  expect(result.types['video_edit.clip'].shared).toMatchObject({ duration: 30, opacity: 1, scale: 1, kind: 'text' })
  expect(result.types['video_edit.clip'].properties!.opacity).toContain('0–1')
  // 界面状态与目录型子实体默认不带
  expect(result.root.properties).not.toHaveProperty('timeline_view')
  expect(result.types['video_edit.document'].onRequest).toContain('timeline_view')
  expect(result.notExpanded).toEqual(expect.arrayContaining(['video_edit.builtin_effect', 'video_edit.code_material']))

  await write([{ kind: 'set_properties', target: clips[5].ref, entityType: 'video_edit.clip', properties: { opacity: 0.5, scale: 0.8 } }])
  const changed = await snapshot({ root: timeline.ref, entityTypes: ['video_edit.clip'], properties: { 'video_edit.clip': ['opacity', 'scale'] } })
  expect(changed.root.children!['video_edit.clip'].map(clip => clip.properties)).toEqual(
    clips.map((_, index) => index === 5 ? { opacity: 0.5, scale: 0.8 } : { opacity: 1, scale: 1 }))

  // 按所属序列、时间段与排序筛：第 100–200 帧之间出现的片段，从后往前
  const found = await app.requireResult('list_application_entities', { entityType: 'video_edit.clip', parent: root, propertyIds: ['start'],
    overlap: { start: 'start', duration: 'duration', from: 100, to: 200 }, orderBy: [{ property: 'start', direction: 'desc' }] })
  expect((found.items as Array<{ properties: Record<string, unknown> }>).map(entry => entry.properties['video_edit.clip.start'])).toEqual([180, 150, 120, 90])

  // 同一份状态用旧读法：查四类实体的属性，逐类列出，再逐个读取
  const types = ['video_edit.sequence', 'video_edit.track', 'video_edit.clip', 'video_edit.marker']
  let calls = 0, chars = 0
  const count = async (id: string, old: Record<string, unknown>): Promise<Record<string, unknown>> => { const read = await delivered(id, old); calls += 1; chars += read.chars; return read.data }
  for (let cursor: string | null = '0'; cursor !== null;) cursor = (await count('describe_application_entities', { entityTypes: types, limit: 100, cursor })).nextCursor as string | null
  for (const entityType of types) for (const ref of (await count('list_application_entities', { entityType })).refs as Ref[]) await count('read_application_entity', { ref })
  if (process.env.HENJI_SNAPSHOT_MEASURE === '1') process.stdout.write(`[snapshot] 旧读法 ${calls} 次调用、${chars} 字符；整份读回 1 次调用、${after.chars} 字符（${result.entityCount} 个实体）\n`)
  // 整份读回的意义就在于比逐个读取省得多（查结构这一步本身已是每条属性一行的紧凑目录）：体积回涨到一半以上就失去了这个前提
  expect(after.chars * 2).toBeLessThan(chars)
})

it('图片文档：读回图层组里的图层与滤镜，读回的引用直接写入', async () => {
  const document = createImageEditDocumentV3({ width: 32, height: 24, documentId: 'snapshot-layers' })
  const group = createImageEditGroupLayerV3('group', '人物')
  group.children = [createImageEditRasterLayerV3('inner', '主体')]
  document.layers = [createImageEditRasterLayerV3('base', '底图'), group]
  disposers.push(registerPersistedImageEditTestSession('snapshot-layers-session', new ImageEditCommandBusV3(document)))
  const { snapshot, write, value } = harness()
  const root = imageEditV3DocumentRef(document.id)

  const before = await snapshot({ root })
  const base = before.root.children!['image_edit.layer'][0]
  expect(value(before, base, 'name')).toBe('底图')
  const inner = before.root.children!['image_edit.group'][0].children!['image_edit.layer'][0]
  expect(value(before, inner, 'name')).toBe('主体')
  expect(Object.keys(before.types['image_edit.layer_filter'].create!.required)).toEqual(expect.arrayContaining(['operation_type', 'effect_id']))

  await write([
    { kind: 'create_items', parent: inner.ref, entityType: 'image_edit.layer_filter', items: [{ properties: { operation_type: 'adjustment', effect_id: 'exposure', params: { stops: 0.4 } } }] },
    { kind: 'set_properties', target: base.ref, entityType: 'image_edit.layer', properties: { name: '背景', opacity: 0.8 } },
  ])
  const after = await snapshot({ root })
  const layers = after.root.children!['image_edit.layer']
  expect(layers).toHaveLength(1)
  expect(value(after, layers[0], 'name')).toBe('背景')
  expect(value(after, layers[0], 'opacity')).toBe(0.8)
  const filters = after.root.children!['image_edit.group'][0].children!['image_edit.layer'][0].children!['image_edit.layer_filter']
  expect(filters).toHaveLength(1)
  expect(filters[0].properties).toMatchObject({ effect_id: 'exposure', params: { stops: 0.4 } })
})

it('项目、画布与口播：只读回根实体自己的成员，不带别的文档的内容', async () => {
  const { app, snapshot, write } = harness()
  const created = async (input: Record<string, unknown>): Promise<Ref> => (await app.requireResult('create_document', input)).resultRef as Ref
  // 新建剪辑会带出一个项目；项目外另有两份画布
  const edit = await createVideoEditTestProject()
  const inside = await created({ kind: 'canvas', name: '画布甲' })
  const outside = await created({ kind: 'canvas', name: '画布乙' })
  const membership = await app.read({ kind: 'documents.document', id: edit.document.id }, ['project_id'])
  const project = { kind: 'documents.project', id: (membership.properties as Record<string, string>)['documents.document.project_id'] }
  // 项目的制作进度要读磁盘上的文件，测试替身不装文件系统：只点名名称
  const tree = await snapshot({ root: project, properties: { 'documents.project': ['name'] } })
  expect(tree.root.children!['documents.document'].map(node => node.ref.id)).toEqual([edit.document.id])

  const node = { properties: { node_type: 'textAnnotationNode' } }
  await write([{ kind: 'create_items', parent: { kind: 'canvas.document', id: inside.id }, entityType: 'canvas.node', items: [node, node] }])
  await write([{ kind: 'create_items', parent: { kind: 'canvas.document', id: outside.id }, entityType: 'canvas.node', items: [node] }])
  const blank = await snapshot({ root: { kind: 'canvas.document', id: inside.id } })
  const nodes = blank.root.children!['canvas.node']
  expect(nodes).toHaveLength(2)
  await write(nodes.map((item, index) => ({ kind: 'set_properties', target: item.ref, entityType: 'canvas.node', properties: { text_content: ['甲', '乙'][index] } })))
  const canvas = await snapshot({ root: { kind: 'canvas.document', id: inside.id } })
  expect(canvas.root.children!['canvas.node'].map(item => item.properties?.text_content)).toEqual(['甲', '乙'])
  expect(canvas.types['canvas.edge'].create).toMatchObject({ under: ['canvas.document'] })

  const talk = (id: string, words: string[]): AudioEditProjectDocument => ({
    id, name: id, referenceScript: '', suggestions: [], createdAt: 1, updatedAt: 1, revision: 1,
    source: { mediaType: 'audio', sourcePath: 'fixture.wav', audioPath: 'fixture.wav', durationFrames: 96_000, sampleRate: 48_000, channels: 1 },
    transcript: words.map((word, index) => ({ id: `w${index}`, text: word, startFrame: index * 1000, endFrame: (index + 1) * 1000, included: true, locked: false, granularity: 'word' as const })),
  })
  registerHarnessAudioEditProject(talk('talk-a', ['你好', '世界'])); registerHarnessAudioEditProject(talk('talk-b', ['别的', '口播', '内容']))
  // 口播的原素材核对要读磁盘，测试替身不装：只点名名称
  const audio = await snapshot({ root: { kind: 'audio_edit.document', id: 'talk-a' }, properties: { 'audio_edit.document': ['name'] } })
  expect(audio.root.children!['audio_edit.transcript_block'].map(node => node.properties?.text)).toEqual(['你好', '世界'])
  // 呼吸声检测与本机插件扫描不随整份读回触发
  expect(audio.notExpanded).toEqual(expect.arrayContaining(['audio_edit.breath', 'audio_edit.processor_chain']))
})

it('剪辑里按 ID 标成界面状态的属性都还登记着：属性改名后这份标记不会无声失效', () => {
  const registry = getApplicationReflectionRegistry()
  const stale = [...VIDEO_EDIT_VIEW_STATE_PROPERTY_IDS].filter(id => registry.getProperty(id)?.viewState !== true)
  expect(stale).toEqual([])
})

it('剪辑的固定源码版本只挂在各自的代码素材下：按剪辑列出与点名展开都不重复', async () => {
  // 带代码素材的黄金样本，逐版本升级到当前格式后打开
  const sample = parseDocumentText(fs.readFileSync('tests/fixtures/persistence/document.video_edit/v47.json', 'utf8'))
  const content = upgradePersistenceContent(PERSISTENCE_FORMATS.find(format => format.id === 'document.video_edit')!, sample.content, sample.kindVersion) as object
  const owner = await openSeededVideoEdit(parseVideoEditDocument({ format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: 'snapshot-code', name: '代码素材样本', revision: 0, ...content }))
  const versions = owner.document.codeMaterials!.flatMap(definition => definition.versions.map(version => `${owner.document.id}:${version.id}`))
  expect(versions.length).toBeGreaterThan(0)
  const { app, snapshot } = harness()
  const root = { kind: 'video_edit.document', id: owner.document.id }
  const listed = await app.requireResult('list_application_entities', { entityType: 'video_edit.code_version', parent: root })
  expect((listed.refs as Ref[]).map(ref => ref.id)).toEqual(versions)
  // 只点名类型、不读属性：读代码版本要加载源码声明，这里只核对层级
  const tree = await snapshot({ root, entityTypes: ['video_edit.code_version'], properties: { 'video_edit.document': [], 'video_edit.code_version': [], 'video_edit.code_material': [] } })
  expect(tree.root.children!['video_edit.code_version']).toBeUndefined()
  expect(tree.root.children!['video_edit.code_material'].flatMap(node => node.children!['video_edit.code_version'].map(child => child.ref.id))).toEqual(versions)
})
