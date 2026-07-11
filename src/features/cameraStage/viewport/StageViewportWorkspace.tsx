import React, { useEffect } from 'react'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'
import StagePathContextBar from '../toolbar/StagePathContextBar'
import StageViewportPane from './StageViewportPane'
import { STAGE_VIEWPORT_IDS } from './viewportTypes'

interface StageViewportWorkspaceProps {
  captureRef?: React.MutableRefObject<StageCaptureFn | null>
}

const StageViewportWorkspace: React.FC<StageViewportWorkspaceProps> = ({ captureRef }) => {
  const maximizedViewportId = useCameraStageViewportStore((state) => state.maximizedViewportId)
  const activeViewportId = useCameraStageViewportStore((state) => state.activeViewportId)
  const viewports = useCameraStageViewportStore((state) => state.viewports)
  const setViewportSource = useCameraStageViewportStore((state) => state.setViewportSource)
  const objects = useCameraStageStore((state) => state.objects)

  useEffect(() => {
    const cameraIds = new Set(objects.filter((object) => object.type === 'camera').map((camera) => camera.id))
    for (const id of STAGE_VIEWPORT_IDS) {
      const source = viewports[id].source
      if (source.kind === 'camera' && !cameraIds.has(source.cameraId)) {
        setViewportSource(id, { kind: 'director' })
      }
    }
  }, [objects, setViewportSource, viewports])

  const visibleIds = maximizedViewportId ? [maximizedViewportId] : STAGE_VIEWPORT_IDS

  return (
    <div className="relative h-full w-full">
      <div className={maximizedViewportId ? 'grid h-full grid-cols-1' : 'grid h-full grid-cols-2 grid-rows-2'}>
        {visibleIds.map((id, index) => (
          <StageViewportPane
            key={id}
            viewportId={id}
            captureRef={captureRef}
            primary={id === activeViewportId || (index === 0 && !visibleIds.includes(activeViewportId))}
          />
        ))}
      </div>
      <StagePathContextBar />
    </div>
  )
}

export default StageViewportWorkspace
