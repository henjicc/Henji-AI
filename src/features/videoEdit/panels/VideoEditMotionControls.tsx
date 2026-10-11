import { useEffect, useState, useSyncExternalStore } from 'react'
import { PanelTrigger, UiButton, UiGroup, Dropdown } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { CreativeIntentControls, CreativeIntentOverlay } from '@/features/creativeIntent'
import { type VideoEditInstance, setVideoEditView, getActiveVideoEditSequence } from '../application/videoEditService'
import { videoEditClipPictureSize, videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { mergeMotionClipCurves, motionClipPose } from '@/core/videoEdit/motionDraft'
import { subscribeVideoMotion, videoMotionRevision, videoMotionState, startVideoMotion, stopVideoMotion, pauseVideoMotion, resumeVideoMotion, optimizeVideoMotion, applyVideoMotion, configureVideoMotion, setVideoMotionOptions, setVideoMotionIntent, pinVideoMotionFrame, cancelVideoMotionOptimization, previewVideoMotion, reopenVideoMotion, configureVideoMotionConstraints, organizeVideoMotionAnnotation } from '../application/videoEditMotionDraft'

export function VideoEditMotionControls({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoMotion, videoMotionRevision)
  const state = videoMotionState(owner); const id = owner.document.id
  const [capture, setCapture] = useState<'place' | 'record'>('place')
  const [open, setOpen] = useState(false)
  useEffect(() => { if (state?.reviewRequest) setOpen(true) }, [state?.reviewRequest, state?.draft.id])
  const sequence = getActiveVideoEditSequence(owner)
  const clip = sequence.clips.find(c => c.id === owner.selection)
  const [annotationId, setAnnotationId] = useState('')
  const [role, setRole] = useState<'path' | 'target' | 'dwell' | 'text'>('path')
  const [span, setSpan] = useState<[number, number] | undefined>()
  const chosenMark = sequence.annotations.find(a => a.id === annotationId)
  const interval: [number, number] = span ?? [chosenMark?.frame ?? clip?.start ?? 0, chosenMark?.endFrame ?? (clip ? clip.start + clip.duration - 1 : 0)]
  const run = (operation: () => void | Promise<void>): void => { try { void Promise.resolve(operation()).catch(onError) } catch (error) { onError(error) } }
  const lastDraft = owner.document.creativeIntents?.drafts.at(-1)
  return <PanelTrigger open={open} onOpenChange={setOpen} display={state?.status === 'recording' ? '正在示范' : '超级关键帧'} appearance="quiet" size="sm" buttonClassName="w-auto" alignment="aboveCenter" gap={8} surface="glass" panelPadding="content" panelWidth="content" renderPanel={() => <>
    {!state && lastDraft && <UiButton onClick={() => run(() => reopenVideoMotion(id, lastDraft.id))}>继续上次原稿</UiButton>}
    <UiGroup title="标注与参照" titleTone="compact">
      <Dropdown label="使用标注" value={annotationId} options={sequence.annotations.filter(a => a.status !== 'resolved' && (!a.clipId || a.clipId === clip?.id)).map(a => ({ value: a.id, label: a.text }))} onSelect={value => { setAnnotationId(value); setSpan(undefined) }} />
      {chosenMark && <>
        <Dropdown label="标注含义" value={role} options={[{ value: 'path', label: '沿箭头方向' }, { value: 'target', label: '到达圈内' }, { value: 'dwell', label: '在圈内停留' }, { value: 'text', label: '文字意图提示' }]} onSelect={setRole} />
        <NumberInput label="开始帧" value={interval[0]} min={clip?.start ?? 0} max={clip ? clip.start + clip.duration - 1 : 0} step={1} onChange={value => setSpan([value, interval[1]])} />
        <NumberInput label="结束帧" value={interval[1]} min={interval[0]} max={clip ? clip.start + clip.duration - 1 : 0} step={1} onChange={value => setSpan([interval[0], value])} />
        <UiButton disabled={state?.status === 'optimizing' || !clip} onClick={() => run(() => organizeVideoMotionAnnotation(id, annotationId, role, interval))}>按标注整理</UiButton>
      </>}
      <Dropdown label="相对参照" value={state?.constraints?.reference?.clip.id ?? ''} display={state?.constraints?.reference?.clip.name ?? '选择另一个元素'} options={sequence.clips.filter(c => c.id !== clip?.id && c.kind !== 'audio' && c.kind !== 'adjustment').map(c => ({ value: c.id, label: c.name }))} disabled={state?.status === 'optimizing'} onSelect={referenceId => run(async () => { if (!state) await startVideoMotion(id, capture); await configureVideoMotionConstraints(id, { referenceId }) })} />
      {state?.constraints?.reference && <Dropdown label="保持偏移" value={state.constraints.reference.mode} options={[{ value: 'local', label: '随参照旋转和缩放' }, { value: 'composition', label: '保持画面方向和距离' }]} onSelect={referenceMode => run(() => configureVideoMotionConstraints(id, { referenceId: state.constraints!.reference!.clip.id, referenceMode }))} />}
      {state?.constraints?.reference && <span className="text-xs text-text3">应用到当前区间；参照再变化时需重新整理。</span>}
      {state?.constraints && <UiButton disabled={state.status === 'optimizing'} onClick={() => run(() => configureVideoMotionConstraints(id, { clear: true }))}>清除标注与参照约束</UiButton>}
    </UiGroup>
    <CreativeIntentControls intent={state?.intent?.kind === 'overshoot' ? 'overshoot' : state?.intent?.kind === 'spring_settle' ? 'spring' : state?.intent?.kind === 'bounce' ? 'bounce' : state?.intent?.kind === 'orbit' ? 'orbit' : state?.intent?.kind === 'cycle' && state.intent.mode === 'pingpong' ? 'pingpong' : 'path'} status={state?.status ?? 'idle'} capture={state?.capture ?? capture} candidates={state?.candidates ?? []} selected={state?.preview ?? 'original'} fidelity={state?.draft.fidelity ?? .5} mode={state?.mode ?? 'navigate'} speed={state?.speed ?? 1} property={state?.property ?? 'position'}
      message={state?.message} needsSave={state?.draft.applications.some(a => !a.saved)} canPin={Boolean(state?.presentation && state.draft.takes.length)} pins={state?.draft.pins.map((p, i) => ({ id: p.id, label: `姿态 ${i + 1}` })) ?? []}
      takes={state?.draft.takes.map((t, i) => ({ id: t.id, label: `第 ${i + 1} 次示范`, selected: !state.selectedTakeIds || state.selectedTakeIds.includes(t.id) })) ?? []}
      onStart={() => run(() => startVideoMotion(id, capture))} onStop={() => run(() => stopVideoMotion(id))} onPause={() => pauseVideoMotion(id)} onResume={() => resumeVideoMotion(id)} onCancel={() => cancelVideoMotionOptimization(id)}
      onOptimize={() => run(() => optimizeVideoMotion(id))} onApply={() => run(() => applyVideoMotion(id))} onPreview={candidate => run(() => previewVideoMotion(id, candidate))}
      onFidelity={fidelity => run(async () => { await configureVideoMotion(id, { fidelity }); await optimizeVideoMotion(id) })}
      onPin={() => { if (state?.presentation) run(() => pinVideoMotionFrame(id, state.presentation!.frame)) }} onPinEnd={() => run(() => pinVideoMotionFrame(id, 'end'))}
      onUnpin={unpinId => run(async () => { await configureVideoMotion(id, { unpinId }); await optimizeVideoMotion(id) })}
      onTake={takeId => run(() => configureVideoMotion(id, { selectedTakeIds: [takeId] }))}
      onMode={mode => setVideoMotionOptions(id, { mode })} onSpeed={speed => setVideoMotionOptions(id, { speed })} onProperty={property => setVideoMotionOptions(id, { property })}
      onCapture={value => { setCapture(value); setVideoMotionOptions(id, { capture: value }) }}
      onIntent={value => run(() => setVideoMotionIntent(id, value))}
      onPlay={() => run(async () => { if (state) await previewVideoMotion(id, state.preview); const candidate = state?.preview === 'original' ? state.original : state?.candidates.find(c => c.id === state.preview); const start = candidate?.motions[0]?.range[0]; const frame = start === undefined ? state?.endpoints?.[0]?.timeline?.frame ?? owner.frame : start + getActiveVideoEditSequence(owner).clips.find(c => `${id}:${c.id}` === state?.draft.targets[0].ref.id)!.start; setVideoEditView(id, { frame, playing: true, playbackDirection: 1 }) })} />
  </>} />
}
export function VideoEditMotionOverlay({ owner }: { owner: VideoEditInstance }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoMotion, videoMotionRevision)
  const state = videoMotionState(owner); if (!state) return null
  const document = getActiveVideoEditSequence(owner)
  const target = document.clips.find(c => `${owner.document.id}:${c.id}` === state.draft.targets[0].ref.id); if (!target) return null
  const picture = videoEditClipPictureSize(document, target)
  if (state.preview === 'base') return null
  const candidate = state.preview === 'original' ? state.original : state.candidates.find(c => c.id === state.preview)
  const originalPoses = [...state.recent, ...(state.pinnedSamples ?? []).filter(s => !state.recent.some(recent => recent.sampleId === s.sampleId))].sort((a, b) => a.seq - b.seq)
  let poses = originalPoses.map((s, i) => ({ pose: s.pose, pinned: state.draft.pins.some(p => p.sampleId === s.sampleId), breakBefore: i === 0 || s.seq > originalPoses[i - 1].seq + 1 || s.takeRef !== originalPoses[i - 1].takeRef || s.timeline?.visitRef !== originalPoses[i - 1].timeline?.visitRef }))
  if (candidate && state.status === 'reviewing') {
    const currentFrame = (state.presentation?.frame ?? owner.frame) - target.start
    const motion = candidate.motions.find(m => currentFrame >= m.range[0] && currentFrame <= m.range[1]) ?? candidate.motions[0]
    if (motion) {
      const projected = mergeMotionClipCurves(target, [motion]); poses = []
      const frames = new Set<number>([motion.range[0], motion.range[1]])
      for (const sample of state.pinnedSamples ?? []) if (sample.timeline && sample.timeline.frame - target.start >= motion.range[0] && sample.timeline.frame - target.start <= motion.range[1]) frames.add(sample.timeline.frame - target.start)
      for (let frame = motion.range[0]; frame <= motion.range[1]; frame += Math.max(1, Math.ceil((motion.range[1] - motion.range[0]) / 96))) frames.add(frame)
      for (const frame of [...frames].sort((a, b) => a - b)) poses.push({ pose: motionClipPose(projected, frame + target.start), pinned: (state.pinnedSamples ?? []).some(s => s.timeline?.frame === frame + target.start), breakBefore: frame === motion.range[0] })
    }
  }
  return <CreativeIntentOverlay ghosts={poses.map(s => {
    const placement = { ...target, x: s.pose.position[0] - .5, y: s.pose.position[1] - .5, scale: s.pose.scaleXY[0], rotation: s.pose.rotationTurns * 360, anchorX: s.pose.pivot[0], anchorY: s.pose.pivot[1] }
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]): [number, number] => { const point = videoEditClipToFrame(placement, picture, document, u, v); return [point.x, point.y] })
    return { position: s.pose.position, turns: s.pose.rotationTurns, scale: s.pose.scaleXY[0], pinned: s.pinned, breakBefore: s.breakBefore, corners }
  })} />
}
