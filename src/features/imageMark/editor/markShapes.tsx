import { Arrow, Circle, Ellipse, Group, Line, Rect, Shape, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { WHITE_HEX } from '@/core/theme/colorTokens';
import {
  MARK_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  numberBadgeRadius,
  resolveLabelConnector,
  resolveLabelFontSize,
  resolveLabelPlacement,
  resolveMosaicBlurRadius,
  resolveMosaicPixelSize,
  resolveTextBaseSize,
} from '../domain/metrics';
import { isLabeledMark, type LabeledMark, type MarkItem } from '../domain/types';
import { drawBlurRegion, drawMosaicRegion } from '../render/orientedImage';

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
  opacity?: number;
  /** 标签正在原位编辑时隐藏已渲染的标签文字 */
  hideLabel?: boolean;
  bindRef?: (id: string, node: Konva.Node | null) => void;
  onSelect?: (id: string) => void;
  onDragEnd?: (item: MarkItem, event: KonvaEventObject<DragEvent>) => void;
  onTransformEnd?: (item: MarkItem, event: KonvaEventObject<Event>) => void;
  onDblClick?: (item: MarkItem) => void;
  /** 标签被单独拖动后回写相对偏移 */
  onLabelDragEnd?: (item: LabeledMark, node: Konva.Node) => void;
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
  opacity = 1,
  hideLabel = false,
  bindRef,
  onSelect,
  onDragEnd,
  onTransformEnd,
  onDblClick,
  onLabelDragEnd,
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
      onSelect={onSelect}
      onDblClick={onDblClick}
      onLabelDragEnd={onLabelDragEnd}
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
          strokeScaleEnabled={false}
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
          strokeScaleEnabled={false}
          hitStrokeWidth={Math.max(item.lineWidth, 12)}
          {...commonHandlers}
        />
        {labelNode}
      </>
    );
  }

  if (item.type === 'arrow') {
    return (
      <>
        <Arrow
          ref={(node) => bindRef?.(item.id, node)}
          points={item.points}
          stroke={item.stroke}
          fill={item.stroke}
          strokeWidth={item.lineWidth}
          pointerLength={Math.max(10, item.lineWidth * 4)}
          pointerWidth={Math.max(10, item.lineWidth * 3)}
          opacity={opacity}
          strokeScaleEnabled={false}
          hitStrokeWidth={Math.max(item.lineWidth, 12)}
          {...commonHandlers}
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
        lineJoin="round"
        lineCap="round"
        opacity={opacity}
        strokeScaleEnabled={false}
        hitStrokeWidth={Math.max(item.lineWidth, 12)}
        {...commonHandlers}
      />
    );
  }

  if (item.type === 'text') {
    return (
      <Text
        ref={(node) => bindRef?.(item.id, node)}
        x={item.x}
        y={item.y}
        text={item.text}
        fill={item.color}
        fontStyle="bold"
        fontFamily={MARK_FONT_FAMILY}
        fontSize={item.fontSize}
        lineHeight={TEXT_LINE_HEIGHT}
        opacity={opacity}
        shadowColor="rgba(0, 0, 0, 0.55)"
        shadowBlur={Math.max(1, item.fontSize * 0.08)}
        shadowOffsetY={Math.max(1, Math.round(item.fontSize * 0.04))}
        {...commonHandlers}
      />
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
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={Math.max(2, radius * 0.25)}
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
          fontStyle="bold"
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

function LabelTextNode({
  item,
  imageWidth,
  imageHeight,
  opacity,
  listening,
  onSelect,
  onDblClick,
  onLabelDragEnd,
}: {
  item: MarkItem & { label?: string };
  imageWidth: number;
  imageHeight: number;
  opacity: number;
  listening: boolean;
  onSelect?: (id: string) => void;
  onDblClick?: (item: MarkItem) => void;
  onLabelDragEnd?: (item: LabeledMark, node: Konva.Node) => void;
}): JSX.Element | null {
  if (!isLabeledMark(item) || !item.label) {
    return null;
  }
  const fontSize = resolveLabelFontSize(item, resolveTextBaseSize(imageWidth, imageHeight));
  const placement = resolveLabelPlacement(item, imageWidth, imageHeight);
  const connector = resolveLabelConnector(item, imageWidth, imageHeight);
  return (
    <>
      {connector && (
        <Line
          points={[connector.x1, connector.y1, connector.x2, connector.y2]}
          stroke={item.stroke}
          strokeWidth={Math.max(1, item.lineWidth * 0.5)}
          opacity={opacity}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
      <Text
        x={placement.x}
        y={placement.y}
        text={item.label}
        fill={item.stroke}
        fontStyle="bold"
        fontFamily={MARK_FONT_FAMILY}
        fontSize={fontSize}
        lineHeight={TEXT_LINE_HEIGHT}
        opacity={opacity}
        listening={listening}
        draggable={listening}
        onClick={() => onSelect?.(item.id)}
        onTap={() => onSelect?.(item.id)}
        onDblClick={(event) => {
          event.cancelBubble = true;
          onDblClick?.(item);
        }}
        onDragEnd={(event) => onLabelDragEnd?.(item, event.target)}
        onMouseEnter={(event) => setStageCursor(event, 'move')}
        onMouseLeave={(event) => setStageCursor(event, '')}
        shadowColor="rgba(0, 0, 0, 0.55)"
        shadowBlur={Math.max(1, fontSize * 0.08)}
        shadowOffsetY={Math.max(1, Math.round(fontSize * 0.04))}
      />
    </>
  );
}
