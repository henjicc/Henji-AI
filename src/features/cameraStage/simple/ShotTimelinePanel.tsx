import React, { useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { UiButton } from '@/components/ui'
import { useReorderDrag } from '@/components/ui/fileUploader/useReorderDrag'
import { useCameraStageStore } from '../store/cameraStageStore'
import { PlaybackButtons } from '../timeline/PlaybackControls'
import ShotCard from './ShotCard'
import TransitionDetailPanel from './TransitionDetailPanel'
import { getShotAtTime } from './shotTimelineUtils'

const ShotTimelinePanel: React.FC = () => {
  const shots = useCameraStageStore((state) => state.shots)
  const objects = useCameraStageStore((state) => state.objects)
  const selectedShotId = useCameraStageStore((state) => state.selectedShotId)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const duration = useCameraStageStore((state) => state.animation.duration)
  const addShot = useCameraStageStore((state) => state.addShot)
  const selectShot = useCameraStageStore((state) => state.selectShot)
  const removeShot = useCameraStageStore((state) => state.removeShot)
  const reorderShot = useCameraStageStore((state) => state.reorderShot)
  const updateShotName = useCameraStageStore((state) => state.updateShotName)
  const updateShotTiming = useCameraStageStore((state) => state.updateShotTiming)
  const updateShotTransition = useCameraStageStore((state) => state.updateShotTransition)
  const [expandedTransitionId, setExpandedTransitionId] = useState<string | null>(null)
  const activeShotId = useMemo(() => getShotAtTime(shots, currentTime)?.shotId ?? null, [shots, currentTime])
  const shotIds = useMemo(() => shots.map((shot) => shot.id), [shots])
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: shots.length < 2,
    isCustomDragging: false,
    files: shotIds,
    onReorder: (from, to) => reorderShot(shots[from].id, to),
    onImageClick: (shotId) => selectShot(shotId),
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-dark bg-surface-dark px-2">
        <PlaybackButtons canPlay={shots.length > 0 && duration > 0} />
        <span className="tabular-nums text-xs text-text-muted">{currentTime.toFixed(2)}s / {duration.toFixed(2)}s</span>
        <span className="ml-auto text-xs text-text-muted">镜头卡</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-28 shrink-0 items-center gap-3 overflow-x-auto p-3">
        {shots.length === 0 && (
          <div className="flex min-w-72 flex-1 items-center justify-center text-sm text-text-muted">
            点击「添加片段」记录当前画面
          </div>
        )}
        {shots.map((shot, index) => {
          const dragging = dragState.isDragging && dragState.fromIndex === index
          let offsetX = dragging ? dragState.currentX - dragState.startX : 0
          if (dragState.isDragging && dragState.fromIndex !== null && dragState.toIndex !== null && !dragging) {
            if (dragState.fromIndex < index && index <= dragState.toIndex) offsetX = -204
            else if (dragState.toIndex <= index && index < dragState.fromIndex) offsetX = 204
          }
          return (
            <div key={shot.id} ref={(element) => { itemRefs.current[index] = element }}>
              <ShotCard shot={shot} index={index} selected={shot.id === selectedShotId} active={shot.id === activeShotId}
                dragging={dragging} dropping={dragState.isDropping && dragState.fromIndex === index} offsetX={offsetX}
                onMouseDown={(event) => handleMouseDown(index, event)} onRename={(name) => updateShotName(shot.id, name)}
                onTimingChange={(patch) => updateShotTiming(shot.id, patch)} onRemove={() => removeShot(shot.id)} />
              {index < shots.length - 1 && <UiButton variant="ghost" className="mt-1 h-6 w-48 border-0 bg-transparent text-[11px] text-text-muted"
                onClick={() => setExpandedTransitionId((current) => current === shot.id ? null : shot.id)}>
                过渡细节 <ChevronDown size={12} className={`ml-1 transition-transform ${expandedTransitionId === shot.id ? 'rotate-180' : ''}`} />
              </UiButton>}
            </div>
          )
        })}
        <UiButton variant="ghost" className="h-24 w-36 shrink-0 border-dashed text-xs" onClick={addShot}>
          <Plus size={15} className="mr-1" />添加片段
        </UiButton>
      </div>
      {expandedTransitionId && (() => {
        const index = shots.findIndex((shot) => shot.id === expandedTransitionId)
        const shot = shots[index]
        const nextShot = shots[index + 1]
        return shot && nextShot ? <div className="min-h-0 flex-1 overflow-y-auto"><TransitionDetailPanel shot={shot} nextShot={nextShot}
          shotIndex={index} objects={objects}
          onDetailChange={(objectId, detail) => updateShotTransition(shot.id, { perObject: { [objectId]: detail } })}
          onCameraMoveChange={(objectId, move) => updateShotTransition(shot.id, { cameraMoves: { [objectId]: move } })} /></div> : null
      })()}
      </div>
    </div>
  )
}

export default ShotTimelinePanel
