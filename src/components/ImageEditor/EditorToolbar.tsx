/**
 * EditorToolbar - 编辑器工具栏组件（双行布局）
 * 上排：工具按钮
 * 下排：工具选项（颜色、粗细、字号、裁剪比例）
 */
import React from 'react'
import {
    Crop,
    FlipHorizontal,
    FlipVertical,
    RotateCw,
    Square,
    Circle,
    ArrowRight,
    Type,
    Pencil,
    Undo2,
    Redo2,
    Check,
    X,
} from 'lucide-react'
import type { EditorTool, EditorToolbarProps, CropRatio } from './types'

// ==================== 常量 ====================

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

const RATIO_OPTIONS: { label: string; value: CropRatio }[] = [
    { label: '自由', value: 'free' },
    { label: '1:1', value: '1:1' },
    { label: '4:3', value: '4:3' },
    { label: '3:4', value: '3:4' },
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '3:2', value: '3:2' },
    { label: '原图', value: 'original' },
]

const TOOL_CONFIG: { tool: EditorTool; icon: React.ReactNode; label: string }[] = [
    { tool: 'crop', icon: <Crop size={18} />, label: '裁剪' },
    { tool: 'rect', icon: <Square size={18} />, label: '矩形' },
    { tool: 'circle', icon: <Circle size={18} />, label: '圆形' },
    { tool: 'arrow', icon: <ArrowRight size={18} />, label: '箭头' },
    { tool: 'text', icon: <Type size={18} />, label: '文字' },
    { tool: 'brush', icon: <Pencil size={18} />, label: '画笔' },
]

// ==================== 子组件 ====================

interface ToolButtonProps {
    icon: React.ReactNode
    label: string
    active?: boolean
    disabled?: boolean
    variant?: 'default' | 'confirm' | 'cancel'
    onClick: () => void
}

const ToolButton: React.FC<ToolButtonProps> = ({
    icon,
    label,
    active = false,
    disabled = false,
    variant = 'default',
    onClick,
}) => {
    const variantClass = variant === 'confirm'
        ? 'toolbar-button-confirm'
        : variant === 'cancel'
            ? 'toolbar-button-cancel'
            : ''

    return (
        <button
            className={`toolbar-button ${active ? 'active' : ''} ${variantClass}`}
            onClick={onClick}
            disabled={disabled}
            title={label}
        >
            {icon}
        </button>
    )
}

// 内联颜色选择器
interface InlineColorPickerProps {
    value: string
    onChange: (color: string) => void
}

