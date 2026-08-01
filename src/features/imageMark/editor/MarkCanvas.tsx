import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { ANNOTATION_TRANSFORMER_HEX, WHITE_HEX } from '@/core/theme/colorTokens';
import { labelRefPoint } from '../domain/geometry';
import { resolveConnectorLine, resolveLabelBlockRect, resolveShapeAnchorRect } from '../domain/metrics';
import { isLabeledMark, type ImageMarkDoc, type LabeledMark, type MarkItem, type MarkToolType } from '../domain/types';
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
  /** 当前激活的标签子选中目标(标签独立选中/拖动/调整大小时与父图形区分) */
  activeLabelId: string | null;
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
  onSelectLabel: (id: string) => void;
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
  activeLabelId,
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
  onSelectLabel,
  onItemsUpdated,
  onStartTextEditing,
  onTextEditorChange,
  onCommitTextEditor,
  onCancelTextEditor,
  onCropChange,
  onCropCommit,
}: MarkCanvasProps): JSX.Element {
  const shapeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const labelRefs = useRef<Map<string, Konva.Node>>(new Map());
  const transformerRef = useRef<Konva.Transformer | null>(null);

  const imageWidth = orientedCanvas?.width ?? 0;
  const imageHeight = orientedCanvas?.height ?? 0;
  const numberValues = useMemo(() => resolveNumberValues(doc.items), [doc.items]);

  // 标签原位输入期间(尚未提交到 item.label)的引导线预览,保证创建标注时引导线立即可见;
  // 锚点必须用实时输入内容重算(与最终渲染同一函数),否则确认时会因占位符与真实文字宽度不同而跳动
  const labelEditPreview = useMemo(() => {
    if (textEditor?.kind !== 'label') {
      return null;
    }
    const parentItem = doc.items.find((entry) => entry.id === textEditor.itemId);
    if (!parentItem || !isLabeledMark(parentItem)) {
      return null;
    }
    const block = resolveLabelBlockRect(
      { ...parentItem, label: textEditor.value, labelFontSize: textEditor.fontSize },
      imageWidth,
      imageHeight
    );
    const connector = resolveConnectorLine(resolveShapeAnchorRect(parentItem), block);
    if (!connector) {
      return null;
    }
    return { connector, stroke: parentItem.stroke, lineWidth: parentItem.lineWidth };
  }, [doc.items, imageHeight, imageWidth, textEditor]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }
    const isLabelTarget = Boolean(selectedId && activeLabelId === selectedId);
    const selectedNode = selectedId
      ? (isLabelTarget ? labelRefs.current : shapeRefs.current).get(selectedId)
      : null;
    if (!selectedNode || !selectedItem || tool === 'crop') {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    transformer.nodes([selectedNode]);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, selectedItem, activeLabelId, tool, doc.items]);

  const bindShapeRef = useCallback((id: string, node: Konva.Node | null) => {
    if (node) {
      shapeRefs.current.set(id, node);
      return;
    }
    shapeRefs.current.delete(id);
  }, []);

  const bindLabelRef = useCallback((id: string, node: Konva.Node | null) => {
    if (node) {
      labelRefs.current.set(id, node);
      return;
    }
    labelRefs.current.delete(id);
  }, []);

  const handleDragEnd = useCallback((item: MarkItem, event: KonvaEventObject<DragEvent>) => {
    const updated = applyNodeDragToMark(item, event.target);
    onItemsUpdated(doc.items.map((current) => (current.id === item.id ? updated : current)));
  }, [doc.items, onItemsUpdated]);

  const handleTransformEnd = useCallback((item: MarkItem, event: KonvaEventObject<Event>) => {
    const updated = applyNodeTransformToMark(item, event.target);
    onItemsUpdated(doc.items.map((current) => (current.id === item.id ? updated : current)));
  }, [doc.items, onItemsUpdated]);

  // 标签单独拖动:把新位置记为相对图形参考点的偏移,之后仍随图形移动
  const handleLabelDragEnd = useCallback((item: LabeledMark, node: Konva.Node) => {
    const ref = labelRefPoint(item);
    const updated: MarkItem = {
      ...item,
      labelDx: node.x() - ref.x,
      labelDy: node.y() - ref.y,
    };
    onItemsUpdated(doc.items.map((current) => (current.id === item.id ? updated : current)));
  }, [doc.items, onItemsUpdated]);

  // 标签独立选中后通过变换框拖角调整字号(与拖动一致,松手才回写)
  const handleLabelTransformEnd = useCallback((item: LabeledMark, node: Konva.Node) => {
    const textNode = node as Konva.Text;
    const scale = Math.max(textNode.scaleX(), textNode.scaleY());
    textNode.scaleX(1);
    textNode.scaleY(1);
    const updated: MarkItem = {
      ...item,
      labelFontSize: Math.max(8, Math.round(textNode.fontSize() * scale)),
    };
    onItemsUpdated(doc.items.map((current) => (current.id === item.id ? updated : current)));
  }, [doc.items, onItemsUpdated]);

  const isLabelSelected = Boolean(selectedItem && activeLabelId === selectedItem.id);
  const transformerKeepRatio = isLabelSelected || selectedItem?.type === 'text' || selectedItem?.type === 'number';
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
      data-application-observation-region="image_edit.canvas_observer"
      /* 铺满剩余空间的工作面不是卡片:不加 rounded/border,边界交给命令带那条 border-b */
      className="relative min-h-0 flex-1 overflow-hidden bg-bg-dark/85"
    >
      <div
        ref={stageHostRef}
        tabIndex={0}
        className="relative flex h-full w-full items-center justify-center p-3 outline-none"
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
                      blurSource={orientedCanvas}
                      draggable={tool !== 'crop'}
                      listening={tool !== 'crop'}
                      hideLabel={textEditor?.kind === 'label' && textEditor.itemId === item.id}
                      bindRef={bindShapeRef}
                      bindLabelRef={bindLabelRef}
                      onSelect={onSelectedIdChange}
                      onSelectLabel={onSelectLabel}
                      onDragEnd={handleDragEnd}
                      onTransformEnd={handleTransformEnd}
                      onDblClick={onStartTextEditing}
                      onLabelDragEnd={handleLabelDragEnd}
                      onLabelTransformEnd={handleLabelTransformEnd}
                    />
                  );
                })}
                {/* 创建标注原位输入期间的引导线预览,标签尚未提交也能立即看到 */}
                {labelEditPreview && (
                  <Line
                    points={[
                      labelEditPreview.connector.x1,
                      labelEditPreview.connector.y1,
                      labelEditPreview.connector.x2,
                      labelEditPreview.connector.y2,
                    ]}
                    stroke={labelEditPreview.stroke}
                    strokeWidth={labelEditPreview.lineWidth}
                    strokeScaleEnabled={false}
                    listening={false}
                  />
                )}
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
                    blurSource={orientedCanvas}
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
