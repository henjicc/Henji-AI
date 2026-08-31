import { Suspense, lazy, useRef, useState } from 'react';
import {
  imageEditDocumentToMarkDoc,
  parseImageEditDocument,
  stringifyImageEditDocument,
  stringifyMarkDoc,
  type ImageEditDocument,
} from '@/core/imageEdit';
// 同 CameraStageNodeDialog：静态引入会把约 630KB 的图片编辑器钉进画布 chunk，
// 而它只在画布的图片编辑对话框打开时才用得到。
const ImageEditor = lazy(() => import('@/features/imageEdit/editor/ImageEditor')
  .then((m) => ({ default: m.ImageEditor })));
import type { MarkEditorStyleState } from '@/features/imageMark';
import { isImageEditorV3Enabled } from '@/platform/runtime';
import type { VisualToolEditorProps } from './types';

const CanvasEditToolEditorV3Host = lazy(() => import('../../imageEditV3/CanvasEditToolEditorV3Host')
  .then((module) => ({ default: module.CanvasEditToolEditorV3Host })));

function toNumber(value: DynamicValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 画布图片编辑宿主：复用共享 ImageEditor，并兼容双写旧 markDoc。
 */
export function EditToolEditor(props: VisualToolEditorProps): JSX.Element {
  if (isImageEditorV3Enabled()) {
    return (
      <Suspense fallback={<div className="h-[min(76vh,900px)]" />}>
        <CanvasEditToolEditorV3Host {...props} />
      </Suspense>
    );
  }

  return <LegacyEditToolEditor {...props} />;
}

function LegacyEditToolEditor({
  options,
  onOptionsChange,
  sourceImageUrl,
}: VisualToolEditorProps): JSX.Element {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 对话框打开时读取一次初始文档；此后由共享编辑会话单向回写 options。
  const [initialDocument] = useState<ImageEditDocument>(() =>
    parseImageEditDocument(options.document ?? options.markDoc)
  );
  const [initialStyle] = useState<Partial<MarkEditorStyleState>>(() => ({
    color: typeof options.color === 'string' ? options.color : undefined,
    lineWidthPercent: toNumber(options.lineWidthPercent),
    textSizePercent: toNumber(options.fontSizePercent),
    mosaicStrengthPercent: toNumber(options.mosaicStrengthPercent),
    mosaicMode: options.mosaicMode === 'blur' ? 'blur' : undefined,
    calloutShape: options.calloutShape === 'ellipse' ? 'ellipse' : undefined,
  }));

  return (
    <Suspense fallback={<div className="h-[min(76vh,900px)]" />}>
    <ImageEditor
      sourceImageUrl={sourceImageUrl}
      initialDocument={initialDocument}
      initialStyle={initialStyle}
      onDocumentChange={(document) => {
        onOptionsChange({
          ...optionsRef.current,
          document: stringifyImageEditDocument(document),
          markDoc: stringifyMarkDoc(imageEditDocumentToMarkDoc(document)),
        });
      }}
      onStyleChange={(style) => {
        onOptionsChange({
          ...optionsRef.current,
          color: style.color,
          lineWidthPercent: style.lineWidthPercent,
          fontSizePercent: style.textSizePercent,
          mosaicStrengthPercent: style.mosaicStrengthPercent,
          mosaicMode: style.mosaicMode,
          calloutShape: style.calloutShape,
        });
      }}
      className="h-[min(76vh,900px)]"
    />
    </Suspense>
  );
}
