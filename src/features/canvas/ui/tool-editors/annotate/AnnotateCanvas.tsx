import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  Arrow,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { UiButton, UiTextAreaField } from '@/components/ui';
import type { AnnotationItem, AnnotationToolType } from '@/features/canvas/tools/annotation';
import { canSelectByTool, canTransformAnnotation, type TextEditorState, updateAnnotationPosition, updateAnnotationTransform } from './shared';

interface AnnotateCanvasProps {
  image: HTMLImageElement | null;
  annotations: AnnotationItem[];
  draftAnnotation: AnnotationItem | null;
  tool: AnnotationToolType;
  selectedId: string | null;
  selectedAnnotation: AnnotationItem | null;
  textEditorState: TextEditorState | null;
  textEditorStagePos: { x: number; y: number } | null;
  stageWidth: number;
  stageHeight: number;
  scale: number;
  viewportRef: RefObject<HTMLDivElement>;
  stageHostRef: RefObject<HTMLDivElement>;
  stageRef: MutableRefObject<Konva.Stage | null>;
  contentGroupRef: MutableRefObject<Konva.Group | null>;
  transformerRef: MutableRefObject<Konva.Transformer | null>;
  textInputRef: RefObject<HTMLTextAreaElement>;
  onStageKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onPointerMove: () => void;
  onPointerUp: () => void;
  onSelectedIdChange: (id: string | null) => void;
  onAnnotationUpdated: (nextAnnotations: AnnotationItem[]) => void;
  onStartTextEditing: (item: AnnotationItem | null) => void;
  onTextEditorChange: (value: string) => void;
  onCommitTextEditor: () => void;
  onCancelTextEditor: () => void;
}

