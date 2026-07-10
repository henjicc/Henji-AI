import React from 'react'
import { Spline } from 'lucide-react'
import type { StageShot } from '../../domain/shotTypes'
import type { ShotClipBlock } from './shotClipGeometry'

/** 硬切剪切线的点击命中区宽度（视觉线本身只有 2px，命中区放大到可点选） */
const HARD_CUT_HIT_WIDTH = 16
/** 极窄过渡块保底最小可视宽度，与静止块对齐（重要记录/01-实施方案 风险控制） */
const MIN_TRANSITION_WIDTH = 16

interface TransitionClipBlockProps {
  shot: StageShot
  block: ShotClipBlock
  /** 点击块（含硬切剪切线）：1.2 过渡态打开旧抽屉，1.3 替换为参数气泡 */
  onOpen: () => void
}

/** 时间轴过渡块：更矮/更弱视觉重量，显示时长；0 帧过渡渲染为可点击的剪切竖线 */
const TransitionClipBlock: React.FC<TransitionClipBlockProps> = ({ shot, block, onOpen }) => {
  const isHardCut = block.width <= 0

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  if (isHardCut) {
    return (
      <div
        role="button"
        tabIndex={0}
        title="硬切（0 帧过渡），点击可调整"
        className="absolute inset-y-2 z-10 flex cursor-pointer items-center justify-center"
        style={{ left: block.x - HARD_CUT_HIT_WIDTH / 2, width: HARD_CUT_HIT_WIDTH }}
        onClick={onOpen}
        onKeyDown={handleKeyDown}
      >
        <span className="h-full w-0.5 rounded-full bg-text-muted transition-colors hover:bg-accent" />
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={`过渡 ${shot.transitionDuration.toFixed(2)}s`}
      className="absolute inset-y-3.5 flex cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-border-dark bg-layer/70 px-1 text-[10px] text-text-muted transition-colors hover:bg-layer"
      style={{ left: block.x, width: Math.max(block.width, MIN_TRANSITION_WIDTH) }}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
    >
      <Spline size={11} />
      <span className="truncate">{shot.transitionDuration.toFixed(2)}s</span>
    </div>
  )
}

export default TransitionClipBlock
