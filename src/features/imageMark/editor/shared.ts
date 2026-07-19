import {
  ArrowRight,
  Brush,
  Circle,
  Crop,
  Grid3x3,
  ListOrdered,
  MessageSquareText,
  MousePointer2,
  Square,
  Type,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MarkItem, MarkToolType } from '../domain/types';
import { normalizeMarkRect } from '../domain/geometry';
import { DEFAULT_MOSAIC_STRENGTH_PERCENT } from '../domain/metrics';

export const VIEWPORT_PADDING_PX = 16;
export const VIEWPORT_MIN_WIDTH_PX = 220;
export const VIEWPORT_MIN_HEIGHT_PX = 180;
export const HISTORY_LIMIT = 40;
export const DEFAULT_VIEWPORT_CLASS = 'h-[min(62vh,640px)]';

export interface MarkEditorStyleState {
  color: string;
  lineWidthPercent: number;
  textSizePercent: number;
  mosaicStrengthPercent: number;
}

export type DraftState = {
  tool: 'callout' | 'rect' | 'ellipse' | 'arrow' | 'pen' | 'mosaic';
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  shiftKey: boolean;
  points?: number[];
};

export interface TextEditorState {
  /** text: 独立文字;label: 挂在图形旁的标签 */
  kind: 'text' | 'label';
  /** text 模式为文字项 id(新建为 null);label 模式为宿主图形 id */
  itemId: string | null;
  x: number;
  y: number;
  value: string;
  /** 原位输入使用的字号(图片像素)与颜色,与最终渲染一致 */
  fontSize: number;
  color: string;
}

export interface ToolButtonDef {
  type: MarkToolType;
  label: string;
  shortcut: string;
  icon: LucideIcon;
}

export const TOOL_BUTTONS: ToolButtonDef[] = [
  { type: 'select', label: '选择', shortcut: 'V', icon: MousePointer2 },
  { type: 'callout', label: '标注', shortcut: 'B', icon: MessageSquareText },
  { type: 'rect', label: '矩形', shortcut: 'R', icon: Square },
  { type: 'ellipse', label: '圆形', shortcut: 'O', icon: Circle },
  { type: 'arrow', label: '箭头', shortcut: 'A', icon: ArrowRight },
  { type: 'number', label: '序号', shortcut: 'N', icon: ListOrdered },
  { type: 'text', label: '文字', shortcut: 'T', icon: Type },
  { type: 'pen', label: '画笔', shortcut: 'P', icon: Brush },
  { type: 'mosaic', label: '打码', shortcut: 'M', icon: Grid3x3 },
  { type: 'crop', label: '裁剪', shortcut: 'C', icon: Crop },
];

export const TOOL_SHORTCUT_MAP: Record<string, MarkToolType> = Object.fromEntries(
  TOOL_BUTTONS.map((button) => [button.shortcut.toLowerCase(), button.type])
) as Record<string, MarkToolType>;

export interface CropRatioOption {
  label: string;
  value: string;
  ratio?: number;
}

export const CROP_RATIO_OPTIONS: CropRatioOption[] = [
  { label: '自由', value: 'free' },
  { label: '原图', value: 'original' },
  { label: '1:1', value: '1:1', ratio: 1 },
  { label: '4:3', value: '4:3', ratio: 4 / 3 },
  { label: '3:4', value: '3:4', ratio: 3 / 4 },
  { label: '16:9', value: '16:9', ratio: 16 / 9 },
  { label: '9:16', value: '9:16', ratio: 9 / 16 },
  { label: '2:1', value: '2:1', ratio: 2 },
  { label: '21:9', value: '21:9', ratio: 21 / 9 },
];

export function toNumber(value: DynamicValue, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function toText(value: DynamicValue, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Shift 约束:矩形/椭圆取正形,箭头吸附 45° */
function constrainDraftEnd(
  draft: DraftState,
  currentX: number,
  currentY: number
): { x: number; y: number } {
  if (!draft.shiftKey) {
    return { x: currentX, y: currentY };
  }
  const dx = currentX - draft.startX;
  const dy = currentY - draft.startY;
  if (draft.tool === 'rect' || draft.tool === 'callout' || draft.tool === 'ellipse' || draft.tool === 'mosaic') {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: draft.startX + Math.sign(dx || 1) * size,
      y: draft.startY + Math.sign(dy || 1) * size,
    };
  }
  if (draft.tool === 'arrow') {
    const angle = Math.atan2(dy, dx);
    const snapped = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4;
    const length = Math.hypot(dx, dy);
    return {
      x: draft.startX + Math.cos(snapped) * length,
      y: draft.startY + Math.sin(snapped) * length,
    };
  }
  return { x: currentX, y: currentY };
}

export function buildDraftMark(
  draft: DraftState | null,
  color: string,
  lineWidth: number,
  mosaicStrengthPercent: number = DEFAULT_MOSAIC_STRENGTH_PERCENT
): MarkItem | null {
  if (!draft) {
    return null;
  }

  if (draft.tool === 'pen') {
    const points = [...(draft.points ?? [draft.startX, draft.startY]), draft.currentX, draft.currentY];
    return {
      id: 'draft-pen',
      type: 'pen',
      points,
      stroke: color,
      lineWidth,
    };
  }

  const end = constrainDraftEnd(draft, draft.currentX, draft.currentY);

  if (draft.tool === 'arrow') {
    return {
      id: 'draft-arrow',
      type: 'arrow',
      points: [draft.startX, draft.startY, end.x, end.y],
      stroke: color,
      lineWidth,
    };
  }

  const rect = normalizeMarkRect(draft.startX, draft.startY, end.x, end.y);
  if (draft.tool === 'mosaic') {
    return {
      id: 'draft-mosaic',
      type: 'mosaic',
      ...rect,
      strengthPercent: mosaicStrengthPercent,
    };
  }

  // 标注(callout)在数据上就是带 label 的矩形,草稿阶段先画纯矩形
  return {
    id: draft.tool === 'ellipse' ? 'draft-ellipse' : 'draft-rect',
    type: draft.tool === 'ellipse' ? 'ellipse' : 'rect',
    ...rect,
    stroke: color,
    lineWidth,
  };
}

/** 取标记项的"位置"(左上角/最小点),用于键盘微调 */
export function getMarkPosition(item: MarkItem): { x: number; y: number } {
  if (item.type === 'arrow' || item.type === 'pen') {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (let index = 0; index < item.points.length; index += 2) {
      minX = Math.min(minX, item.points[index]);
      minY = Math.min(minY, item.points[index + 1]);
    }
    return { x: minX, y: minY };
  }
  return { x: item.x, y: item.y };
}
