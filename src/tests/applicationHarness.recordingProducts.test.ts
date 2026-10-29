// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'
import { createApplicationHarness } from './applicationHarness'
import { harnessDocumentStore, installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { getPlatform } from '@/platform'
import type { ApplicationRef } from '@/core/application-control'



const pixels = vi.hoisted(() => ({ frames: [] as number[], blockAt: 0, release: undefined as (() => void) | undefined, disposed: vi.fn() }))
// 只隔离媒体解码和像素合成；授权、领域处理器、编译、发布、取消及回读均为正式实现。
vi.mock('@/features/videoEdit/application/videoEditMedia', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/videoEdit/application/videoEditMedia')>(),
  inspectVideoEditMedia: async (path: string) => ({ id: crypto.randomUUID(), path, name: '屏幕原片', kind: 'video', width: 1920, height: 1080, durationSeconds: 2 }),
}))
vi.mock('@/features/videoEdit/engine/videoEditRenderSession', () => ({
  warmVideoEditNativeDecoder: async () => {},
  VideoEditRenderSession: class {
    canvas = { convertToBlob: async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) }
    setSmartRegions(): void {} setTracks(): void {}
    async render(frame: number): Promise<void> {
      pixels.frames.push(frame)
      if (pixels.frames.length === pixels.blockAt) await new Promise<void>(resolve => { pixels.release = resolve })
    }
    dispose = pixels.disposed
  },
}))

const files = new Map<string, Uint8Array>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear(); pixels.frames = []; pixels.blockAt = 0; pixels.release = undefined; pixels.disposed.mockClear()
  const { paths, fs } = getPlatform().system
  const root = resolve(sep, 'fixture', 'recording-products')
  vi.spyOn(paths, 'join').mockImplementation(async (...parts) => parts.join('/'))
  vi.spyOn(paths, 'appDirectories').mockResolvedValue({ programDir: root, userRoot: root, defaultUserRoot: root, isCustomUserRoot: false,
    thumbnailsDir: root, folderNames: { projects: 'projects', generated: 'generated', uploads: 'uploads', exports: 'exports', skills: 'skills' },
    folders: { projects: root, generated: root, uploads: root, exports: root, skills: root } })
  vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(fs, 'writeFile').mockImplementation(async (path, bytes, options) => {
    if (options?.exclusive && files.has(path)) throw new Error('文件已存在')
    files.set(path, bytes.slice())
  })
  vi.spyOn(fs, 'readFile').mockImplementation(async (path, options) => {
    const bytes = files.get(path)
    if (!bytes) throw new Error('文件不存在')
    if (options && bytes.length > options.maxBytes) throw new Error('超出读取预算')
    return bytes.slice()
  })
})
afterEach(() => { vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

function fixture(twoSteps = false) {
  const id = crypto.randomUUID(), content = createRecordingDocument()
  content.sessionId = id; content.status = 'stopped'
  content.media = [{ id: 'screen', kind: 'screen', path: resolve(sep, 'fixture', 'screen.mp4'), monoUs: 3000000, durationUs: 2000000 }]
  content.understanding.steps = [{ id: 'first', title: '打开项目', description: '第一步说明', signal: 'start', eventIds: [], startUs: 3000000, endUs: twoSteps ? 4000000 : 5000000 }]
  if (twoSteps) content.understanding.steps.push({ ...content.understanding.steps[0], id: 'second', title: '查看结果', startUs: 4000000, endUs: 5000000 })
  harnessDocumentStore().seed({ id, kind: 'screen_recording', name: '公共导出', content })
  return { id, sessionRef: { kind: 'screen_recording.session', id }, content }
}

it('公开导出能力经授权写文件、正式结果实体读回，并保持源会话持久内容', async () => {
  const { id, sessionRef, content } = fixture(), app = createApplicationHarness()
  try {
    const result = await app.requireResult('export_screen_recording_product', { sessionRef, product: 'steps' })
    expect(result).toMatchObject({ state: 'completed', verified: true, files: ['step-001.png', 'steps.md', 'steps.html'] })
    const ref = result.resultRef as ApplicationRef
    const read = await app.read(ref, ['screen_recording.export.phase', 'screen_recording.export.details'])
    expect(read.properties).toMatchObject({ 'screen_recording.export.phase': 'completed', 'screen_recording.export.details': {
      completedSteps: 1, verified: true, steps: [{ id: 'first', title: '打开项目' }], files: result.files,
    } })
    const listed = await app.requireResult('list_application_entities', { entityType: 'screen_recording.export' })
    expect(listed.refs).toContainEqual(expect.objectContaining({ kind: ref.kind, id: ref.id }))
    expect(files.size).toBe(3)
    expect(new TextDecoder().decode([...files].find(([path]) => path.endsWith('steps.md'))![1])).toContain('第一步说明')
    expect(new TextDecoder().decode([...files].find(([path]) => path.endsWith('steps.html'))![1])).toContain('打开项目')
    expect(harnessDocumentStore().stored(id)?.content).toEqual(content)
    expect(pixels.disposed).toHaveBeenCalledOnce()
  } finally { app.dispose() }
})

it('公开取消经真实导出引用终止后续发布，已完成图片仍可读回', async () => {
  const { sessionRef } = fixture(true), app = createApplicationHarness()
  pixels.blockAt = 2
  try {
    const exporting = app.requireResult('export_screen_recording_product', { sessionRef, product: 'steps' })
    await vi.waitFor(() => expect(pixels.release).toBeTypeOf('function'))
    const listed = await app.requireResult('list_application_entities', { entityType: 'screen_recording.export' })
    let ref: ApplicationRef | undefined
    for (const candidate of listed.refs as ApplicationRef[]) {
      const snapshot = await app.read(candidate, ['screen_recording.export.details'])
      const details = (snapshot.properties as Record<string, { sessionId: string }>)['screen_recording.export.details']
      if (details.sessionId === sessionRef.id) ref = { kind: candidate.kind, id: candidate.id }
    }
    if (!ref) throw new Error('本会话导出未出现在正式结果目录')
    const cancelling = app.requireResult('cancel_screen_recording_export', { exportRef: ref })
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    pixels.release!()
    expect(await exporting).toMatchObject({ state: 'cancelled', verified: false, files: ['step-001.png'] })
    expect(await cancelling).toMatchObject({ resultRef: ref, verified: true })
    const read = await app.read(ref, ['screen_recording.export.phase', 'screen_recording.export.details'])
    expect(read.properties).toMatchObject({ 'screen_recording.export.phase': 'cancelled', 'screen_recording.export.details': { completedSteps: 1, files: ['step-001.png'] } })
    expect(files.size).toBe(1)
    expect(pixels.disposed).toHaveBeenCalledOnce()
  } finally { pixels.release?.(); app.dispose() }
})
