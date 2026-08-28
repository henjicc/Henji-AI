import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import {
  CANVAS_IMAGE_CAPABILITY_IDS,
  type CanvasImageCapabilityDefinition,
} from './types';
import { builtInCanvasImageCapabilities } from './builtInCapabilities';
import {
  CanvasImageCapabilityRegistrationError,
  createCanvasImageCapabilityRegistry,
  filterCanvasImageCapabilities,
  getCanvasImageCapability,
  getExecutableCanvasImageCapabilitiesForSourceNode,
  getRegisteredCanvasImageCapabilities,
  isCanvasImageCapabilityExecutable,
} from './registry';
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
} from '../domain/canvasNodes';

function capabilityWith(
  definition: CanvasImageCapabilityDefinition,
  patch: Partial<CanvasImageCapabilityDefinition>,
): CanvasImageCapabilityDefinition {
  return { ...definition, ...patch };
}

describe('画布图片能力注册表', () => {
  const panorama = builtInCanvasImageCapabilities.find(
    (definition) => definition.id === CANVAS_IMAGE_CAPABILITY_IDS.panorama,
  );
  const gridSplit = builtInCanvasImageCapabilities.find(
    (definition) => definition.id === CANVAS_IMAGE_CAPABILITY_IDS.gridSplit,
  );

  if (!panorama || !gridSplit) {
    throw new Error('内置图片能力测试基线不完整');
  }

  const imageNode: CanvasNode = {
    id: 'image-source',
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: {
      imageUrl: 'managed-image.png',
      aspectRatio: '1:1',
    },
  };

  it('登记九项唯一、稳定且可序列化的能力', () => {
    const definitions = getRegisteredCanvasImageCapabilities();
    const expectedIds = Object.values(CANVAS_IMAGE_CAPABILITY_IDS);

    expect(definitions).toHaveLength(9);
    expect(new Set(definitions.map((definition) => definition.id)).size).toBe(9);
    expect(definitions.map((definition) => definition.id)).toEqual(expectedIds);
    expect(JSON.parse(JSON.stringify(definitions))).toEqual(definitions);
    expect(definitions.every((definition) => (
      typeof definition.icon === 'string'
      && typeof definition.node.editor === 'string'
      && !Object.values(definition).some((value) => typeof value === 'function')
    ))).toBe(true);
  });

  it('只向可执行查询开放已经实现且开关启用的能力', () => {
    expect(isCanvasImageCapabilityExecutable(panorama)).toBe(true);
    expect(getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.panorama))
      .toMatchObject({
        implementation: {
          status: 'implemented',
          execution: { kind: 'canvas-node', nodeType: CANVAS_NODE_TYPES.panoramaGen },
        },
        availability: { releaseStage: 'available', defaultEnabled: true },
      });

    expect(getExecutableCanvasImageCapabilitiesForSourceNode(imageNode).map(({ id }) => id))
      .toEqual([
        CANVAS_IMAGE_CAPABILITY_IDS.panorama,
        CANVAS_IMAGE_CAPABILITY_IDS.relight,
        CANVAS_IMAGE_CAPABILITY_IDS.gridSplit,
      ]);
    expect(getExecutableCanvasImageCapabilitiesForSourceNode(imageNode, {
      [CANVAS_IMAGE_CAPABILITY_IDS.gridSplit]: false,
    }).map(({ id }) => id)).toEqual([
      CANVAS_IMAGE_CAPABILITY_IDS.panorama,
      CANVAS_IMAGE_CAPABILITY_IDS.relight,
    ]);
  });

  it('按媒体类型、发布状态和实现状态筛选同一注册源', () => {
    expect(filterCanvasImageCapabilities({
      sourceMediaType: 'image',
      implementationStatus: 'planned',
    })).toHaveLength(6);
    expect(filterCanvasImageCapabilities({
      sourceMediaType: 'video',
    })).toEqual([]);
    expect(filterCanvasImageCapabilities({
      releaseStages: ['available'],
      executableOnly: true,
    }).map(({ id }) => id)).toEqual([
      CANVAS_IMAGE_CAPABILITY_IDS.panorama,
      CANVAS_IMAGE_CAPABILITY_IDS.relight,
      CANVAS_IMAGE_CAPABILITY_IDS.gridSplit,
    ]);
    expect(filterCanvasImageCapabilities({
      enabledOnly: true,
      featureFlags: {
        [CANVAS_IMAGE_CAPABILITY_IDS.gridSplit]: false,
        [CANVAS_IMAGE_CAPABILITY_IDS.panorama]: true,
      },
    }).map(({ id }) => id)).toEqual([
      CANVAS_IMAGE_CAPABILITY_IDS.panorama,
      CANVAS_IMAGE_CAPABILITY_IDS.relight,
    ]);
  });

  it('中英文名称、分组、说明和不可用原因均有翻译', () => {
    for (const definition of getRegisteredCanvasImageCapabilities()) {
      const keys = [
        definition.titleKey,
        definition.descriptionKey,
        definition.groupLabelKey,
        definition.availability.unavailableReasonKey,
      ].filter((key): key is string => key !== null);
      for (const key of keys) {
        expect(i18n.exists(key, { lng: 'zh-CN' }), `缺少中文文案：${key}`).toBe(true);
        expect(i18n.exists(key, { lng: 'en-US' }), `缺少英文文案：${key}`).toBe(true);
      }
    }
  });

  it('要求源节点已有符合数量范围的真实媒体输出', () => {
    const emptyImageNode: CanvasNode = {
      ...imageNode,
      data: { ...imageNode.data, imageUrl: null },
    };
    expect(getExecutableCanvasImageCapabilitiesForSourceNode(emptyImageNode)).toEqual([]);
  });

  it('拒绝重复编号、未知编辑器和非法源媒体类型', () => {
    expect(() => createCanvasImageCapabilityRegistry([gridSplit, gridSplit]))
      .toThrow('图片能力已注册：image.grid-split');

    const unknownEditor = capabilityWith(gridSplit, {
      node: {
        ...gridSplit.node,
        editor: 'unknown-editor',
      } as unknown as CanvasImageCapabilityDefinition['node'],
    });
    expect(() => createCanvasImageCapabilityRegistry([unknownEditor]))
      .toThrow('引用了未知编辑器：unknown-editor');

    const invalidSource = capabilityWith(gridSplit, {
      source: {
        ...gridSplit.source,
        mediaTypes: ['document'],
      } as unknown as CanvasImageCapabilityDefinition['source'],
    });
    expect(() => createCanvasImageCapabilityRegistry([invalidSource]))
      .toThrow('包含未知或空的源媒体类型');
  });

  it('拒绝尚未实现的能力误开放以及已实现能力的无效引用', () => {
    const plannedPanorama = capabilityWith(panorama, {
      implementation: { status: 'planned', execution: null },
    });
    const mistakenlyAvailable = capabilityWith(plannedPanorama, {
      availability: {
        releaseStage: 'available',
        defaultEnabled: true,
        unavailableReasonKey: null,
      },
    });
    expect(() => createCanvasImageCapabilityRegistry([mistakenlyAvailable]))
      .toThrow('尚未实现，不能默认开放或标记为可用');

    const unknownTool = capabilityWith(gridSplit, {
      implementation: {
        status: 'implemented',
        execution: {
          kind: 'local-tool',
          toolType: 'missing-tool',
        },
      } as unknown as CanvasImageCapabilityDefinition['implementation'],
    });
    expect(() => createCanvasImageCapabilityRegistry([unknownTool]))
      .toThrow('引用了未知本地工具：missing-tool');

    const unknownNode = capabilityWith(gridSplit, {
      implementation: {
        status: 'implemented',
        execution: {
          kind: 'canvas-node',
          nodeType: 'missing-node',
        },
      } as unknown as CanvasImageCapabilityDefinition['implementation'],
    });
    expect(() => createCanvasImageCapabilityRegistry([unknownNode]))
      .toThrow(CanvasImageCapabilityRegistrationError);
  });
});
