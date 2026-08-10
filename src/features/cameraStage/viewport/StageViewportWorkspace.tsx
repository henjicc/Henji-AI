import React, { useEffect } from 'react'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'
import { useCameraStageStore } from '../store/cameraStageStore'
import { useCameraStageViewportStore } from '../store/cameraStageViewportStore'
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
      /*
       * 绑死的摄像机没了就改成跟随当前机位，不要退回自由透视。
       *
       * 视口配置存在本机、摄像机 id 属于工程：换个工程那个 id 必然失效。退回自由透视的结果是
       * 四窗格里出现两个一模一样的透视画面（左上角本来就是自由透视），用户什么都没做，
       * 信息量白掉四分之一。这正是"新建工程后有两个相同透视图"的来源。
       */
      if (source.kind === 'camera' && !cameraIds.has(source.cameraId)) {
        setViewportSource(id, { kind: 'active_camera' })
      }
    }
  }, [objects, setViewportSource, viewports])

  const visibleIds = maximizedViewportId ? [maximizedViewportId] : STAGE_VIEWPORT_IDS

  return (
    <div data-application-observation-region="camera_stage.viewport_observer" className="relative h-full w-full">
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
    </div>
  )
}

export default StageViewportWorkspace
