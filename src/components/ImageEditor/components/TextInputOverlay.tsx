import React, { useMemo } from 'react'

import type { Annotation, TextAnnotation, ToolSettings } from '../types'
import { TEXT_LINE_HEIGHT } from '../utils/textMetrics'
import { UiTextAreaField } from '@/components/ui'

interface TextInputOverlayProps {
    isEditing: boolean
    textInputRef: React.RefObject<HTMLTextAreaElement>
    position: { x: number; y: number }
    value: string
    onChange: (value: string) => void
    onConfirm: () => void
    onCancel: () => void
    textEditingId: string | null
    annotations: Annotation[]
    toolSettings: ToolSettings
    displaySize: { width: number; height: number }
    stageSize: { width: number; height: number }
    placeholder: string
}

export const TextInputOverlay: React.FC<TextInputOverlayProps> = ({
    isEditing,
    textInputRef,
    position,
    value,
    onChange,
    onConfirm,
    onCancel,
    textEditingId,
    annotations,
    toolSettings,
    displaySize,
    stageSize,
    placeholder,
}) => {
    const activeText = useMemo(() => {
        if (!textEditingId) return undefined
        const annotation = annotations.find(a => a.id === textEditingId && a.type === 'text')
        return annotation as TextAnnotation | undefined
    }, [annotations, textEditingId])

    if (!isEditing) return null

    const scale = displaySize.width > 0 ? stageSize.width / displaySize.width : 1
    const fontSize = (activeText ? activeText.fontSize : toolSettings.fontSize) * scale
    const color = activeText ? activeText.fill : toolSettings.strokeColor
    const fontFamily = activeText ? activeText.fontFamily : toolSettings.fontFamily

    return (
        <UiTextAreaField
            ref={textInputRef}
            className="text-input-overlay"
            style={{
                position: 'absolute',
                left: position.x,
                top: position.y,
                fontSize,
                color: 'transparent',
                caretColor: 'transparent',
                fontFamily,
                lineHeight: `${TEXT_LINE_HEIGHT}`,
                background: 'transparent',
                border: 'none',
                padding: 0,
                minWidth: '1px',
                minHeight: '1px',
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
            }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onConfirm}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    onCancel()
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onConfirm()
                }
            }}
            placeholder={placeholder}
        />
    )
}
