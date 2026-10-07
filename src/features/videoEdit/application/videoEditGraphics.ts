import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { createVideoEditGraphic, orderVideoEditGraphicObjects } from '@/core/videoEdit/graphics'
import type { VideoEditGraphicObject } from '@/core/videoEdit/graphics'
import { editVideoSequence, requireVideoEditInstance, type VideoEditGesture } from './videoEditService'
import type { VideoEditTextStyle } from '@/core/videoEdit/text'
import type { VideoEditGraphicTarget } from './videoEditCodeParameters'

export type VideoEditGraphicClipTarget = Omit<VideoEditGraphicTarget, 'objectId'>
function graphic(target: VideoEditGraphicClipTarget) {
  const value = requireVideoEditInstance(target.projectId).document.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(clip => clip.id === target.clipId)?.graphic
  if (!value) throw new Error('原图形片段已移除，请重新选择。')
  return value
}
function edit(target: VideoEditGraphicClipTarget, change: (objects: VideoEditGraphicObject[]) => VideoEditGraphicObject[], gesture?: VideoEditGesture): void {
  editVideoSequence(target.projectId, target.sequenceId, sequence => {
    const clip = sequence.clips.find(clip => clip.id === target.clipId)
    if (clip?.kind !== 'graphic' || !clip.graphic) throw new Error('原图形片段已移除，请重新选择。')
    assertVideoEditClipsEditable(sequence, [clip.id])
    clip.graphic.objects = change(clip.graphic.objects); return sequence
  }, gesture)
}
export function updateVideoEditGraphicObject(target: VideoEditGraphicTarget, patch: { textStyle?: VideoEditTextStyle; visible?: boolean }, gesture?: VideoEditGesture): void {
  edit(target, objects => {
    const object = objects.find(value => value.id === target.objectId)
    if (!object) throw new Error('原图形对象已移除。')
    if (patch.textStyle && object.kind !== 'text') throw new Error('请选择文字图层。')
    return objects.map(value => value === object ? { ...value, ...patch } : value)
  }, gesture)
}
export function createVideoEditGraphicObject(target: VideoEditGraphicClipTarget, input: { kind: 'rect' | 'ellipse' | 'text'; name?: string }): string {
  const value = graphic(target)
  const object = createVideoEditGraphic(input.kind, value.width, value.height).objects[0]
  if (input.name !== undefined) object.name = input.name
  edit(target, objects => [...objects, object]); return object.id
}
export function renameVideoEditGraphicObject(target: VideoEditGraphicTarget, name: string): void {
  edit(target, objects => {
    if (!objects.some(object => object.id === target.objectId)) throw new Error('原图形对象已移除。')
    return objects.map(object => object.id === target.objectId ? { ...object, name } : object)
  })
}
export function deleteVideoEditGraphicObjects(target: VideoEditGraphicClipTarget, ids: string[]): void {
  edit(target, objects => {
    if (!ids.length || ids.some(id => !objects.some(object => object.id === id))) throw new Error('原图形对象已移除。')
    return objects.filter(object => !ids.includes(object.id))
  })
}
export function reorderVideoEditGraphicObjects(target: VideoEditGraphicClipTarget, ids: string[]): void {
  edit(target, objects => orderVideoEditGraphicObjects(objects, ids))
}
