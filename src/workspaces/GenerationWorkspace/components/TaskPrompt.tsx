import React from 'react'
import { UI_TEXT_BODY_CLASS } from '@/components/ui'

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
        className={`pr-10 leading-5 ${UI_TEXT_BODY_CLASS}`}
        style={clampStyle}
        title={prompt}
      >
        {prompt}
      </div>
    </div>
  )
}