const InlineColorPicker: React.FC<InlineColorPickerProps> = ({ value, onChange }) => {
    return (
        <div className="inline-color-picker">
            {COLORS.map((color) => (
                <button
                    key={color}
                    className={`inline-color-swatch ${value === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => onChange(color)}
                    title={color}
                />
            ))}
        </div>
    )
}

// 内联滑块
interface InlineSliderProps {
    label: string
    value: number
    min: number
    max: number
    onChange: (value: number) => void
}

const InlineSlider: React.FC<InlineSliderProps> = ({ label, value, min, max, onChange }) => {
    return (
        <div className="inline-slider">
            <span className="inline-slider-label">{label}</span>
            <input
                type="range"
                className="inline-slider-input"
                value={value}
                min={min}
                max={max}
                onChange={(e) => onChange(Number(e.target.value))}
            />
            <span className="inline-slider-value">{value}</span>
        </div>
    )
}

// ==================== 主组件 ====================

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
    currentTool,
    onToolChange,
    onFlipH,
    onFlipV,
    onRotate,
    onUndo,
    onRedo,
    onConfirm,
    onCancel,
    canUndo,
    canRedo,
    isCropping,
    // 工具设置
    toolSettings,
    onSettingsChange,
    maxStrokeWidth = 20,
    maxFontSize = 72,
    // 裁剪选项
    cropRatio,
    onCropRatioChange,
    onCropConfirm,
    onCropCancel,
}) => {
    const isDrawingTool = ['rect', 'circle', 'arrow', 'brush'].includes(currentTool)
    const isTextTool = currentTool === 'text'
    const showOptionsRow = isCropping || isDrawingTool || isTextTool

    return (
        <div className="editor-toolbar-container">
            {/* 上排：工具按钮 */}
            <div className="editor-toolbar toolbar-row-tools">
                {/* 编辑工具组 */}
                <div className="toolbar-group">
                    {TOOL_CONFIG.map(({ tool, icon, label }) => (
                        <ToolButton
                            key={tool}
                            icon={icon}
                            label={label}
                            active={currentTool === tool}
                            onClick={() => onToolChange(tool)}
                        />
                    ))}
                </div>

                {/* 变换工具组 */}
                <div className="toolbar-group">
                    <ToolButton
                        icon={<FlipHorizontal size={18} />}
                        label="水平翻转"
                        disabled={isCropping}
                        onClick={onFlipH}
                    />
                    <ToolButton
                        icon={<FlipVertical size={18} />}
                        label="垂直翻转"
                        disabled={isCropping}
                        onClick={onFlipV}
                    />
                    <ToolButton
                        icon={<RotateCw size={18} />}
                        label="顺时针旋转 90°"
                        disabled={isCropping}
                        onClick={onRotate}
                    />
                </div>

                {/* 撤销/重做组 */}
                <div className="toolbar-group">
                    <ToolButton
                        icon={<Undo2 size={18} />}
                        label="撤销 (Ctrl+Z)"
                        disabled={!canUndo}
                        onClick={onUndo}
                    />
                    <ToolButton
                        icon={<Redo2 size={18} />}
                        label="重做 (Ctrl+Shift+Z)"
                        disabled={!canRedo}
                        onClick={onRedo}
                    />
                </div>

                {/* 确认/取消组 */}
                <div className="toolbar-group">
                    <ToolButton
                        icon={<Check size={18} />}
                        label="保存编辑"
                        variant="confirm"
                        onClick={onConfirm}
                    />
                    <ToolButton
                        icon={<X size={18} />}
                        label="取消编辑"
                        variant="cancel"
                        onClick={onCancel}
                    />
                </div>
            </div>

            {/* 下排：工具选项 */}
            {showOptionsRow && (
                <div className="editor-toolbar toolbar-row-options">
                    {isCropping ? (
                        // 裁剪模式：比例选择 + 确认/取消
                        <>
                            <div className="crop-ratio-buttons">
                                {RATIO_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        className={`crop-ratio-btn ${cropRatio === opt.value ? 'active' : ''}`}
                                        onClick={() => onCropRatioChange?.(opt.value)}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                            <button className="crop-action-btn crop-action-confirm" onClick={() => onCropConfirm?.()}>
                                应用
                            </button>
                            <button className="crop-action-btn crop-action-cancel" onClick={() => onCropCancel?.()}>
                                取消
                            </button>
                        </>
                    ) : isDrawingTool ? (
                        // 绘图模式：颜色 + 粗细
                        <>
                            <InlineColorPicker
                                value={toolSettings.strokeColor}
                                onChange={(color) => onSettingsChange({ strokeColor: color })}
                            />
                            <div className="toolbar-divider" />
                            <InlineSlider
                                label="粗细"
                                value={toolSettings.strokeWidth}
                                min={1}
                                max={maxStrokeWidth}
                                onChange={(value) => onSettingsChange({ strokeWidth: value })}
                            />
                        </>
                    ) : isTextTool ? (
                        // 文字模式：颜色 + 字号
                        <>
                            <InlineColorPicker
                                value={toolSettings.strokeColor}
                                onChange={(color) => onSettingsChange({ strokeColor: color })}
                            />
                            <div className="toolbar-divider" />
                            <InlineSlider
                                label="字号"
                                value={toolSettings.fontSize}
                                min={12}
                                max={maxFontSize}
                                onChange={(value) => onSettingsChange({ fontSize: value })}
                            />
                        </>
                    ) : null}
                </div>
            )}
        </div>
    )
}

export default EditorToolbar
