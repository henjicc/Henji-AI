import React, { useState } from 'react'
import { formatShotTimecode, nextShotTimecodeMode, type ShotTimecodeMode } from './shotTimecodeFormat'

/**
 * 简易模式工具条时间码文本（重要记录 008）：默认显示纯秒，按住 Ctrl 键点击循环切换
 * 纯秒 → 纯帧 → 秒:帧（hh:mm:ss:ff）→ 纯秒；显示模式为组件内部界面态，不进撤销历史。
 */

interface ShotTimecodeTextProps {
  currentTime: number
  duration: number
  fps: number
}

const ShotTimecodeText: React.FC<ShotTimecodeTextProps> = ({ currentTime, duration, fps }) => {
  const [mode, setMode] = useState<ShotTimecodeMode>('seconds')

  const handleClick = (event: React.MouseEvent<HTMLSpanElement>): void => {
    if (!event.ctrlKey) return
    setMode((current) => nextShotTimecodeMode(current))
  }

  return (
    <span
      role="button"
      tabIndex={0}
      title="按住 Ctrl 点击切换时间码格式（秒 / 帧 / 秒:帧）"
      className="cursor-default select-none rounded px-1 tabular-nums text-xs text-text-muted hover:bg-layer"
      onClick={handleClick}
    >
      {formatShotTimecode(currentTime, mode, fps)} / {formatShotTimecode(duration, mode, fps)}
    </span>
  )
}

export default ShotTimecodeText
