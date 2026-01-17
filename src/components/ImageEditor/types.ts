/**
 * Image Editor - 类型定义
 */

// ==================== 标注类型 ====================

export type AnnotationType = 'rect' | 'circle' | 'arrow' | 'text' | 'brush' | 'mosaic'

export interface BaseAnnotation {
    id: string
    type: AnnotationType
    x: number
    y: number
    rotation?: number
    scaleX?: number
    scaleY?: number
}

export interface RectAnnotation extends BaseAnnotation {
    type: 'rect'
    width: number
    height: number
    stroke: string
    strokeWidth: number
    fill?: string
}

export interface CircleAnnotation extends BaseAnnotation {
    type: 'circle'
    radiusX: number
    radiusY: number
    stroke: string
    strokeWidth: number
    fill?: string
}

export interface ArrowAnnotation extends BaseAnnotation {
    type: 'arrow'
    points: number[]  // [x1, y1, x2, y2]
    stroke: string
    strokeWidth: number
    pointerLength?: number
    pointerWidth?: number
}

export interface TextAnnotation extends BaseAnnotation {
    type: 'text'
    text: string
    fontSize: number
    fontFamily: string
    fill: string
    width?: number
}

export interface BrushAnnotation extends BaseAnnotation {
    type: 'brush'
    points: number[]  // [x1, y1, x2, y2, ...]
    stroke: string
    strokeWidth: number
    tension?: number
    lineCap?: 'round' | 'butt' | 'square'
    lineJoin?: 'round' | 'bevel' | 'miter'
}

export interface MosaicAnnotation extends BaseAnnotation {
    type: 'mosaic'
    width: number
    height: number
    pixelSize: number
}

export type Annotation =
    | RectAnnotation
    | CircleAnnotation
    | ArrowAnnotation
    | TextAnnotation
    | BrushAnnotation
    | MosaicAnnotation

// ==================== 编辑工具类型 ====================

export type EditorTool =
    | 'select'    // 选择/移动
    | 'crop'      // 裁剪
    | 'rect'      // 矩形
    | 'circle'    // 圆形
    | 'arrow'     // 箭头
    | 'text'      // 文字
    | 'brush'     // 画笔
    | 'mosaic'    // 马赛克

// ==================== 裁剪比例 ====================

export type CropRatio =
    | 'free'      // 自由裁剪
    | '1:1'       // 正方形
    | '4:3'       // 标准
    | '3:4'
    | '16:9'      // 宽屏
    | '9:16'
    | '3:2'
    | '2:3'
    | '21:9'      // 超宽屏
    | '4:5'       // Instagram
    | '2:1'       // Twitter
    | 'original'  // 原始比例

export interface CropRatioOption {
    label: string
    value: CropRatio
    ratio?: number  // width / height, undefined for 'free' and 'original'
}

export const CROP_RATIO_OPTIONS: CropRatioOption[] = [
    { label: '自由', value: 'free' },
    { label: '1:1', value: '1:1', ratio: 1 },
    { label: '4:3', value: '4:3', ratio: 4 / 3 },
    { label: '3:4', value: '3:4', ratio: 3 / 4 },
    { label: '16:9', value: '16:9', ratio: 16 / 9 },
    { label: '9:16', value: '9:16', ratio: 9 / 16 },
    { label: '3:2', value: '3:2', ratio: 3 / 2 },
    { label: '2:3', value: '2:3', ratio: 2 / 3 },
    { label: '21:9', value: '21:9', ratio: 21 / 9 },
    { label: '4:5', value: '4:5', ratio: 4 / 5 },
    { label: '2:1', value: '2:1', ratio: 2 / 1 },
    { label: '原图', value: 'original' },
]

// ==================== 裁剪区域 ====================

export interface CropRect {
    x: number
    y: number
    width: number
    height: number
}

// ==================== 画布状态 ====================

export interface CanvasState {
    flipH: boolean
    flipV: boolean
    rotation: number  // 0, 90, 180, 270
    cropRect?: CropRect
    annotations: Annotation[]
}

// ==================== 操作记录 ====================

export type OperationType =
    | 'flip_h'
    | 'flip_v'
    | 'rotate'
    | 'crop'
    | 'add_annotation'
    | 'modify_annotation'
    | 'delete_annotation'

export interface EditorOperation {
    type: OperationType
    timestamp: number
    data: any  // 操作相关数据，用于撤销/重做
    prevState?: Partial<CanvasState>  // 操作前的状态快照
}

// ==================== 编辑状态 ====================

export interface ImageEditState {
    imageId: string
    originalDataUrl: string
    operations: EditorOperation[]
    currentIndex: number  // 当前操作位置，-1 表示初始状态
    canvas: CanvasState
}

// ==================== 工具设置 ====================

export interface ToolSettings {
    strokeColor: string
    fillColor: string
    strokeWidth: number
    fontSize: number
    fontFamily: string
    opacity: number
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
    strokeColor: '#ff0000',
    fillColor: 'transparent',
    strokeWidth: 3,
    fontSize: 24,
    fontFamily: 'Arial',
    opacity: 1,
}

// ==================== 预设颜色 ====================

export const PRESET_COLORS = [
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

// ==================== 组件 Props ====================

export interface ImageEditorProps {
    imageUrl: string
    imageId: string
    imageList?: string[]
    currentIndex?: number
    initialEditState?: ImageEditState
    onClose: () => void
    onSave: (dataUrl: string, editState: ImageEditState) => void
    onNavigate?: (direction: 'prev' | 'next') => void
}

export interface EditorToolbarProps {
    currentTool: EditorTool
    onToolChange: (tool: EditorTool) => void
    onFlipH: () => void
    onFlipV: () => void
    onRotate: () => void
    onUndo: () => void
    onRedo: () => void
    onConfirm: () => void
    onCancel: () => void
    canUndo: boolean
    canRedo: boolean
    isCropping: boolean
    // 工具设置
    toolSettings: ToolSettings
    onSettingsChange: (settings: Partial<ToolSettings>) => void
    maxStrokeWidth?: number
    maxFontSize?: number
    // 裁剪选项
    cropRatio?: CropRatio
    onCropRatioChange?: (ratio: CropRatio) => void
    onCropConfirm?: () => void
    onCropCancel?: () => void
}

export interface ToolSettingsProps {
    currentTool: EditorTool
    settings: ToolSettings
    onSettingsChange: (settings: Partial<ToolSettings>) => void
    maxStrokeWidth?: number
    maxFontSize?: number
}

export interface CropOverlayProps {
    imageWidth: number
    imageHeight: number
    cropRect: CropRect
    cropRatio: CropRatio
    onCropRectChange: (rect: CropRect) => void
}

// ==================== 工具函数类型 ====================

export interface EditorHistoryHook {
    state: ImageEditState
    pushOperation: (op: EditorOperation) => void
    undo: () => void
    redo: () => void
    canUndo: boolean
    canRedo: boolean
    reset: () => void
}

// ==================== 初始状态工厂 ====================

export function createInitialEditState(imageId: string, originalDataUrl: string): ImageEditState {
    return {
        imageId,
        originalDataUrl,
        operations: [],
        currentIndex: -1,
        canvas: {
            flipH: false,
            flipV: false,
            rotation: 0,
            annotations: [],
        },
    }
}

export function createInitialCanvasState(): CanvasState {
    return {
        flipH: false,
        flipV: false,
        rotation: 0,
        annotations: [],
    }
}
