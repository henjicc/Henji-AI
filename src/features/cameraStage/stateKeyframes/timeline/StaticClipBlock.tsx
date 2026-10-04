import React, { useMemo, useState } from 'react'
import { Diamond, Trash2 } from 'lucide-react'
import { Dropdown, PanelTrigger, UiFormRow, UiIconButton, UiInput } from '@/components/ui'
import type { StageCameraObject } from '../../domain/sceneTypes'
import type { StageStateKeyframe } from '../../domain/stateKeyframeTypes'
import type { StateKeyframeClipBlock } from './stateKeyframeClipGeometry'
import { formatStateKeyframeTimecode } from './stateKeyframeTimecodeFormat'

const KEYFRAME_HIT_SIZE = 24
const DEFAULT_CAMERA_OPTION_VALUE = '__default__'

export interface ClipBlockPointerHandlers {
  onPointerDown: (event: React.PointerEvent) => void
  onPointerMove: (event: React.PointerEvent) => void
  onPointerUp: (event: React.PointerEvent) => void
  onPointerCancel: (event: React.PointerEvent) => void
}

interface StaticClipBlockProps {
  stateKeyframe: StageStateKeyframe
  block: StateKeyframeClipBlock
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
  onUpdateContinuity: (continuity: StageStateKeyframe['continuity']) => void
}

/** 关键帧只以菱形占据时间坐标；名称、机位和通过方式收进点击浮层。 */
const StaticClipBlock: React.FC<StaticClipBlockProps> = ({
  stateKeyframe,
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
  const [draftName, setDraftName] = useState(stateKeyframe.name)
  const cameraOptions = useMemo(() => [
    { label: '跟随默认', value: DEFAULT_CAMERA_OPTION_VALUE },
    ...cameras.map((camera) => ({ label: camera.name, value: camera.id })),
  ], [cameras])
  const cameraLabel = stateKeyframe.cameraId
    ? cameras.find((camera) => camera.id === stateKeyframe.cameraId)?.name ?? '未知机位'
    : '跟随默认'

  const commitName = (): void => {
    onRename(draftName)
  }

  return (
    <div
      className="absolute top-1/2 z-sticky"
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
        panelWidth={280}
        className="h-full w-full"
        panelPadding="content"
        renderPanel={() => (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-text1">状态关键帧</div>
                <div className="mt-0.5 font-mono text-2xs tabular-nums text-text2">
                  {formatStateKeyframeTimecode(stateKeyframe.time, 'secondsFrames', fps)}
                </div>
              </div>
              <UiIconButton
                tone="danger"
                title="删除关键帧"
                aria-label="删除关键帧"
                onClick={onRemove}
              >
                <Trash2 size={14} />
              </UiIconButton>
            </div>
            <UiFormRow label="名称" density="compact">
              <UiInput
                aria-label="关键帧名称"
                size="sm"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </UiFormRow>
            <UiFormRow label="拍摄机位" density="compact">
              <Dropdown<string>
                ariaLabel="拍摄机位"
                value={stateKeyframe.cameraId ?? DEFAULT_CAMERA_OPTION_VALUE}
                display={cameraLabel}
                options={cameraOptions}
                onSelect={(value) => onSelectCamera(value === DEFAULT_CAMERA_OPTION_VALUE ? null : value)}
                disabled={cameras.length === 0}
                className="w-full"
                size="sm"
                minWidthStrategy="none"
              />
            </UiFormRow>
            <UiFormRow label="经过本关键帧时" density="compact">
              <Dropdown<StageStateKeyframe['continuity']>
                ariaLabel="经过本关键帧时"
                value={stateKeyframe.continuity}
                display={stateKeyframe.continuity === 'smooth' ? '无缝通过' : '停靠'}
                options={[
                  { label: '停靠（速度降为 0）', value: 'stop' },
                  { label: '无缝通过（保持速度连续）', value: 'smooth' },
                ]}
                onSelect={onUpdateContinuity}
                className="w-full"
                size="sm"
                minWidthStrategy="none"
              />
            </UiFormRow>
          </div>
        )}
      >
        {({ togglePanel }) => (
          <div
            role="button"
            tabIndex={0}
            data-panel-trigger-button
            aria-label={`关键帧 ${stateKeyframe.name}`}
            className={`flex h-full w-full cursor-grab items-center justify-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent-ring ${dragging ? 'cursor-grabbing opacity-70' : ''}`}
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
            title={`${stateKeyframe.name} · ${formatStateKeyframeTimecode(stateKeyframe.time, 'secondsFrames', fps)}`}
          >
            {/* 选中 = 强调色实心；只是播放头停在这里 = 强调色描边空心；其余中性。三者一眼可辨。 */}
            <Diamond
              size={selected || isPlayhead ? 16 : 14}
              className={selected ? 'fill-accent text-accent' : isPlayhead ? 'fill-raised text-accent' : 'fill-raised text-text2'}
            />
          </div>
        )}
      </PanelTrigger>
    </div>
  )
}

export default StaticClipBlock
