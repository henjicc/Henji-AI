import React, { useMemo } from 'react'
import { Camera, Cuboid, PenTool, UserRound } from 'lucide-react'
import NumberInput from '@/components/ui/NumberInput'
import { Dropdown, UiButton, UiEmpty, UiFormRow, UiGroup } from '@/components/ui'
import { getCameraObjects } from '../../domain/cameraUtils'
import { diffStateKeyframeObjects } from '../../domain/stateKeyframeCompiler'
import type {
  StageStateKeyframe,
  StageStateKeyframeTransitionObjectDetail,
  StageSpeedPreset,
} from '../../domain/stateKeyframeTypes'
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
  stateKeyframe: StageStateKeyframe
  nextStateKeyframe: StageStateKeyframe
  stateKeyframeIndex: number
  objects: StageObject[]
  fps: number
  camerasDiffer: boolean
  onDurationFramesChange: (frames: number) => void
  onDetailChange: (objectId: string, detail: StageStateKeyframeTransitionObjectDetail) => void
}

function cameraDisplayName(objects: StageObject[], cameraId: string | null): string {
  if (!cameraId) return '默认机位'
  return getCameraObjects(objects).find((camera) => camera.id === cameraId)?.name ?? '未知机位'
}

function detailSummary(detail: StageStateKeyframeTransitionObjectDetail): string {
  const speed = SPEED_OPTIONS.find((option) => option.value === (detail.speedPreset ?? 'easeInOut'))?.label ?? '平滑'
  const path = detail.spatialPath?.source.kind === 'preset'
    ? ({ orbit: '环绕', dollyIn: '推进', dollyOut: '拉远', truck: '横移', crane: '升降' } as const)[detail.spatialPath.source.preset.kind]
    : detail.spatialPath ? '自定义贝塞尔' : '直线'
  const delay = detail.delay ? ` · 延迟 ${detail.delay.toFixed(1)}s` : ''
  return `${path} · ${speed}${delay}`
}

const TransitionPopover: React.FC<TransitionPopoverProps> = ({
  stateKeyframe,
  nextStateKeyframe,
  stateKeyframeIndex,
  objects,
  fps,
  camerasDiffer,
  onDurationFramesChange,
  onDetailChange,
}) => {
  const changedIds = useMemo(() => new Set(diffStateKeyframeObjects(stateKeyframe, nextStateKeyframe, objects)), [stateKeyframe, nextStateKeyframe, objects])
  const changedObjects = useMemo(() => objects.filter((object) => changedIds.has(object.id)), [objects, changedIds])
  const durationFrames = Math.round(stateKeyframe.transitionDuration * fps)

  const applyBulkSpeedPreset = (speedPreset: StageSpeedPreset): void => {
    changedObjects.forEach((object) => {
      onDetailChange(object.id, { ...stateKeyframe.transition.perObject[object.id], speedPreset })
    })
  }

  const editObjectPath = (objectId: string): void => {
    const stage = useCameraStageStore.getState()
    stage.pause()
    stage.setSelected(objectId)
    stage.seek((stateKeyframe.time + nextStateKeyframe.time) / 2)
    useCameraStageToolStore.getState().selectPath({ stateKeyframeId: stateKeyframe.id, objectId })
  }

  return (
    <div className="flex max-h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="text-xs font-semibold text-text1">
        关键帧 {stateKeyframeIndex + 1} → 关键帧 {stateKeyframeIndex + 2}
      </div>

      {/* 浮层本身已是一张卡片，提示只写成说明文字，不再套一层描边底色块 */}
      {camerasDiffer ? (
        <p className="text-xs leading-5 text-text2">
          机位切换：{cameraDisplayName(objects, stateKeyframe.cameraId)} → {cameraDisplayName(objects, nextStateKeyframe.cameraId)}。
          区间末端执行硬切；需要连续运镜时，请把两侧机位改为相同。
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <UiFormRow label="时长（帧）" density="compact">
          <NumberInput
            ariaLabel="过渡时长（帧）"
            size="sm"
            value={durationFrames}
            min={0}
            step={1}
            precision={0}
            widthClassName="w-full"
            commitOnChange
            wheelStep
            onChange={(next) => onDurationFramesChange(Math.max(0, Math.round(next)))}
          />
        </UiFormRow>
        <UiFormRow label="全部对象速度" density="compact">
          <Dropdown<StageSpeedPreset>
            ariaLabel="全部对象速度"
            display="批量设置"
            options={SPEED_OPTIONS}
            onSelect={applyBulkSpeedPreset}
            className="w-full"
            size="sm"
            minWidthStrategy="none"
            disabled={changedObjects.length === 0}
          />
        </UiFormRow>
      </div>

      {!camerasDiffer && durationFrames === 0 ? (
        <p className="text-xs leading-5 text-text2">0 帧表示硬切；增加时长后即可编辑过渡路径。</p>
      ) : null}

      <UiGroup title="变化对象" titleTone="compact" divided gap="none">
        {changedObjects.length === 0 ? (
          <UiEmpty size="xs" title="这两个关键帧之间没有变化" />
        ) : (
          changedObjects.map((object) => {
            const Icon = object.type === 'camera' ? Camera : object.type === 'character' ? UserRound : Cuboid
            return (
              <div key={object.id} className="flex items-center gap-2 py-1.5">
                <Icon aria-hidden="true" size={14} className="shrink-0 text-text2" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-text1">{object.name}</div>
                  <div className="truncate text-2xs text-text2">
                    {detailSummary(stateKeyframe.transition.perObject[object.id] ?? {})}
                  </div>
                </div>
                <UiButton
                  size="sm"
                  variant="secondary"
                  className="shrink-0 gap-1"
                  onClick={() => editObjectPath(object.id)}
                >
                  <PenTool size={14} />在视口编辑
                </UiButton>
              </div>
            )
          })
        )}
      </UiGroup>
    </div>
  )
}

export default TransitionPopover
