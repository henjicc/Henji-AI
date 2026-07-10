import React from 'react'
import { Camera, Spline } from 'lucide-react'
import { PanelTrigger } from '@/components/ui'
import { hasForcedHardCut } from '../../domain/shotCompiler'
import type { StageObject } from '../../domain/sceneTypes'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotTimingPatch, ShotTransitionPatch } from '../../store/shotSlice'
import type { ClipBlockPointerHandlers } from './StaticClipBlock'
import type { ShotClipBlock } from './shotClipGeometry'
import TransitionPopover from './TransitionPopover'

/** 硬切剪切线的点击命中区宽度（视觉线本身只有 2px，命中区放大到可点选） */
const HARD_CUT_HIT_WIDTH = 16
/** 极窄过渡块保底最小可视宽度，与静止块对齐（重要记录/01-实施方案 风险控制） */
const MIN_TRANSITION_WIDTH = 16
/** 过渡参数气泡宽度（重要记录 004） */
const POPOVER_WIDTH = 380

interface TransitionClipBlockProps {
  shot: StageShot
  nextShot: StageShot
  shotIndex: number
  block: ShotClipBlock
  objects: StageObject[]
  fps: number
  updateShotTiming: (id: string, patch: ShotTimingPatch) => void
  updateShotTransition: (id: string, patch: ShotTransitionPatch) => void
  /** 右边缘：拖拽调整过渡时长（trim），0 帧时可从硬切剪切线右缘拖回 >0 */
  trimHandlers: ClipBlockPointerHandlers
  /** 本块右边缘是否正在被 trim 拖拽（高亮态） */
  trimming: boolean
}

/**
 * 时间轴过渡块：更矮/更弱视觉重量，显示时长；0 帧过渡渲染为可点击的剪切竖线。
 * 点击（含剪切线）在块上方弹出参数气泡（重要记录 004），替代旧底部抽屉；
 * 气泡容器用 PanelTrigger（aboveCenter），锚点取本组件自身尺寸，内容见 TransitionPopover。
 * 右边缘叠加独立的 trim 命中区（晚于 PanelTrigger 渲染，天然盖在其上，不经过 stopPropagation
 * 也不会触发气泡点击，两者是兄弟节点而非父子节点）。
 */
const TransitionClipBlock: React.FC<TransitionClipBlockProps> = ({
  shot,
  nextShot,
  shotIndex,
  block,
  objects,
  fps,
  updateShotTiming,
  updateShotTransition,
  trimHandlers,
  trimming,
}) => {
  const isHardCut = block.width <= 0
  // 两侧机位不同 → 布点层已强制硬切（3.1），这里额外区分"机位造成的硬切"与"用户手动拖到 0 帧的硬切"，
  // 呈现与可编辑性不同：前者时长编辑不生效（record 005：不支持跨机位带时长过渡），后者仍可编辑。
  const camerasDiffer = hasForcedHardCut(shot, nextShot)
  const left = isHardCut ? block.x - HARD_CUT_HIT_WIDTH / 2 : block.x
  const width = isHardCut ? HARD_CUT_HIT_WIDTH : Math.max(block.width, MIN_TRANSITION_WIDTH)

  const handleDurationFramesChange = (frames: number): void => {
    updateShotTiming(shot.id, { transitionDuration: frames / Math.max(1, fps) })
  }
  const handleDetailChange: React.ComponentProps<typeof TransitionPopover>['onDetailChange'] = (objectId, detail) => {
    updateShotTransition(shot.id, { perObject: { [objectId]: detail } })
  }
  const handleCameraMoveChange: React.ComponentProps<typeof TransitionPopover>['onCameraMoveChange'] = (objectId, move) => {
    updateShotTransition(shot.id, { cameraMoves: { [objectId]: move } })
  }

  return (
    <div className="absolute inset-y-2 z-10" style={{ left, width }}>
      <PanelTrigger
        alignment="aboveCenter"
        panelWidth={POPOVER_WIDTH}
        className="h-full w-full"
        renderPanel={() => (
          <TransitionPopover
            shot={shot}
            nextShot={nextShot}
            shotIndex={shotIndex}
            objects={objects}
            fps={fps}
            camerasDiffer={camerasDiffer}
            onDurationFramesChange={handleDurationFramesChange}
            onDetailChange={handleDetailChange}
            onCameraMoveChange={handleCameraMoveChange}
          />
        )}
      >
        {({ togglePanel }) => {
          const handleKeyDown = (event: React.KeyboardEvent): void => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            togglePanel()
          }
          return isHardCut ? (
            <div
              role="button"
              tabIndex={0}
              data-panel-trigger-button
              title={
                camerasDiffer
                  ? '机位切换（强制硬切），点击查看详情'
                  : '硬切（0 帧过渡），点击可调整；拖右缘可拉出过渡时长'
              }
              className="flex h-full w-full cursor-pointer items-center justify-center"
              onClick={togglePanel}
              onKeyDown={handleKeyDown}
            >
              {camerasDiffer ? (
                <Camera size={11} className="text-accent" />
              ) : (
                <span className={`h-full w-0.5 rounded-full transition-colors ${trimming ? 'bg-accent' : 'bg-text-muted hover:bg-accent'}`} />
              )}
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              data-panel-trigger-button
              title={`过渡 ${shot.transitionDuration.toFixed(2)}s`}
              className={`flex h-full w-full cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border bg-layer/70 px-1 text-[10px] text-text-muted transition-colors hover:bg-layer ${trimming ? 'border-accent' : 'border-border-dark'}`}
              onClick={togglePanel}
              onKeyDown={handleKeyDown}
            >
              <Spline size={11} />
              <span className="truncate">{shot.transitionDuration.toFixed(2)}s</span>
            </div>
          )
        }}
      </PanelTrigger>
      {/* 右边缘 trim 命中区：与 PanelTrigger 是兄弟节点、后渲染盖在其上，点击/拖拽不会触发气泡；
          机位不同时不渲染——拖拽调整的时长不会生效（record 005：不支持跨机位带时长过渡），避免误导 */}
      {!camerasDiffer && (
        <div
          role="presentation"
          className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize"
          onPointerDown={trimHandlers.onPointerDown}
          onPointerMove={trimHandlers.onPointerMove}
          onPointerUp={trimHandlers.onPointerUp}
          onPointerCancel={trimHandlers.onPointerCancel}
        />
      )}
    </div>
  )
}

export default TransitionClipBlock
