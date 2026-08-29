/**
 * 画布图片能力的稳定跨层标识。这里只放纯数据，供产品能力、助手 schema 与处理器共同引用。
 */
export const CANVAS_IMAGE_CAPABILITY_IDS = {
  panorama: 'image.panorama',
  relight: 'image.relight',
  presetRelight: 'image.preset-relight',
  lowLightEnhancement: 'image.low-light-enhancement',
  outpaint: 'image.outpaint',
  productPhotography: 'image.product-photography',
  photoRestoration: 'image.photo-restoration',
  backgroundRemoval: 'image.background-removal',
  multiAngle: 'image.multi-angle',
  nineGrid: 'image.nine-grid',
  upscale: 'image.upscale',
  portraitTexture: 'image.portrait-texture',
  elementEdit: 'image.element-edit',
  layerSeparation: 'image.layer-separation',
  gridSplit: 'image.grid-split',
} as const

export type CanvasImageCapabilityId =
  (typeof CANVAS_IMAGE_CAPABILITY_IDS)[keyof typeof CANVAS_IMAGE_CAPABILITY_IDS]

/** 本地弹窗工具不在助手后台写入能力中；其余能力均通过统一画布事务执行。 */
export const ASSISTANT_CANVAS_IMAGE_CAPABILITY_IDS = [
  CANVAS_IMAGE_CAPABILITY_IDS.panorama,
  CANVAS_IMAGE_CAPABILITY_IDS.relight,
  CANVAS_IMAGE_CAPABILITY_IDS.presetRelight,
  CANVAS_IMAGE_CAPABILITY_IDS.lowLightEnhancement,
  CANVAS_IMAGE_CAPABILITY_IDS.outpaint,
  CANVAS_IMAGE_CAPABILITY_IDS.productPhotography,
  CANVAS_IMAGE_CAPABILITY_IDS.photoRestoration,
  CANVAS_IMAGE_CAPABILITY_IDS.backgroundRemoval,
  CANVAS_IMAGE_CAPABILITY_IDS.multiAngle,
  CANVAS_IMAGE_CAPABILITY_IDS.nineGrid,
  CANVAS_IMAGE_CAPABILITY_IDS.upscale,
  CANVAS_IMAGE_CAPABILITY_IDS.portraitTexture,
  CANVAS_IMAGE_CAPABILITY_IDS.elementEdit,
  CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation,
] as const

export type AssistantCanvasImageCapabilityId =
  (typeof ASSISTANT_CANVAS_IMAGE_CAPABILITY_IDS)[number]
