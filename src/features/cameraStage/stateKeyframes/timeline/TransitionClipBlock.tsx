import React from 'react'
import { Spline } from 'lucide-react'
import { PanelTrigger, UiIconButton } from '@/components/ui'
import type { StageObject } from '../../domain/sceneTypes'
import type { StageStateKeyframe } from '../../domain/stateKeyframeTypes'
import type { StateKeyframeTimingPatch, StateKeyframeTransitionPatch } from '../../store/stateKeyframeSlice'
import type { StateKeyframeClipBlock } from './stateKeyframeClipGeometry'
import TransitionPopover from './TransitionPopover'

/** 硬切剪切线的点击命中区宽度（视觉线本身只有 2px，命中区放大到可点选） */
const HARD_CUT_HIT_WIDTH = 16
/** 极窄过渡块保底最小可视宽度，与静止块对齐（重要记录/01-实施方案 风险控制） */
const MIN_TRANSITION_WIDTH = 16
/** 过渡参数气泡宽度（重要记录 004） */

interface TransitionClipBlockProps {
  stateKeyframe: StageStateKeyframe
  nextStateKeyframe: StageStateKeyframe
  stateKeyframeIndex: number
  block: StateKeyframeClipBlock
  objects: StageObject[]
  fps: number
  updateStateKeyframeTiming: (id: string, patch: StateKeyframeTimingPatch) => void
  updateStateKeyframeTransition: (id: string, patch: StateKeyframeTransitionPatch) => void
}

/**
 * 时间轴过渡块：更矮/更弱视觉重量，显示时长；0 帧过渡渲染为可点击的剪切竖线。
 * 点击（含剪切线）在块上方弹出参数气泡（重要记录 004），替代旧底部抽屉；
 * 气泡容器用 PanelTrigger（aboveCenter），锚点取本组件自身尺寸，内容见 TransitionPopover。
 * 右边缘叠加独立的 trim 命中区（晚于 PanelTrigger 渲染，天然盖在其上，不经过 stopPropagation
 * 也不会触发气泡点击，两者是兄弟节点而非父子节点）。
 */
const TransitionClipBlock: React.FC<TransitionClipBlockProps> = ({
  stateKeyframe,
  nextStateKeyframe,
  stateKeyframeIndex,
  block,
  objects,
  fps,
  updateStateKeyframeTiming,
  updateStateKeyframeTransition,
}) => {
  const isHardCut = block.width <= 0
  const left = isHardCut ? block.x - HARD_CUT_HIT_WIDTH / 2 : block.x
  const width = isHardCut ? HARD_CUT_HIT_WIDTH : Math.max(block.width, MIN_TRANSITION_WIDTH)

  const transitionLabel = `过渡参数：关键帧 ${stateKeyframeIndex + 1} → 关键帧 ${stateKeyframeIndex + 2}`

  const handleDurationFramesChange = (frames: number): void => {
    updateStateKeyframeTiming(stateKeyframe.id, { transitionDuration: frames / Math.max(1, fps) })
  }
  const handleDetailChange: React.ComponentProps<typeof TransitionPopover>['onDetailChange'] = (objectId, detail) => {
    updateStateKeyframeTransition(stateKeyframe.id, { perObject: { [objectId]: detail } })
  }
  return (
    <div className="absolute inset-y-2 z-raised" style={{ left, width }}>
      <PanelTrigger
        alignment="aboveCenter"
        panelSize="compact"
        panelPadding="none"
        className="h-full w-full"
        renderPanel={() => (
          <TransitionPopover
            stateKeyframe={stateKeyframe}
            nextStateKeyframe={nextStateKeyframe}
            stateKeyframeIndex={stateKeyframeIndex}
            objects={objects}
            fps={fps}
            onDurationFramesChange={handleDurationFramesChange}
            onDetailChange={handleDetailChange}
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
            <UiIconButton
              type="button" tone="bare" size="sm"
              style={{ width: '100%', height: '100%' }}
              data-panel-trigger-button
              aria-label={transitionLabel}
              tooltip="硬切（0 帧过渡），点击可调整；拖右缘可拉出过渡时长"
              className="cursor-pointer"
              onClick={togglePanel}
              onKeyDown={handleKeyDown}
            >
              <span className="h-full w-0.5 rounded-full bg-text2 transition-colors hover:bg-accent" />
            </UiIconButton>
          ) : (
            <UiIconButton
              type="button" tone="bare" size="sm"
              style={{ width: '100%', height: '100%' }}
              data-panel-trigger-button
              aria-label={transitionLabel}
              tooltip={`过渡 ${stateKeyframe.transitionDuration.toFixed(2)}s`}
              className="cursor-pointer"
              onClick={togglePanel}
              onKeyDown={handleKeyDown}
            >
              <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden border-y border-line bg-hover/50 px-1 text-2xs text-text2 transition-colors hover:bg-hover/80">
                <Spline />
                <span className="truncate">{stateKeyframe.transitionDuration.toFixed(2)}s</span>
              </span>
            </UiIconButton>
          )
        }}
      </PanelTrigger>
    </div>
  )
}

export default TransitionClipBlock
