/** Fal 模型展示补丁（第 8 组：图片放大工具）。 */

import type { ModelPresentation } from '@/core/types/ModelPresentation'

const FACTOR_LABELS = {
  '2': { label: '2×' },
  '4': { label: '4×' },
}

export const falPresentationPart8: Record<string, ModelPresentation> = {
  'fal-ai-topaz-image-upscale': {
    meta: {
      name: { key: 'meta.name', fallback: 'Topaz Image Upscale' },
      i18nScope: 'models.defs.fal-ai-topaz-image-upscale',
    },
    params: {
      falTopazUpscaleMode: {
        name: { zh: '处理模式', en: 'Processing Mode' },
        role: 'mode',
        tooltip: {
          zh: '精确模式优先忠实放大；创意和生成模式会补充或重建细节，不等同于无损放大。',
          en: 'Precision prioritizes faithful enlargement. Creative and Generative modes may add or reconstruct detail and are not lossless.',
        },
        optionLabels: {
          precision: { label: { zh: '精确放大', en: 'Precision' }, description: { zh: '适合照片、插画和含文字画面', en: 'For photos, illustrations, and text-heavy images' } },
          creative: { label: { zh: '创意放大', en: 'Creative' }, description: { zh: '重新设计局部细节，偏向 AI 生成图', en: 'Reimagines local detail for AI-generated images' } },
          generative: { label: { zh: '生成式放大', en: 'Generative' }, description: { zh: '重建低清、模糊图片中缺失的细节', en: 'Rebuilds missing detail in small or blurry sources' } },
        },
      },
      falTopazPrecisionModel: {
        name: { zh: '精确模型', en: 'Precision Model' },
        tooltip: { zh: '根据原图类型选择忠实放大策略。', en: 'Choose a faithful upscaling strategy for the source type.' },
        optionLabels: {
          'Standard V2': { label: { zh: '标准 V2', en: 'Standard V2' } },
          'High Fidelity V3': { label: { zh: '高保真 V3', en: 'High Fidelity V3' } },
          'High Fidelity V2': { label: { zh: '高保真 V2', en: 'High Fidelity V2' } },
          'Low Resolution V2': { label: { zh: '低清修复 V2', en: 'Low Resolution V2' } },
          CGI: { label: { zh: 'CGI / 插画', en: 'CGI / Illustration' } },
          'Text Refine': { label: { zh: '文字优化', en: 'Text Refine' } },
        },
      },
      falTopazCreativeModel: {
        name: { zh: '创意模型', en: 'Creative Model' },
        tooltip: { zh: '创意模型会主动重画细节，Bloom Realism 更偏写实。', en: 'Creative models actively redraw detail; Bloom Realism leans photorealistic.' },
        optionLabels: {
          'Bloom 2': { label: 'Bloom 2' },
          Bloom: { label: 'Bloom' },
          'Bloom Realism': { label: 'Bloom Realism' },
        },
      },
      falTopazGenerativeModel: {
        name: { zh: '生成模型', en: 'Generative Model' },
        tooltip: { zh: '不同模型面向普通模糊、极低分辨率或高质量重建。', en: 'Models target general blur, extreme low resolution, or higher-quality reconstruction.' },
        optionLabels: Object.fromEntries([
          'Wonder 3.5', 'Wonder 3', 'Wonder 2', 'Wonder', 'Recover 3', 'Standard MAX', 'Recovery V2', 'Recovery',
        ].map((value) => [value, { label: value }])),
      },
      falTopazUpscaleFactor: {
        name: { zh: '放大倍率', en: 'Upscale Factor' },
        tooltip: { zh: '宽和高分别放大 2× 或 4×。', en: 'Scales both width and height by 2× or 4×.' },
        optionLabels: FACTOR_LABELS,
      },
      falTopazFaceEnhancement: {
        name: { zh: '人脸增强', en: 'Face Enhancement' },
        tooltip: { zh: '额外修复检测到的人脸；可能改变极小的面部细节，默认关闭。', en: 'Repairs detected faces and may alter very small facial details. Off by default.' },
      },
      falTopazCreativeStrength: {
        name: { zh: '创意强度', en: 'Creativity' },
        tooltip: { zh: '数值越高，新增细节越多，与原图的偏离也越明显。', en: 'Higher values add more detail and can deviate further from the source.' },
        unit: '/ 9',
      },
      falTopazColorPreservation: {
        name: { zh: '保留原色', en: 'Preserve Colors' },
        tooltip: { zh: '尽量保持原图的色彩关系。', en: 'Tries to retain the source image’s color relationships.' },
      },
      falTopazEnhancementStrength: {
        name: { zh: '重建强度', en: 'Enhancement Strength' },
        tooltip: { zh: '控制 Wonder 模型重建新细节的程度。', en: 'Controls how strongly Wonder reconstructs new detail.' },
        optionLabels: {
          low: { label: { zh: '低', en: 'Low' } },
          medium: { label: { zh: '中', en: 'Medium' } },
          high: { label: { zh: '高', en: 'High' } },
        },
      },
    },
    linkages: [],
  },
  'fal-ai-topaz-transparent-upscale': {
    meta: {
      name: { key: 'meta.name', fallback: 'Topaz Transparent Upscale' },
      i18nScope: 'models.defs.fal-ai-topaz-transparent-upscale',
    },
    params: {},
    linkages: [],
  },
  'fal-ai-seedvr2-image-upscale': {
    meta: {
      name: { key: 'meta.name', fallback: 'SeedVR2 Image Upscale' },
      i18nScope: 'models.defs.fal-ai-seedvr2-image-upscale',
    },
    params: {
      falSeedvr2UpscaleFactor: {
        name: { zh: '放大倍率', en: 'Upscale Factor' },
        tooltip: { zh: '宽和高分别放大 2× 或 4×。', en: 'Scales both width and height by 2× or 4×.' },
        optionLabels: FACTOR_LABELS,
      },
      falSeedvr2NoiseScale: {
        name: { zh: '降噪强度', en: 'Noise Scale' },
        tooltip: { zh: '较高数值会更积极地清理噪点，也可能改变细小纹理。', en: 'Higher values clean noise more aggressively and may alter fine texture.' },
      },
    },
    linkages: [],
  },
  'fal-ai-bria-creative-upscale': {
    meta: {
      name: { key: 'meta.name', fallback: 'Bria Creative Upscale' },
      i18nScope: 'models.defs.fal-ai-bria-creative-upscale',
    },
    params: {
      falBriaPreserveAlpha: {
        name: { zh: '保留透明通道', en: 'Preserve Alpha' },
        tooltip: { zh: '原图包含透明背景时，在结果中继续保留。', en: 'Keeps a transparent background in the result when present in the source.' },
      },
    },
    linkages: [],
  },
  'fal-ai-ideogram-upscale': {
    meta: {
      name: { key: 'meta.name', fallback: 'Ideogram Upscale' },
      i18nScope: 'models.defs.fal-ai-ideogram-upscale',
    },
    params: {
      falIdeogramUpscaleResemblance: {
        name: { zh: '原图相似度', en: 'Resemblance' },
        tooltip: { zh: '数值越高，结果越贴近原图。', en: 'Higher values keep the result closer to the source.' },
        unit: '%',
      },
      falIdeogramUpscaleDetail: {
        name: { zh: '细节强度', en: 'Detail' },
        tooltip: { zh: '数值越高，模型会更积极地补充细节。', en: 'Higher values make the model add detail more aggressively.' },
        unit: '%',
      },
    },
    linkages: [],
  },
}
