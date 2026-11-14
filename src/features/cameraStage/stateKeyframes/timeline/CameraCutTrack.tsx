import React, { useMemo, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Dropdown, PanelTrigger, UiFormRow, UiIconButton } from '@/components/ui'
import { TooltipContent } from '@/components/ui/Tooltip'
import { getCameraObjects } from '../../domain/cameraUtils'
import type { StageCameraCut } from '../../domain/renderCameraSchedule'
import type { StageObject } from '../../domain/sceneTypes'
import { timeToX } from '../../timeline/timeScale'
import { CAMERA_CUT_TRACK_HEIGHT } from './stateKeyframeTimelineLayout'
import { formatStateKeyframeTimecode } from './stateKeyframeTimecodeFormat'
import { useKeyframeTimeDrag } from './useKeyframeTimeDrag'

const ACTIVE_CAMERA_VALUE = '__active__'
const CUT_HIT_WIDTH = 24

interface CameraCutTrackProps {
  cuts: StageCameraCut[]
  objects: StageObject[]
  pxPerSecond: number
  contentWidth: number
  fps: number
  currentTime: number
  onMoveCut: (id: string, time: number) => void
  onChangeCamera: (id: string, cameraId: string | null) => void
  onRemoveCut: (id: string) => void
}

/**
 * 机位轨：每段从一个切换点到下一个，写着这段由哪台摄像机拍；切换点可以拖动，点开改机位或删除。
 * 只换拍摄机位，不碰状态关键帧，所以切在动作中途不会打断任何运动。
 */
const CameraCutTrack: React.FC<CameraCutTrackProps> = ({
  cuts, objects, pxPerSecond, contentWidth, fps, currentTime, onMoveCut, onChangeCamera, onRemoveCut,
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const cameras = useMemo(() => getCameraObjects(objects), [objects])
  const drag = useKeyframeTimeDrag({ stateKeyframes: cuts, fps, pxPerSecond, onCommit: onMoveCut })
  const laidOut = useMemo(() => cuts.map((cut) => (drag.preview?.stateKeyframeId === cut.id ? { ...cut, time: drag.preview.time } : cut)), [cuts, drag.preview])
  const cameraName = (cameraId: string | null): string => (cameraId ? cameras.find((camera) => camera.id === cameraId)?.name ?? '已删除的摄像机' : '活动摄像机')
  const cameraOptions = useMemo(() => [
    { label: '活动摄像机', value: ACTIVE_CAMERA_VALUE },
    ...cameras.map((camera) => ({ label: camera.name, value: camera.id })),
  ], [cameras])
  const liveIndex = laidOut.reduce((found, cut, index) => (cut.time <= currentTime + 1e-6 ? index : found), -1)

  return (
    <div ref={trackRef} className="relative shrink-0 border-t border-line" style={{ width: contentWidth, height: CAMERA_CUT_TRACK_HEIGHT }}>
      {laidOut.length === 0 && (
        <div className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-2xs text-text3">全程用活动摄像机拍</div>
      )}
      {laidOut.map((cut, index) => {
        const left = timeToX(cut.time, pxPerSecond)
        const right = index + 1 < laidOut.length ? timeToX(laidOut[index + 1].time, pxPerSecond) : contentWidth
        return (
          <div
            key={`segment-${cut.id}`}
            className={`pointer-events-none absolute inset-y-0 flex items-center truncate whitespace-nowrap pl-2 pr-1 text-2xs ${index === liveIndex ? 'text-text1' : 'text-text2'}`}
            style={{ left, width: Math.max(0, right - left) }}
          >
            {cameraName(cut.cameraId)}
          </div>
        )
      })}
      {laidOut.map((cut) => (
        <div key={`cut-${cut.id}`} className="absolute inset-y-0 z-sticky flex items-center justify-center" style={{ left: timeToX(cut.time, pxPerSecond) - CUT_HIT_WIDTH / 2, width: CUT_HIT_WIDTH }}>
          <PanelTrigger
            alignment="aboveCenter"
            gap={8}
            panelSize="compact"
            panelPadding="content"
            renderPanel={() => (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text1">切机位</div>
                    <div className="mt-0.5 text-2xs tabular-nums text-text2">{formatStateKeyframeTimecode(cut.time, 'secondsFrames', fps)}</div>
                  </div>
                  <UiIconButton tone="danger" tooltip="删除切换点" aria-label="删除切换点" onClick={() => onRemoveCut(cut.id)}>
                    <Trash2 />
                  </UiIconButton>
                </div>
                <UiFormRow label="切到" density="compact">
                  <Dropdown<string> width="fill"
                    ariaLabel="切到"
                    value={cut.cameraId ?? ACTIVE_CAMERA_VALUE}
                    display={cameraName(cut.cameraId)}
                    options={cameraOptions}
                    onSelect={(value) => onChangeCamera(cut.id, value === ACTIVE_CAMERA_VALUE ? null : value)}
                    size="sm"
                  />
                </UiFormRow>
              </div>
            )}
          >
            {({ togglePanel }) => (
              <UiIconButton
                type="button"
                tone="bare"
                size="xs"
                data-panel-trigger-button
                aria-label={`${formatStateKeyframeTimecode(cut.time, 'secondsFrames', fps)} 切到${cameraName(cut.cameraId)}`}
                tooltip={`${formatStateKeyframeTimecode(cut.time, 'secondsFrames', fps)} 切到${cameraName(cut.cameraId)}`}
                className={`cursor-ew-resize ${drag.preview?.stateKeyframeId === cut.id ? 'opacity-70' : ''}`}
                onPointerDown={(event) => drag.beginDrag(event, cut.id)}
                onPointerMove={drag.handlePointerMove}
                onPointerUp={drag.handlePointerUp}
                onPointerCancel={drag.handlePointerCancel}
                onClick={() => {
                  if (drag.consumeClickSuppression()) return
                  togglePanel()
                }}
              >
                {/* 切换点是一条竖线：机位轨上每段的分界 */}
                <span className="block h-5 w-px bg-line-strong" />
              </UiIconButton>
            )}
          </PanelTrigger>
        </div>
      ))}
      {drag.preview && (
        <TooltipContent anchorRef={trackRef} content={formatStateKeyframeTimecode(drag.preview.time, 'secondsFrames', fps)} interactive={false}
          getAnchorRect={() => {
            const rect = trackRef.current!.getBoundingClientRect()
            const left = rect.left + drag.preview!.time * pxPerSecond
            return { top: rect.top, left, right: left, width: 0, height: 0 }
          }} />
      )}
    </div>
  )
}

export default CameraCutTrack
