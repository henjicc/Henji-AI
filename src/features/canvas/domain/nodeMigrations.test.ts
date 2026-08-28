// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels';

import { CANVAS_NODE_TYPES } from './canvasNodes';
import {
  migrateGenerationPromptData,
  migrateExportImageResultKind,
  migrateLegacyGenerationDisplayName,
  migratePanoramaGenerationData,
  resetTransientNodeRuntimeState,
} from './nodeMigrations';

beforeAll(async () => {
  await loadRealModelsIntoRegistry();
});

describe('migrateExportImageResultKind', () => {
  it('保留全景与合法旧来源语义', () => {
    const panorama: DynamicValueMap = { resultKind: 'panorama' };
    const storyboard: DynamicValueMap = { resultKind: 'storyboardGenOutput' };

    migrateExportImageResultKind(panorama);
    migrateExportImageResultKind(storyboard);

    expect(panorama.resultKind).toBe('panorama');
    expect(storyboard.resultKind).toBe('storyboardGenOutput');
  });

  it('缺失或非法结果语义降级为普通图片', () => {
    const missing: DynamicValueMap = {};
    const invalid: DynamicValueMap = { resultKind: 'future-corrupted-kind' };

    migrateExportImageResultKind(missing);
    migrateExportImageResultKind(invalid);

    expect(missing.resultKind).toBe('image');
    expect(invalid.resultKind).toBe('image');
  });
});

describe('migratePanoramaGenerationData', () => {
  it('恢复能力固定字段、兼容模型参数并限制为单张内联参考图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken-capability',
      promptTemplateVersion: 'broken-template',
      modelId: 'apimart-gpt-image-2',
      params: {
        apimartGptImage2AspectRatio: '1:1',
        apimartGptImage2Resolution: '1K',
        apimartGptImage2Count: 4,
      },
      mediaInputs: {
        image: ['first.png', 'second.png'],
      },
    };

    migratePanoramaGenerationData(data);

    expect(data).toMatchObject({
      capabilityId: 'image.panorama',
      promptTemplateVersion: 'panorama-equirectangular-reference-v1',
      modelId: 'apimart-gpt-image-2',
      params: {
        apimartGptImage2AspectRatio: '2:1',
        apimartGptImage2Resolution: '2K',
        apimartGptImage2Count: 1,
      },
      mediaInputs: { image: ['first.png'] },
      fixedSemanticParams: {
        projection: 'equirectangular',
        aspectRatio: '2:1',
        resolution: '2K',
        outputCount: 1,
      },
    });
  });
});

describe('migrateLegacyGenerationDisplayName', () => {
  it('迁移精确匹配的旧默认名，并保留用户自定义标题', () => {
    const legacy: DynamicValueMap = { displayName: 'AI 图片' };
    migrateLegacyGenerationDisplayName(CANVAS_NODE_TYPES.imageEdit, legacy);
    expect(legacy.displayName).toBe('图片生成');

    const custom: DynamicValueMap = { displayName: '产品主视觉' };
    migrateLegacyGenerationDisplayName(CANVAS_NODE_TYPES.imageEdit, custom);
    expect(custom.displayName).toBe('产品主视觉');
  });
});

describe('migrateGenerationPromptData', () => {
  it('旧节点补齐兼容字符串并过滤损坏的媒体 binding', () => {
    const data: DynamicValueMap = {
      prompt: null,
      promptMediaBindings: [
        {
          resourceId: 'canvas-local:node-a:valid',
          mediaType: 'image',
          dataUrl: 'C:\\media\\a.png',
        },
        { resourceId: '', mediaType: 'unknown' },
      ],
    };

    migrateGenerationPromptData(data);

    expect(data.prompt).toBe('');
    expect(data.promptMediaBindings).toEqual([expect.objectContaining({
      resourceId: 'canvas-local:node-a:valid',
    })]);
  });
});

describe('resetTransientNodeRuntimeState', () => {
  it('清理 3D 镜头节点无法恢复的视频渲染状态并保留结果', () => {
    const data: DynamicValueMap = {
      projectId: 'camera-project',
      outputKind: 'video',
      videoUrl: 'henji-media://completed.mp4',
      durationSec: 5.2,
      videoExporting: true,
      videoProgress: 0.42,
      videoRenderPhase: 'rendering',
      videoRenderRequestId: 'stale-request',
      videoRenderError: 'stale-error',
      imageExporting: true,
      imageRenderRequestId: 'stale-image-request',
      imageRenderError: 'stale-image-error',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.cameraStage, data);

    expect(data).toMatchObject({
      projectId: 'camera-project',
      outputKind: 'video',
      videoUrl: 'henji-media://completed.mp4',
      durationSec: 5.2,
      videoExporting: false,
      videoProgress: null,
      videoRenderPhase: null,
      videoRenderRequestId: null,
      videoRenderError: null,
      imageExporting: false,
      imageRenderRequestId: null,
      imageRenderError: null,
    });
  });

  it('继续清理普通生成节点的旧生成状态', () => {
    const data: DynamicValueMap = {
      isGenerating: true,
      generationStartedAt: 123,
      imageUrl: 'henji-media://completed.png',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.imageEdit, data);

    expect(data).toEqual({
      isGenerating: false,
      generationStartedAt: null,
      imageUrl: 'henji-media://completed.png',
    });
  });

  it('保留已登记服务端任务且尚无结果的生成态，供重启后续查', () => {
    const data: DynamicValueMap = {
      isGenerating: true,
      generationStartedAt: 123,
      videoUrl: null,
      serverTaskId: 'dfcd13c95406b9acf3999f043d6f0a26',
      serverTaskModelId: 'kie-seedance-2.0-fast',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.exportVideo, data);

    expect(data.isGenerating).toBe(true);
    expect(data.generationStartedAt).toBe(123);
    expect(data.serverTaskId).toBe('dfcd13c95406b9acf3999f043d6f0a26');
  });

  it('任务已出结果时不再保留生成态', () => {
    const data: DynamicValueMap = {
      isGenerating: true,
      generationStartedAt: 123,
      videoUrl: 'henji-media://done.mp4',
      serverTaskId: 'finished-task',
      serverTaskModelId: 'kie-seedance-2.0-fast',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.exportVideo, data);

    expect(data.isGenerating).toBe(false);
    expect(data.generationStartedAt).toBe(null);
  });

  it('缺少模型 ID 时无法续查，按旧行为清理生成态', () => {
    const data: DynamicValueMap = {
      isGenerating: true,
      generationStartedAt: 123,
      videoUrl: null,
      serverTaskId: 'orphan-task',
    };

    resetTransientNodeRuntimeState(CANVAS_NODE_TYPES.exportVideo, data);

    expect(data.isGenerating).toBe(false);
    expect(data.generationStartedAt).toBe(null);
  });
});
