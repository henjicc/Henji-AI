import type { CanvasNode } from '../domain/canvasNodes';
import {
  getCanvasNodeDefinition,
  getNodeMediaOutputs,
} from '../domain/nodeRegistry';
import type { MediaPortKind } from '../domain/nodePorts';
import { getToolPlugin } from '../tools';
import { builtInCanvasImageCapabilities } from './builtInCapabilities';
import type {
  CanvasImageCapabilityDefinition,
  CanvasImageCapabilityEditorKind,
  CanvasImageCapabilityFeatureFlags,
  CanvasImageCapabilityFilter,
  CanvasImageCapabilityId,
  CanvasImageCapabilityReleaseStage,
} from './types';

const EDITOR_KINDS: readonly CanvasImageCapabilityEditorKind[] = [
  'standard',
  'relight',
  'multiAngle',
  'mask',
  'gridSplit',
];
const SOURCE_MEDIA_TYPES = ['image', 'video', 'audio'] as const;
const RELEASE_STAGES: readonly CanvasImageCapabilityReleaseStage[] = [
  'draft',
  'experimental',
  'available',
  'disabled',
];

function isMediaPortKind(value: string): value is MediaPortKind {
  return value === 'image' || value === 'video' || value === 'audio';
}

export class CanvasImageCapabilityRegistrationError extends Error {}

