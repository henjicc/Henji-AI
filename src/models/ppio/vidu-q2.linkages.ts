import type { Linkage } from '@/core/types'
import { MODE_FALLBACK, MODE_SUPPORT_MATRIX, resolveEditionFromParams, resolveModeFromParams } from './vidu-q2.constants'
import { countUploadedImages } from './mediaSources'

// 画布媒体行键是 images，对话/工具面板实时上传状态键是 uploadedImages；
// 之前只查 uploadedImages，导致画布上传图片永远触发不了下面这些自动切换。
function getImageCount(params: DynamicValueMap): number {
  return countUploadedImages(params)
}

export const viduQ2Linkages: Linkage[] = [
  {
    trigger: ['ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'filterOptions',
    target: 'ppioViduQ2Mode',
    filter: (_, options, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const supportedModes = MODE_SUPPORT_MATRIX[edition]
      return options.filter((option) => supportedModes.includes(option.value as (typeof supportedModes)[number]))
    }
  },
  {
    trigger: ['ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2Mode',
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = typeof allParams.ppioViduQ2Mode === 'string' ? allParams.ppioViduQ2Mode : ''
      return !MODE_SUPPORT_MATRIX[edition].includes(mode as (typeof MODE_SUPPORT_MATRIX)[typeof edition][number])
    },
    value: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      return MODE_FALLBACK[edition]
    }
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2Mode',
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = resolveModeFromParams(allParams, edition)
      return !MODE_SUPPORT_MATRIX[edition].includes(mode)
    },
    value: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      return MODE_FALLBACK[edition]
    }
  },
  {
    trigger: ['ppioViduQ2ProMode', 'uploadedImages', 'images'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2ProMode',
    condition: (_, allParams) => {
      return allParams.ppioViduQ2ProMode === true && getImageCount(allParams) === 0
    },
    value: false
  },
  {
    trigger: ['ppioViduQ2Mode', 'uploadedImages', 'images', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2FastMode',
    condition: (_, allParams) => {
      const mode = typeof allParams.ppioViduQ2Mode === 'string' ? allParams.ppioViduQ2Mode : 'text-image-to-video'
      const imageCount = getImageCount(allParams)
      return mode === 'text-image-to-video'
        && allParams.ppioViduQ2ProMode !== true
        && imageCount > 0
        && allParams.ppioViduQ2FastMode !== true
    },
    value: true
  },
  {
    trigger: ['ppioViduQ2Mode', 'uploadedImages', 'images', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2FastMode',
    condition: (_, allParams) => {
      const mode = typeof allParams.ppioViduQ2Mode === 'string' ? allParams.ppioViduQ2Mode : 'text-image-to-video'
      const imageCount = getImageCount(allParams)
      return mode === 'text-image-to-video'
        && allParams.ppioViduQ2ProMode !== true
        && imageCount === 0
        && allParams.ppioViduQ2FastMode === true
    },
    value: false
  },
  {
    trigger: ['uploadedImages', 'images', 'ppioViduQ2Mode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2Mode',
    condition: (_, allParams) => {
      const imageCount = getImageCount(allParams)
      const mode = typeof allParams.ppioViduQ2Mode === 'string' ? allParams.ppioViduQ2Mode : 'text-image-to-video'
      return imageCount === 2 && mode !== 'reference-to-video' && mode !== 'smart-multiframe' && mode !== 'start-end-frame'
    },
    value: 'start-end-frame'
  },
  {
    trigger: ['uploadedImages', 'images', 'ppioViduQ2Mode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2Mode',
    condition: (_, allParams) => {
      const imageCount = getImageCount(allParams)
      const mode = typeof allParams.ppioViduQ2Mode === 'string' ? allParams.ppioViduQ2Mode : 'text-image-to-video'
      return imageCount === 1 && mode === 'start-end-frame'
    },
    value: 'text-image-to-video'
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2FastMode',
    condition: (_, allParams) => {
      return allParams.ppioViduQ2Mode === 'start-end-frame' && allParams.ppioViduQ2FastMode !== true
    },
    value: true
  },
  {
    trigger: 'ppioViduQ2Mode',
    effect: 'autoSwitch',
    target: 'ppioViduQ2ProMode',
    condition: (mode, allParams) => mode === 'reference-to-video' && allParams.ppioViduQ2ProMode === true,
    value: false
  },
  {
    trigger: 'ppioViduQ2Mode',
    effect: 'autoSwitch',
    target: 'ppioViduQ2FastMode',
    condition: (mode, allParams) => mode === 'reference-to-video' && allParams.ppioViduQ2FastMode === true,
    value: false
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2FastMode',
    condition: (_, allParams) => {
      return allParams.ppioViduQ2Mode === 'smart-multiframe'
        && allParams.ppioViduQ2ProMode === true
        && allParams.ppioViduQ2FastMode === true
    },
    value: false
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2FastMode',
    condition: (_, allParams) => {
      return allParams.ppioViduQ2Mode === 'smart-multiframe'
        && allParams.ppioViduQ2ProMode !== true
        && allParams.ppioViduQ2FastMode !== true
    },
    value: true
  },
  {
    trigger: ['ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'filterOptions',
    target: 'ppioViduQ2Resolution',
    filter: (_, options, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      if (edition !== 'pro-fast') {
        return options
      }
      return options.filter((option) => option.value !== '540p')
    }
  },
  {
    trigger: ['ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'autoSwitch',
    target: 'ppioViduQ2Resolution',
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      return edition === 'pro-fast' && allParams.ppioViduQ2Resolution === '540p'
    },
    value: '720p'
  },
  {
    trigger: 'ppioViduQ2Mode',
    effect: 'hide',
    targets: ['ppioViduQ2Duration'],
    condition: (mode) => mode === 'smart-multiframe'
  },
  {
    trigger: 'ppioViduQ2Mode',
    effect: 'hide',
    targets: ['ppioViduQ2MultiframeSegmentDuration'],
    condition: (mode) => mode !== 'smart-multiframe'
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'hide',
    targets: ['ppioViduQ2AspectRatio'],
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = resolveModeFromParams(allParams, edition)
      return !(edition === 'q2' && (mode === 'text-image-to-video' || mode === 'reference-to-video'))
    }
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode', 'uploadedImages', 'images'],
    effect: 'hide',
    targets: ['ppioViduQ2Style'],
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = resolveModeFromParams(allParams, edition)
      const imageCount = getImageCount(allParams)
      return !(edition === 'q2' && mode === 'text-image-to-video' && imageCount === 0)
    }
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'hide',
    targets: ['ppioViduQ2MovementAmplitude'],
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = resolveModeFromParams(allParams, edition)
      if (edition === 'q2') {
        return !(mode === 'text-image-to-video' || mode === 'reference-to-video')
      }
      return !(mode === 'text-image-to-video' || mode === 'start-end-frame')
    }
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'hide',
    targets: ['ppioViduQ2Audio'],
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = resolveModeFromParams(allParams, edition)
      if (edition === 'q2') {
        return !(mode === 'text-image-to-video' || mode === 'reference-to-video')
      }
      return mode !== 'text-image-to-video'
    }
  },
  {
    trigger: ['ppioViduQ2Mode', 'ppioViduQ2ProMode', 'ppioViduQ2FastMode'],
    effect: 'hide',
    targets: ['ppioViduQ2Bgm'],
    condition: (_, allParams) => {
      const edition = resolveEditionFromParams(allParams)
      const mode = resolveModeFromParams(allParams, edition)
      if (edition === 'q2') {
        return !(mode === 'text-image-to-video' || mode === 'reference-to-video')
      }
      return !(mode === 'text-image-to-video' || mode === 'start-end-frame')
    }
  }
]
