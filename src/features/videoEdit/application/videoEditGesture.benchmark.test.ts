// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditClipSchema } from '@/core/videoEdit/document'
import { createVideoEditMaskShape, editVideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { styleKitSchema, styleKitRenderKey } from '@/core/videoEdit/styleKit'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { openSeededVideoEdit, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { beginVideoEditGesture, finishVideoEditGesture, updateVideoEditGesture, updateVideoEditMaskGesture, updateVideoEditPicturePosition, subscribeVideoEditDomain } from './videoEditService'
import { videoEditCodeElementFrames } from './videoEditCodeElements'
import * as fonts from './videoEditFonts'
import * as timed from '@/core/videoEdit/timedContent'

vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class { async compile(source: string) { return compileCodeMaterial(source) } dispose() {} } }
})
vi.mock('../videoEditGlyphMetrics', async () => {
  const { layoutCodeText } = await import('@/core/videoEdit/codeMaterial/textLayout')
  return { measureCodeText: (request: Parameters<typeof layoutCodeText>[0]) => ({ ...layoutCodeText(request, text => text.length * request.fontSize), fontGeneration: 0 }) }
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

// Node-hosted service benchmark; DOM/storage and compiler thread are replaced, domain code is real.
// Opt-in timings are evidence, never a machine-dependent CI threshold.
it.skipIf(process.env.HENJI_GESTURE_BENCH !== '1')('service gestures with v3, fonts, styles, annotations and subscriber ablations', async () => {
  installHarnessNativeStorage()
  const document = createVideoEditTestDocument('手势基准')
  const sequence = document.sequences[0]
  sequence.width = 3840; sequence.height = 2160; sequence.frameRate = { numerator: 60, denominator: 1 }
  const source = `export default {apiVersion:1,languageVersion:3,name:"基准",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:7,parameters:{font:{type:"text",title:"字体",default:"sans-serif",maxLength:200}},render(ctx){return [${Array.from({ length: 48 }, (_, i) => `rect({id:"shape${i}",x:${i * 15},y:${i * 8},width:100,height:100,fill:[1,1,1,1]})`).join(',')}];}}`
  document.codeMaterials = [{ id: 'code', name: '基准', defaultVersionId: 'version', versions: [{ id: 'version', source, apiVersion: 1, languageVersion: 3 }] }]
  document.styleKits = [styleKitSchema.parse({ id: 'kit', name: '基准风格' })]; sequence.styleKitId = 'kit'
  document.items = [{ id: 'item', kind: 'code', name: '代码', code: { definitionId: 'code', versionId: 'version', parameters: { font: 'sans-serif' } } }]
  sequence.clips = Array.from({ length: 120 }, (_, i) => videoEditClipSchema.parse({ id: `clip${i}`, itemId: 'item', kind: 'code', name: `代码${i}`, code: document.items[0].code, track: sequence.tracks.find(track => track.kind === 'video')!.index, start: Math.floor(i / 4) * 600, duration: 600, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', effects: [{ id: `effect${i}`, name: '模糊', enabled: true, amount: 1, builtin: { id: 'gaussian_blur', params: {} } }], elementOverrides: { shape0: { fontFamily: 'sans-serif' } } }))
  sequence.annotations = Array.from({ length: 24 }, (_, i) => ({ id: `mark${i}`, frame: Math.floor(i / 4) * 600, clipId: `clip${i}`, space: 'composition-normalized' as const, target: { kind: 'element' as const, elementId: 'shape0' }, status: 'draft' as const, author: { kind: 'user' as const, name: '我' }, text: '检查位置', createdAt: '2026-10-08T00:00:00.000Z', thread: [] }))
  const owner = await openSeededVideoEdit(document)
  const sample = (fn: (i: number) => void, count = 100): { medianMs: number; p95Ms: number } => {
    for (let i = 0; i < 15; i++) fn(i)
    const times = Array.from({ length: count }, (_, i) => { const start = performance.now(); fn(i + 15); return performance.now() - start }).sort((a, b) => a - b)
    return { medianMs: times[Math.floor(count / 2)], p95Ms: times[Math.floor(count * .95)] }
  }
  const measure = (kind: 'mask' | 'position' | 'generic', indexSubscriber = false): object => {
    const unsubscribe = indexSubscriber ? subscribeVideoEditDomain(() => { videoEditCodeElementFrames(owner) }) : () => undefined
    const handle = beginVideoEditGesture(owner.document.id)
    try {
      const update = sample(i => {
        if (kind === 'mask') updateVideoEditMaskGesture(handle, sequence.id, 'clip0', 'effect0', { regionId: 'shapes', shapes: [editVideoEditMaskShape(createVideoEditMaskShape('ellipse', 'mask'), 'move', 0, i / 1000, 0, { u: 0, v: 0 })] })
        else if (kind === 'position') updateVideoEditPicturePosition(handle, sequence.id, 'clip0', { x: i / 1000, y: .1 })
        else updateVideoEditGesture(handle, next => { next.sequences[0].clips[0].x = i / 1000; return next })
      }, kind === 'generic' ? 30 : 100)
      const start = performance.now(); finishVideoEditGesture(handle)
      return { update, finishMs: performance.now() - start }
    } finally { finishVideoEditGesture(handle, false); unsubscribe() }
  }
  const results = { mask: measure('mask'), position: measure('position'), maskWithIndex: measure('mask', true), positionWithIndex: measure('position', true), generic: measure('generic') }
  const fontSpy = vi.spyOn(fonts, 'validateVideoEditFontChanges').mockImplementation(() => undefined)
  const withoutFonts = measure('generic'); fontSpy.mockRestore()
  const timedSpy = vi.spyOn(timed, 'reconcileVideoEditTimedContent').mockImplementation((_before, next) => next)
  const withoutTimeMapping = measure('generic'); timedSpy.mockRestore()
  const styleKey = sample(() => { for (let i = 0; i < 120; i++) styleKitRenderKey(owner.document.styleKits![0]) })
  process.stdout.write(`${JSON.stringify({ clips: 120, visibleCodes: 4, elementsPerCode: 48, annotations: 24, ...results, withoutFonts, withoutTimeMapping, styleKey120: styleKey })}\n`)
  expect(owner.past.length).toBeGreaterThan(0)
}, 60_000)

