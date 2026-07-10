import React, { useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import { UiButton } from '@/components/ui'
import { getCameraObjects } from '../../domain/cameraUtils'
import type { StageObject } from '../../domain/sceneTypes'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotTimingPatch, ShotTransitionPatch } from '../../store/shotSlice'
import { buildClipLayout, findClipAtTime } from './shotClipGeometry'
import { SHOT_CLIP_TRACK_HEIGHT } from './shotTimelineLayout'
import { formatShotTimecode } from './shotTimecodeFormat'
import StaticClipBlock from './StaticClipBlock'
import TransitionClipBlock from './TransitionClipBlock'
import { useClipReorder } from './useClipReorder'
import { useClipTrim } from './useClipTrim'

const ADD_BLOCK_WIDTH = 104
/** trim 实时预览浮签相对块顶部的垂直偏移（向上飘出，落在标尺条内） */
const TRIM_BADGE_TOP = -22
/** 插入指示线宽度（px） */
const INSERT_INDICATOR_WIDTH = 2

interface ShotClipTrackProps {
  shots: StageShot[]
  objects: StageObject[]
  pxPerSecond: number
  contentWidth: number
  fps: number
  selectedShotId: string | null
  currentTime: number
  onSelectShot: (id: string) => void
  onRenameShot: (id: string, name: string) => void
  onRemoveShot: (id: string) => void
  onUpdateShotTiming: (id: string, patch: ShotTimingPatch) => void
  onUpdateShotTransition: (id: string, patch: ShotTransitionPatch) => void
  onUpdateShotCamera: (id: string, cameraId: string | null) => void
  onReorderShot: (id: string, toIndex: number) => void
  onAddShot: () => void
}

/**
 * 时间轴块轨道：消费 buildClipLayout 渲染静止块/过渡块，末尾接"+ 添加片段"虚线块（不参与时间映射）。
 * 接入 2.1 trim（块右边缘拖拽调时长）与 2.2 重排（静止块块身拖拽换序）两个纯 hook：
 * trim 拖拽中用本地覆盖值（layoutShots）重算布局实现实时预览，松手才提交 store；
 * 重排拖拽中只做视觉跟手 + 插入指示线，松手一次性提交。两者互不冲突（命中区分离）。
 */
