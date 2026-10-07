// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { appendVideoEditMedia, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, undoVideoEdit, type VideoEditInstance } from '../application/videoEditService'
import { registerVideoEditSourcePresenter, updateVideoEditSource } from '../application/videoEditSource'
import { writeVideoEditSourceDrag } from '../application/videoEditSourceRange'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop } from '../application/videoEditDrop'
import { VideoEditTimelineCanvas } from './VideoEditTimelineCanvas'
import { TIMELINE_DEFAULT_SPLIT, TIMELINE_HEADER_WIDTH, timelineLayout, timelineTrackAt } from './timelineGeometry'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

/** dragover 的保护模式只能读 types；drop 才能读载荷。 */
function sourceTransfer() {
  const data = new Map<string, string>()
  let protectedMode = false
  const getData = vi.fn((type: string) => protectedMode ? '' : data.get(type) ?? '')
  const transfer = { get types() { return [...data.keys()] }, setData: (type: string, value: string) => data.set(type, value), getData, dropEffect: 'none', effectAllowed: 'copy' } as unknown as DataTransfer
  return { transfer, getData, protect: (value: boolean) => { protectedMode = value } }
}

let owner: VideoEditInstance
let unregister: () => void
beforeEach(async () => {
  installHarnessNativeStorage()
  vi.stubGlobal('DragEvent', class extends MouseEvent {
    readonly dataTransfer: DataTransfer | null
    constructor(type: string, init: DragEventInit = {}) { super(type, init); this.dataTransfer = init.dataTransfer ?? null }
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, right: 1000, bottom: 350, width: 900, height: 300, x: 100, y: 50, toJSON: () => ({}) })
  owner = await createVideoEditTestProject()
  editVideoProject(owner.document.id, document => {
    const sequence = document.sequences[0]; const template = sequence.tracks[0]
    sequence.frameRate = { numerator: 60, denominator: 1 }
    sequence.tracks = Array.from({ length: 8 }, (_, index) => ({ ...template, id: `source-drop-track-${index}`, index, kind: index === 0 || index === 2 || index === 7 ? 'audio' as const : 'video' as const, height: 32, name: `轨道 ${index}` }))
    return document
  })
  appendVideoEditMedia(owner.document.id, { id: 'source-drop-media', name: '音画源', path: 'D:/source.mp4', kind: 'video', width: 1920, height: 1080, durationSeconds: 10, hasAudio: true })
  setVideoEditTimelineView(owner.document.id, { targetTrackIds: ['source-drop-track-7'] })
  unregister = registerVideoEditSourcePresenter(owner.document.id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  await updateVideoEditSource(owner.document.id, { itemId: owner.document.items[0].id, inUs: 500000, outUs: 1250000 })
})
afterEach(async () => {
  cleanup(); unregister?.()
  for (const instance of listVideoEditInstances()) await closeVideoEditProject(instance.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage()
})

for (const component of ['video', 'audio', 'linked'] as const) {
  for (const route of ['application', 'timeline'] as const) {
    it(`${component} 的真实源拖拽经 ${route} 落入指定轨道起点，保留入出点并一步撤销`, async () => {
      const { transfer, getData, protect } = sourceTransfer()
      writeVideoEditSourceDrag(transfer, owner.document.id, component)
      const sequence = getActiveVideoEditSequence(owner)
      const track = component === 'audio' ? 7 : 6
      const baseline = owner.document; const history = owner.past.length
      if (route === 'application') {
        expect(acceptsVideoEditDrop(transfer)).toBe(true)
        const ids = await dropVideoEditInput(owner.document.id, readVideoEditDrop(transfer), { frame: 0, track, mode: 'overwrite' }, undefined, { sequenceId: sequence.id, createSequenceWhenEmpty: true })
        expect(ids).toHaveLength(component === 'linked' ? 2 : 1)
      } else {
        const onError = vi.fn()
        const view = render(<VideoEditTimelineCanvas instance={owner} sequence={sequence} pixels={2} onError={onError} />)
        const host = view.getByRole('region', { name: '时间线编辑区域' })
        // V5 起初被视频区裁切；通过真实 Ctrl+滚轮滚入，仍以完整几何命中。
        if (component !== 'audio') fireEvent.wheel(host, { deltaY: -80, ctrlKey: true, clientX: 500, clientY: 98 })
        const rows = timelineLayout(sequence, { viewportHeight: 300, split: TIMELINE_DEFAULT_SPLIT, scroll: { video: component === 'audio' ? 0 : 80, audio: 0 } }).rows
        const row = rows.find(value => value.track.index === track)!
        const y = row.top + row.height / 2
        expect(timelineTrackAt(rows, y)?.track.index).toBe(track)
        expect(view.container.querySelector(`[data-track-index="${track}"]`)).not.toBeNull()
        const coordinates = { clientX: 100 + TIMELINE_HEADER_WIDTH + 0.1, clientY: 50 + y, dataTransfer: transfer }
        protect(true)
        expect(acceptsVideoEditDrop(transfer)).toBe(true)
        // 只有 preventDefault 后浏览器才会派发原生 drop。
        expect(fireEvent.dragOver(host, coordinates)).toBe(false)
        expect(transfer.dropEffect).toBe('copy')
        expect(getData).not.toHaveBeenCalled()
        expect(owner.document.sequences).toEqual(baseline.sequences)
        protect(false)
        await act(async () => { expect(fireEvent.drop(host, coordinates)).toBe(false) })
        expect(onError).not.toHaveBeenCalled()
      }
      const clips = getActiveVideoEditSequence(owner).clips
      expect(clips).toHaveLength(component === 'linked' ? 2 : 1)
      expect(clips.map(clip => clip.kind)).toEqual(component === 'linked' ? ['video', 'audio'] : [component])
      expect(clips.map(clip => clip.track)).toEqual(component === 'linked' ? [6, 7] : [track])
      for (const clip of clips) expect(clip).toMatchObject({ start: 0, duration: 45, sourceInUs: 500000, sourceComponent: clip.kind })
      if (component === 'linked') { expect(clips[0].linkId).toBeTruthy(); expect(clips[0].linkId).toBe(clips[1].linkId) }
      expect(owner.past).toHaveLength(history + 1)
      act(() => undoVideoEdit(owner.document.id))
      expect(owner.document.sequences).toEqual(baseline.sequences)
      expect(owner.past).toHaveLength(history)
    })
  }
}
