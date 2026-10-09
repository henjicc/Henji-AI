import { createBuiltInImageEditRenderNodeRegistry } from '@/core/imageEdit/v3/builtInRenderNodes';
import { createImageEditOperationParametersV3 } from '@/core/imageEdit/v3/operationCatalog';
import { listImagingEffects } from '@/core/imaging/effects/registry';
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3/layerTypes';
import type { ImageEditorHostProfileV3 } from '../application/imageEditorHostProfiles';

export interface ImageEditFilterChoiceV3 {
  id: string;
  kind: 'effect' | 'adjustment';
  titleKey: string;
  title: string;
  available: boolean;
  reason?: string;
}

/** Only UI naming lives here. Algorithms, defaults and executability come from the registry. */
export function listImageEditFilterChoicesV3(profile: ImageEditorHostProfileV3): ImageEditFilterChoiceV3[] {
  const shared = listImagingEffects();
  return createBuiltInImageEditRenderNodeRegistry().list().flatMap(node => {
    const operation = node.operation;
    if (!operation?.creatable) return [];
    const allowed = operation.layerType === 'effect' ? profile.effects.find(effect => effect.id === operation.id) : undefined;
    if (operation.layerType === 'effect' ? !allowed : !profile.adjustments.includes(operation.id)) return [];
    const descriptor = shared.find(effect => effect.id === operation.id);
    return [{ id: operation.id, kind: operation.layerType,
      titleKey: `imageEditor.v3.${operation.layerType}.${operation.id}`,
      title: descriptor?.name ?? (operation.layerType === 'adjustment' ? '颜色调整' : '空间滤镜'),
      available: Boolean(node.cpu) && (allowed?.readiness.state ?? 'ready') === 'ready',
      reason: !node.cpu ? '此滤镜暂时无法用于图片，请选择其他滤镜' : allowed?.readiness.reason }];
  });
}

export function imageEditFilterDefaultsV3(choice: Pick<ImageEditFilterChoiceV3, 'id'>, workingSpace: string): ImageEditJsonObjectV3 {
  return createImageEditOperationParametersV3(choice.id, workingSpace);
}
