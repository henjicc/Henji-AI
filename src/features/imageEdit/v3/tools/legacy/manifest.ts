import { ArrowUpRight, Bandage, CircleDashed, Crop, Eraser, Hand, LassoSelect, MessageSquareText, Move, Paintbrush, Scan, VectorSquare, WandSparkles, ZoomIn } from 'lucide-react'
import type { ToolManifest } from '../../toolFramework/toolManifest'
import type { ImageEditorHostProfileIdV3 } from '../../application/imageEditorHostProfiles'

const all: readonly ImageEditorHostProfileIdV3[] = ['full', 'quick', 'canvas-edit', 'mask']
const editing: readonly ImageEditorHostProfileIdV3[] = ['full', 'canvas-edit']
const painting: readonly ImageEditorHostProfileIdV3[] = [...editing, 'mask']
const marking: readonly ImageEditorHostProfileIdV3[] = [...editing, 'quick']
const navigation = { id: 'navigation', order: 0 }
const cropping = { id: 'crop', order: 1 }
const selection = { id: 'selection', order: 2, collapsed: true, labelKey: 'imageEditor.v3.selection.overlay', expandedProfiles: ['mask'] as const }
const repair = { id: 'repair', order: 3 }
const annotation = { id: 'annotation', order: 4, collapsed: true, labelKey: 'imageEditor.v3.tools.annotation', triggerId: 'annotation' }
const paint = { id: 'paint', order: 5 }

const specs = {
  move: { icon: Move, group: navigation, profiles: all, input: 'move', cursor: 'cursor-default', shortcut: 'KeyV' },
  hand: { icon: Hand, group: navigation, profiles: all, input: 'navigation', cursor: 'cursor-grab active:cursor-grabbing', shortcut: 'KeyH' },
  zoom: { icon: ZoomIn, group: navigation, profiles: all, input: 'navigation', cursor: 'cursor-zoom-in' },
  crop: { icon: Crop, group: cropping, profiles: marking, input: 'overlay', cursor: 'cursor-default', shortcut: 'KeyC' },
  'select-rect': { icon: VectorSquare, group: selection, profiles: painting, input: 'overlay', cursor: 'cursor-crosshair', shortcut: 'KeyM' },
  'select-ellipse': { icon: Scan, group: selection, profiles: painting, input: 'overlay', cursor: 'cursor-crosshair' },
  'select-lasso': { icon: LassoSelect, group: selection, profiles: painting, input: 'overlay', cursor: 'cursor-crosshair', shortcut: 'KeyL' },
  'select-polygon': { icon: LassoSelect, group: selection, profiles: editing, input: 'overlay', cursor: 'cursor-crosshair' },
  'select-brush': { icon: Paintbrush, group: selection, profiles: editing, input: 'overlay', cursor: 'cursor-crosshair' },
  'select-subject': { icon: WandSparkles, group: selection, profiles: editing, input: 'overlay', cursor: 'cursor-crosshair' },
  'select-subject-box': { icon: Scan, group: selection, profiles: editing, input: 'overlay', cursor: 'cursor-crosshair' },
  remove: { icon: WandSparkles, group: repair, profiles: editing, input: 'overlay', cursor: 'cursor-crosshair', requiresRasterTarget: true },
  repair: { icon: Bandage, group: repair, profiles: editing, input: 'overlay', cursor: 'cursor-crosshair', requiresRasterTarget: true },
  'annotation-text': { icon: MessageSquareText, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-text', shortcut: 'KeyT' },
  'annotation-callout': { icon: MessageSquareText, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'annotation-arrow': { icon: ArrowUpRight, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'annotation-rect': { icon: VectorSquare, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'annotation-ellipse': { icon: CircleDashed, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'annotation-number': { icon: MessageSquareText, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'annotation-pen': { icon: Paintbrush, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'annotation-mosaic': { icon: MessageSquareText, group: annotation, profiles: marking, input: 'overlay', cursor: 'cursor-crosshair' },
  'raster-brush': { icon: Paintbrush, group: paint, profiles: painting, input: 'overlay', cursor: 'cursor-crosshair', shortcut: 'KeyB', requiresRasterTarget: true },
  eraser: { icon: Eraser, group: paint, profiles: painting, input: 'overlay', cursor: 'cursor-crosshair', shortcut: 'KeyE', requiresRasterTarget: true },
  'mask-edit': { icon: CircleDashed, group: paint, profiles: painting, input: 'overlay', cursor: 'cursor-crosshair' },
} as const

declare module '../../toolFramework/types' {
  interface ImageEditorToolCatalog extends Record<keyof typeof specs, true> {}
}

const intents: Record<keyof typeof specs, string> = {
  move: '选择图层并移动、缩放、旋转或错切；完成手势后一次写入作品。',
  hand: '平移工作画面，保持作品内容不变。',
  zoom: '缩放工作画面，保持作品内容不变。',
  crop: '调整图片输出范围，确认应用或取消裁剪草稿。',
  'select-rect': '拖出矩形选区，按当前组合方式替换、添加、减去或相交。',
  'select-ellipse': '拖出椭圆选区，按当前组合方式应用。',
  'select-lasso': '沿手绘路径围出选区，按当前组合方式应用。',
  'select-polygon': '逐点构建多边形选区，双击或回车完成，取消不改变原选区。',
  'select-brush': '用画笔刷选区域，按当前组合方式应用。',
  'select-subject': '点选主体，由已有主体服务先生成可校正选区。',
  'select-subject-box': '框出主体搜索范围，由已有主体服务生成选区。',
  remove: '刷选要移除的区域，委托已有本地移除服务并回填当前图层。',
  repair: '从当前选区拖到供体位置，委托已有修补服务回填当前图层。',
  'annotation-text': '在图层上添加可编辑文字标记，输入期间保留文字与输入法快捷键。',
  'annotation-callout': '添加带文字的矩形或椭圆说明框。',
  'annotation-arrow': '添加箭头标记并调整端点和弯曲控制点。',
  'annotation-rect': '添加矩形标记。',
  'annotation-ellipse': '添加椭圆标记。',
  'annotation-number': '在指定位置添加序号标记。',
  'annotation-pen': '在图层上绘制手写标记路径。',
  'annotation-mosaic': '添加像素化或模糊的遮盖标记。',
  'raster-brush': '在当前栅格图层绘画，保留压感和整笔撤销。',
  eraser: '擦除当前栅格图层像素，保留压感和整笔撤销。',
  'mask-edit': '在当前图层蒙版上绘制或擦除覆盖。',
}

export const legacyToolManifest: readonly ToolManifest[] = (Object.keys(specs) as (keyof typeof specs)[]).map(id => ({
  ...specs[id], id, labelKey: `imageEditor.v3.tools.${id}`, description: intents[id], aliases: [id],
  ...(specs[id].group.id === 'annotation' ? { legacyFinalMove: true } : {}),
}))
