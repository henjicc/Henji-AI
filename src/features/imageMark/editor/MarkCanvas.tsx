import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { ANNOTATION_TRANSFORMER_HEX, WHITE_HEX } from '@/core/theme/colorTokens';
import type { ImageMarkDoc, MarkItem, MarkToolType } from '../domain/types';
import { resolveNumberValues } from '../render/drawMarks';
import { CropOverlayBox } from './CropOverlayBox';
import { MarkShapeNode } from './markShapes';
import { applyNodeDragToMark, applyNodeTransformToMark } from './nodeSync';
import { TextEditOverlay } from './TextEditOverlay';
import type { TextEditorState } from './shared';

interface MarkCanvasProps {
  orientedCanvas: HTMLCanvasElement | null;
  getMosaicSource: (pixelSize: number) => HTMLCanvasElement | null;
  doc: ImageMarkDoc;
  draftMark: MarkItem | null;
  tool: MarkToolType;
  cropRatio: number | null;
  selectedId: string | null;
  selectedItem: MarkItem | null;
  textEditor: TextEditorState | null;
  textEditorHostPos: { x: number; y: number } | null;
  stageWidth: number;
  stageHeight: number;
  scale: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  stageHostRef: React.RefObject<HTMLDivElement>;
  stageRef: React.MutableRefObject<Konva.Stage | null>;
  contentGroupRef: React.MutableRefObject<Konva.Group | null>;
  textInputRef: React.RefObject<HTMLTextAreaElement>;
  onPointerDown: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onPointerMove: (event: KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onPointerUp: () => void;
  onStageDblClick: (event: KonvaEventObject<MouseEvent>) => void;
  onSelectedIdChange: (id: string | null) => void;
  onItemsUpdated: (items: MarkItem[]) => void;
  onStartTextEditing: (item: MarkItem) => void;
  onTextEditorChange: (value: string) => void;
  onCommitTextEditor: () => void;
  onCancelTextEditor: () => void;
  onCropChange: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCropCommit: () => void;
}

export function MarkCanvas({
  orientedCanvas,
  getMosaicSource,
  doc,
  draftMark,
  tool,
  cropRatio,
  selectedId,
  selectedItem,
  textEditor,
  textEditorHostPos,
  stageWidth,
  stageHeight,
  scale,
  viewportRef,
  stageHostRef,
  stageRef,
  contentGroupRef,
  textInputRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onStageDblClick,
  onSelectedIdChange,
  onItemsUpdated,
  onStartTextEditing,
  onTextEditorChange,
  onCommitTextEditor,
  onCancelTextEditor,
  onCropChange,
  onCropCommit,
}: MarkCanvasProps): JSX.Element {
  const shapeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const transformerRef = useRef<Konva.Transformer | null>(null);

  const imageWidth = orientedCanvas?.width ?? 0;
  const imageHeight = orientedCanvas?.height ?? 0;
  const numberValues = useMemo(() => resolveNumberValues(doc.items), [doc.items]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }
    const selectedNode = selectedId ? shapeRefs.current.get(selectedId) : null;
    if (!selectedNode || !selectedItem || tool === 'crop') {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    transformer.nodes([selectedNode]);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, selectedItem, tool, doc.items]);

  const bindShapeRef = useCallback((id: string, node: Konva.Node | null) => {
    if (node) {
      shapeRefs.current.set(id, node);
      return;
    }
    shapeRefs.current.delete(id);
  }, []);

  const handleDragEnd = useCallback((item: MarkItem, event: KonvaEventObject<DragEvent>) => {
    const updated = applyNodeDragToMark(item, event.target);
    onItemsUpdated(doc.items.map((current) => (current.id === item.id ? updated : current)));
  }, [doc.items, onItemsUpdated]);

  const handleTransformEnd = useCallback((item: MarkItem, event: KonvaEventObject<Event>) => {
    const updated = applyNodeTransformToMark(item, event.target);
    onItemsUpdated(doc.items.map((current) => (current.id === item.id ? updated : current)));
  }, [doc.items, onItemsUpdated]);

  const transformerKeepRatio = selectedItem?.type === 'text' || selectedItem?.type === 'number';
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

