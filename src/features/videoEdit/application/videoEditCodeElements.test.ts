// @vitest-environment jsdom
import { rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { addLegacyVideoEditTracks } from '@/core/videoEdit/testFixtures'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { editVideoProject, getActiveVideoEditSequence } from './videoEditService'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { updateVideoEditCodeElement, setVideoEditCodeElementAutoKeyframes, toggleVideoEditCodeElementKeyframe } from './videoEditCodeElementEditing'
import * as codeTrial from './videoEditCodeTrial'
import { assertCodeElementOverrideAllowed } from '@/core/videoEdit/codeElementOverrides'

import { afterEach, expect, it, vi } from 'vitest'


import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'


import { installVideoEditCodeElements, readSelectedVideoEditCodeElement, selectedVideoEditCodeElement, selectVideoEditCodeElement, videoEditSelectedCodeElementContext, videoEditCodeElementFrames, videoEditProgramClipAt } from './videoEditCodeElements'




const font = vi.hoisted(() => ({ generation: 0, calls: 0 }))
vi.mock('../videoEditGlyphMetrics', async () => {
  const { layoutCodeText } = await import('@/core/videoEdit/codeMaterial/textLayout')
  return { measureCodeText: (request: Parameters<typeof layoutCodeText>[0]) => { font.calls++; return { ...layoutCodeText(request, text => text.length * request.fontSize, { alphabeticPlacement: 'em' }), fontGeneration: font.generation } } }
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('non-code scenes do not initialize font measurement or author indices', async () => {
  installHarnessNativeStorage(); const owner = await createVideoEditTestProject(); const before = font.calls
  expect(videoEditCodeElementFrames(owner).size).toBe(0)
  expect(videoEditProgramClipAt(owner, { x: .5, y: .5 })).toBeUndefined()
  expect(font.calls).toBe(before)
})

it('调整层按 id/源码选择后逻辑读回和助手上下文保留，画面几何查询排除；文档更新保留逻辑选择', async () => {
  installHarnessNativeStorage()
  const owner = await createVideoEditTestProject(), sequence = getActiveVideoEditSequence(owner)
  const source = "export default {name:'调整',params:[{key:'drawing',type:'boolean',default:false}],layers:p=>[p.drawing?{id:'grade',draw(){}}:{id:'grade',adjust:()=>[]}]}"
  const version = { id: 'version', apiVersion: CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, languageVersion: 4 as const, ...testCodeManifest(source, owner.document) }
  rememberVideoEditCodeMetadata(owner, 'definition', version, testAuthorProgram(testAuthorBundle({ apiVersion: CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, entry: 'main.ts', files: { 'main.ts': source } })))
  const clip: VideoEditClip = { id: 'code', itemId: 'item', name: '调整', kind: 'code', track: 1, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', code: { definitionId: 'definition', versionId: 'version', parameters: {} } }
  editVideoProject(owner.document.id, document => {
    const next = structuredClone(document)
    next.codeMaterials = [{ id: 'definition', name: '调整', defaultVersionId: 'version', versions: [version] }]
    next.items.push({ id: 'item', name: '调整', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: {} } })
    const target = next.sequences.find(value => value.id === sequence.id)!
    addLegacyVideoEditTracks(target)
    target.clips.push(clip)
    return next
  })
  const sourceSpan = { file: 'main.ts', start: 10, end: 30, startLine: 1, startColumn: 11, endLine: 1, endColumn: 31 }
  expect(installVideoEditCodeElements(owner, { sequenceId: sequence.id, revision: owner.document.revision, frame: owner.frame, clips: [{ clipId: clip.id, versionId: 'version', width: 1920, height: 1080, elements: [{ id: 'grade', name: '调整', kind: 'adjust', matrix: [1, 0, 0, 1, 0, 0], corners: [], sourceSpan, parameterKeys: ['strength'], textParameterKeys: [], effects: [{ id: 'vignette', params: { amount: 30 }, amount: 1, source: 'descriptor' }] }] }] })).toBe(true)
  selectVideoEditCodeElement(owner, clip.id, 'grade')
  expect(readSelectedVideoEditCodeElement(owner)?.element.author).toMatchObject({ kind: 'adjust', sourceSpan })
  expect(videoEditSelectedCodeElementContext(owner)).toMatchObject({ elementId: 'grade', sourceSpan, parameterKeys: ['strength'], effects: [{ id: 'vignette' }] })
  expect(selectedVideoEditCodeElement(owner)).toBeUndefined()
  editVideoProject(owner.document.id, document => ({ ...document, name: '调整层选择回读' }))
  expect(readSelectedVideoEditCodeElement(owner)?.element.author.kind).toBe('adjust')
  const target = { projectId: owner.document.id, sequenceId: sequence.id, clipId: clip.id, versionId: 'version', elementId: 'grade' }
  for (const key of ['dx', 'dy', 'scale', 'scaleX', 'scaleY', 'rotation']) {
    expect(() => updateVideoEditCodeElement(target, { [key]: key.startsWith('scale') ? 1 : 0 })).toThrow('调整层没有画面范围')
  }
  expect(() => setVideoEditCodeElementAutoKeyframes(target, true)).toThrow('调整层没有画面范围')
  expect(() => toggleVideoEditCodeElementKeyframe(target, 'rotation')).toThrow('调整层没有画面范围')
  installVideoEditCodeElements(owner, { sequenceId: sequence.id, revision: owner.document.revision, frame: owner.frame, clips: [] })
  const trial = vi.spyOn(codeTrial, 'trialVideoEditCodeDocument').mockImplementation(async (_owner, _revision, document, sequenceId) => {
    const candidate = document.sequences.find(value => value.id === sequenceId)!.clips.find(value => value.id === clip.id)!
    assertCodeElementOverrideAllowed(candidate.code?.parameters.drawing ? undefined : 'adjust', candidate.elementOverrides?.grade)
  })
  const app = createApplicationHarness(), ref = { kind: 'video_edit.clip', id: `${owner.document.id}:${clip.id}` }
  try {
    const before = owner.document
    for (const override of [{ dx: 1 }, { curves: { rotation: [{ id: 'rotate', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 10, interpolation: 'linear' }] } }]) {
      expect((await app.change(ref, { 'video_edit.clip.element_overrides': { grade: override } })).ok).toBe(false)
      expect(owner.document).toBe(before)
    }
    expect((await app.change(ref, { 'video_edit.clip.element_overrides': { grade: { dx: 1 } }, 'video_edit.clip.effect_ids': [] })).ok).toBe(false)
    expect(owner.document).toBe(before)
    expect((await app.change(ref, { 'video_edit.clip.element_overrides': { grade: { opacity: .5 } } })).ok).toBe(true)
    expect(getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)?.elementOverrides).toEqual({ grade: { opacity: .5 } })
    expect((await app.change(ref, { 'video_edit.clip.code_parameters': { drawing: true }, 'video_edit.clip.element_overrides': { grade: { dx: 5 } } })).ok).toBe(true)
    expect(trial).toHaveBeenCalledTimes(4)
    expect(getActiveVideoEditSequence(owner).clips.find(value => value.id === clip.id)?.elementOverrides).toEqual({ grade: { dx: 5 } })
  } finally { app.dispose() }
})
