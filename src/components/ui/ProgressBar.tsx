import React from 'react'

interface ProgressBarProps {
    progress: number
    className?: string
    color?: string
    height?: string
    showPercentage?: boolean
    duration?: number  // 动画持续时间（毫秒）
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    progress,
    className = '',
    color = '#007eff',
    height = 'h-2',
    showPercentage = true,
    duration = 2800  // 默认 2800ms，提供丝滑的动画效果
}) => {
    const normalizedProgress = Math.min(100, Math.max(0, progress))

    return (
        <div className={`w-full ${className}`}>
            <div className={`w-full ${height} bg-zinc-700 rounded overflow-hidden`}>
                <div
                    className="h-full rounded ease-out"
                    style={{
                        width: `${normalizedProgress}%`,
                        backgroundColor: color,
                        transition: `all ${duration}ms ease-out`
                    }}
                />
            </div>
            {showPercentage && (
                <div className="mt-2 text-sm text-zinc-400 text-right">
                    {Math.floor(normalizedProgress)}%
                </div>
            )}
        </div>
    )
}