  const stageCursor = tool === 'text'
    ? 'cursor-text'
    : tool === 'select' || tool === 'crop'
      ? 'cursor-default'
      : 'cursor-crosshair';

  return (
    <div
      ref={viewportRef}
      className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/85"
    >
      <div
        ref={stageHostRef}
        tabIndex={0}
        className="relative flex h-full w-full items-center justify-center p-2 outline-none"
      >
        <div className="relative" style={{ width: stageWidth, height: stageHeight }}>
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
            onDblClick={onStageDblClick}
            className={stageCursor}
          >
            {/* 底图层:内容静态,拖拽/绘制期间不重绘 */}
            <Layer listening={false}>
              {orientedCanvas && (
                <KonvaImage
                  image={orientedCanvas}
                  x={0}
                  y={0}
                  scaleX={scale}
                  scaleY={scale}
                />
              )}
            </Layer>

            {/* 标记层 */}
            <Layer>
              <Group
                ref={(node) => {
                  contentGroupRef.current = node;
                }}
                scaleX={scale}
                scaleY={scale}
              >
                {/* 透明命中层,保证空白处指针事件有目标 */}
                <Rect
                  name="mark-background"
                  x={0}
                  y={0}
                  width={imageWidth}
                  height={imageHeight}
                  fill="transparent"
                />
                {doc.items.map((item) => {
                  // 原位编辑中的文字项整体隐藏;标签编辑中只隐藏标签文字
                  if (textEditor?.kind === 'text' && textEditor.itemId === item.id) {
                    return null;
                  }
                  return (
                    <MarkShapeNode
                      key={item.id}
                      item={item}
                      numberValue={numberValues.get(item.id) ?? 0}
                      imageWidth={imageWidth}
                      imageHeight={imageHeight}
                      getMosaicSource={getMosaicSource}
                      draggable={tool !== 'crop'}
                      listening={tool !== 'crop'}
                      hideLabel={textEditor?.kind === 'label' && textEditor.itemId === item.id}
                      bindRef={bindShapeRef}
                      onSelect={onSelectedIdChange}
                      onDragEnd={handleDragEnd}
                      onTransformEnd={handleTransformEnd}
                      onDblClick={onStartTextEditing}
                    />
                  );
                })}
                {/* 非裁剪模式下提示既有裁剪范围 */}
                {doc.crop && tool !== 'crop' && (
                  <Rect
                    x={doc.crop.x}
                    y={doc.crop.y}
                    width={doc.crop.width}
                    height={doc.crop.height}
                    stroke={WHITE_HEX}
                    strokeWidth={1}
                    strokeScaleEnabled={false}
                    dash={[6, 4]}
                    opacity={0.45}
                    listening={false}
                  />
                )}
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
                  borderStroke={ANNOTATION_TRANSFORMER_HEX}
                  anchorStroke={ANNOTATION_TRANSFORMER_HEX}
                  anchorFill={WHITE_HEX}
                  anchorSize={8}
                  ignoreStroke
                  keepRatio={transformerKeepRatio}
                  enabledAnchors={transformerAnchors}
                />
              </Group>
            </Layer>

            {/* 草稿层:绘制过程只重绘这一层 */}
            <Layer listening={false}>
              <Group scaleX={scale} scaleY={scale}>
                {draftMark && (
                  <MarkShapeNode
                    item={draftMark}
                    numberValue={0}
                    imageWidth={imageWidth}
                    imageHeight={imageHeight}
                    getMosaicSource={getMosaicSource}
                    draggable={false}
                    listening={false}
                    opacity={0.75}
                  />
                )}
              </Group>
            </Layer>
          </Stage>

          {tool === 'crop' && doc.crop && (
            <CropOverlayBox
              displayWidth={stageWidth}
              displayHeight={stageHeight}
              scale={scale}
              crop={doc.crop}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              ratio={cropRatio}
              onChange={onCropChange}
              onCommit={onCropCommit}
            />
          )}
        </div>

        {textEditor && textEditorHostPos && (
          <TextEditOverlay
            state={textEditor}
            position={textEditorHostPos}
            scale={scale}
            textInputRef={textInputRef}
            onChange={onTextEditorChange}
            onCommit={onCommitTextEditor}
            onCancel={onCancelTextEditor}
          />
        )}
      </div>
    </div>
  );
}
