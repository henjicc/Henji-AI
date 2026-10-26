import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { buildColorGradeExport, ColorGradeExportRejection } from '@/core/imaging/lut/colorGradeExport'
import { parseCubeLut } from '@/core/imaging/lut/cube'
import type { ColorGradeExportWorkerRequest } from '@/core/imaging/lut/colorGradeExport.worker'
import { appendVideoEditClip, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances } from './videoEditService'
import { editVideoEditColorGrade } from './videoEditColorGrade'
import { makeVideoEditBuiltinEffect } from './videoEditCompositing'

/** Same request/response contract as colorGradeExport.worker.ts, run inline. */
class InlineWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage(request: ColorGradeExportWorkerRequest): void {
    queueMicrotask(() => {
      try { this.onmessage?.({ data: { build: buildColorGradeExport({ ...request, luts: new Map(request.luts) }) } }) }
      catch (error) { this.onmessage?.({ data: { error: error instanceof Error ? error.message : String(error), rejected: error instanceof ColorGradeExportRejection } }) }
    })
  }
  terminate(): void {}
}
const files = new Map<string, string>()
beforeEach(() => {
  installHarnessNativeStorage(); files.clear()
  vi.stubGlobal('Worker', InlineWorker)
  const fs = getPlatform().system.fs
  vi.spyOn(fs, 'exists').mockImplementation(async path => files.has(path))
  vi.spyOn(fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(fs, 'readTextFile').mockImplementation(async path => files.get(path) ?? '')
})
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})

/** Encoded output of mid gray (input 0.5) in the 17-point LUT. */
const centre = (text: string): number => { const lut = parseCubeLut(text); return lut.data[((8 * 17 + 8) * 17 + 8) * 4 + 1] }

it('公共能力按指定帧求值关键帧调色并写出 LUT，回执列出效果强度，不改剪辑', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips[0]
  const target = { projectId: id, sequenceId: sequence.id, clipId: clip.id }
  editVideoEditColorGrade(target, { params: { exposure: 0 }, curves: { exposure: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 10, value: 1, interpolation: 'linear' }] } })
  editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, clips: value.clips.map(item => ({ ...item, effects: item.effects!.map(effect => ({ ...effect, amount: .6 })) })) })) }))
  const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
  const app = createApplicationHarness(); const snapshot = owner.document; const history = owner.past.length
  const documentRef = { kind: 'video_edit.document', id }; const effectRef = { kind: 'video_edit.effect', id: `${id}:${effect.id}` }
  try {
    const start = await app.requireResult('export_video_edit_color_lut', { documentRef, effectRef, frame: clip.start, format: 'cube', lutSize: 17, path: 'D:/out/start.cube' })
    const lit = await app.requireResult('export_video_edit_color_lut', { documentRef, effectRef, frame: clip.start + 10, format: 'cube', lutSize: 17, path: 'D:/out/lit.cube' })
    expect(start).toMatchObject({ resultRef: effectRef, clipRef: { kind: 'video_edit.clip', id: `${id}:${clip.id}` }, frame: clip.start, lutSize: 17, verification: { verified: true } })
    expect(lit.frame).toBe(clip.start + 10)
    expect((start.omitted as string[])[0]).toContain('效果强度 60%')
    expect(centre(files.get('D:/out/start.cube')!)).toBeCloseTo(.5, 3)
    expect(centre(files.get('D:/out/lit.cube')!)).toBeGreaterThan(.65) // +1 EV at frame 10
    expect(owner.document).toBe(snapshot); expect(owner.past).toHaveLength(history)
    // Pre-write rejections: outside the clip, not a color grade, existing file without overwrite.
    expect((await app.call('export_video_edit_color_lut', { documentRef, effectRef, frame: clip.start + clip.duration + 5, format: 'cube', path: 'D:/out/x.cube' })).ok).toBe(false)
    expect((await app.call('export_video_edit_color_lut', { documentRef, effectRef, format: 'cube', path: 'D:/out/start.cube' })).ok).toBe(false)
    editVideoProject(id, document => ({ ...document, sequences: document.sequences.map(value => ({ ...value, clips: value.clips.map(item => ({ ...item, effects: [...item.effects!, { ...makeVideoEditBuiltinEffect('invert'), id: 'invert-effect' }] })) })) }))
    expect((await app.call('export_video_edit_color_lut', { documentRef, effectRef: { kind: 'video_edit.effect', id: `${id}:invert-effect` }, format: 'cube', path: 'D:/out/y.cube' })).ok).toBe(false)
    expect(files.has('D:/out/x.cube') || files.has('D:/out/y.cube')).toBe(false)
  } finally { app.dispose() }
})
