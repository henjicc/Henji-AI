import { requireVideoEditInstance, type VideoEditInstance } from './videoEditService'
import { videoEditSceneRecordRef } from './videoEditSceneFields'

/*
 * 片子数据记录的选择（视图状态，不进文档、不进撤销）：时间线子轨道、片子数据面板与宿主上下文共用这一份，
 * 用户在任一处点选的记录就是助手读到的“这一条”。选记录不清片段选择；用户之后在时间线上点选片段时由时间线清掉记录选择
 * （免得助手读到一条用户早已不在看的记录）。播放头自动选中片段这类跟随改选不清，否则跳转、播放会让刚选中的记录立刻失效。
 */
export interface VideoEditSceneSelection { readonly sceneId: string; readonly recordId: string }
const selections = new WeakMap<VideoEditInstance, VideoEditSceneSelection>()
const listeners = new Set<() => void>()
let selectionVersion = 0
function publish(): void { selectionVersion++; for (const listener of listeners) listener() }
export function subscribeVideoEditSceneSelection(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditSceneSelectionVersion(): number { return selectionVersion }

/** 当前选中的记录；记录或所在的片子数据已被删除（撤销、助手写入）时视为没有选择。 */
export function selectedVideoEditSceneRecord(instance: VideoEditInstance): VideoEditSceneSelection | undefined {
  const value = selections.get(instance)
  if (!value) return undefined
  if (!instance.document.scenes?.find(scene => scene.id === value.sceneId)?.records.some(record => record.id === value.recordId)) return undefined
  return { sceneId: value.sceneId, recordId: value.recordId }
}
/** 选中一条记录；传 null 取消。选择不变时不通知订阅者。 */
export function selectVideoEditSceneRecord(projectId: string, selection: VideoEditSceneSelection | null): void {
  const owner = requireVideoEditInstance(projectId)
  if (!selection) { if (selections.delete(owner)) publish(); return }
  const current = selections.get(owner)
  if (current?.sceneId === selection.sceneId && current.recordId === selection.recordId) return
  const scene = owner.document.scenes?.find(item => item.id === selection.sceneId)
  if (!scene?.records.some(record => record.id === selection.recordId)) throw new Error('原记录已删除，请重新选择。')
  selections.set(owner, { sceneId: selection.sceneId, recordId: selection.recordId })
  publish()
}
/** 宿主上下文 selectedRefs 单项的长度上限（hostContracts）：超长的引用不放进去，免得整份快照校验失败。 */
const MAX_REF_LENGTH = 500
/** 选中记录的稳定引用（宿主上下文的 selectedRefs 用）；没有选择或引用超长时 undefined。 */
export function videoEditSelectedSceneRecordRef(instance: VideoEditInstance): string | undefined {
  const selection = selectedVideoEditSceneRecord(instance)
  const record = selection && instance.document.scenes?.find(scene => scene.id === selection.sceneId)?.records.find(item => item.id === selection.recordId)
  if (!selection || !record) return undefined
  const ref = videoEditSceneRecordRef(instance.document.id, selection.sceneId, record)
  const text = `${ref.kind}:${ref.id}`
  return text.length <= MAX_REF_LENGTH ? text : undefined
}
