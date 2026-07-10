import React, { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Dropdown, UiButton, UiInput } from '@/components/ui'
import { getCameraObjects } from '../../domain/cameraUtils'
import { diffShotObjects } from '../../domain/shotCompiler'
import type {
  StageCameraMove,
  StageShot,
  StageShotTransitionObjectDetail,
  StageSpeedPreset,
} from '../../domain/shotTypes'
import type { StageObject } from '../../domain/sceneTypes'
import TransitionObjectRow from '../TransitionObjectRow'

/**
 * 过渡参数气泡内容（重要记录 004）：锚定容器由 TransitionClipBlock 里的 PanelTrigger 提供，
 * 本组件只负责内容——顶部时长（帧）+ 批量速度预设，下方折叠逐对象细节（复用 TransitionObjectRow，不重复实现）。
 */

const SPEED_OPTIONS: Array<{ label: string; value: StageSpeedPreset }> = [
  { label: '匀速', value: 'uniform' },
  { label: '平滑', value: 'easeInOut' },
  { label: '快速起步', value: 'fastStart' },
  { label: '缓慢起步', value: 'slowStart' },
]

interface TransitionPopoverProps {
  shot: StageShot
  nextShot: StageShot
  shotIndex: number
  objects: StageObject[]
  fps: number
  /** 两侧机位不同（重要记录 005）：时长输入禁用，展示跨机位硬切提示 */
  camerasDiffer: boolean
  onDurationFramesChange: (frames: number) => void
  onDetailChange: (objectId: string, detail: StageShotTransitionObjectDetail) => void
  onCameraMoveChange: (objectId: string, move: StageCameraMove) => void
}

function cameraDisplayName(objects: StageObject[], cameraId: string | null): string {
  if (!cameraId) return '默认机位'
  return getCameraObjects(objects).find((camera) => camera.id === cameraId)?.name ?? '未知机位'
}

const TransitionPopover: React.FC<TransitionPopoverProps> = ({
  shot,
  nextShot,
  shotIndex,
  objects,
  fps,
  camerasDiffer,
  onDurationFramesChange,
  onDetailChange,
  onCameraMoveChange,
}) => {
  const [detailExpanded, setDetailExpanded] = useState(false)
  const changedIds = useMemo(() => new Set(diffShotObjects(shot, nextShot, objects)), [shot, nextShot, objects])
  const changedObjects = useMemo(() => objects.filter((object) => changedIds.has(object.id)), [objects, changedIds])
  const durationFrames = Math.round(shot.transitionDuration * fps)

  const applyBulkSpeedPreset = (speedPreset: StageSpeedPreset): void => {
    changedObjects.forEach((object) => {
      onDetailChange(object.id, { ...shot.transition.perObject[object.id], speedPreset })
    })
  }

  return (
    <div className="flex max-h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="text-xs font-medium text-text-dark">
        片段 {shotIndex + 1} → 片段 {shotIndex + 2} 的过渡
      </div>

      {camerasDiffer && (
        <div className="rounded-md border border-border-dark bg-layer/60 px-2 py-1.5 text-[11px] leading-5 text-text-muted">
          机位切换：{cameraDisplayName(objects, shot.cameraId)} → {cameraDisplayName(objects, nextShot.cameraId)}，
          此处强制为硬切，过渡时长不生效（不支持跨机位带时长过渡）。如需恢复过渡效果，请把两侧机位改为相同。
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-text-muted">
          时长（帧）
          <UiInput
            type="number"
            min={0}
            step={1}
            value={durationFrames}
            disabled={camerasDiffer}
            className="h-8 w-24 px-2 text-xs"
            onChange={(event) => onDurationFramesChange(Math.max(0, Math.round(Number(event.target.value))))}
          />
        </label>
        <Dropdown
          label="速度预设（批量应用到全部有变化的对象）"
          display="批量设置"
          options={SPEED_OPTIONS}
          onSelect={applyBulkSpeedPreset}
          buttonClassName="w-28"
          disabled={changedObjects.length === 0}
        />
      </div>

      {!camerasDiffer && durationFrames === 0 && (
        <div className="text-[11px] leading-5 text-text-muted">
          时长为 0 帧 = 硬切，前后画面直接切换；改为大于 0 的值即可恢复为过渡。
        </div>
      )}

      <div>
        <UiButton
          variant="ghost"
          className="h-7 border-0 bg-transparent px-1 text-xs text-text-muted"
          onClick={() => setDetailExpanded((current) => !current)}
        >
          逐对象细节
          <ChevronDown size={12} className={`ml-1 transition-transform ${detailExpanded ? 'rotate-180' : ''}`} />
        </UiButton>
        {detailExpanded && (
          <div className="mt-2 max-h-64 overflow-y-auto">
            {changedObjects.length === 0 ? (
              <div className="py-3 text-center text-xs text-text-muted">这两个片段之间没有变化</div>
            ) : (
              <div className="grid gap-2">
                {changedObjects.map((object) => (
                  <TransitionObjectRow
                    key={object.id}
                    object={object}
                    detail={shot.transition.perObject[object.id] ?? {}}
                    cameraMove={shot.transition.cameraMoves[object.id]}
                    onDetailChange={(detail) => onDetailChange(object.id, detail)}
                    onCameraMoveChange={(move) => onCameraMoveChange(object.id, move)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default TransitionPopover
