import { prepareVideoExplanationGeneration, runVideoExplanationGeneration } from '../application/videoEditExplanation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelTrigger, UiButton, UiGroup, UiFormRow, UiSwitch, Dropdown } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { CreativeIntentControls, CreativeIntentOverlay } from '@/features/creativeIntent'
import { type VideoEditInstance, setVideoEditView, getActiveVideoEditSequence } from '../application/videoEditService'
import { videoEditClipPictureSize, videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { mergeMotionClipCurves, motionClipPose } from '@/core/videoEdit/motionDraft'
import { videoStaggerSource, staggerVideoMotion } from '../application/videoEditMotionDraft'
import { staggerMotionRange } from '@/core/creativeIntent/stagger'
import { subscribeVideoMotion, videoMotionRevision, videoMotionState, startVideoMotion, stopVideoMotion, pauseVideoMotion, resumeVideoMotion, optimizeVideoMotion, applyVideoMotion, configureVideoMotion, setVideoMotionOptions, setVideoMotionIntent, pinVideoMotionFrame, cancelVideoMotionOptimization, previewVideoMotion, reopenVideoMotion, configureVideoMotionConstraints, organizeVideoMotionAnnotation } from '../application/videoEditMotionDraft'

export function VideoEditMotionControls({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  const { t } = useTranslation('ui')
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
  const [staggerFrames, setStaggerFrames] = useState(4)
  const staggerSource = videoStaggerSource(owner)
  const annotations = sequence.annotations.filter(mark => mark.status !== 'resolved' && (!mark.clipId || mark.clipId === clip?.id))
  const references = sequence.clips.filter(item => item.id !== clip?.id && item.kind !== 'audio' && item.kind !== 'adjustment')
  return <PanelTrigger open={open} onOpenChange={setOpen} display={state?.status === 'recording' ? t('creativeIntent.recording', { defaultValue: '正在示范' }) : t('creativeIntent.title', { defaultValue: '超级关键帧' })} appearance="quiet" size="sm" buttonClassName="w-auto" alignment="aboveCenter" gap={8} surface="glass" panelPadding="content" panelWidth="content" renderPanel={() => <CreativeIntentControls referenceControls={<>
    {!state && lastDraft && <UiFormRow label="" density="compact" labelColumn="panel"><UiButton size="sm" variant="quiet" className="w-full" onClick={() => run(() => reopenVideoMotion(id, lastDraft.id))}>{t('creativeIntent.reopen', { defaultValue: '继续上次原稿' })}</UiButton></UiFormRow>}
    {staggerSource && <UiGroup title={t('creativeIntent.stagger', { defaultValue: '依次错开' })} titleTone="compact">
      <UiFormRow label={t('creativeIntent.staggerFrames', { defaultValue: '错开帧数' })} density="compact" labelColumn="panel"><NumberInput ariaLabel={t('creativeIntent.staggerFrames', { defaultValue: '错开帧数' })} size="sm" value={staggerFrames} min={0} step={1} onChange={setStaggerFrames} /></UiFormRow>
      <UiFormRow label="" density="compact" labelColumn="panel"><UiButton variant="quiet" size="sm" className="w-full" onClick={() => run(() => { const range: [number, number] = owner.inFrame !== null && owner.outFrame !== null ? [Math.max(0, owner.inFrame - staggerSource.start), Math.min(staggerSource.duration - 1, owner.outFrame - staggerSource.start)] : staggerMotionRange(staggerSource)!; staggerVideoMotion(id, sequence.id, staggerSource.id, owner.selectedClipIds.filter(targetId => targetId !== staggerSource.id && sequence.clips.some(target => target.id === targetId && target.kind !== 'audio' && target.kind !== 'adjustment')), range, staggerFrames) })}>{t('creativeIntent.applySelected', { defaultValue: '应用到所选' })}</UiButton></UiFormRow>
    </UiGroup>}
    <UiGroup title={t('creativeIntent.reference', { defaultValue: '参照' })} titleTone="compact" divided={Boolean(staggerSource)}>
      <UiFormRow label={t('creativeIntent.snapLabel', { defaultValue: '吸附节拍' })} density="compact" labelColumn="panel"><div className="flex min-h-control-sm justify-end items-center"><UiSwitch aria-label={t('creativeIntent.snapAria', { defaultValue: '吸附到节拍' })} checked={clip?.snapToBeat ?? false} disabled={!clip || state?.status === 'optimizing'} onCheckedChange={value => run(() => { updateVideoEditClipProperties(id, sequence.id, clip!.id, { snapToBeat: value }) })} /></div></UiFormRow>
      <UiFormRow label={t('creativeIntent.annotation', { defaultValue: '使用标注' })} density="compact" labelColumn="panel"><Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.annotation', { defaultValue: '使用标注' })} value={annotations.some(mark => mark.id === annotationId) ? annotationId : ''} options={[{ value: '', label: t('creativeIntent.unused', { defaultValue: '不使用' }) }, ...annotations.map(mark => ({ value: mark.id, label: mark.text }))]} disabled={!annotations.length || state?.status === 'optimizing'} onSelect={value => { setAnnotationId(value); setSpan(undefined) }} /></UiFormRow>
      {chosenMark && <>
        <UiFormRow label={t('creativeIntent.annotationRole', { defaultValue: '标注含义' })} density="compact" labelColumn="panel"><Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.annotationRole', { defaultValue: '标注含义' })} value={role} options={[{ value: 'path', label: t('creativeIntent.arrow', { defaultValue: '沿箭头方向' }) }, { value: 'target', label: t('creativeIntent.target', { defaultValue: '到达圈内' }) }, { value: 'dwell', label: t('creativeIntent.dwell', { defaultValue: '在圈内停留' }) }, { value: 'text', label: t('creativeIntent.textIntent', { defaultValue: '文字意图提示' }) }]} onSelect={setRole} /></UiFormRow>
        <UiFormRow label={t('creativeIntent.startFrame', { defaultValue: '开始帧' })} density="compact" labelColumn="panel"><NumberInput ariaLabel={t('creativeIntent.startFrame', { defaultValue: '开始帧' })} size="sm" value={interval[0]} min={clip?.start ?? 0} max={clip ? clip.start + clip.duration - 1 : 0} step={1} onChange={value => setSpan([value, interval[1]])} /></UiFormRow>
        <UiFormRow label={t('creativeIntent.endFrame', { defaultValue: '结束帧' })} density="compact" labelColumn="panel"><NumberInput ariaLabel={t('creativeIntent.endFrame', { defaultValue: '结束帧' })} size="sm" value={interval[1]} min={interval[0]} max={clip ? clip.start + clip.duration - 1 : 0} step={1} onChange={value => setSpan([interval[0], value])} /></UiFormRow>
        <UiFormRow label="" density="compact" labelColumn="panel"><UiButton variant="quiet" size="sm" className="w-full" disabled={state?.status === 'optimizing' || !clip} onClick={() => run(() => organizeVideoMotionAnnotation(id, annotationId, role, interval))}>{t('creativeIntent.organizeAnnotation', { defaultValue: '按标注整理' })}</UiButton></UiFormRow>
      </>}
      <UiFormRow label={t('creativeIntent.relative', { defaultValue: '相对参照' })} density="compact" labelColumn="panel"><Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.relative', { defaultValue: '相对参照' })} value={state?.constraints?.reference?.clip.id ?? ''} options={[{ value: '', label: t('creativeIntent.unused', { defaultValue: '不使用' }) }, ...references.map(item => ({ value: item.id, label: item.name }))]} disabled={state?.status === 'optimizing'} onSelect={referenceId => run(async () => { if (!state && !referenceId) return; if (!state) await startVideoMotion(id, capture); await configureVideoMotionConstraints(id, { referenceId }) })} /></UiFormRow>
      {state?.constraints?.reference && <UiFormRow label={t('creativeIntent.offset', { defaultValue: '保持偏移' })} density="compact" labelColumn="panel" hint={t('creativeIntent.referenceHint', { defaultValue: '应用到当前区间；参照再变化时需重新整理。' })}><Dropdown size="sm" appearance="field" className="w-full" buttonClassName="w-full" minWidthStrategy="none" ariaLabel={t('creativeIntent.offset', { defaultValue: '保持偏移' })} value={state.constraints.reference.mode} options={[{ value: 'local', label: t('creativeIntent.localReference', { defaultValue: '随参照旋转和缩放' }) }, { value: 'composition', label: t('creativeIntent.compositionReference', { defaultValue: '保持画面方向和距离' }) }]} onSelect={referenceMode => run(() => configureVideoMotionConstraints(id, { referenceId: state.constraints!.reference!.clip.id, referenceMode }))} /></UiFormRow>}
      {state?.constraints && <UiFormRow label="" density="compact" labelColumn="panel"><UiButton variant="quiet" size="sm" className="w-full" disabled={state.status === 'optimizing'} onClick={() => run(() => { setAnnotationId(''); setSpan(undefined); return configureVideoMotionConstraints(id, { clear: true }) })}>{t('creativeIntent.clearConstraints', { defaultValue: '清除标注与参照约束' })}</UiButton></UiFormRow>}
    </UiGroup>
  </>} intent={state?.intent?.kind === 'overshoot' ? 'overshoot' : state?.intent?.kind === 'spring_settle' ? 'spring' : state?.intent?.kind === 'bounce' ? 'bounce' : state?.intent?.kind === 'orbit' ? 'orbit' : state?.intent?.kind === 'cycle' && state.intent.mode === 'pingpong' ? 'pingpong' : 'path'} status={state?.status ?? 'idle'} capture={state?.capture ?? capture} candidates={state?.candidates ?? []} selected={state?.preview ?? 'original'} fidelity={state?.draft.fidelity ?? .5} mode={state?.mode ?? 'navigate'} speed={state?.speed ?? 1} property={state?.property ?? 'position'}
      message={state?.message} needsSave={state?.draft.applications.some(a => !a.saved)} canPin={Boolean(state?.presentation && state.draft.takes.length)} pins={state?.draft.pins.map((p, i) => ({ id: p.id, label: t('creativeIntent.pose', { defaultValue: '姿态 {{count}}', count: i + 1 }) })) ?? []}
      takes={state?.draft.takes.map((take, i) => ({ id: take.id, label: t('creativeIntent.take', { defaultValue: '第 {{count}} 次示范', count: i + 1 }), selected: !state.selectedTakeIds || state.selectedTakeIds.includes(take.id) })) ?? []}
      onStart={() => run(() => startVideoMotion(id, capture))} onStop={() => run(() => stopVideoMotion(id))} onPause={() => pauseVideoMotion(id)} onResume={() => resumeVideoMotion(id)} onCancel={() => cancelVideoMotionOptimization(id)}
      contextKey={`${id}:${state?.draft.id}`} prepareGeneration={() => prepareVideoExplanationGeneration(id)} onError={onError}
      onOptimize={() => runVideoExplanationGeneration(id, () => optimizeVideoMotion(id))} onApply={() => run(() => applyVideoMotion(id))} onPreview={candidate => run(() => previewVideoMotion(id, candidate))}
      onFidelity={fidelity => run(async () => { await configureVideoMotion(id, { fidelity }); await optimizeVideoMotion(id) })}
      onPin={() => { if (state?.presentation) run(() => pinVideoMotionFrame(id, state.presentation!.frame)) }} onPinEnd={() => run(() => pinVideoMotionFrame(id, 'end'))}
      onUnpin={unpinId => run(async () => { await configureVideoMotion(id, { unpinId }); await optimizeVideoMotion(id) })}
      onTake={takeId => run(() => configureVideoMotion(id, { selectedTakeIds: [takeId] }))}
      onMode={mode => setVideoMotionOptions(id, { mode })} onSpeed={speed => setVideoMotionOptions(id, { speed })} onProperty={property => setVideoMotionOptions(id, { property })}
      onCapture={value => { setCapture(value); setVideoMotionOptions(id, { capture: value }) }}
      onIntent={value => run(() => setVideoMotionIntent(id, value))}
      onPlay={() => run(async () => { if (state) await previewVideoMotion(id, state.preview); const candidate = state?.preview === 'original' ? state.original : state?.candidates.find(c => c.id === state.preview); const start = candidate?.motions[0]?.range[0]; const frame = start === undefined ? state?.endpoints?.[0]?.timeline?.frame ?? owner.frame : start + getActiveVideoEditSequence(owner).clips.find(c => `${id}:${c.id}` === state?.draft.targets[0].ref.id)!.start; setVideoEditView(id, { frame, playing: true, playbackDirection: 1 }) })} />
  } />
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
