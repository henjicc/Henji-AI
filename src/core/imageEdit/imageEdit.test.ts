import { describe, expect, it, vi } from 'vitest';
import { ANNOTATION_DEFAULT_STROKE_HEX } from '@/core/theme/colorTokens';
import {
  IMAGE_EDIT_OPERATION_IDS,
  ImageEditOperationRegistry,
  InvalidImageEditOperationParamsError,
  UnsupportedImageEditOperationError,
  coerceImageEditSession,
  createBuiltInImageEditOperationRegistry,
  createDefaultDiffusionOperationParams,
  createEmptyImageEditDocument,
  createImageEditDocumentFromMarkDoc,
  createImageEditExecutionPort,
  compileDiffusionRecipe,
  decodeImageEditDocument,
  imageEditDocumentToMarkDoc,
  parseDiffusionOperationParams,
  replaceMarkDocInImageEditDocument,
  type ImageEditDocument,
  type ImageMarkDoc,
} from './index';
import { determineDiffusionInvalidation } from './webgpu/diffusionRenderer';

function createMarkDoc(): ImageMarkDoc {
  return {
    version: 1,
    orientation: { rotate: 90, mirrored: true },
    crop: { x: 4, y: 6, width: 80, height: 60 },
    items: [{
      id: 'rect-1',
      type: 'rect',
      x: 10,
      y: 12,
      width: 30,
      height: 20,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 3,
    }],
  };
}

describe('图片编辑文档兼容契约', () => {
  it('按朝向、标注、裁剪顺序迁移 V1 并可无损投影回旧文档', () => {
    const source = createMarkDoc();
    const decoded = decodeImageEditDocument(source);

    expect(decoded).toMatchObject({ sourceFormat: 'v1', migrated: true, issues: [] });
    expect(decoded.document.operations.map((operation) => operation.operationId)).toEqual([
      IMAGE_EDIT_OPERATION_IDS.orientation,
      IMAGE_EDIT_OPERATION_IDS.annotations,
      IMAGE_EDIT_OPERATION_IDS.crop,
    ]);
    expect(imageEditDocumentToMarkDoc(decoded.document)).toEqual(source);
  });

  it('保留合法未知操作，并在更新标注投影时保持实例位置', () => {
    const source = createImageEditDocumentFromMarkDoc(createMarkDoc());
    const unknownOperation = {
      id: 'future-effect-1',
      operationId: 'image.future-effect',
      enabled: true,
      params: { amount: 0.5 },
    };
    source.operations.splice(1, 0, unknownOperation);

    const decoded = decodeImageEditDocument(JSON.stringify(source));
    expect(decoded.document.operations[1]).toEqual(unknownOperation);

    const nextMarkDoc = { ...createMarkDoc(), crop: null };
    const replaced = replaceMarkDocInImageEditDocument(decoded.document, nextMarkDoc);
    expect(replaced.operations[1]).toEqual(unknownOperation);
    expect(imageEditDocumentToMarkDoc(replaced)).toEqual(nextMarkDoc);
  });

  it('对损坏 JSON、未知版本和非法 V2 操作确定回退空文档', () => {
    expect(decodeImageEditDocument('{').issues).toEqual(['invalid-json']);
    expect(decodeImageEditDocument({ version: 9 }).sourceFormat).toBe('unknown-version');

    const invalidOrientation = decodeImageEditDocument({
      version: 2,
      operations: [{
        id: 'orientation',
        operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
        enabled: true,
        params: { rotate: 45, mirrored: false },
      }],
    });
    expect(invalidOrientation.issues).toEqual(['invalid-operation']);
    expect(invalidOrientation.document).toEqual(createEmptyImageEditDocument());

    const invalidEnabled = decodeImageEditDocument({
      version: 2,
      operations: [{
        id: 'orientation',
        operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
        enabled: 'true',
        params: { rotate: 0, mirrored: false },
      }],
    });
    expect(invalidEnabled.issues).toEqual(['invalid-operation']);

    const duplicateBuiltIn = decodeImageEditDocument({
      version: 2,
      operations: [
        {
          id: 'diffusion-1',
          operationId: IMAGE_EDIT_OPERATION_IDS.diffusion,
          enabled: true,
          params: createDefaultDiffusionOperationParams(),
        },
        {
          id: 'diffusion-2',
          operationId: IMAGE_EDIT_OPERATION_IDS.diffusion,
          enabled: true,
          params: createDefaultDiffusionOperationParams(),
        },
      ],
    });
    expect(duplicateBuiltIn.issues).toEqual(['duplicate-built-in-operation']);
  });

  it('兼容旧编辑状态和旧会话并优先保留原图来源', () => {
    const legacy = coerceImageEditSession({
      originalSrc: 'legacy-source',
      canvas: {
        annotations: [{
          id: 'ellipse-1',
          type: 'circle',
          x: 50,
          y: 40,
          radiusX: 10,
          radiusY: 5,
          stroke: ANNOTATION_DEFAULT_STROKE_HEX,
          strokeWidth: 2,
        }],
        rotation: 90,
        flipH: true,
        flipV: false,
        cropRect: { x: 2, y: 3, width: 40, height: 30 },
      },
    }, 'fallback-source');

    expect(legacy.sourceUrl).toBe('legacy-source');
    expect(imageEditDocumentToMarkDoc(legacy.document)).toMatchObject({
      orientation: { rotate: 90, mirrored: true },
      crop: { x: 2, y: 3, width: 40, height: 30 },
      items: [{ type: 'ellipse', x: 40, y: 35, width: 20, height: 10 }],
    });

    const oldSession = coerceImageEditSession({ sourceUrl: 'session-source', doc: createMarkDoc() }, 'fallback-source');
    expect(oldSession.sourceUrl).toBe('session-source');
    expect(imageEditDocumentToMarkDoc(oldSession.document)).toEqual(createMarkDoc());
  });
});