function assertNonEmptyKey(value: string, field: string, capabilityId: string): void {
  if (!value.trim()) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${capabilityId} 的 ${field} 不能为空`,
    );
  }
}

function validateCapability(definition: CanvasImageCapabilityDefinition): void {
  assertNonEmptyKey(definition.titleKey, 'titleKey', definition.id);
  assertNonEmptyKey(definition.descriptionKey, 'descriptionKey', definition.id);
  assertNonEmptyKey(definition.groupLabelKey, 'groupLabelKey', definition.id);

  if (!EDITOR_KINDS.includes(definition.node.editor)) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 引用了未知编辑器：${definition.node.editor}`,
    );
  }
  if (definition.node.openEditorOnCreate && definition.node.editor === 'standard') {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 的标准编辑器不能在创建后自动打开`,
    );
  }
  if (!RELEASE_STAGES.includes(definition.availability.releaseStage)) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 使用了未知发布状态：${definition.availability.releaseStage}`,
    );
  }
  if (
    definition.source.mediaTypes.length === 0
    || definition.source.mediaTypes.some((kind) => !SOURCE_MEDIA_TYPES.includes(kind))
  ) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 包含未知或空的源媒体类型`,
    );
  }
  if (
    !Number.isInteger(definition.source.minCount)
    || !Number.isInteger(definition.source.maxCount)
    || definition.source.minCount < 0
    || definition.source.maxCount < definition.source.minCount
  ) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 的源媒体数量范围无效`,
    );
  }

  const { implementation, availability } = definition;
  if (
    implementation.status === 'planned'
    && (availability.releaseStage === 'available' || availability.defaultEnabled)
  ) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 尚未实现，不能默认开放或标记为可用`,
    );
  }
  if (
    availability.defaultEnabled
    && availability.releaseStage !== 'available'
    && availability.releaseStage !== 'experimental'
  ) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 的发布状态不允许默认启用`,
    );
  }
  if (
    availability.releaseStage !== 'available'
    && availability.unavailableReasonKey === null
  ) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 缺少不可用原因文案键`,
    );
  }
  if (availability.unavailableReasonKey !== null) {
    assertNonEmptyKey(
      availability.unavailableReasonKey,
      'unavailableReasonKey',
      definition.id,
    );
  }

  if (implementation.status === 'implemented') {
    const { execution } = implementation;
    if (execution.kind === 'canvas-node' && !getCanvasNodeDefinition(execution.nodeType)) {
      throw new CanvasImageCapabilityRegistrationError(
        `图片能力 ${definition.id} 引用了未知画布节点：${execution.nodeType}`,
      );
    }
    if (execution.kind === 'local-tool' && !getToolPlugin(execution.toolType)) {
      throw new CanvasImageCapabilityRegistrationError(
        `图片能力 ${definition.id} 引用了未知本地工具：${execution.toolType}`,
      );
    }
  }

  const { count } = definition.outputPolicy;
  if (
    (count.mode === 'fixed' && (!Number.isInteger(count.count) || count.count < 1))
    || (
      count.mode === 'parameter'
      && (
        !count.parameterKey.trim()
        || !Number.isInteger(count.defaultCount)
        || !Number.isInteger(count.minCount)
        || !Number.isInteger(count.maxCount)
        || count.minCount < 1
        || count.maxCount < count.minCount
        || count.defaultCount < count.minCount
        || count.defaultCount > count.maxCount
      )
    )
  ) {
    throw new CanvasImageCapabilityRegistrationError(
      `图片能力 ${definition.id} 的输出数量策略无效`,
    );
  }
}

export function createCanvasImageCapabilityRegistry(
  definitions: readonly CanvasImageCapabilityDefinition[],
): ReadonlyMap<CanvasImageCapabilityId, CanvasImageCapabilityDefinition> {
  const registry = new Map<CanvasImageCapabilityId, CanvasImageCapabilityDefinition>();
  definitions.forEach((definition) => {
    if (registry.has(definition.id)) {
      throw new CanvasImageCapabilityRegistrationError(`图片能力已注册：${definition.id}`);
    }
    validateCapability(definition);
    registry.set(definition.id, definition);
  });
  return registry;
}

const capabilityRegistry = createCanvasImageCapabilityRegistry(builtInCanvasImageCapabilities);

export function getCanvasImageCapability(
  capabilityId: CanvasImageCapabilityId,
): CanvasImageCapabilityDefinition | null {
  return capabilityRegistry.get(capabilityId) ?? null;
}

export function getRegisteredCanvasImageCapabilities(): readonly CanvasImageCapabilityDefinition[] {
  return [...capabilityRegistry.values()].sort((left, right) => left.order - right.order);
}

export function isCanvasImageCapabilityExecutable(
  definition: CanvasImageCapabilityDefinition,
  featureFlags: CanvasImageCapabilityFeatureFlags = {},
): boolean {
  if (definition.implementation.status !== 'implemented') {
    return false;
  }
  if (
    definition.availability.releaseStage !== 'available'
    && definition.availability.releaseStage !== 'experimental'
  ) {
    return false;
  }
  return isCanvasImageCapabilityFeatureEnabled(definition, featureFlags);
}

export function isCanvasImageCapabilityFeatureEnabled(
  definition: CanvasImageCapabilityDefinition,
  featureFlags: CanvasImageCapabilityFeatureFlags = {},
): boolean {
  return featureFlags[definition.id] ?? definition.availability.defaultEnabled;
}

export function filterCanvasImageCapabilities(
  filter: CanvasImageCapabilityFilter = {},
): readonly CanvasImageCapabilityDefinition[] {
  return getRegisteredCanvasImageCapabilities().filter((definition) => {
    if (
      filter.sourceMediaType
      && !definition.source.mediaTypes.includes(filter.sourceMediaType)
    ) {
      return false;
    }
    if (
      filter.releaseStages
      && !filter.releaseStages.includes(definition.availability.releaseStage)
    ) {
      return false;
    }
    if (
      filter.implementationStatus
      && definition.implementation.status !== filter.implementationStatus
    ) {
      return false;
    }
    if (
      filter.enabledOnly
      && !isCanvasImageCapabilityFeatureEnabled(definition, filter.featureFlags)
    ) {
      return false;
    }
    if (
      filter.executableOnly
      && !isCanvasImageCapabilityExecutable(definition, filter.featureFlags)
    ) {
      return false;
    }
    return true;
  });
}

export function getExecutableCanvasImageCapabilitiesForSourceNode(
  sourceNode: CanvasNode,
  featureFlags: CanvasImageCapabilityFeatureFlags = {},
): readonly CanvasImageCapabilityDefinition[] {
  const outputs = getNodeMediaOutputs(sourceNode.type, sourceNode.data);
  return filterCanvasImageCapabilities({
    featureFlags,
    executableOnly: true,
  }).filter((definition) => {
    const matchingOutputCount = outputs.filter((output) => (
      isMediaPortKind(output.kind) && definition.source.mediaTypes.includes(output.kind)
    )).length;
    if (definition.source.requireMaterializedMedia && matchingOutputCount === 0) {
      return false;
    }
    return matchingOutputCount >= definition.source.minCount
      && matchingOutputCount <= definition.source.maxCount;
  });
}
