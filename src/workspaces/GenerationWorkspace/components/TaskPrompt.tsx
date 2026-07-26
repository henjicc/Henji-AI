import React from 'react'

export interface TaskPromptProps {
  prompt: string
}

export function TaskPrompt({ prompt }: TaskPromptProps): JSX.Element {
  const clampStyle: React.CSSProperties = {
    display: '-webkit-box',
    WebkitLineClamp: 1,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }

  return (
    <div className="min-w-0 flex-1 rounded-lg">
      <div
        className="text-sm text-text-dark leading-5 pr-10"
        style={clampStyle}
        title={prompt}
      >
        {prompt}
      </div>
    </div>
  )
}
