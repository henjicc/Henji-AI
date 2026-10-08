// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { styleKitSchema } from '@/core/videoEdit/styleKit'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { rememberVideoEditCodeMetadata, readVideoEditCodeMetadata } from './videoEditCodeState'
import { beginVideoEditGesture, editVideoProject, finishVideoEditGesture, setVideoEditView, updateVideoEditMaskGesture, updateVideoEditPicturePosition } from './videoEditService'
import { videoEditCodeElementFrames, videoEditProgramClipAt } from './videoEditCodeElements'
import { makeVideoEditBuiltinEffect } from './videoEditCompositing'
import { createVideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { videoEditCodeElementOverrideSummary } from './videoEditCodeElementEditing'

const font = vi.hoisted(() => ({ generation: 0, calls: 0 }))
vi.mock('../videoEditGlyphMetrics', async () => {
  const { layoutCodeText } = await import('@/core/videoEdit/codeMaterial/textLayout')
  return { measureCodeText: (request: Parameters<typeof layoutCodeText>[0]) => { font.calls++; return { ...layoutCodeText(request, text => text.length * request.fontSize), fontGeneration: font.generation } } }
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('reuse author index across mask/placement while returning current placement; invalidate time, styles, overrides, parameters and fonts', async () => {
  installHarnessNativeStorage()
  const owner = await createVideoEditTestProject(); const id = owner.document.id; const sequenceId = owner.activeSequenceId
  const source = 'export default {apiVersion:1,languageVersion:3,name:"缓存",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,seed:7,parameters:{amount:{type:"number",title:"位置",default:10,min:0,max:100,step:1}},render(ctx){return [rect({id:"box",x:ctx.params.amount+ctx.time*10,y:100,width:100,height:100,fill:ctx.style.palette.accent})];}}'
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'version', apiVersion: 1, languageVersion: 3, source }, compileCodeMaterial(source))
  let clipId = ''; let effectId = ''
  editVideoProject(id, document => {
    document.codeMaterials = [{ id: 'definition', name: '缓存', defaultVersionId: 'version', versions: [{ id: 'version', apiVersion: 1, languageVersion: 3, source }] }]
    document.items.push({ id: 'item', name: '缓存', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: { amount: 10 } } })
    document.styleKits = [styleKitSchema.parse({ id: 'kit', name: '风格' })]; document.sequences[0].styleKitId = 'kit'
    const clip = makeVideoEditItemClip(document, 'item', sequenceId, { frame: 0 }, readVideoEditCodeMetadata(owner, document))
    clipId = clip.id; const effect = makeVideoEditBuiltinEffect('gaussian_blur'); effectId = effect.id; clip.effects = [effect]
    document.sequences[0].clips.push(clip); return document
  })
  const beforeSummary = font.calls
  expect(videoEditCodeElementOverrideSummary(id, sequenceId, clipId)).toEqual([])
  expect(font.calls).toBe(beforeSummary)
  const frame = () => videoEditCodeElementFrames(owner).get(clipId)!
  const original = frame(); expect(frame()).toBe(original)
  const gesture = beginVideoEditGesture(id)
  updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: .2, y: .1 })
  const moved = frame(); expect(moved.index).toBe(original.index); expect(moved.clip.x).toBe(.2)
  updateVideoEditMaskGesture(gesture, sequenceId, clipId, effectId, { regionId: 'shapes', shapes: [createVideoEditMaskShape('ellipse')] })
  expect(frame().index).toBe(original.index); finishVideoEditGesture(gesture)
  setVideoEditView(id, { frame: 1 }); let previous = frame().index
  expect(previous).not.toBe(original.index); expect(previous.byId.get('box')!.x).toBeGreaterThan(original.index.byId.get('box')!.x)
  font.generation++; expect(frame().index).not.toBe(previous); previous = frame().index
  editVideoProject(id, document => { document.sequences[0].clips[0].elementOverrides = { box: { dx: 20 } }; return document })
  expect(frame().index).not.toBe(previous); expect(frame().index.byId.get('box')!.x).toBeGreaterThan(previous.byId.get('box')!.x + 19); previous = frame().index
  editVideoProject(id, document => { document.styleKits![0].tokens.palette.accent = [1, 0, 0, 1]; return document })
  expect(frame().index).not.toBe(previous); expect(frame().index.byId.get('box')!.command).toMatchObject({ fill: [1, 0, 0, 1] }); previous = frame().index
  editVideoProject(id, document => { document.sequences[0].clips[0].code!.parameters.amount = 50; return document })
  expect(frame().index).not.toBe(previous)
})
it('non-code scenes do not initialize font measurement or author indices', async () => {
  installHarnessNativeStorage(); const owner = await createVideoEditTestProject(); const before = font.calls
  expect(videoEditCodeElementFrames(owner).size).toBe(0)
  expect(videoEditProgramClipAt(owner, { x: .5, y: .5 })).toBeUndefined()
  expect(font.calls).toBe(before)
})
