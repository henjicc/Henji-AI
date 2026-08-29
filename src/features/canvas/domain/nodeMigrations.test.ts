// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels';

import { CANVAS_NODE_TYPES } from './canvasNodes';
import {
  migrateGenerationPromptData,
  migrateExportImageResultKind,
  migrateLegacyGenerationDisplayName,
  migratePanoramaGenerationData,
  migrateRelightGenerationData,
  migrateMultiAngleGenerationData,
  migrateStoryboardGenerationData,
  migrateUpscaleGenerationData,
  migrateLayerSeparationGenerationData,
  migrateLayerStackResultData,
  resetTransientNodeRuntimeState,
} from './nodeMigrations';
import {
  PANORAMA_DEFAULT_PROMPT,
  PANORAMA_DEFAULT_PROMPT_VERSION,
} from '../capabilities/panoramaPolicy';

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
  it('恢复能力固定字段、默认提示词、兼容模型参数并限制为单张内联参考图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken-capability',
      promptTemplateVersion: 'broken-template',
      modelId: 'apimart-gpt-image-2',
      params: {
        apimartGptImage2AspectRatio: '1:1',
        apimartGptImage2Resolution: '1K',
        apimartGptImage2Count: 4,
      },
      prompt: '',
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
        apimartGptImage2Resolution: '1K',
        apimartGptImage2Count: 1,
      },
      mediaInputs: { image: ['first.png'] },
      fixedSemanticParams: {
        projection: 'equirectangular',
        aspectRatio: '2:1',
        outputCount: 1,
      },
      prompt: PANORAMA_DEFAULT_PROMPT,
      defaultPromptVersion: PANORAMA_DEFAULT_PROMPT_VERSION,
    });
  });

  it('默认提示词只迁移一次，用户主动清空后不会再次回填', () => {
    const data: DynamicValueMap = {
      modelId: 'apimart-gpt-image-2',
      prompt: '',
      defaultPromptVersion: PANORAMA_DEFAULT_PROMPT_VERSION,
    };

    migratePanoramaGenerationData(data);

    expect(data.prompt).toBe('');
    expect(data.defaultPromptVersion).toBe(PANORAMA_DEFAULT_PROMPT_VERSION);
  });
});

describe('migrateRelightGenerationData', () => {
  it('保存重开后恢复手动模式路由、提示词和一张源图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken',
      modelId: 'broken',
      params: {},
      mediaInputs: { image: ['source.png'] },
      relightSettings: {
        relightContractVersion: 1,
        lightingMode: 'manual',
        manual: {
          keyDirection: 'bottom',
          brightness: -1,
          colorPreset: 'cool',
          rimDirection: 'top',
          extraPrompt: 'keep logo',
        },
        smart: {
          preset: 'natural-studio',
          prompt: '',
          lightingReferenceImages: [],
        },
      },
    };

    migrateRelightGenerationData(data);

    expect(data).toMatchObject({
      capabilityId: 'image.relight',
      modelId: 'fal-ai-ic-light-v2',
      promptTemplateVersion: 'relight-manual-iclight-v1',
      params: { falIcLightV2InitialLatent: 'Bottom' },
      mediaInputs: { image: ['source.png'] },
      lightingReferenceImages: [],
      relightRouteReasons: [],
    });
    expect(String(data.prompt)).toContain('slightly darker low-key lighting');
    expect(String(data.prompt)).toContain('cool white illumination');
  });

  it('未知契约版本保持数据并标记为不可生成', () => {
    const data: DynamicValueMap = {
      relightSettings: { relightContractVersion: 2 },
      prompt: 'legacy',
    };
    migrateRelightGenerationData(data);
    expect(data.relightSettings).toEqual({ relightContractVersion: 2 });
    expect(data.relightRouteReasons).toEqual([expect.stringContaining('不支持的打光契约版本')]);
  });
});

