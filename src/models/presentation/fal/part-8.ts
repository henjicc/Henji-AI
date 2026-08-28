/** Fal 模型展示补丁（第 8 组：按需图片工具）。 */

import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart8: Record<string, ModelPresentation> = {
  'fal-ai-topaz-image-upscale': {
    meta: {
      name: { key: 'meta.name', fallback: 'Topaz Image Upscale' },
      i18nScope: 'models.defs.fal-ai-topaz-image-upscale',
    },
    params: {
      falTopazUpscaleModel: {
        name: { zh: '处理模式', en: 'Processing Mode' },
        tooltip: {
          zh: '高保真适合清晰原图；低清修复和文字优化可能推断缺失细节，不等同于无损放大。',
          en: 'High Fidelity suits clean sources. Low Resolution and Text Refine may infer missing detail and are not lossless.',
        },
        optionLabels: {
          'Standard V2': {
            label: { zh: '标准', en: 'Standard' },
            description: { zh: '通用图片放大', en: 'General-purpose image upscaling' },
          },
          'High Fidelity V2': {
            label: { zh: '高保真', en: 'High Fidelity' },
            description: { zh: '优先保持原图结构与细节', en: 'Prioritizes source structure and detail' },
          },
          'Low Resolution V2': {
            label: { zh: '低清修复', en: 'Low Resolution' },
            description: { zh: '可能重建缺失细节', en: 'May reconstruct missing detail' },
          },
          CGI: {
            label: { zh: 'CGI / 插画', en: 'CGI / Illustration' },
            description: { zh: '适合渲染图和数字插画', en: 'For renders and digital illustrations' },
          },
          'Text Refine': {
            label: { zh: '文字优化', en: 'Text Refine' },
            description: { zh: '优化含文字画面，可能推断字形', en: 'Refines text-heavy images and may infer glyphs' },
          },
        },
      },
      falTopazUpscaleFactor: {
        name: { zh: '放大倍率', en: 'Upscale Factor' },
        tooltip: {
          zh: '宽和高分别放大 2× 或 4×；预计输出超过 48MP 时会在上传前停止。',
          en: 'Scales both dimensions by 2× or 4×. Jobs above 48MP stop before upload.',
        },
        optionLabels: {
          '2': { label: '2×' },
          '4': { label: '4×' },
        },
      },
      falTopazFaceEnhancement: {
        name: { zh: '人脸增强', en: 'Face Enhancement' },
        tooltip: {
          zh: '额外修复检测到的人脸；可能改变极小的人脸细节，默认关闭。',
          en: 'Repairs detected faces and may alter very small facial details. Off by default.',
        },
      },
    },
    linkages: [],
  },
}
