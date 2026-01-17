/**
 * ToolSettings - 工具设置面板组件
 */
import React from 'react'
import type { EditorTool, ToolSettingsProps } from './types'

const COLORS = [
    '#ff0000',  // 红
    '#ff6b00',  // 橙
    '#ffd000',  // 黄
    '#00c853',  // 绿
    '#00b0ff',  // 蓝
    '#7c4dff',  // 紫
    '#ff4081',  // 粉
    '#ffffff',  // 白
    '#000000',  // 黑
]

interface ColorPickerProps {
    value: string
    onChange: (color: string) => void
}

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange }) => {
    return (
        <div className="color-picker">
            {COLORS.map((color) => (
                <button
                    key={color}
                    className={`color-swatch ${value === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => onChange(color)}
                />
            ))}
        </div>
    )
}

interface SliderProps {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
}

const Slider: React.FC<SliderProps> = ({ value, min, max, onChange }) => {
    return (
        <input
            type="range"
            className="settings-slider"
            value={value}
            min={min}
            max={max}
            onChange={(e) => onChange(Number(e.target.value))}
        />
    )
}

// 根据工具类型决定显示哪些设置
const getSettingsForTool = (tool: EditorTool): ('color' | 'strokeWidth' | 'fontSize')[] => {
    switch (tool) {
        case 'rect':
        case 'circle':
        case 'arrow':
            return ['color', 'strokeWidth']
        case 'text':
            return ['color', 'fontSize']
        case 'brush':
            return ['color', 'strokeWidth']
        case 'mosaic':
            return [] // 马赛克暂不需要设置
        default:
            return []
    }
}

export const ToolSettingsPanel: React.FC<ToolSettingsProps> = ({
    currentTool,
    settings,
    onSettingsChange,
    maxStrokeWidth = 20,
    maxFontSize = 72,
}) => {
    const visibleSettings = getSettingsForTool(currentTool)

    // 如果没有需要显示的设置，不渲染面板
    if (visibleSettings.length === 0) {
        return null
    }

    return (
        <div className="tool-settings-panel">
            {visibleSettings.includes('color') && (
                <div className="settings-group">
                    <span className="settings-label">颜色</span>
                    <ColorPicker
                        value={settings.strokeColor}
                        onChange={(color) => onSettingsChange({ strokeColor: color })}
                    />
                </div>
            )}

            {visibleSettings.includes('strokeWidth') && (
                <div className="settings-group">
                    <span className="settings-label">粗细</span>
                    <Slider
                        value={settings.strokeWidth}
                        min={1}
                        max={maxStrokeWidth}
                        onChange={(value) => onSettingsChange({ strokeWidth: value })}
                    />
                    <span className="settings-label">{settings.strokeWidth}px</span>
                </div>
            )}

            {visibleSettings.includes('fontSize') && (
                <div className="settings-group">
                    <span className="settings-label">字号</span>
                    <Slider
                        value={settings.fontSize}
                        min={12}
                        max={maxFontSize}
                        onChange={(value) => onSettingsChange({ fontSize: value })}
                    />
                    <span className="settings-label">{settings.fontSize}px</span>
                </div>
            )}
        </div>
    )
}

export default ToolSettingsPanel