describe('图片操作注册与执行端口', () => {
  it('拒绝重复和未知操作，并在执行前传入校验后的完整文档', async () => {
    const registry = createBuiltInImageEditOperationRegistry();
    const document = createImageEditDocumentFromMarkDoc(createMarkDoc());
    const executor = {
      id: 'test-executor',
      execute: vi.fn(async () => 'rendered-image'),
    };
    const port = createImageEditExecutionPort(registry, executor);

    await expect(port.execute({ sourceImageUrl: 'source-image', document })).resolves.toEqual({
      kind: 'encoded-export',
      output: { kind: 'url', url: 'rendered-image' },
      outputImageUrl: 'rendered-image',
      document,
      executorId: 'test-executor',
      backend: 'webgpu-worker',
      width: 0,
      height: 0,
      capabilities: {
        executorId: 'test-executor',
        backends: ['webgpu-worker'],
        supportedOperationIds: [
          IMAGE_EDIT_OPERATION_IDS.orientation,
          IMAGE_EDIT_OPERATION_IDS.diffusion,
          IMAGE_EDIT_OPERATION_IDS.annotations,
          IMAGE_EDIT_OPERATION_IDS.crop,
        ],
        purposes: ['preview', 'export'],
        qualities: ['realtime', 'high'],
        exportFormats: ['image/png', 'image/jpeg', 'image/webp'],
        hardCancellationSupported: false,
      },
    });
    expect(executor.execute).toHaveBeenCalledWith({ sourceImageUrl: 'source-image', document });
    await expect(port.execute({
      sourceImageUrl: 'source-image',
      document,
      purpose: 'preview',
      revision: 2,
    })).resolves.toMatchObject({
      kind: 'preview-frame',
      frame: 'rendered-image',
      outputImageUrl: 'rendered-image',
      revision: 2,
    });

    const duplicate: ImageEditDocument = {
      ...document,
      operations: [...document.operations, { ...document.operations[0], id: 'duplicate-orientation' }],
    };
    await expect(port.execute({ sourceImageUrl: 'source-image', document: duplicate }))
      .rejects.toBeInstanceOf(InvalidImageEditOperationParamsError);

    const unknown: ImageEditDocument = {
      version: 2,
      operations: [{ id: 'unknown', operationId: 'image.unknown', enabled: true, params: {} }],
    };
    await expect(port.execute({ sourceImageUrl: 'source-image', document: unknown }))
      .rejects.toBeInstanceOf(UnsupportedImageEditOperationError);
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });

  it('禁止同一个操作定义重复注册', () => {
    const registry = new ImageEditOperationRegistry();
    const definition = {
      id: 'image.test',
      stage: 'effect' as const,
      order: 1,
      supportsMultiple: false,
      createDefaultParams: () => ({}),
      parseParams: () => ({}),
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow('图片操作已注册：image.test');
  });
});

describe('摄影柔光共享配方', () => {
  it('编译六层归一化半径和权重，不引入屏幕尺寸语义', () => {
    const params = createDefaultDiffusionOperationParams();
    const recipe = compileDiffusionRecipe(params, {
      width: 6000,
      height: 4000,
      quality: 'high',
    });

    expect(recipe.version).toBe(2);
    expect(recipe.scales).toHaveLength(6);
    expect(recipe.scales.reduce((sum, scale) => sum + scale.weight, 0)).toBeCloseTo(1, 12);
    expect(recipe.scales.every((scale) => scale.radius > 0 && scale.radius <= 1)).toBe(true);
    expect(recipe.scales.map((scale) => scale.radius)).toEqual(
      [...recipe.scales].map((scale) => scale.radius).sort((left, right) => left - right)
    );
    expect(recipe.image.aspectCorrection).toEqual([1, 1.5]);
    // 扣除项与加回项共用 scatterFraction，尺度权重又归一化到 1，
    // 因此散射系数落在 [0,1] 就等价于「不会凭空造光」。
    expect(recipe.energy.scatterFraction).toBeGreaterThanOrEqual(0);
    expect(recipe.energy.scatterFraction).toBeLessThanOrEqual(1);
  });

  it('三种模式编译为不同源图、长尾与雾幕响应', () => {
    const base = createDefaultDiffusionOperationParams();
    const compileMode = (mode: typeof base.mode) =>
      compileDiffusionRecipe({ ...base, mode }, { width: 1920, height: 1080 });
    const black = compileMode('black_mist');
    const white = compileMode('white_mist');
    const glow = compileMode('glow');

    expect(black.source.microGain).toBeLessThan(white.source.microGain);
    expect(glow.source.highlightGain).toBeGreaterThan(black.source.highlightGain);
    expect(white.energy.veil).toBeGreaterThan(black.energy.veil);
    expect(glow.energy.veil).toBe(0);
    expect(glow.source.highlightRecovery).toBe(0);
    expect(glow.detail.highFrequencyRetention).toBe(0);
  });

  /**
   * 辉光是刻意不守恒的加法层：曝光允许超过 1，把光源推到过曝、让相邻光晕互相融合
   * 正是它的观感来源。溢出由末端的保色相肩部收，不能靠把增益锁在 1 以内代劳——
   * 后者就是「光源自己不发光、只有周围暗处才有光晕」的成因。
   */
  it('辉光曝光可以超过 1，且滚降越强肩部起点越低', () => {
    const base = { ...createDefaultDiffusionOperationParams(), mode: 'glow' as const, density: 'high' as const };
    const compile = (patch: Partial<typeof base>) =>
      compileDiffusionRecipe({ ...base, ...patch }, { width: 1920, height: 1080 });

    expect(compile({ strength: 1, glowExposure: 1 }).glow.exposure).toBeGreaterThan(1);
    expect(compile({ strength: 1, glowExposure: 0 }).glow.exposure).toBeLessThan(1);
    expect(compile({ highlightRolloff: 0 }).glow.shoulderKnee).toBe(1);
    expect(compile({ highlightRolloff: 1 }).glow.shoulderKnee).toBeLessThan(1);
    // 强度归零时必须严格无效果，否则「关掉」和「很弱」分不开。
    expect(compile({ strength: 0, glowExposure: 1 }).glow.exposure).toBe(0);
    // 范围越窄越依赖全分辨率紧致核补 1~2px 的近场过渡。
    expect(compile({ glowRange: 0.05 }).glow.coreWeight)
      .toBeGreaterThan(compile({ glowRange: 0.95 }).glow.coreWeight);
  });

  it('v2 柔光参数迁移到 v4 时补齐辉光曝光、滚降与核心白热', () => {
    const defaults = createDefaultDiffusionOperationParams();
    const { glowExposure, highlightRolloff, glowCoreWhite, ...rest } = defaults;
    const migrated = parseDiffusionOperationParams({ ...rest, schemaVersion: 2 });

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.glowExposure).toBe(glowExposure);
    expect(migrated.highlightRolloff).toBe(highlightRolloff);
    expect(migrated.glowCoreWhite).toBe(glowCoreWhite);
  });

  /**
   * v3 把核心白热放在「着色」分组下，导致不开着色时彩色光源的光晕从里到外一个颜色。
   * v4 挪到顶层，迁移必须把用户已经调过的值搬过来而不是重置。
   */
  it('v3 的 tint.coreWhite 迁移到 v4 的顶层 glowCoreWhite', () => {
    const { glowCoreWhite: _dropped, ...rest } = createDefaultDiffusionOperationParams();
    const migrated = parseDiffusionOperationParams({
      ...rest,
      schemaVersion: 3,
      tint: { ...rest.tint, coreWhite: 0.23 },
    });

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.glowCoreWhite).toBe(0.23);
  });

  it('按源图、金字塔和最终合成依赖区分缓存失效', () => {
    const params = createDefaultDiffusionOperationParams();
    const recipe = compileDiffusionRecipe(params, { width: 1920, height: 1080 });
    const input = { sourceKey: 'source-a', width: 1920, height: 1080, recipe };
    expect(determineDiffusionInvalidation(null, input)).toBe('source');

    const cache = {
      sourceKey: 'source-a',
      width: 1920,
      height: 1080,
      sourceSignature: JSON.stringify([
        recipe.mode,
        recipe.source,
      ]),
      pyramidSignature: JSON.stringify([recipe.quality, recipe.scales, recipe.glow.levels]),
    };
    const toneOnlyRecipe = {
      ...recipe,
      tone: { ...recipe.tone, blackRetention: 0.5 },
    };
    expect(determineDiffusionInvalidation(cache, {
      ...input,
      recipe: toneOnlyRecipe,
    })).toBe('composite');
    expect(determineDiffusionInvalidation(cache, {
      ...input,
      recipe: { ...recipe, quality: 'high' },
    })).toBe('pyramid');
    // 辉光金字塔由 glow.levels 驱动，层数与逐通道权重变化必须让金字塔失效；
    // 只看 scales 的话改了层数缓存不会重建，画面会停在旧的衰减曲线上。
    expect(determineDiffusionInvalidation(cache, {
      ...input,
      recipe: { ...recipe, glow: { ...recipe.glow, levels: recipe.glow.levels.slice(0, 5) } },
    })).toBe('pyramid');
    expect(determineDiffusionInvalidation(cache, {
      ...input,
      sourceKey: 'source-b',
    })).toBe('source');
  });
});
