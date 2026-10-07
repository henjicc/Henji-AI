// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditMaskShape, editVideoEditMaskShape, rasterizeVideoEditMaskShapes } from '@/core/videoEdit/effectMasks'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { appendVideoEditClip, appendVideoEditMedia, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, updateVideoEditGesture } from '../application/videoEditService'
import { applyVideoEditBuiltinEffect, updateVideoEditBuiltinEffect } from '../application/videoEditCompositing'

vi.mock('./videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})
// Explicit opt-in: timings are evidence, never machine-dependent CI assertions.
it.skipIf(process.env.HENJI_MASK_BENCH !== '1')('4K mask rasterization and real gesture publication benchmark', async () => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('/mask-benchmark.henji-video')
  const owner = (await createVideoEditTestProject())!
  appendVideoEditMedia(owner.document.id, { id: 'bench-media', name: 'bench', path: '/bench.mp4', kind: 'video', durationSeconds: 20, width: 3840, height: 2160 })
  appendVideoEditClip(owner.document.id, 'bench-media')
  const sequence = getActiveVideoEditSequence(owner); const clip = sequence.clips.find(value => value.kind === 'video')!
  const target = { projectId: owner.document.id, sequenceId: sequence.id, clipId: clip.id }
  const [effectId] = applyVideoEditBuiltinEffect(owner.document.id, sequence.id, [clip.id], 'gaussian_blur')
  const shape = createVideoEditMaskShape('ellipse', 'bench-shape')
  const sample = (fn: (index: number) => void, count: number): { median: number; max: number } => {
    fn(-1)
    const times = Array.from({ length: count }, (_, index) => { const start = performance.now(); fn(index); return performance.now() - start }).sort((a, b) => a - b)
    return { median: times[Math.floor(count / 2)], max: times[count - 1] }
  }
  const raster4k = sample(() => { expect(rasterizeVideoEditMaskShapes([shape], 3840, 2160).length).toBe(3840 * 2160) }, 5)
  const rasterPreview = sample(() => { rasterizeVideoEditMaskShapes([shape], 1024, 576) }, 10)
  const gesture = beginVideoEditGesture(owner.document.id)
  const update = sample(index => updateVideoEditBuiltinEffect(target, effectId, { mask: { regionId: 'shapes', shapes: [editVideoEditMaskShape(shape, 'move', 0, index / 1000, 0, { u: 0, v: 0 })] } }, gesture), 30)
  const final = owner.document
  const start = performance.now(); finishVideoEditGesture(gesture)
  process.stdout.write(`${JSON.stringify({ raster4k, rasterPreview, update, finishMs: performance.now() - start, retainsFinalPreview: owner.document === final })}\n`)
  expect(owner.document).toBe(final)
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(value => value.id !== sequence.id ? value : { ...value, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, clips: Array.from({length:1000},(_,i)=>({...value.clips[0],id:i===0 ? clip.id : `bench-${i}`,start:i*value.clips[0].duration,effects:value.clips[0].effects?.map(effect=>({...effect,id:i===0 ? effect.id : `bench-effect-${i}`}))})) }) }))
  const large = beginVideoEditGesture(owner.document.id)
  const wholeDocument = sample(index => updateVideoEditGesture(large, document => {
    const effects = document.sequences.find(value=>value.id===sequence.id)!.clips[0].effects!
    effects[0].mask = { regionId:'shapes',shapes:[editVideoEditMaskShape(shape,'move',0,index/1000,0,{u:0,v:0})] }
    return document
  }),10)
  finishVideoEditGesture(large)
  const localGesture = beginVideoEditGesture(owner.document.id)
  const localMask = sample(index => updateVideoEditBuiltinEffect(target,effectId,{mask:{regionId:'shapes',shapes:[editVideoEditMaskShape(shape,'move',0,index/1000,.01,{u:0,v:0})]}},localGesture),30)
  const largePreview = owner.document; const largeStart = performance.now()
  finishVideoEditGesture(localGesture)
  const largeFinishMs = performance.now()-largeStart
  expect(owner.document).toBe(largePreview)
  process.stdout.write(`${JSON.stringify({ sequence:'3840x2160@60',clips:1000,wholeDocument,localMask,largeFinishMs,retainsFinalPreview:owner.document===largePreview })}\n`)
})