const ShotClipTrack: React.FC<ShotClipTrackProps> = ({
  shots,
  objects,
  pxPerSecond,
  contentWidth,
  fps,
  selectedShotId,
  currentTime,
  onSelectShot,
  onRenameShot,
  onRemoveShot,
  onUpdateShotTiming,
  onUpdateShotTransition,
  onUpdateShotCamera,
  onReorderShot,
  onAddShot,
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const cameras = useMemo(() => getCameraObjects(objects), [objects])

  const trim = useClipTrim({ fps, pxPerSecond, onCommit: onUpdateShotTiming })

  // trim 拖拽中用预览值覆盖对应卡的 hold/transitionDuration 后重新走 buildClipLayout，
  // 不新写一套几何计算——块宽据此实时变化，静止块标签同步显示预览值。
  const layoutShots = useMemo(() => {
    if (!trim.preview) return shots
    return shots.map((shot) => {
      if (shot.id !== trim.preview!.shotId) return shot
      return trim.preview!.kind === 'static'
        ? { ...shot, hold: trim.preview!.value }
        : { ...shot, transitionDuration: trim.preview!.value }
    })
  }, [shots, trim.preview])

  const layout = useMemo(() => buildClipLayout(layoutShots, pxPerSecond), [layoutShots, pxPerSecond])
  const playheadBlock = useMemo(() => findClipAtTime(layout, currentTime), [layout, currentTime])
  const staticBlocks = useMemo(
    () => layout.filter((block) => block.kind === 'static').map((block) => ({ shotId: block.shotId, x: block.x, width: block.width })),
    [layout],
  )

  const reorder = useClipReorder({
    staticBlocks,
    trackRef,
    onReorder: onReorderShot,
    onSelect: onSelectShot,
  })

  const trimBlock = trim.preview
    ? layout.find((block) => block.shotId === trim.preview!.shotId && block.kind === trim.preview!.kind)
    : null

  const insertIndicatorX = useMemo(() => {
    if (!reorder.drag) return null
    const others = layout.filter((block) => block.kind === 'static' && block.shotId !== reorder.drag!.shotId)
    const index = reorder.drag.insertIndex
    if (others.length === 0) return 0
    if (index <= 0) return others[0].x
    if (index >= others.length) {
      const last = others[others.length - 1]
      return last.x + last.width
    }
    return others[index].x
  }, [layout, reorder.drag])

  return (
    <div className="flex items-stretch" style={{ height: SHOT_CLIP_TRACK_HEIGHT }}>
      <div ref={trackRef} className="relative shrink-0" style={{ width: contentWidth, height: SHOT_CLIP_TRACK_HEIGHT }}>
        {shots.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">
            点击「添加片段」记录当前画面
          </div>
        )}
        {layout.map((block) => {
          if (block.kind === 'static') {
            const shot = layoutShots[block.index]
            const dragging = reorder.drag?.shotId === block.shotId
            return (
              <StaticClipBlock
                key={`static-${block.shotId}`}
                shot={shot}
                block={block}
                selected={block.shotId === selectedShotId}
                isPlayhead={playheadBlock?.kind === 'static' && playheadBlock.shotId === block.shotId}
                onSelect={() => onSelectShot(block.shotId)}
                onRename={(name) => onRenameShot(block.shotId, name)}
                onRemove={() => onRemoveShot(block.shotId)}
                reorderHandlers={{
                  onPointerDown: (event) => reorder.beginReorder(event, block.shotId),
                  onPointerMove: reorder.handlePointerMove,
                  onPointerUp: reorder.handlePointerUp,
                  onPointerCancel: reorder.handlePointerCancel,
                }}
                dragging={dragging}
                dragOffsetX={dragging ? reorder.drag!.offsetX : 0}
                trimHandlers={{
                  onPointerDown: (event) => trim.beginTrim(event, { shotId: block.shotId, kind: 'static', currentValue: shot.hold }),
                  onPointerMove: trim.handlePointerMove,
                  onPointerUp: trim.handlePointerUp,
                  onPointerCancel: trim.handlePointerCancel,
                }}
                trimming={trim.preview?.shotId === block.shotId && trim.preview.kind === 'static'}
                cameras={cameras}
                onSelectCamera={(cameraId) => onUpdateShotCamera(block.shotId, cameraId)}
              />
            )
          }
          const shot = layoutShots[block.index]
          return (
            <TransitionClipBlock
              key={`transition-${block.shotId}`}
              shot={shot}
              nextShot={layoutShots[block.index + 1]}
              shotIndex={block.index}
              block={block}
              objects={objects}
              fps={fps}
              updateShotTiming={onUpdateShotTiming}
              updateShotTransition={onUpdateShotTransition}
              trimHandlers={{
                onPointerDown: (event) => trim.beginTrim(event, { shotId: block.shotId, kind: 'transition', currentValue: shot.transitionDuration }),
                onPointerMove: trim.handlePointerMove,
                onPointerUp: trim.handlePointerUp,
                onPointerCancel: trim.handlePointerCancel,
              }}
              trimming={trim.preview?.shotId === block.shotId && trim.preview.kind === 'transition'}
            />
          )
        })}

        {trimBlock && trim.preview && (
          <div
            className="pointer-events-none absolute z-40 -translate-x-1/2 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
            style={{ left: trimBlock.x + trimBlock.width, top: TRIM_BADGE_TOP }}
          >
            {formatShotTimecode(trim.preview.value, 'secondsFrames', fps)}
          </div>
        )}

        {insertIndicatorX !== null && (
          <div
            className="pointer-events-none absolute inset-y-1 z-40 rounded-full bg-accent"
            style={{ left: insertIndicatorX - INSERT_INDICATOR_WIDTH / 2, width: INSERT_INDICATOR_WIDTH }}
          />
        )}
      </div>
      <UiButton
        variant="ghost"
        className="my-1 ml-2 shrink-0 border-dashed text-xs"
        style={{ width: ADD_BLOCK_WIDTH }}
        onClick={onAddShot}
      >
        <Plus size={14} className="mr-1" />添加片段
      </UiButton>
    </div>
  )
}

export default ShotClipTrack
