// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';

import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels';

import { migrateElementEditGenerationData } from './nodeMigrations';

beforeAll(async () => {
  await loadRealModelsIntoRegistry();
});

describe('migrateElementEditGenerationData', () => {
  it('旧节点恢复局部重绘契约、安全设置、可用模型与单张源图', () => {
    const data: DynamicValueMap = {
      capabilityId: 'legacy.element-edit',
      promptTemplateVersion: 'local-redraw-v1',
      fixedSemanticParams: { legacy: true },
      modelId: 'missing-image-edit-model',
      params: {
        apimartGptImage2Resolution: '4K',
        unsupported: 'drop-me',
      },
      mediaInputs: {
        image: ['', 'first.png', 'second.png'],
        video: ['keep-video.mp4'],
      },
      localRedrawSettings: {
        contextScale: 99,
        aspectRatio: '21:9',
        registrationQuality: 'unknown',
        featherPixels: -5,
        forceRegistration: 'true',
      },
    };

    migrateElementEditGenerationData(data);

    expect(data).toMatchObject({
      capabilityId: 'image.element-edit',
      promptTemplateVersion: 'local-redraw-crop-v2',
      fixedSemanticParams: {
        referenceImageCount: 1,
        outputCount: 1,
        localRedrawContractVersion: 2,
        maskEncoding: 'alpha',
        maskPaintMeaning: 'transparent-edit',
      },
      modelId: 'apimart-gpt-image-2',
      params: { apimartGptImage2Resolution: '4K' },
      mediaInputs: {
        image: ['first.png'],
        video: ['keep-video.mp4'],
      },
      localRedrawSettings: {
        contextScale: 5,
        aspectRatio: 'auto',
        registrationQuality: 'precise',
        featherPixels: 0,
        forceRegistration: false,
      },
    });
    expect((data.params as DynamicValueMap).unsupported).toBeUndefined();
  });
});
