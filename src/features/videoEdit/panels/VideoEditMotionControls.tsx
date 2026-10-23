import { useRef, useState, useSyncExternalStore } from 'react'
import { PanelTrigger } from '@/components/ui'
import { CreativeIntentOverlay, SuperKeyframeRecordingControls } from '@/features/creativeIntent'
import { type VideoEditInstance, getActiveVideoEditSequence } from '../application/videoEditService'
import { videoEditClipPictureSize, videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { mergeMotionClipCurves, motionClipPose } from '@/core/videoEdit/motionDraft'
import { subscribeVideoMotion, videoMotionRevision, videoMotionState, reopenVideoMotion } from '../application/videoEditMotionDraft'
import { subscribeVideoExplanation, videoExplanationRevision, videoExplanationState } from '../application/videoEditExplanation'
import { configureSuperKeyframeMicrophone, finishSuperKeyframes, pauseSuperKeyframes, resumeSuperKeyframes, startSuperKeyframes, superKeyframeMicrophonePreference, removeSuperKeyframeTake } from '../application/videoEditSuperKeyframes'

export function VideoEditMotionControls({ owner, onError }: { owner: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoMotion, videoMotionRevision)
  useSyncExternalStore(subscribeVideoExplanation, videoExplanationRevision)
  const state = videoMotionState(owner), explanation = videoExplanationState(owner), id = owner.document.id
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  const working = useRef(false)
  const [microphone, setMicrophone] = useState(superKeyframeMicrophonePreference)
  const run = (operation: () => void | Promise<void>): void => {
    if (working.current) return
    working.current = true; setBusy(true); setError(undefined)
    void Promise.resolve().then(operation).catch(failure => { setError(failure instanceof Error ? failure.message : '操作失败，请重试。'); onError(failure) }).finally(() => { working.current = false; setBusy(false) })
  }
  const draft = state?.draft ?? owner.document.creativeIntents?.drafts.at(-1)
  const prepare = async (): Promise<void> => { if (!state && draft) await reopenVideoMotion(id, draft.id) }
  return <PanelTrigger open={open} onOpenChange={setOpen} display="超级关键帧" appearance="quiet" size="sm" buttonClassName="w-auto" alignment="aboveCenter" gap={8} panelPadding="content" panelSize="compact" renderPanel={() => <SuperKeyframeRecordingControls
    status={state?.status ?? 'idle'} busy={busy || Boolean(explanation?.busy)} message={error ?? state?.message ?? explanation?.message}
    microphone={microphone.enabled}
    onMicrophone={enabled => run(async () => { await configureSuperKeyframeMicrophone(id, enabled); setMicrophone({ ...microphone, enabled }) })}
    takes={draft?.takes.map((take, index) => ({ id: take.id, label: `第 ${index + 1} 段 · ${((take.monoSpanUs[1] - take.monoSpanUs[0]) / 1_000_000).toFixed(1)} 秒` })) ?? []}
    onStart={() => run(async () => { await prepare(); await startSuperKeyframes(id) })} onPause={() => run(() => pauseSuperKeyframes(id))} onResume={() => run(() => resumeSuperKeyframes(id))}
    onFinish={() => run(() => finishSuperKeyframes(id))} onHandoff={() => run(async () => { await prepare(); await finishSuperKeyframes(id) })}
    onRemove={takeId => run(() => removeSuperKeyframeTake(id, draft!.id, takeId))}
  />} />
}
export function VideoEditMotionOverlay({ owner }: { owner: VideoEditInstance }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoMotion, videoMotionRevision)
  const state = videoMotionState(owner); if (!state) return null
  const document = getActiveVideoEditSequence(owner)
  const target = document.clips.find(c => `${owner.document.id}:${c.id}` === (state.activeTargetId ?? state.draft.targets[0].ref.id)); if (!target) return null
  const picture = videoEditClipPictureSize(document, target)
  if (state.preview === 'base') return null
  const candidate = state.preview === 'original' ? state.original : state.candidates.find(c => c.id === state.preview)
  const originalPoses = [...state.recent.filter(sample => sample.targetRef.id === `${owner.document.id}:${target.id}`), ...(state.pinnedSamples ?? []).filter(s => !state.recent.some(recent => recent.sampleId === s.sampleId))].sort((a, b) => a.seq - b.seq)
  let poses = originalPoses.map((s, i) => ({ pose: s.pose, pinned: state.draft.pins.some(p => p.sampleId === s.sampleId), breakBefore: i === 0 || s.seq > originalPoses[i - 1].seq + 1 || s.takeRef !== originalPoses[i - 1].takeRef || s.timeline?.visitRef !== originalPoses[i - 1].timeline?.visitRef }))
  if (candidate && state.status === 'reviewing') {
    const currentFrame = (state.presentation?.frame ?? owner.frame) - target.start
    const motions = candidate.motions.filter(motion => state.takeTargets?.[motion.takeId] === `${owner.document.id}:${target.id}`)
    const motion = motions.find(m => currentFrame >= m.range[0] && currentFrame <= m.range[1]) ?? motions[0]
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
