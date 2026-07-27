import React from 'react'
import { UI_DATA_TWEEN_MS, uiTransition } from './motion'
import { UI_TEXT_META_CLASS } from './styleTokens'

interface ProgressBarProps {
    progress: number
    className?: string
    height?: string
    showPercentage?: boolean
    duration?: number  // 动画持续时间（毫秒）
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    progress,
    className = '',
    height = 'h-2',
    showPercentage = true,
    duration = UI_DATA_TWEEN_MS
}) => {
    const normalizedProgress = Math.min(100, Math.max(0, progress))

    return (
        <div className={`w-full ${className}`}>
            <div className={`w-full ${height} bg-layer rounded overflow-hidden`}>
                <div
                    className="h-full w-full origin-left bg-accent"
                    style={{
                        transform: `scaleX(${normalizedProgress / 100})`,
                        transition: uiTransition(['transform'], duration)
                    }}
                />
            </div>
            {showPercentage && (
                <div className={`mt-2 text-right ${UI_TEXT_META_CLASS}`}>
                    {Math.floor(normalizedProgress)}%
                </div>
            )}
        </div>
    )
}
