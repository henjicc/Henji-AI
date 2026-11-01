import { useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { RotateCcw } from 'lucide-react'
import { UiButton, UiError, UiLoading, UiIconButton } from '@/components/ui'
import { UI_PROPERTY_INSET_CLASS } from '@/components/ui/styleTokens'
import { EffectSection } from '@/components/effects/EffectSection'
import { useVideoEditCodeMetadata } from './useVideoEditCodeMetadata'
import { readSelectedVideoEditCodeElement, selectVideoEditCodeElement } from '../application/videoEditCodeElements'
import { videoEditCodeElementOverrideSummary, videoEditCodeElementWriter } from '../application/videoEditCodeElementEditing'
import { subscribeVideoEditView, videoEditViewRevision, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditCodeElementView } from './VideoEditCodeElementView'

const writer = videoEditCodeElementWriter('user')

/** 代码片段的元素：选中的元素（画面点选或从源码定位，调整层也在内）显示它的三块属性；下面列出有改动的元素，可选中或整个重置。 */
export function VideoEditCodeElementsPanel({ instance, clipId, onError }: { instance: VideoEditInstance; clipId: string; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision); useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const clip = instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)?.clips.find(clip => clip.id === clipId)
  const selected = readSelectedVideoEditCodeElement(instance)
  const metadata = useVideoEditCodeMetadata(instance, clip?.code)
  const target = clip?.code ? { projectId: instance.document.id, sequenceId: instance.activeSequenceId, clipId, versionId: clip.code.versionId } : undefined
  const entries = target ? videoEditCodeElementOverrideSummary(target.projectId, target.sequenceId, clipId) : []
  const chosen = target && selected?.entry.clip.id === clipId ? selected : undefined
  const row = (index: number): React.ReactElement => { const value = entries[index]; return <div className="flex items-center gap-1"><UiButton size="sm" className="min-w-0 flex-1" disabled={!value.visible} disabledReason="当前帧看不到这个元素" onClick={() => selectVideoEditCodeElement(instance, clipId, value.elementId)}>{value.label}</UiButton><UiIconButton size="sm" aria-label={`重置${value.label}`} tooltip="清除该元素的覆盖" onClick={() => { try { writer.resetVideoEditCodeElement({ ...target!, elementId: value.elementId }) } catch (error) { onError(error) } }}><RotateCcw /></UiIconButton></div> }
  return <EffectSection id="code-elements" title={chosen ? `元素：${chosen.label}` : '元素'}>
    {metadata.error ? <UiError title="代码参数读取失败" message={metadata.error instanceof Error ? metadata.error.message : '请恢复源码文件后重试。'} onRetry={metadata.retry} /> : !metadata.ready ? <UiLoading message="正在读取代码参数…" /> : target && chosen && <VideoEditCodeElementView key={`${target.versionId}:${chosen.element.elementId}`} target={{ ...target, elementId: chosen.element.elementId }} keys={chosen.parameterKeys} onError={onError} />}
    {entries.length > 0 && <div className={`h-40 ${UI_PROPERTY_INSET_CLASS}`}><Virtuoso totalCount={entries.length} itemContent={row} /></div>}
  </EffectSection>
}
