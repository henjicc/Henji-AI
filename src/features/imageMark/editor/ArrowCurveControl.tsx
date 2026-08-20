import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { Circle } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { ANNOTATION_TRANSFORMER_HEX, WHITE_HEX } from '@/core/theme/colorTokens';
import {
  arrowCurveHandleToControl,
  resolveArrowCurveHandle,
} from '../domain/arrowGeometry';
import type { ArrowMark, MarkItem, MarkToolType } from '../domain/types';
import { updateArrowNodeGeometry } from './arrowNodes';

interface ArrowCurveControlProps {
  selectedArrow: ArrowMark | null;
  tool: MarkToolType;
  activeLabelId: string | null;
  scale: number;
  items: MarkItem[];
  shapeRefs: MutableRefObject<Map<string, Konva.Node>>;
  transformerRef: MutableRefObject<Konva.Transformer | null>;
  onItemsUpdated: (items: MarkItem[]) => void;
}

export function ArrowCurveControl({
  selectedArrow,
  tool,
  activeLabelId,
  scale,
  items,
  shapeRefs,
  transformerRef,
  onItemsUpdated,
}: ArrowCurveControlProps): JSX.Element {
  const handle = selectedArrow ? resolveArrowCurveHandle(selectedArrow) : null;
  const safeScale = Math.max(scale, 0.01);
  const curveHandleRef = useRef<Konva.Circle | null>(null);

  useEffect(() => {
    if (!selectedArrow || !handle) return undefined;
    const arrowNode = shapeRefs.current.get(selectedArrow.id);
    const controlNode = curveHandleRef.current;
    if (!arrowNode || !controlNode) return undefined;
    const syncHandle = (): void => {
      const position = arrowNode.getTransform().point({ x: handle[0], y: handle[1] });
      controlNode.position(position);
      controlNode.getLayer()?.batchDraw();
    };
    syncHandle();
    arrowNode.on('dragmove.arrowCurveHandle transform.arrowCurveHandle', syncHandle);
    return () => {
      arrowNode.off('.arrowCurveHandle');
    };
  }, [handle, selectedArrow, shapeRefs]);

  const setTransformerVisible = useCallback((visible: boolean) => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    transformer.visible(visible);
    transformer.getLayer()?.batchDraw();
  }, [transformerRef]);

  const restoreTransformer = useCallback(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    transformer.forceUpdate();
    transformer.visible(true);
    transformer.getLayer()?.batchDraw();
  }, [transformerRef]);

  const handleDragStart = useCallback((event: KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true;
    setTransformerVisible(false);
  }, [setTransformerVisible]);

  const handleDragMove = useCallback((item: ArrowMark, event: KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true;
    const node = shapeRefs.current.get(item.id);
    if (!node) return;
    const curveHandle: [number, number] = [event.target.x(), event.target.y()];
    const control = arrowCurveHandleToControl(item, curveHandle);
    updateArrowNodeGeometry(node, { ...item, curveControl: control });
    node.getLayer()?.batchDraw();
  }, [shapeRefs]);

  const handleDragEnd = useCallback((item: ArrowMark, event: KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true;
    const curveHandle: [number, number] = [event.target.x(), event.target.y()];
    const curveControl = arrowCurveHandleToControl(item, curveHandle);
    onItemsUpdated(items.map((current) => (
      current.id === item.id && current.type === 'arrow'
        ? { ...current, curveControl }
        : current
    )));
    restoreTransformer();
  }, [items, onItemsUpdated, restoreTransformer]);

  const handleReset = useCallback((item: ArrowMark, event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    const node = shapeRefs.current.get(item.id);
    if (node) {
      setTransformerVisible(false);
      const { curveControl: _curveControl, ...straightArrow } = item;
      updateArrowNodeGeometry(node, straightArrow);
      node.getLayer()?.batchDraw();
    }
    onItemsUpdated(items.map((current) => {
      if (current.id !== item.id || current.type !== 'arrow') return current;
      const { curveControl: _curveControl, ...straightArrow } = current;
      return straightArrow;
    }));
    restoreTransformer();
  }, [items, onItemsUpdated, restoreTransformer, setTransformerVisible, shapeRefs]);

  return (
    <>
      {selectedArrow && handle && tool !== 'crop' && activeLabelId !== selectedArrow.id && (
        <Circle
          ref={curveHandleRef}
          x={handle[0]}
          y={handle[1]}
          radius={6 / safeScale}
          fill={WHITE_HEX}
          stroke={ANNOTATION_TRANSFORMER_HEX}
          strokeWidth={1}
          strokeScaleEnabled={false}
          hitStrokeWidth={12 / safeScale}
          draggable
          onDragStart={(event) => {
            const container = event.target.getStage()?.container();
            if (container) container.style.cursor = 'grabbing';
            handleDragStart(event);
          }}
          onMouseDown={(event) => { event.cancelBubble = true; }}
          onTouchStart={(event) => { event.cancelBubble = true; }}
          onDragMove={(event) => handleDragMove(selectedArrow, event)}
          onDragEnd={(event) => {
            const container = event.target.getStage()?.container();
            if (container) container.style.cursor = 'grab';
            handleDragEnd(selectedArrow, event);
          }}
          onDblClick={(event) => handleReset(selectedArrow, event)}
          onMouseEnter={(event) => {
            const container = event.target.getStage()?.container();
            if (container) container.style.cursor = 'grab';
          }}
          onMouseLeave={(event) => {
            const container = event.target.getStage()?.container();
            if (container) container.style.cursor = '';
          }}
        />
      )}
    </>
  );
}
