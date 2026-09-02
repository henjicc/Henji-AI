import { useRef } from 'react';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Group, Line, Rect, Text } from 'react-konva';
import {
  MARK_FONT_FAMILY,
  MARK_FONT_STYLE,
  TEXT_LINE_HEIGHT,
  resolveConnectorLine,
  resolveLabelBlockRect,
  resolveLabelConnector,
  resolveLabelFontSize,
  resolveLabelPlacement,
  resolveShapeAnchorRect,
  resolveTextBackgroundPadding,
  resolveTextBaseSize,
  resolveTextBlockSize,
} from '../domain/metrics';
import type { LabeledMark, MarkItem } from '../domain/types';

interface LabelTextNodeProps {
  item: LabeledMark;
  imageWidth: number;
  imageHeight: number;
  opacity: number;
  listening: boolean;
  /** 默认沿用旧编辑器的屏幕恒定描边；V3 文档画布按图片比例缩放描边。 */
  strokeScaleEnabled?: boolean;
  bindRef?: (id: string, node: Konva.Node | null) => void;
  onSelect?: (id: string) => void;
  onSelectLabel?: (id: string) => void;
  onDblClick?: (item: MarkItem) => void;
  onLabelDragEnd?: (item: LabeledMark, node: Konva.Node) => void;
  onLabelTransformEnd?: (item: LabeledMark, node: Konva.Node) => void;
}

function setStageCursor(event: KonvaEventObject<MouseEvent>, cursor: string): void {
  const container = event.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

/** 图形旁标签；背景与文字共用一个变换节点，拖动和缩放始终保持贴合。 */
export function LabelTextNode({
  item,
  imageWidth,
  imageHeight,
  opacity,
  listening,
  strokeScaleEnabled = false,
  bindRef,
  onSelect,
  onSelectLabel,
  onDblClick,
  onLabelDragEnd,
  onLabelTransformEnd,
}: LabelTextNodeProps): JSX.Element | null {
  const connectorRef = useRef<Konva.Line>(null);
  if (!item.label) return null;

  const fontSize = resolveLabelFontSize(item, resolveTextBaseSize(imageWidth, imageHeight));
  const placement = resolveLabelPlacement(item, imageWidth, imageHeight);
  const shapeRect = resolveShapeAnchorRect(item);
  const blockRect = resolveLabelBlockRect(item, imageWidth, imageHeight);
  const connector = resolveLabelConnector(item, imageWidth, imageHeight);
  const textSize = resolveTextBlockSize(item.label, fontSize);
  const padding = item.labelBackgroundColor ? resolveTextBackgroundPadding(fontSize) : 0;

  const handleLabelDragMove = (event: KonvaEventObject<DragEvent>): void => {
    const lineNode = connectorRef.current;
    if (!lineNode) return;
    const node = event.target;
    const nextConnector = resolveConnectorLine(shapeRect, {
      x: node.x() - padding,
      y: node.y() - padding,
      width: blockRect.width,
      height: blockRect.height,
    });
    if (nextConnector) {
      lineNode.points([nextConnector.x1, nextConnector.y1, nextConnector.x2, nextConnector.y2]);
      lineNode.visible(true);
    } else {
      lineNode.visible(false);
    }
    lineNode.getLayer()?.batchDraw();
  };

  return (
    <>
      <Line
        ref={connectorRef}
        points={connector ? [connector.x1, connector.y1, connector.x2, connector.y2] : [0, 0, 0, 0]}
        visible={Boolean(connector)}
        stroke={item.stroke}
        strokeWidth={item.lineWidth}
        opacity={opacity}
        strokeScaleEnabled={strokeScaleEnabled}
        listening={false}
      />
      <Group
        ref={(node) => bindRef?.(item.id, node)}
        x={placement.x}
        y={placement.y}
        opacity={opacity}
        listening={listening}
        draggable={listening}
        onClick={() => {
          onSelect?.(item.id);
          onSelectLabel?.(item.id);
        }}
        onTap={() => {
          onSelect?.(item.id);
          onSelectLabel?.(item.id);
        }}
        onDblClick={(event) => {
          event.cancelBubble = true;
          onDblClick?.(item);
        }}
        onDragStart={() => onSelectLabel?.(item.id)}
        onDragMove={handleLabelDragMove}
        onDragEnd={(event) => onLabelDragEnd?.(item, event.target)}
        onTransformEnd={(event) => onLabelTransformEnd?.(item, event.target)}
        onMouseEnter={(event) => setStageCursor(event, 'move')}
        onMouseLeave={(event) => setStageCursor(event, '')}
      >
        {item.labelBackgroundColor && (
          <Rect
            x={-padding}
            y={-padding}
            width={textSize.width + padding * 2}
            height={textSize.height + padding * 2}
            fill={item.labelBackgroundColor}
          />
        )}
        <Text
          text={item.label}
          fill={item.stroke}
          fontStyle={MARK_FONT_STYLE}
          fontFamily={MARK_FONT_FAMILY}
          fontSize={fontSize}
          lineHeight={TEXT_LINE_HEIGHT}
        />
      </Group>
    </>
  );
}