export function AnnotateCanvas({
  image,
  annotations,
  draftAnnotation,
  tool,
  selectedId,
  selectedAnnotation,
  textEditorState,
  textEditorStagePos,
  stageWidth,
  stageHeight,
  scale,
  viewportRef,
  stageHostRef,
  stageRef,
  contentGroupRef,
  transformerRef,
  textInputRef,
  onStageKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelectedIdChange,
  onAnnotationUpdated,
  onStartTextEditing,
  onTextEditorChange,
  onCommitTextEditor,
  onCancelTextEditor,
}: AnnotateCanvasProps): JSX.Element {
  const shapeRefs = useRef<Map<string, Konva.Node>>(new Map());

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }
    if (!selectedId) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const selectedNode = shapeRefs.current.get(selectedId);
    if (!selectedNode || !selectedAnnotation || !canTransformAnnotation(selectedAnnotation)) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    transformer.nodes([selectedNode]);
    transformer.getLayer()?.batchDraw();
  }, [selectedAnnotation, selectedId, transformerRef]);

  const bindShapeRef = useCallback((id: string, node: Konva.Node | null) => {
    if (node) {
      shapeRefs.current.set(id, node);
      return;
    }
    shapeRefs.current.delete(id);
  }, []);

  const handleAnnotationDragEnd = useCallback((item: AnnotationItem, event: KonvaEventObject<DragEvent>) => {
    const node = event.target;
    const nextX = node.x();
    const nextY = node.y();
    if (item.type === 'arrow' || item.type === 'pen') {
      node.x(0);
      node.y(0);
    }
    const nextAnnotations = annotations.map((current) =>
      current.id === item.id ? updateAnnotationPosition(current, nextX, nextY) : current
    );
    onAnnotationUpdated(nextAnnotations);
  }, [annotations, onAnnotationUpdated]);

  const handleAnnotationTransformEnd = useCallback((item: AnnotationItem, event: KonvaEventObject<Event>) => {
    const node = event.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const nextX = node.x();
    const nextY = node.y();
    node.scaleX(1);
    node.scaleY(1);
    if (item.type === 'arrow' || item.type === 'pen') {
      node.x(0);
      node.y(0);
    }
    const nextAnnotations = annotations.map((current) =>
      current.id === item.id
        ? updateAnnotationTransform(current, nextX, nextY, scaleX, scaleY)
        : current
    );
    onAnnotationUpdated(nextAnnotations);
  }, [annotations, onAnnotationUpdated]);

  const renderAnnotationNode = (item: AnnotationItem, opacity = 1): JSX.Element => {
    const isSelected = selectedId === item.id;
    const canInteract = canSelectByTool(tool, item);
    const draggable = canInteract && isSelected;

    const commonHandlers = {
      draggable,
      onClick: () => {
        if (canInteract) {
          onSelectedIdChange(item.id);
        }
      },
      onTap: () => {
        if (canInteract) {
          onSelectedIdChange(item.id);
        }
      },
      onDragEnd: (event: KonvaEventObject<DragEvent>) => handleAnnotationDragEnd(item, event),
      onTransformEnd: (event: KonvaEventObject<Event>) => handleAnnotationTransformEnd(item, event),
    };

    if (item.type === 'rect') {
      return (
        <Rect
          key={item.id}
          ref={(node) => bindShapeRef(item.id, node)}
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          stroke={item.stroke}
          strokeWidth={item.lineWidth}
          opacity={opacity}
          strokeScaleEnabled={false}
          {...commonHandlers}
        />
      );
    }

    if (item.type === 'ellipse') {
      return (
        <Ellipse
          key={item.id}
          ref={(node) => bindShapeRef(item.id, node)}
          x={item.x + item.width / 2}
          y={item.y + item.height / 2}
          radiusX={item.width / 2}
          radiusY={item.height / 2}
          stroke={item.stroke}
          strokeWidth={item.lineWidth}
          opacity={opacity}
          strokeScaleEnabled={false}
          {...commonHandlers}
        />
      );
    }

    if (item.type === 'arrow') {
      return (
        <Arrow
          key={item.id}
          ref={(node) => bindShapeRef(item.id, node)}
          points={item.points}
          stroke={item.stroke}
          fill={item.stroke}
          strokeWidth={item.lineWidth}
          pointerLength={Math.max(10, item.lineWidth * 4)}
          pointerWidth={Math.max(10, item.lineWidth * 3)}
          opacity={opacity}
          strokeScaleEnabled={false}
          {...commonHandlers}
        />
      );
    }

    if (item.type === 'pen') {
      return (
        <Line
          key={item.id}
          ref={(node) => bindShapeRef(item.id, node)}
          points={item.points}
          stroke={item.stroke}
          strokeWidth={item.lineWidth}
          lineJoin="round"
          lineCap="round"
          opacity={opacity}
          strokeScaleEnabled={false}
          {...commonHandlers}
        />
      );
    }

    return (
      <Text
        key={item.id}
        ref={(node) => bindShapeRef(item.id, node)}
        x={item.x}
        y={item.y}
        text={item.text}
        fill={item.color}
        fontStyle="bold"
        fontSize={item.fontSize}
        lineHeight={1.2}
        opacity={opacity}
        {...commonHandlers}
        onDblClick={(event) => {
          event.cancelBubble = true;
          onStartTextEditing(item);
        }}
      />
    );
  };

  const transformerKeepRatio = selectedAnnotation?.type === 'text';
  const transformerAnchors: Konva.TransformerConfig['enabledAnchors'] = transformerKeepRatio
    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
    : [
      'top-left',
      'top-center',
      'top-right',
      'middle-right',
      'bottom-right',
      'bottom-center',
      'bottom-left',
      'middle-left',
    ];

  return (
    <div
      ref={viewportRef}
      className="relative h-[min(62vh,640px)] overflow-hidden rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/85"
    >
      <div
        ref={stageHostRef}
        tabIndex={0}
        className="relative flex h-full w-full items-center justify-center p-2 outline-none"
        onKeyDown={onStageKeyDown}
      >
        <Stage
          ref={(node) => {
            stageRef.current = node;
          }}
          width={stageWidth}
          height={stageHeight}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onMouseMove={onPointerMove}
          onTouchMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchEnd={onPointerUp}
          onMouseLeave={onPointerUp}
          className={tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}
        >
          <Layer>
            <Group
              ref={(node) => {
                contentGroupRef.current = node;
              }}
              x={0}
              y={0}
              scaleX={scale}
              scaleY={scale}
            >
              {image && (
                <KonvaImage
                  image={image}
                  x={0}
                  y={0}
                  width={image.naturalWidth}
                  height={image.naturalHeight}
                  name="annotation-background"
                />
              )}
              {annotations.map((item) => renderAnnotationNode(item))}
              {draftAnnotation && renderAnnotationNode(draftAnnotation, 0.75)}
              <Transformer
                ref={(node) => {
                  transformerRef.current = node;
                }}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 5 || newBox.height < 5) {
                    return oldBox;
                  }
                  return newBox;
                }}
                rotateEnabled={false}
                borderStroke="#3b82f6"
                anchorStroke="#3b82f6"
                anchorFill="#ffffff"
                anchorSize={8}
                ignoreStroke
                keepRatio={transformerKeepRatio}
                enabledAnchors={transformerAnchors}
              />
            </Group>
          </Layer>
        </Stage>

        {textEditorState && textEditorStagePos && (
          <div
            className="absolute z-20 flex flex-col gap-2 rounded-md border border-[rgba(255,255,255,0.2)] bg-black/75 p-2 backdrop-blur-sm"
            style={{
              left: `${textEditorStagePos.x}px`,
              top: `${textEditorStagePos.y}px`,
              transform: 'translate(0, -100%)',
              minWidth: '180px',
              maxWidth: '300px',
            }}
          >
            <UiTextAreaField
              ref={textInputRef}
              value={textEditorState.value}
              onChange={(event) => onTextEditorChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  onCommitTextEditor();
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelTextEditor();
                }
              }}
              rows={3}
              className="w-full rounded border border-[rgba(255,255,255,0.18)] bg-bg-dark/90 px-2 py-1.5 text-sm text-text-dark outline-none focus:border-accent"
            />
            <div className="flex items-center justify-end gap-2">
              <UiButton type="button" variant="ghost" size="sm" onClick={onCancelTextEditor}>
                取消
              </UiButton>
              <UiButton type="button" variant="primary" size="sm" onClick={onCommitTextEditor}>
                确认
              </UiButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
