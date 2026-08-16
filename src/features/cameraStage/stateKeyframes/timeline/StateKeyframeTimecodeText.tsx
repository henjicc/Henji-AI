import React from 'react'
import { formatStateKeyframeTimecode, nextStateKeyframeTimecodeMode, type StateKeyframeTimecodeMode } from './stateKeyframeTimecodeFormat'

/**
 * 状态关键帧工具条时间码文本：默认使用剪辑软件常见的 hh:mm:ss:ff，按住 Ctrl 点击可切换。
 * 纯秒 → 纯帧 → 秒:帧（hh:mm:ss:ff）→ 纯秒；显示模式为组件内部界面态，不进撤销历史。
 */

interface StateKeyframeTimecodeTextProps {
  currentTime: number
  duration: number
  fps: number
  mode: StateKeyframeTimecodeMode
  onModeChange: (mode: StateKeyframeTimecodeMode) => void
}

const StateKeyframeTimecodeText: React.FC<StateKeyframeTimecodeTextProps> = ({ currentTime, duration, fps, mode, onModeChange }) => {
  const handleClick = (event: React.MouseEvent<HTMLSpanElement>): void => {
    if (!event.ctrlKey) return
    onModeChange(nextStateKeyframeTimecodeMode(mode))
  }

  return (
    <span
      role="button"
      tabIndex={0}
      title="按住 Ctrl 点击切换时间码格式（秒 / 帧 / 秒:帧）"
      className="cursor-default select-none rounded px-1 font-mono text-xs tabular-nums text-accent hover:bg-layer"
      onClick={handleClick}
    >
      {formatStateKeyframeTimecode(currentTime, mode, fps)} / {formatStateKeyframeTimecode(duration, mode, fps)}
    </span>
  )
}

export default StateKeyframeTimecodeText
