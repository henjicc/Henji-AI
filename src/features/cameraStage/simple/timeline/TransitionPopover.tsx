import React, { useMemo } from 'react'
import { Camera, Cuboid, PenTool, UserRound } from 'lucide-react'
import { Dropdown, UiButton, UiInput } from '@/components/ui'
import { getCameraObjects } from '../../domain/cameraUtils'
import { diffShotObjects } from '../../domain/shotCompiler'
import type {
  StageShot,
  StageShotTransitionObjectDetail,
  StageSpeedPreset,
} from '../../domain/shotTypes'
import type { StageObject } from '../../domain/sceneTypes'
import { useCameraStageStore } from '../../store/cameraStageStore'
import { useCameraStageToolStore } from '../../store/cameraStageToolStore'

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
  camerasDiffer: boolean
  onDurationFramesChange: (frames: number) => void
  onDetailChange: (objectId: string, detail: StageShotTransitionObjectDetail) => void
}

function cameraDisplayName(objects: StageObject[], cameraId: string | null): string {
  if (!cameraId) return '默认机位'
  return getCameraObjects(objects).find((camera) => camera.id === cameraId)?.name ?? '未知机位'
}

function detailSummary(detail: StageShotTransitionObjectDetail): string {
  const speed = SPEED_OPTIONS.find((option) => option.value === (detail.speedPreset ?? 'easeInOut'))?.label ?? '平滑'
  const path = detail.spatialPath?.source.kind === 'preset'
    ? ({ orbit: '环绕', dollyIn: '推进', dollyOut: '拉远', truck: '横移', crane: '升降' } as const)[detail.spatialPath.source.preset.kind]
    : detail.spatialPath ? '自定义贝塞尔' : '直线'
  const delay = detail.delay ? ` · 延迟 ${detail.delay.toFixed(1)}s` : ''
  return `${path} · ${speed}${delay}`
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
}) => {
  const changedIds = useMemo(() => new Set(diffShotObjects(shot, nextShot, objects)), [shot, nextShot, objects])
  const changedObjects = useMemo(() => objects.filter((object) => changedIds.has(object.id)), [objects, changedIds])
  const durationFrames = Math.round(shot.transitionDuration * fps)

  const applyBulkSpeedPreset = (speedPreset: StageSpeedPreset): void => {
    changedObjects.forEach((object) => {
      onDetailChange(object.id, { ...shot.transition.perObject[object.id], speedPreset })
    })
  }

  const editObjectPath = (objectId: string): void => {
    const stage = useCameraStageStore.getState()
    stage.pause()
    stage.setSelected(objectId)
    stage.seek((shot.time + nextShot.time) / 2)
    useCameraStageToolStore.getState().selectPath({ shotId: shot.id, objectId })
  }

  return (
    <div className="flex max-h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="text-xs font-medium text-text-dark">
        关键帧 {shotIndex + 1} → 关键帧 {shotIndex + 2}
      </div>

      {camerasDiffer && (
        <div className="rounded-md border border-border-dark bg-layer/60 px-2 py-1.5 text-2xs leading-5 text-text-muted">
          机位切换：{cameraDisplayName(objects, shot.cameraId)} → {cameraDisplayName(objects, nextShot.cameraId)}。
          区间末端执行硬切；需要连续运镜时，请把两侧机位改为相同。
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-2xs text-text-muted">
          时长（帧）
          <UiInput
            type="number"
            min={0}
            step={1}
            value={durationFrames}
            className="h-8 w-24 px-2 text-xs tabular-nums"
            onChange={(event) => onDurationFramesChange(Math.max(0, Math.round(Number(event.target.value))))}
          />
        </label>
        <Dropdown
          label="全部对象速度"
          display="批量设置"
          options={SPEED_OPTIONS}
          onSelect={applyBulkSpeedPreset}
          buttonClassName="w-28"
          disabled={changedObjects.length === 0}
        />
      </div>

      {!camerasDiffer && durationFrames === 0 && (
        <div className="text-2xs leading-5 text-text-muted">
          0 帧表示硬切；增加时长后即可编辑过渡路径。
        </div>
      )}

      <div className="border-t border-border-dark pt-2">
        <div className="mb-1 text-2xs text-text-muted">变化对象</div>
        {changedObjects.length === 0 ? (
          <div className="py-3 text-center text-xs text-text-muted">这两个关键帧之间没有变化</div>
        ) : (
          <div className="grid gap-1">
            {changedObjects.map((object) => {
              const Icon = object.type === 'camera' ? Camera : object.type === 'character' ? UserRound : Cuboid
              return (
                <div key={object.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-layer/60">
                  <Icon size={13} className="shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-text-dark">{object.name}</div>
                    <div className="truncate text-3xs text-text-muted">
                      {detailSummary(shot.transition.perObject[object.id] ?? {})}
                    </div>
                  </div>
                  <UiButton
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 rounded-md px-2 text-2xs"
                    onClick={() => editObjectPath(object.id)}
                  >
                    <PenTool size={12} className="mr-1" />在视口编辑
                  </UiButton>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default TransitionPopover
