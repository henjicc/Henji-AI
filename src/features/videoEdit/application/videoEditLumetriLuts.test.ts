import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { videoEditContentSchema } from '@/core/documents/kinds/videoEdit'
import { videoEditComposition } from '@/core/videoEdit/document'
import { createLocationCodec } from '@/core/storage/locationCodec'
import { importVideoEditLumetriLut, readVideoEditLumetriLut } from './videoEditLumetriLuts'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit, videoEditDocumentContent, videoEditDocumentFromContent } from './videoEditService'
import { editVideoEditLumetri } from './videoEditLumetri'
vi.mock('./videoEditCodeTrial', async original => ({ ...await original<typeof import('./videoEditCodeTrial')>(), trialVideoEditCodeDocument: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./videoEditLumetriLutClient', async () => ({ decodeVideoEditLutOffThread: (await import('../engine/videoEditLumetriLutSource')).decodeVideoEditLut }))
const path = resolve(sep, 'luts', 'look.cube')
const cube = 'LUT_1D_SIZE 2\n0 0 0\n1 1 1'
beforeEach(() => {
  installHarnessNativeStorage(); vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue(resolve(sep, 'lumetri.henji-video'))
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(path)
  vi.spyOn(getPlatform().system.fs, 'readFile').mockResolvedValue(new TextEncoder().encode(cube))
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('复用文件对话框与有界读取，项目LUT引用保存/重载/合成不丢失，内容改变拒绝，撤销移除导入', async () => {
  const owner = (await createVideoEditProject())!; const snapshot = owner.document
  const asset = (await importVideoEditLumetriLut(owner.document.id))!
  expect(getPlatform().system.fs.readFile).toHaveBeenCalledWith(path, { maxBytes: 24 * 1024 * 1024 })
  expect(await readVideoEditLumetriLut(asset)).toMatchObject({ kind: '1d', size: 2 })
  const content = videoEditContentSchema.parse(videoEditDocumentContent(owner.document))
  const restored = videoEditDocumentFromContent(JSON.parse(JSON.stringify(content)), { id: owner.document.id, name: owner.document.name })
  expect(restored.lumetriLuts).toEqual([asset]); expect(videoEditComposition(restored, restored.sequences[0].id).lumetriLuts).toEqual([asset])
  const codec = createLocationCodec({ style: sep === '\\' ? 'win32' : 'posix', userRoot: resolve(sep, 'works'), projects: [{ id: 'p', root: resolve(sep, 'luts') }], container: { kind: 'project', projectId: 'p' } })
  const stored = codec.encodeContent(content)
  expect(stored.content).toMatchObject({ lumetriLuts: [{ path: 'henji:/look.cube' }] }); expect(stored.report.references).toContainEqual(expect.objectContaining({ path }))
  expect(videoEditContentSchema.parse(codec.decodeContent(stored.content).content).lumetriLuts).toEqual([asset])
  vi.mocked(getPlatform().system.fs.readFile).mockResolvedValue(new TextEncoder().encode(cube.replace('1 1 1', '.5 .5 .5')))
  await expect(readVideoEditLumetriLut(asset)).rejects.toThrow('恢复或重新导入')
  undoVideoEdit(owner.document.id); expect(owner.document.lumetriLuts).toEqual(snapshot.lumetriLuts)
})
it('取消/非法LUT/导入途中改文档不会发布引用；原错误继续暴露', async () => {
  const owner = (await createVideoEditProject())!; const snapshot = owner.document
  vi.mocked(getPlatform().system.dialog.open).mockResolvedValueOnce(null)
  expect(await importVideoEditLumetriLut(owner.document.id)).toBeNull(); expect(owner.document).toBe(snapshot)
  vi.mocked(getPlatform().system.fs.readFile).mockResolvedValueOnce(new TextEncoder().encode('LUT_3D_SIZE 66'))
  await expect(importVideoEditLumetriLut(owner.document.id)).rejects.toThrow('尺寸'); expect(owner.document).toBe(snapshot)
  vi.mocked(getPlatform().system.fs.readFile).mockImplementationOnce(async () => { appendVideoEditClip(owner.document.id); return new TextEncoder().encode(cube) })
  await expect(importVideoEditLumetriLut(owner.document.id)).rejects.toThrow('已改变'); expect(owner.document.lumetriLuts).toBeUndefined()
})
it('通用读回项目LUT不泄露路径；曲线/强度/引用读写与hold关键帧，跨项目引用和未知点拒绝', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; appendVideoEditClip(id)
  const asset = (await importVideoEditLumetriLut(id))!; const sequence = getActiveVideoEditSequence(owner); const target = { projectId: id, sequenceId: sequence.id, clipId: sequence.clips[0].id }
  editVideoEditLumetri(target, { params: { input_lut: asset.id, input_lut_strength: 60 } })
  const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]; const ref = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }; const app = createApplicationHarness()
  try {
    const document = await app.read({ kind: 'video_edit.document', id }, ['video_edit.document.lumetri_luts'])
    expect(document.properties).toMatchObject({ 'video_edit.document.lumetri_luts': [{ id: asset.id, name: asset.name }] }); expect(JSON.stringify(document)).not.toContain(path)
    const points = '[{"x":0,"y":0},{"x":40,"y":70},{"x":100,"y":100}]'
    expect(await app.change(ref, { 'video_edit.effect.parameters': { input_lut: asset.id, input_lut_strength: 40, curve_master_points: points } })).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.effect.parameters'])).properties).toMatchObject({ 'video_edit.effect.parameters': { input_lut: asset.id, input_lut_strength: 40, curve_master_points: points } })
    expect(await app.change(ref, { 'video_edit.effect.frame_curves': { curve_master_points: [{ time: 0, value: points, interpolation: 'hold' }] } })).toMatchObject({ ok: true })
    expect((await app.change(ref, { 'video_edit.effect.parameters': { input_lut: 'foreign' } })).ok).toBe(false)
    expect((await app.change(ref, { 'video_edit.effect.parameters': { curve_master_points: '[]' } })).ok).toBe(false)
    const baseline = owner.document
    expect(() => editVideoProject(id, document => ({ ...document, lumetriLuts: [] }))).toThrow('LUT'); expect(owner.document).toBe(baseline)
  } finally { app.dispose() }
})
