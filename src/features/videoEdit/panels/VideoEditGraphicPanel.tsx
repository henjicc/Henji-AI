import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { Dropdown, UiEmpty, UiError, UiFormRow, UiGroup, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import type { VideoEditGraphic } from '@/core/videoEdit/graphics'
import { readVideoEditGraphicEditor, type VideoEditGraphicEditorState, type VideoEditGraphicTarget } from '../application/videoEditCodeParameters'
import { createVideoEditGraphicObject, deleteVideoEditGraphicObjects, renameVideoEditGraphicObject, reorderVideoEditGraphicObjects, type VideoEditGraphicClipTarget } from '../application/videoEditGraphics'
import { requireVideoEditInstance, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditParameterFields } from './CodeParameterPanel'
import { videoEditParameterTargetIdentity } from './useCodeParameterGesture'

const objectKinds = { rect: '矩形', ellipse: '椭圆', text: '文字' } as const
const objectOptions = [{ value: 'rect', label: '矩形' }, { value: 'ellipse', label: '椭圆' }, { value: 'text', label: '原生文字' }] as const
interface Props extends VideoEditGraphicClipTarget { onError: (reason: unknown) => void }

function GraphicObjectName({ owner, target, name, onError }: { owner: VideoEditInstance; target: VideoEditGraphicTarget; name: string; onError: Props['onError'] }): React.ReactElement {
  const [draft, setDraft] = useState(name)
  const changed = useRef(false)
  const mounted = useRef(true)
  useLayoutEffect(() => {
    mounted.current = true; changed.current = false; setDraft(name)
    return () => { mounted.current = false; changed.current = false }
  }, [owner, name])
  const commit = (): void => {
    if (!mounted.current || !changed.current) return
    changed.current = false
    try {
      if (requireVideoEditInstance(target.projectId) !== owner) return
      if (draft !== name) renameVideoEditGraphicObject(target, draft)
    } catch (error) { setDraft(name); onError(error) }
  }
  return <UiInput aria-label="图形对象名称" value={draft} maxLength={200} onChange={event => { changed.current = true; setDraft(event.target.value) }} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); event.currentTarget.blur() }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); changed.current = false; setDraft(name) }
  }} />
}

function GraphicObjects({ owner, target, graphic, onError }: { owner: VideoEditInstance; target: VideoEditGraphicClipTarget; graphic: VideoEditGraphic; onError: Props['onError'] }): React.ReactElement {
  const [selectedId, setSelectedId] = useState(graphic.objects.at(-1)?.id ?? '')
  const objects = graphic.objects
  const selected = objects.find(object => object.id === selectedId) ?? objects.at(-1)
  const selectedIndex = selected ? objects.findIndex(object => object.id === selected.id) : -1
  const rows = useMemo(() => [...objects].reverse(), [objects])
  const run = (operation: () => void): void => { try { if (requireVideoEditInstance(target.projectId) === owner) operation() } catch (error) { onError(error) } }
  const move = (direction: -1 | 1): void => run(() => {
    const nextIndex = selectedIndex + direction
    if (!selected || nextIndex < 0 || nextIndex >= objects.length) return
    const ids = objects.map(object => object.id)
    const previous = ids[selectedIndex]
    ids[selectedIndex] = ids[nextIndex]; ids[nextIndex] = previous
    reorderVideoEditGraphicObjects(target, ids)
  })
  let editor: VideoEditGraphicEditorState | undefined
  let error: unknown
  if (selected) {
    try { editor = readVideoEditGraphicEditor(target.projectId, target.sequenceId, target.clipId, selected.id) } catch (reason) { error = reason }
  }
  return <>
    <UiGroup title="图形对象" divided data-video-edit-graphic-objects={target.clipId} actions={<Dropdown<'rect' | 'ellipse' | 'text'> ariaLabel="添加图形对象" display="添加对象" disabled={objects.length >= 32} options={[...objectOptions]} onSelect={kind => run(() => setSelectedId(createVideoEditGraphicObject(target, { kind })))} />}>
      {rows.length ? <div className="flex flex-col gap-1" aria-label="图形对象层级">{rows.map(object => <UiOptionButton key={object.id} variant="menu" active={object.id === selected?.id} aria-label={`选择图形对象${object.name}`} aria-pressed={object.id === selected?.id} data-video-edit-graphic-object={object.id} className="w-full min-w-0 justify-between gap-2 text-xs" onPointerDown={event => { if (event.button === 0) setSelectedId(object.id) }} onClick={() => setSelectedId(object.id)}><span className="truncate">{object.name}</span><span className="shrink-0 text-2xs text-text-muted">{objectKinds[object.kind]}</span></UiOptionButton>)}</div> : <UiEmpty title="此图形暂无对象" description="添加矩形、椭圆或文字以创作画面。" />}
      {selected && <>
        <UiFormRow label="对象名称"><GraphicObjectName key={videoEditParameterTargetIdentity({ ...target, objectId: selected.id })} owner={owner} target={{ ...target, objectId: selected.id }} name={selected.name} onError={onError} /></UiFormRow>
        <div className="flex items-center gap-1">
          <UiIconButton size="lg" title="上移对象" aria-label="上移图形对象" disabled={selectedIndex >= objects.length - 1} onClick={() => move(1)}><ArrowUp size={16} /></UiIconButton>
          <UiIconButton size="lg" title="下移对象" aria-label="下移图形对象" disabled={selectedIndex <= 0} onClick={() => move(-1)}><ArrowDown size={16} /></UiIconButton>
          <UiIconButton size="lg" title="删除对象" aria-label="删除图形对象" onClick={() => run(() => { deleteVideoEditGraphicObjects(target, [selected.id]); setSelectedId(objects[selectedIndex - 1]?.id ?? objects[selectedIndex + 1]?.id ?? '') })}><Trash2 size={16} /></UiIconButton>
        </div>
      </>}
    </UiGroup>
    {editor ? <VideoEditParameterFields key={videoEditParameterTargetIdentity(editor.target)} editor={editor} onError={onError} /> : error ? <UiError title="对象参数暂不可用" message={error instanceof Error ? error.message : '请重新选择图形对象。'} /> : null}
  </>
}

export function VideoEditGraphicPanel({ projectId, sequenceId, clipId, onError }: Props): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  let owner: VideoEditInstance | undefined
  let unavailable: unknown
  try { owner = requireVideoEditInstance(projectId) } catch (error) { unavailable = error }
  const document = owner?.document
  const graphic = useMemo(() => document?.sequences.find(sequence => sequence.id === sequenceId)?.clips.find(clip => clip.id === clipId)?.graphic, [document, sequenceId, clipId])
  return owner && graphic ? <GraphicObjects key={JSON.stringify([projectId, sequenceId, clipId])} owner={owner} target={{ projectId, sequenceId, clipId }} graphic={graphic} onError={onError} /> : <UiError title="图形暂不可用" message={unavailable instanceof Error ? unavailable.message : '请重新选择图形片段。'} />
}