describe('migrateUpscaleGenerationData', () => {
  it('保存重开后恢复唯一模型、安全上限和单张内联源图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken',
      prompt: 'do not redraw',
      modelId: 'apimart-gpt-image-2',
      params: {
        falTopazUpscaleModel: 'CGI',
        falTopazUpscaleFactor: 4,
        falTopazFaceEnhancement: true,
        unsupported: 'drop-me',
      },
      mediaInputs: { image: ['first.png', 'second.png'] },
    };

    migrateUpscaleGenerationData(data);

    expect(data).toMatchObject({
      capabilityId: 'image.upscale',
      prompt: '',
      promptTemplateVersion: null,
      modelId: 'fal-ai-topaz-image-upscale',
      params: {
        falTopazUpscaleModel: 'CGI',
        falTopazUpscaleFactor: 4,
        falTopazFaceEnhancement: true,
      },
      mediaInputs: { image: ['first.png'] },
      fixedSemanticParams: {
        maxOutputMegapixels: 48,
        maxInputFileBytes: 20 * 1024 * 1024,
      },
    });
    expect((data.params as DynamicValueMap).unsupported).toBeUndefined();
  });
});

describe('migrateMultiAngleGenerationData', () => {
  it('保存重开后迁移旧角度字段、恢复隐藏模型并限制单张源图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken',
      prompt: '不应保留',
      modelId: 'wrong-model',
      params: { prompt: '不应发送' },
      mediaInputs: { image: ['first.png', 'second.png'] },
      multiAngleConfig: {
        views: [{ id: 'legacy', label: '旧角度', azimuth: 40, elevation: 0.2 }],
      },
    };

    migrateMultiAngleGenerationData(data);

    expect(data).toMatchObject({
      capabilityId: 'image.multi-angle',
      prompt: '',
      params: {},
      modelId: 'fal-qwen-image-edit-2509-multiple-angles',
      mediaInputs: { image: ['first.png'] },
      multiAngleConfig: {
        version: 1,
        controlProfile: 'continuous-v1',
        concurrency: 2,
        views: [{ viewId: 'legacy', yawControlDeg: 40, verticalControl: 0.2 }],
      },
      multiAngleResultPlaceholderId: null,
    });
  });
});

describe('图层拆分迁移', () => {
  it('固定拆层模式、原厂模型与单张源图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'broken',
      modelId: 'not-a-model',
      params: { unsupported: true },
      mediaInputs: { image: ['first.png', 'second.png'] },
    };
    migrateLayerSeparationGenerationData(data);
    expect(data).toMatchObject({
      capabilityId: 'image.layer-separation',
      promptTemplateVersion: null,
      modelId: 'volcengine-seedream-5.0-pro',
      mediaInputs: { image: ['first.png'] },
      fixedSemanticParams: { layerStackContractVersion: 1 },
      params: { volcengineSeedream50ProMode: 'layer-decomposition' },
    });
  });

  it('损坏或未知图层文档保留合成图并降级普通图片语义', () => {
    const data: DynamicValueMap = { resultKind: 'layer-stack', imageUrl: '/managed/composite.png', layerStackDocument: { version: 2 } };
    migrateLayerStackResultData(data);
    expect(data).toEqual({ resultKind: 'image', imageUrl: '/managed/composite.png' });
  });
});

describe('migrateStoryboardGenerationData', () => {
  it('九宫格预设保存重开后恢复固定 3×3、模板版本与九格顺序', () => {
    const data: DynamicValueMap = {
      capabilityId: 'image.nine-grid',
      storyboardPreset: 'nine-grid-v1',
      promptTemplateVersion: 'legacy',
      gridRows: 2,
      gridCols: 7,
      frames: [{ id: 'kept', description: '第一格', referenceIndex: 0 }],
    };

    migrateStoryboardGenerationData(data);

    expect(data).toMatchObject({
      storyboardPreset: 'nine-grid-v1',
      promptTemplateVersion: 'nine-grid-storyboard-v1',
      gridRows: 3,
      gridCols: 3,
    });
    expect(data.frames).toHaveLength(9);
    expect((data.frames as DynamicValueMap[])[0]).toMatchObject({
      id: 'kept',
      description: '第一格',
      referenceIndex: 0,
    });
  });

  it('普通分镜节点不被九宫格迁移改写', () => {
    const data: DynamicValueMap = { gridRows: 2, gridCols: 4, frames: [] };
    migrateStoryboardGenerationData(data);
    expect(data).toEqual({ gridRows: 2, gridCols: 4, frames: [] });
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
    expect(data.generationError).toBeUndefined();
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
    expect(data.generationError).toBe('生成在项目切换或应用关闭前未返回，请重新生成');
  });
});
