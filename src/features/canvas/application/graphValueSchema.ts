import { isParamVisible } from '@/components/params/paramVisibility';
import { LinkageEngine } from '@/core/linkage';
import { buildParamPresentationItems, type ParamPresentationItem } from '@/core/params/paramPresentation';
import { registry } from '@/core/ModelRegistry';
import type { ModelDefinition, ParamDef } from '@/core/types';

import type { CanvasNode } from '../domain/canvasNodes';
import { getCanvasNodeDefinition } from '../domain/nodeRegistry';
import type { RowMediaKind } from '../domain/socketTypes';

export interface VisibleSchemaParamRows {
  visibleParams: ParamDef[];
  presentationItems: ParamPresentationItem[];
  displayedParams: ParamDef[];
  linkageEngine: LinkageEngine | null;
}

export function resolveVisibleSchemaParamRows(
  model: ModelDefinition | undefined,
  schema: ParamDef[],
  values: DynamicValueMap,
  excludedParamIds: ReadonlySet<string>,
  connectedParamIds: ReadonlySet<string>,
): VisibleSchemaParamRows {
  const linkageEngine = model?.linkages?.length ? new LinkageEngine(model.linkages) : null;
  const visibleParams = [...schema]
    .filter((param) => !excludedParamIds.has(param.id))
    .filter((param) => isParamVisible(param, values, linkageEngine))
    .map((param): ParamDef => {
      if (!linkageEngine || (param.type !== 'dropdown' && param.type !== 'radio')) return param;
      const options = linkageEngine.getFilteredOptions(param.id, values, schema);
      return !options.length || options === param.options ? param : { ...param, options } as ParamDef;
    })
    .sort((left, right) => left.order - right.order);
  const presentationItems = buildParamPresentationItems(visibleParams, model?.paramPresentation);
  const displayedParams = presentationItems.flatMap((item) => item.kind === 'param'
    ? [item.param]
    : item.params.filter((param) => connectedParamIds.has(param.id)));
  return { visibleParams, presentationItems, displayedParams, linkageEngine };
}

/** schema 上传参数对应的媒体类型；通用文件参数仅在 accept 明确为单一媒体族时参与自动连接。 */
export function getSchemaMediaParamKind(param: ParamDef | undefined): RowMediaKind | null {
  if (!param) return null;
  if (param.type === 'image-upload') return 'image';
  if (param.type === 'video-upload') return 'video';
  if (param.type !== 'file-upload') return null;
  const accepts = 'accept' in param && Array.isArray(param.accept) ? param.accept : [];
  const kinds = new Set<RowMediaKind>();
  for (const accept of accepts) {
    if (accept.startsWith('image/')) kinds.add('image');
    if (accept.startsWith('video/')) kinds.add('video');
    if (accept.startsWith('audio/')) kinds.add('audio');
  }
  return kinds.size === 1 ? [...kinds][0] : null;
}

export function findParamForTargetNode(targetNode: CanvasNode, paramId: string): ParamDef | undefined {
  const modelId = (targetNode.data as { modelId?: DynamicValue }).modelId;
  if (typeof modelId === 'string' && modelId) {
    const storedParam = registry.getSchema(modelId).find((item) => item.id === paramId);
    if (storedParam) {
      return storedParam;
    }
  }

  const generationType = getCanvasNodeDefinition(targetNode.type)?.generation?.modelType;
  if (!generationType) {
    return undefined;
  }

  return registry
    .getModelsByType(generationType)
    .flatMap((model) => model.params)
    .find((item) => item.id === paramId);
}
