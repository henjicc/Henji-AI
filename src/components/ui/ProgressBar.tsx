import React from 'react'
import { UI_DATA_TWEEN_MS, uiTransition } from './motion'
import { UI_TEXT_META_CLASS } from './styleTokens'

interface ProgressBarProps {
    progress: number
    className?: string
    height?: string
    showPercentage?: boolean
    duration?: number  // 动画持续时间（毫秒）
    /**
     * `default`：强调色进度条；`hairline`：2px 细线（发丝线轨道 + 次要文字色填充），
     * 用于列表里进行中的条目（设计稿 Generation：进行中只显示进度细线），不带百分比。
     */
    appearance?: 'default' | 'hairline'
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    progress,
    className = '',
    height = 'h-2',
    showPercentage = true,
    duration = UI_DATA_TWEEN_MS,
    appearance = 'default'
}) => {
    const normalizedProgress = Math.min(100, Math.max(0, progress))
    if (appearance === 'hairline') {
        return (
            <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.floor(normalizedProgress)}
                className={`h-0.5 w-full overflow-hidden rounded-full bg-line ${className}`}
            >
                <div
                    className="h-full w-full origin-left bg-text2"
                    style={{
                        transform: `scaleX(${normalizedProgress / 100})`,
                        transition: uiTransition(['transform'], duration)
                    }}
                />
            </div>
        )
    }

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
