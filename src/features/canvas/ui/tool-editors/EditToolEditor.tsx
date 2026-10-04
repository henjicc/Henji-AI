import { Suspense, lazy } from 'react';
import type { VisualToolEditorProps } from './types';

// 同 CameraStageNodeDialog：静态引入会把图片编辑器钉进画布 chunk，
// 而它只在画布的图片编辑对话框打开时才用得到。
const CanvasEditToolEditorV3Host = lazy(() => import('../../imageEditV3/CanvasEditToolEditorV3Host')
  .then((module) => ({ default: module.CanvasEditToolEditorV3Host })));

/**
 * 画布图片编辑宿主：挂载 V3 图片编辑器。
 */
export function EditToolEditor(props: VisualToolEditorProps): JSX.Element {
  return (
    <Suspense fallback={<div className="h-[min(76vh,900px)]" />}>
      <CanvasEditToolEditorV3Host {...props} />
    </Suspense>
  );
}
