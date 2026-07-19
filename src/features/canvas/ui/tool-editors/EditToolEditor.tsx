import { useRef, useState } from 'react';
import {
  MarkEditor,
  parseMarkDoc,
  stringifyMarkDoc,
  type ImageMarkDoc,
  type MarkEditorStyleState,
} from '@/features/imageMark';
import type { VisualToolEditorProps } from './types';

function toNumber(value: DynamicValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 画布"编辑"工具编辑器:统一 MarkEditor 的画布宿主。
 * 文档序列化进节点工具 options.markDoc,应用时由 toolProcessor 统一导出。
 */
export function EditToolEditor({ options, onOptionsChange, sourceImageUrl }: VisualToolEditorProps): JSX.Element {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 对话框打开时的初始文档;此后 MarkEditor 内部维护状态,单向回写 options
  const [initialDoc] = useState<ImageMarkDoc>(() => parseMarkDoc(options.markDoc));
  const [initialStyle] = useState<Partial<MarkEditorStyleState>>(() => ({
    color: typeof options.color === 'string' ? options.color : undefined,
    lineWidthPercent: toNumber(options.lineWidthPercent),
    textSizePercent: toNumber(options.fontSizePercent),
    mosaicStrengthPercent: toNumber(options.mosaicStrengthPercent),
  }));

  return (
    <MarkEditor
      sourceImageUrl={sourceImageUrl}
      initialDoc={initialDoc}
      initialStyle={initialStyle}
      onDocChange={(doc) => {
        onOptionsChange({ ...optionsRef.current, markDoc: stringifyMarkDoc(doc) });
      }}
      onStyleChange={(style) => {
        onOptionsChange({
          ...optionsRef.current,
          color: style.color,
          lineWidthPercent: style.lineWidthPercent,
          fontSizePercent: style.textSizePercent,
          mosaicStrengthPercent: style.mosaicStrengthPercent,
        });
      }}
      className="h-[min(76vh,900px)]"
    />
  );
}
