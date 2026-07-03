import React from 'react'
import { UiColorInput, UiSwitch } from '@/components/ui'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 未选中对象时的属性面板：场景级设置（背景色 / 网格显隐），随工程持久化 */
const SceneSettingsPanel: React.FC = () => {
  const sceneSettings = useCameraStageStore((state) => state.sceneSettings)
  const setSceneBackgroundColor = useCameraStageStore((state) => state.setSceneBackgroundColor)
  const setSceneGridVisible = useCameraStageStore((state) => state.setSceneGridVisible)

  return (
    <div className="flex h-full w-full flex-col bg-surface-dark">
      <div className="px-3 pb-2 pt-3 text-sm font-medium text-text-dark">场景设置</div>
      <div className="flex flex-col gap-4 px-3 pb-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">背景色</span>
          <UiColorInput
            value={sceneSettings.backgroundColor}
            onChange={(event) => setSceneBackgroundColor(event.target.value)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">参考网格</span>
          <UiSwitch checked={sceneSettings.gridVisible} onCheckedChange={setSceneGridVisible} />
        </div>
        <div className="pt-2 text-center text-xs text-text-muted">选中一个场景对象后在这里编辑属性</div>
      </div>
    </div>
  )
}

export default SceneSettingsPanel
