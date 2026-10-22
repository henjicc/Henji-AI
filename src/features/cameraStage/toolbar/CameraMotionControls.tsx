import { useEffect, useState, useSyncExternalStore } from 'react'
import { PanelTrigger } from '@/components/ui'
import { CreativeIntentControls } from '@/features/creativeIntent'
import { createLogger } from '@/core/logging'
import { useCameraStageStore } from '../store/cameraStageStore'
import { cameraMotionDraft, cameraMotionRevision, subscribeCameraMotion, startCameraMotion, setCameraMotionProperty, setCameraMotionStatus, organizeCameraMotion, previewCameraMotion, applyCameraMotion, pinCameraMotion, clearCameraMotionPreview, type CameraMotionProperty } from '../application/cameraMotionDraft'

const logger = createLogger('cameraStage.motionControls')

export function CameraMotionControls(): React.ReactElement {
  useSyncExternalStore(subscribeCameraMotion, cameraMotionRevision)
  const projectId = useCameraStageStore(state => state.currentProjectId)
  const activeCameraId = useCameraStageStore(state => state.activeCameraId)
  const selectedId = useCameraStageStore(state => state.selectedId)
  const objects = useCameraStageStore(state => state.objects)
  const time = useCameraStageStore(state => state.playback.currentTime)
  const [property, setProperty] = useState<CameraMotionProperty>('position')
  const [message, setMessage] = useState<string>()
  const draft = projectId ? cameraMotionDraft(projectId) : undefined
  useEffect(() => () => { if (projectId) clearCameraMotionPreview(projectId) }, [projectId])
  const cameraId = objects.find(object => object.id === selectedId && object.type === 'camera')?.id ?? activeCameraId
  const run = (action: () => unknown | Promise<unknown>): void => {
    setMessage(undefined)
    try { void Promise.resolve(action()).catch(fail) } catch (error) { fail(error) }
  }
  const fail = (error: unknown): void => { logger.error('机位示范操作失败', error, { event: 'camera_stage.motion.controls.failed', context: { projectId } }); setMessage(error instanceof Error ? error.message : '请重试。') }
  return <PanelTrigger display={draft?.status === 'recording' ? '正在示范' : '超级关键帧'} appearance="quiet" size="sm" buttonClassName="w-auto" alignment="aboveCenter" gap={8} panelPadding="content" panelWidth="content"
    onOpenChange={open => { if (!open && projectId) clearCameraMotionPreview(projectId) }}
    renderPanel={() => <CreativeIntentControls profile="camera" property={draft?.property ?? property} status={draft?.status ?? 'idle'} candidates={draft?.review?.candidates.map(candidate => ({ ...candidate, label: candidate.id === 'dolly-hold' ? '推近停顿' : candidate.label })) ?? []} selected={draft?.selected ?? 'original'} fidelity={.5}
      pins={draft?.pinnedIds.map(id => ({ id, label: '机位' })) ?? []} canPin={Boolean(draft?.frames.some(frame => Math.abs(frame.time - time) < .5 / useCameraStageStore.getState().animation.fps))} needsSave={draft?.needsSave} message={message ?? draft?.message}
      onStart={() => run(() => { if (!projectId || !cameraId) throw new Error('请选择一个机位。'); startCameraMotion(projectId, cameraId, property) })}
      onStop={() => run(() => setCameraMotionStatus(projectId!, 'reviewing'))} onPause={() => run(() => setCameraMotionStatus(projectId!, 'paused'))} onResume={() => run(() => setCameraMotionStatus(projectId!, 'recording'))}
      onProperty={value => { setProperty(value); if (draft && projectId) run(() => setCameraMotionProperty(projectId, value)) }}
      onOptimize={() => run(() => organizeCameraMotion(projectId!, draft ? undefined : cameraId!))} onApply={() => run(() => applyCameraMotion(projectId!))}
      onPreview={candidate => run(() => previewCameraMotion(projectId!, candidate))} onPin={() => run(() => pinCameraMotion(projectId!))} onUnpin={id => run(() => pinCameraMotion(projectId!, id))}
      onFidelity={() => {}} onCancel={() => projectId && clearCameraMotionPreview(projectId)}
      onPlay={() => run(() => { const state = useCameraStageStore.getState(); state.seek(draft?.preview?.stateKeyframes[0]?.time ?? 0); useCameraStageStore.setState(current => ({ playback: { ...current.playback, playing: true } })) })} />}
  />
}
