import { Circle, Ellipse, Group, Line, Rect, Shape, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import {
  MARK_FONT_FAMILY,
  MARK_FONT_STYLE,
  TEXT_LINE_HEIGHT,
  numberBadgeRadius,
  resolveMosaicBlurRadius,
  resolveMosaicPixelSize,
  resolveTextBackgroundPadding,
  resolveTextBlockSize,
} from '../domain/metrics';
import { isLabeledMark, type LabeledMark, type MarkItem } from '../domain/types';
import {
  arrowToKonvaBezierPoints,
  resolveArrowHeadPoints,
  resolveArrowVisualBounds,
} from '../domain/arrowGeometry';
import { applyPointMarkTransform } from '../domain/geometry';
import { PEN_TENSION } from '../domain/penGeometry';
import { drawBlurRegion, drawMosaicRegion } from '../render/orientedImage';
import {
  ARROW_HITBOX_NODE_NAME,
  ARROW_SHAFT_NODE_NAME,
  arrowHeadNodeId,
  updateArrowHeadNodeGeometry,
} from './arrowNodes';
import { LabelTextNode } from './LabelTextNode';

/** 悬停在标记上时把光标切成移动型,离开时还原为工具光标 */
function setStageCursor(event: KonvaEventObject<MouseEvent>, cursor: string): void {
  const container = event.target.getStage()?.container();
  if (container) {
    container.style.cursor = cursor;
  }
}

interface MarkShapeNodeProps {
  item: MarkItem;
  /** 序号项的显示数字 */
  numberValue?: number;
  imageWidth: number;
  imageHeight: number;
  /** 按像素块尺寸取打码取样源 */
  getMosaicSource: (pixelSize: number) => HTMLCanvasElement | null;
  /** 高斯模糊模式的取样源(当前朝向位图) */
  blurSource?: HTMLCanvasElement | null;
  draggable: boolean;
  listening: boolean;
  /** 默认沿用旧编辑器的屏幕恒定描边；嵌入 V3 时按文档比例缩放。 */
  strokeScaleEnabled?: boolean;
  opacity?: number;
  /** 标签正在原位编辑时隐藏已渲染的标签文字 */
  hideLabel?: boolean;
  bindRef?: (id: string, node: Konva.Node | null) => void;
  /** 绑定标签自身的 Konva 节点,供 Transformer 单独定位 */
  bindLabelRef?: (id: string, node: Konva.Node | null) => void;
  onSelect?: (id: string) => void;
  /** 直接点击/拖动标签时触发,与选中父图形区分 */
  onSelectLabel?: (id: string) => void;
  onDragEnd?: (item: MarkItem, event: KonvaEventObject<DragEvent>) => void;
  onTransformEnd?: (item: MarkItem, event: KonvaEventObject<Event>) => void;
  onDblClick?: (item: MarkItem) => void;
  /** 标签被单独拖动后回写相对偏移 */
  onLabelDragEnd?: (item: LabeledMark, node: Konva.Node) => void;
  /** 标签独立选中后拖角变换,回写标签字号 */
  onLabelTransformEnd?: (item: LabeledMark, node: Konva.Node) => void;
}

export function MarkShapeNode({
  item,
  numberValue = 0,
  imageWidth,
  imageHeight,
  getMosaicSource,
  blurSource = null,
  draggable,
  listening,
  strokeScaleEnabled = false,
  opacity = 1,
  hideLabel = false,
  bindRef,
  bindLabelRef,
  onSelect,
  onSelectLabel,
  onDragEnd,
  onTransformEnd,
  onDblClick,
  onLabelDragEnd,
  onLabelTransformEnd,
}: MarkShapeNodeProps): JSX.Element {
  const commonHandlers = {
    draggable,
    listening,
    onClick: () => onSelect?.(item.id),
    onTap: () => onSelect?.(item.id),
    onDragEnd: (event: KonvaEventObject<DragEvent>) => onDragEnd?.(item, event),
    onTransformEnd: (event: KonvaEventObject<Event>) => onTransformEnd?.(item, event),
    onDblClick: (event: KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      onDblClick?.(item);
    },
    onMouseEnter: (event: KonvaEventObject<MouseEvent>) => setStageCursor(event, 'move'),
    onMouseLeave: (event: KonvaEventObject<MouseEvent>) => setStageCursor(event, ''),
  };

  const labelNode = isLabeledMark(item) && item.label && !hideLabel ? (
    <LabelTextNode
      item={item}
      imageWidth={imageWidth}
      imageHeight={imageHeight}
      opacity={opacity}
      listening={listening}
      strokeScaleEnabled={strokeScaleEnabled}
      bindRef={bindLabelRef}
      onSelect={onSelect}
      onSelectLabel={onSelectLabel}
      onDblClick={onDblClick}
      onLabelDragEnd={onLabelDragEnd}
      onLabelTransformEnd={onLabelTransformEnd}
    />
  ) : null;

  if (item.type === 'rect') {
    return (
      <>
        <Rect
          ref={(node) => bindRef?.(item.id, node)}
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          stroke={item.stroke}
          strokeWidth={item.lineWidth}
          // 透明填充让空心内部可命中,支持从中间拖动整体
          fill="transparent"
          opacity={opacity}
          strokeScaleEnabled={strokeScaleEnabled}
          hitStrokeWidth={Math.max(item.lineWidth, 12)}
          {...commonHandlers}
        />
        {labelNode}
      </>
    );
  }

  if (item.type === 'ellipse') {
    return (
      <>
        <Ellipse
          ref={(node) => bindRef?.(item.id, node)}
          x={item.x + item.width / 2}
          y={item.y + item.height / 2}
          radiusX={Math.max(1, item.width / 2)}
          radiusY={Math.max(1, item.height / 2)}
          stroke={item.stroke}
          strokeWidth={item.lineWidth}
          fill="transparent"
          opacity={opacity}
          strokeScaleEnabled={strokeScaleEnabled}
          hitStrokeWidth={Math.max(item.lineWidth, 12)}
          {...commonHandlers}
        />
        {labelNode}
      </>
    );
  }

  if (item.type === 'arrow') {
    const curved = Boolean(item.curveControl);
    const bounds = resolveArrowVisualBounds(item);
    const syncArrowHead = (node: Konva.Node): void => {
      const transformed = applyPointMarkTransform(
        item,
        node.x(),
        node.y(),
        node.scaleX(),
        node.scaleY()
      );
      if (transformed.type === 'arrow') {
        updateArrowHeadNodeGeometry(node, transformed);
        node.getLayer()?.batchDraw();
      }
    };
    return (
      <>
        <Group
          ref={(node) => bindRef?.(item.id, node)}
          opacity={opacity}
          {...commonHandlers}
          onDragMove={(event) => syncArrowHead(event.target)}
          onTransform={(event) => syncArrowHead(event.target)}
          onDragEnd={(event) => {
            syncArrowHead(event.target);
            onDragEnd?.(item, event);
          }}
          onTransformEnd={(event) => {
            syncArrowHead(event.target);
            onTransformEnd?.(item, event);
          }}
        >
          <Rect
            name={ARROW_HITBOX_NODE_NAME}
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            fill="transparent"
          />
          <Line
            name={ARROW_SHAFT_NODE_NAME}
            points={curved ? arrowToKonvaBezierPoints(item) : item.points}
            bezier={curved}
            stroke={item.stroke}
            strokeWidth={item.lineWidth}
            strokeScaleEnabled={strokeScaleEnabled}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        </Group>
        <Line
          id={arrowHeadNodeId(item.id)}
          points={resolveArrowHeadPoints(item)}
          closed
          fill={item.stroke}
          stroke={item.stroke}
          strokeWidth={item.lineWidth}
          strokeScaleEnabled={strokeScaleEnabled}
          opacity={opacity}
          listening={false}
        />
        {labelNode}
      </>
    );
  }

  if (item.type === 'pen') {
    return (
      <Line
        ref={(node) => bindRef?.(item.id, node)}
        points={item.points}
        stroke={item.stroke}
        strokeWidth={item.lineWidth}
        tension={PEN_TENSION}
        lineJoin="round"
        lineCap="round"
        opacity={opacity}
        strokeScaleEnabled={strokeScaleEnabled}
        hitStrokeWidth={Math.max(item.lineWidth, 12)}
        {...commonHandlers}
      />
    );
  }

  if (item.type === 'text') {
    const textSize = resolveTextBlockSize(item.text, item.fontSize);
    const padding = item.backgroundColor ? resolveTextBackgroundPadding(item.fontSize) : 0;
    return (
      <Group
        ref={(node) => bindRef?.(item.id, node)}
        x={item.x}
        y={item.y}
        opacity={opacity}
        {...commonHandlers}
      >
        {item.backgroundColor && (
          <Rect
            x={-padding}
            y={-padding}
            width={textSize.width + padding * 2}
            height={textSize.height + padding * 2}
            fill={item.backgroundColor}
          />
        )}
        <Text
          text={item.text}
          fill={item.color}
          fontStyle={MARK_FONT_STYLE}
          fontFamily={MARK_FONT_FAMILY}
          fontSize={item.fontSize}
          lineHeight={TEXT_LINE_HEIGHT}
        />
      </Group>
    );
  }

  if (item.type === 'number') {
    const radius = numberBadgeRadius(item.fontSize);
    return (
      <Group
        ref={(node) => bindRef?.(item.id, node)}
        x={item.x}
        y={item.y}
        opacity={opacity}
        {...commonHandlers}
      >
        <Circle
          radius={radius}
          fill={item.color}
        />
        <Text
          x={-radius}
          y={-radius}
          width={radius * 2}
          height={radius * 2}
          align="center"
          verticalAlign="middle"
          lineHeight={1}
          text={String(numberValue)}
          fill={WHITE_HEX}
          fontStyle={MARK_FONT_STYLE}
          fontFamily={MARK_FONT_FAMILY}
          fontSize={item.fontSize}
          listening={false}
        />
      </Group>
    );
  }

  // mosaic:sceneFunc 直接从取样源低清放大/模糊绘制
  const mosaicPixelSize = item.type === 'mosaic'
    ? resolveMosaicPixelSize(imageWidth, imageHeight, item.strengthPercent)
    : 0;
  const mosaicBlurRadius = item.type === 'mosaic'
    ? resolveMosaicBlurRadius(imageWidth, imageHeight, item.strengthPercent)
    : 0;
  const isBlurMode = item.type === 'mosaic' && item.mode === 'blur';
  return (
    <Shape
      ref={(node) => bindRef?.(item.id, node)}
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      opacity={opacity}
      sceneFunc={(context, shape) => {
        const native = context._context;
        const region = { x: shape.x(), y: shape.y(), width: shape.width(), height: shape.height() };
        if (isBlurMode && blurSource) {
          drawBlurRegion(native, blurSource, mosaicBlurRadius, region, 0, 0);
          return;
        }
        const mosaicSource = getMosaicSource(mosaicPixelSize);
        if (mosaicSource) {
          drawMosaicRegion(native, mosaicSource, mosaicPixelSize, region, 0, 0);
        } else {
          native.fillStyle = 'rgba(127, 127, 127, 0.6)';
          native.fillRect(0, 0, shape.width(), shape.height());
        }
      }}
      hitFunc={(context, shape) => {
        context.beginPath();
        context.rect(0, 0, shape.width(), shape.height());
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      {...commonHandlers}
    />
  );
}
