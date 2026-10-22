import { useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Diamond, RotateCcw } from 'lucide-react'
import { UiButton, UiError, UiLoading, UiFormRow, UiGroup, UiIconButton, UiSwitch } from '@/components/ui'
import { useVideoEditCodeMetadata } from './useVideoEditCodeMetadata'
import NumberInput from '@/components/ui/NumberInput'
import type { CodeElementOverrideKey, CodeElementOverrideValues } from '@/core/videoEdit/codeElementOverrides'
import { selectedVideoEditCodeElement, selectVideoEditCodeElement } from '../application/videoEditCodeElements'
import { readVideoEditCodeElementEdit, resetVideoEditCodeElement, toggleVideoEditCodeElementKeyframe, updateVideoEditCodeElement, videoEditCodeElementOverrideSummary, type VideoEditCodeElementTarget } from '../application/videoEditCodeElementEditing'
import { subscribeVideoEditView, videoEditViewRevision, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { useVideoEditTypographyGesture } from './useVideoEditTypographyGesture'

function CodeElementProperties({ target, onError }: { target: VideoEditCodeElementTarget; onError: (error: unknown) => void }): React.ReactElement {
  const current = readVideoEditCodeElementEdit(target)
  const identity = `${JSON.stringify(target)}:${JSON.stringify(current.time)}`
  const gesture = useVideoEditTypographyGesture(target.projectId, identity, onError)
  const write = (patch: CodeElementOverrideValues): void => { try { updateVideoEditCodeElement(target, patch, { gesture: gesture.handle.current, time: current.time }) } catch (error) { gesture.end(false); onError(error) } }
  const run = (operation: () => void): void => { try { gesture.end(true); operation() } catch (error) { onError(error) } }
  const fields: Array<[CodeElementOverrideKey, string, number, number]> = [['dx', '水平位移', -32768, 32768], ['dy', '垂直位移', -32768, 32768], ['scale', '整体比例', .001, 1024], ['scaleX', '水平比例', .001, 1024], ['scaleY', '垂直比例', .001, 1024], ['rotation', '旋转', -32768, 32768], ['opacity', '不透明度', 0, 1]]
  return <div className="flex flex-col gap-3">
    {fields.map(([key, label, min, max]) => <UiFormRow key={key} label={label} density="compact"><NumberInput size="sm" ariaLabel={`元素${label}`} value={Number(current.values[key] ?? (key === 'dx' || key === 'dy' || key === 'rotation' ? 0 : 1))} min={min} max={max} step={key.startsWith('scale') || key === 'opacity' ? .01 : 1} precision={2} widthClassName="w-20" onScrubStart={gesture.begin} onScrubEnd={cancelled => gesture.end(!cancelled)} onChange={value => write({ [key]: value })} /><UiIconButton size="xs" on={Boolean(current.override.curves?.[key])} aria-label={`元素${label}关键帧`} tooltip={`启用或关闭${label}关键帧`} onClick={() => run(() => toggleVideoEditCodeElementKeyframe(target, key))}><Diamond /></UiIconButton></UiFormRow>)}
    <UiFormRow label="显示" density="compact"><UiSwitch aria-label="显示元素" checked={!current.values.hidden} onCheckedChange={visible => write({ hidden: !visible })} /></UiFormRow>
  </div>
}
export function VideoEditCodeElementsPanel({ instance, clipId, onError }: { instance: VideoEditInstance; clipId: string; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision); useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const clip = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)?.clips.find(clip => clip.id === clipId)
  const selected = selectedVideoEditCodeElement(instance)
  const metadata = useVideoEditCodeMetadata(instance, clip?.code)
  const target = clip?.code ? { projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId, versionId: clip.code.versionId } : undefined
  const entries = target ? videoEditCodeElementOverrideSummary(target.projectId, target.sequenceId, clipId) : []
  const row = (index: number): React.ReactElement => { const value = entries[index]; return <div className="flex items-center gap-1"><UiButton size="sm" className="min-w-0 flex-1" disabled={!value.visible} onClick={() => selectVideoEditCodeElement(instance, clipId, value.elementId)}>{value.label}</UiButton><UiIconButton size="sm" aria-label={`重置${value.label}`} tooltip="清除该元素的覆盖" onClick={() => { try { resetVideoEditCodeElement({ ...target!, elementId: value.elementId }) } catch (error) { onError(error) } }}><RotateCcw /></UiIconButton></div> }
  return <UiGroup title="元素" titleTone="compact" divided>
    {metadata.error ? <UiError title="代码参数读取失败" message={metadata.error instanceof Error ? metadata.error.message : '请恢复源码文件后重试。'} onRetry={metadata.retry} /> : !metadata.ready ? <UiLoading message="正在读取代码参数…" /> : target && selected?.entry.clip.id === clipId && <CodeElementProperties key={`${target.versionId}:${selected.element.elementId}`} target={{ ...target, elementId: selected.element.elementId }} onError={onError} />}
    {entries.length > 0 && <div className="h-40"><Virtuoso totalCount={entries.length} itemContent={row} /></div>}
  </UiGroup>
}
