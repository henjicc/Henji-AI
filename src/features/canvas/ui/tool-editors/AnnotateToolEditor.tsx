import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';

import { parseAnnotationItems, type AnnotationItem, type AnnotationToolType } from '@/features/canvas/tools/annotation';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { VisualToolEditorProps } from './types';
import { AnnotateCanvas } from './annotate/AnnotateCanvas';
import { AnnotateToolbar } from './annotate/AnnotateToolbar';
import { useAnnotateController } from './annotate/useAnnotateController';
import { useSelectedStyleSync } from './annotate/useSelectedStyleSync';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import {
  clamp,
  DEFAULT_LINE_WIDTH_PERCENT,
  DEFAULT_TEXT_SIZE_PERCENT,
  fontSizeToPercent,
  lineWidthToPercent,
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  percentToFontSize,
  percentToLineWidth,
  resolveTextBaseSize,
  toNumber,
  toText,
  type DraftState,
  type TextEditorState,
  VIEWPORT_MIN_HEIGHT_PX,
  VIEWPORT_MIN_WIDTH_PX,
  VIEWPORT_PADDING_PX,
} from './annotate/shared';

export function AnnotateToolEditor({ options, onOptionsChange, sourceImageUrl }: VisualToolEditorProps): JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotationToolType>('rect');
  const [annotations, setAnnotations] = useState<AnnotationItem[]>(() => parseAnnotationItems(options.annotations));
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [undoStack, setUndoStack] = useState<AnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationItem[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEditorState, setTextEditorState] = useState<TextEditorState | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  const stageRef = useRef<Konva.Stage | null>(null);
  const contentGroupRef = useRef<Konva.Group | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  const color = toText(options.color, ANNOTATION_DEFAULT_STROKE_HEX);
  const textBaseSize = useMemo(() => resolveTextBaseSize(image), [image]);
  const rawLineWidthPercent = toNumber(options.lineWidthPercent, Number.NaN);
  const legacyLineWidth = Math.max(1, toNumber(options.lineWidth, 4));
  const lineWidthPercent = clamp(
    Number.isFinite(rawLineWidthPercent)
      ? rawLineWidthPercent
      : lineWidthToPercent(legacyLineWidth, textBaseSize),
    MIN_LINE_WIDTH_PERCENT,
    MAX_LINE_WIDTH_PERCENT
  );
  const lineWidth = percentToLineWidth(lineWidthPercent, textBaseSize);
  const rawTextPercent = toNumber(options.fontSizePercent, Number.NaN);
  const legacyFontSize = Math.max(10, toNumber(options.fontSize, 28));
  const textSizePercent = clamp(
    Number.isFinite(rawTextPercent)
      ? rawTextPercent
      : fontSizeToPercent(legacyFontSize, textBaseSize),
    MIN_TEXT_SIZE_PERCENT,
    MAX_TEXT_SIZE_PERCENT
  );
  const fontSize = percentToFontSize(textSizePercent, textBaseSize);

  useEffect(() => {
    const nextAnnotations = parseAnnotationItems(options.annotations);
    setAnnotations(nextAnnotations);
    if (selectedId && !nextAnnotations.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [options.annotations, selectedId]);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = resolveImageDisplayUrl(sourceImageUrl);
  }, [sourceImageUrl]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { stageWidth, stageHeight, scale } = useMemo(() => {
    if (!image) {
      return { stageWidth: 820, stageHeight: 480, scale: 1 };
    }
    const maxWidth = Math.max(VIEWPORT_MIN_WIDTH_PX, viewportSize.width - VIEWPORT_PADDING_PX * 2);
    const maxHeight = Math.max(VIEWPORT_MIN_HEIGHT_PX, viewportSize.height - VIEWPORT_PADDING_PX * 2);
    const ratio = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    return {
      stageWidth: Math.max(1, Math.round(image.naturalWidth * ratio)),
      stageHeight: Math.max(1, Math.round(image.naturalHeight * ratio)),
      scale: ratio,
    };
  }, [image, viewportSize.height, viewportSize.width]);

  const selectedAnnotation = useMemo(
    () => annotations.find((item) => item.id === selectedId) ?? null,
    [annotations, selectedId]
  );
  const activeStyleKind = useMemo<'shape' | 'text' | null>(() => {
    if (tool === 'text') {
      return 'text';
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'pen') {
      return 'shape';
    }
    return null;
  }, [tool]);

  useSelectedStyleSync({
    options,
    onOptionsChange,
    selectedAnnotation,
    textEditorState,
    textBaseSize,
  });

  const {
    draftAnnotation,
    textEditorStagePos,
    updateOptionsPayload,
    startTextEditing,
    handleCommitTextEditor,
    handleCancelTextEditor,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleDeleteSelected,
    handleUndo,
    handleRedo,
    handleStyleInputChange,
    handleStageKeyDown,
  } = useAnnotateController({
    options,
    onOptionsChange,
    image,
    annotations,
    setAnnotations,
    draft,
    setDraft,
    selectedId,
    setSelectedId,
    selectedAnnotation,
    textEditorState,
    setTextEditorState,
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    tool,
    color,
    fontSize,
    lineWidth,
    textBaseSize,
    scale,
    stageRef,
    contentGroupRef,
    stageHostRef,
    textInputRef,
  });

  return (
    <div className="space-y-3">
      <AnnotateToolbar
        tool={tool}
        setTool={setTool}
        setTextEditorState={(open) => {
          if (!open) {
            setTextEditorState(null);
          }
        }}
        activeStyleKind={activeStyleKind}
        color={color}
        lineWidthPercent={lineWidthPercent || DEFAULT_LINE_WIDTH_PERCENT}
        textSizePercent={textSizePercent || DEFAULT_TEXT_SIZE_PERCENT}
        onStylePatch={handleStyleInputChange}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDeleteSelected={handleDeleteSelected}
        onClear={() => {
          setUndoStack((prev) => [...prev, annotations].slice(-40));
          setRedoStack([]);
          setSelectedId(null);
          updateOptionsPayload([], {}, false);
        }}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canDeleteSelected={Boolean(selectedId)}
        canClear={annotations.length > 0}
      />

      <AnnotateCanvas
        image={image}
        annotations={annotations}
        draftAnnotation={draftAnnotation}
        tool={tool}
        selectedId={selectedId}
        selectedAnnotation={selectedAnnotation}
        textEditorState={textEditorState}
        textEditorStagePos={textEditorStagePos}
        stageWidth={stageWidth}
        stageHeight={stageHeight}
        scale={scale}
        viewportRef={viewportRef}
        stageHostRef={stageHostRef}
        stageRef={stageRef}
        contentGroupRef={contentGroupRef}
        transformerRef={transformerRef}
        textInputRef={textInputRef}
        onStageKeyDown={handleStageKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onSelectedIdChange={setSelectedId}
        onAnnotationUpdated={(nextAnnotations) => updateOptionsPayload(nextAnnotations, {}, true)}
        onStartTextEditing={startTextEditing}
        onTextEditorChange={(value) => {
          setTextEditorState((previous) => (previous ? { ...previous, value } : previous));
        }}
        onCommitTextEditor={handleCommitTextEditor}
        onCancelTextEditor={handleCancelTextEditor}
      />
    </div>
  );
}
