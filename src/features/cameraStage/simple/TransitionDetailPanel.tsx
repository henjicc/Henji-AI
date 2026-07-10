import React, { useMemo } from 'react'
import { diffShotObjects } from '../domain/shotCompiler'
import type { StageCameraMove, StageShot, StageShotTransitionObjectDetail } from '../domain/shotTypes'
import type { StageObject } from '../domain/sceneTypes'
import TransitionObjectRow from './TransitionObjectRow'

interface TransitionDetailPanelProps {
  shot: StageShot
  nextShot: StageShot
  shotIndex: number
  objects: StageObject[]
  onDetailChange: (objectId: string, detail: StageShotTransitionObjectDetail) => void
  onCameraMoveChange: (objectId: string, move: StageCameraMove) => void
}

const TransitionDetailPanel: React.FC<TransitionDetailPanelProps> = ({ shot, nextShot, shotIndex, objects, onDetailChange, onCameraMoveChange }) => {
  const changedIds = useMemo(() => new Set(diffShotObjects(shot, nextShot, objects)), [shot, nextShot, objects])
  const changedObjects = useMemo(() => objects.filter((object) => changedIds.has(object.id)), [objects, changedIds])
  return (
    <div className="border-t border-border-dark bg-layer px-4 py-3">
      <div className="mb-3 text-xs font-medium text-text-dark">片段 {shotIndex + 1} → 片段 {shotIndex + 2} 的过渡</div>
      {changedObjects.length === 0 ? <div className="py-4 text-center text-xs text-text-muted">这两个片段之间没有变化</div> : (
        <div className="grid gap-2">
          {changedObjects.map((object) => <TransitionObjectRow key={object.id} object={object}
            detail={shot.transition.perObject[object.id] ?? {}} cameraMove={shot.transition.cameraMoves[object.id]}
            onDetailChange={(detail) => onDetailChange(object.id, detail)}
            onCameraMoveChange={(move) => onCameraMoveChange(object.id, move)} />)}
        </div>
      )}
    </div>
  )
}

export default TransitionDetailPanel
