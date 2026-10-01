import { createVideoEditGraphic, orderVideoEditGraphicObjects } from '@/core/videoEdit/graphics'
import type { VideoEditGraphicObject } from '@/core/videoEdit/graphics'
import { editVideoSequence, requireVideoEditInstance } from './videoEditService'
import type { VideoEditGraphicTarget } from './videoEditCodeParameters'

export type VideoEditGraphicClipTarget = Omit<VideoEditGraphicTarget, 'objectId'>
function graphic(target: VideoEditGraphicClipTarget) {
  const value = requireVideoEditInstance(target.projectId).document.sequences.find(sequence => sequence.id === target.sequenceId)?.clips.find(clip => clip.id === target.clipId)?.graphic
  if (!value) throw new Error('原图形片段已移除，请重新选择。')
  return value
}
function edit(target: VideoEditGraphicClipTarget, change: (objects: VideoEditGraphicObject[]) => VideoEditGraphicObject[]): void {
  editVideoSequence(target.projectId, target.sequenceId, sequence => {
    const clip = sequence.clips.find(clip => clip.id === target.clipId)
    if (clip?.kind !== 'graphic' || !clip.graphic) throw new Error('原图形片段已移除，请重新选择。')
    clip.graphic.objects = change(clip.graphic.objects); return sequence
  })
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
