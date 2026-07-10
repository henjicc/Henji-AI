import React, { useMemo, useState } from 'react'
import { Diamond, Trash2 } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiInput } from '@/components/ui'
import type { StageCameraObject } from '../../domain/sceneTypes'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotClipBlock } from './shotClipGeometry'
import { formatShotTimecode } from './shotTimecodeFormat'

const KEYFRAME_HIT_SIZE = 24
const DEFAULT_CAMERA_OPTION_VALUE = '__default__'

export interface ClipBlockPointerHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

interface StaticClipBlockProps {
  shot: StageShot
  block: ShotClipBlock
  selected: boolean
  isPlayhead: boolean
  fps: number
  onSelect: () => void
  onRename: (name: string) => void
  onRemove: () => void
  /** 菱形拖拽（改关键帧绝对时间）的 pointer 事件，来自 useKeyframeTimeDrag */
  dragHandlers: ClipBlockPointerHandlers
  dragging: boolean
  /** 拖拽刚结束时返回 true 一次，用于吞掉浏览器补发的 click，避免拖完误弹面板 */
  consumeClickSuppression: () => boolean
  cameras: StageCameraObject[]
  onSelectCamera: (cameraId: string | null) => void
  onUpdateContinuity: (continuity: StageShot['continuity']) => void
}

/** 关键帧只以菱形占据时间坐标；名称、机位和通过方式收进点击浮层。 */
const StaticClipBlock: React.FC<StaticClipBlockProps> = ({
  shot,
  block,
  selected,
  isPlayhead,
  fps,
  onSelect,
  onRename,
  onRemove,
  dragHandlers,
  dragging,
  consumeClickSuppression,
  cameras,
  onSelectCamera,
  onUpdateContinuity,
}) => {
  const [draftName, setDraftName] = useState(shot.name)
  const cameraOptions = useMemo(() => [
    { label: '跟随默认', value: DEFAULT_CAMERA_OPTION_VALUE },
    ...cameras.map((camera) => ({ label: camera.name, value: camera.id })),
  ], [cameras])
  const cameraLabel = shot.cameraId
    ? cameras.find((camera) => camera.id === shot.cameraId)?.name ?? '未知机位'
    : '跟随默认'

  const commitName = (): void => {
    onRename(draftName)
  }

  return (
    <div
      className="absolute top-1/2 z-20"
      style={{
        left: block.x - KEYFRAME_HIT_SIZE / 2,
        width: KEYFRAME_HIT_SIZE,
        height: KEYFRAME_HIT_SIZE,
        transform: 'translateY(-50%)',
      }}
    >
      <PanelTrigger
        alignment="aboveCenter"
        gap={8}
        panelWidth={292}
        className="h-full w-full"
        renderPanel={() => (
          <div className="grid gap-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-text-dark">状态关键帧</div>
                <div className="mt-0.5 font-mono text-[10px] text-text-muted">
                  {formatShotTimecode(shot.time, 'secondsFrames', fps)}
                </div>
              </div>
              <UiButton
                variant="ghost"
                className="h-7 w-7 border-0 p-0 text-text-muted hover:text-danger"
                title="删除关键帧"
                onClick={onRemove}
              >
                <Trash2 size={13} />
              </UiButton>
            </div>
            <label className="grid gap-1 text-[11px] text-text-muted">
              名称
              <UiInput
                value={draftName}
                className="h-8 text-xs"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
            <Dropdown<string>
              label="拍摄机位"
              value={shot.cameraId ?? DEFAULT_CAMERA_OPTION_VALUE}
              display={cameraLabel}
              options={cameraOptions}
              onSelect={(value) => onSelectCamera(value === DEFAULT_CAMERA_OPTION_VALUE ? null : value)}
              disabled={cameras.length === 0}
            />
            <Dropdown<StageShot['continuity']>
              label="经过本关键帧时"
              value={shot.continuity}
              display={shot.continuity === 'smooth' ? '无缝通过' : '停靠'}
              options={[
                { label: '停靠（速度降为 0）', value: 'stop' },
                { label: '无缝通过（保持速度连续）', value: 'smooth' },
              ]}
              onSelect={onUpdateContinuity}
            />
          </div>
        )}
      >
        {({ togglePanel }) => (
          <div
            role="button"
            tabIndex={0}
            data-panel-trigger-button
            className={`flex h-full w-full cursor-grab items-center justify-center rounded-full transition-transform hover:scale-110 ${dragging ? 'cursor-grabbing opacity-70' : ''}`}
            onPointerDown={dragHandlers.onPointerDown}
            onPointerMove={dragHandlers.onPointerMove}
            onPointerUp={dragHandlers.onPointerUp}
            onPointerCancel={dragHandlers.onPointerCancel}
            onClick={() => {
              if (consumeClickSuppression()) return
              onSelect()
              togglePanel()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onSelect()
              togglePanel()
            }}
            title={`${shot.name} · ${formatShotTimecode(shot.time, 'secondsFrames', fps)}`}
          >
            <Diamond
              size={selected || isPlayhead ? 16 : 14}
              className={selected || isPlayhead ? 'fill-accent text-accent' : 'fill-surface-dark text-text-muted'}
            />
          </div>
        )}
      </PanelTrigger>
    </div>
  )
}

export default StaticClipBlock
