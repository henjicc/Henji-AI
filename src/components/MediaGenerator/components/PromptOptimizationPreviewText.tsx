import React from 'react'
import type { PromptOptimizationPreviewGlyph } from '../hooks/usePromptOptimizationPreviewPlayback'

interface PromptOptimizationPreviewTextProps {
  className: string
  glyphs: PromptOptimizationPreviewGlyph[]
}

export const PromptOptimizationPreviewText: React.FC<PromptOptimizationPreviewTextProps> = ({
  className,
  glyphs,
}) => {
  if (glyphs.length === 0) {
    return null
  }

  return (
    <span className={className}>
      {glyphs.map(glyph => (
        <span key={glyph.id} className="prompt-optimize-preview__glyph">
          {glyph.value}
        </span>
      ))}
    </span>
  )
}
