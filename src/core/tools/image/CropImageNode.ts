/**
 * CropImageNode - 图片裁剪节点
 */

import { defineToolNode } from '../../defineToolNode'

export const cropImageNode = defineToolNode({
  type: 'image-crop',
  name: { zh: '图片裁剪', en: 'Crop Image' },
  description: { zh: '裁剪图片到指定尺寸', en: 'Crop image to specified size' },
  icon: 'crop',
  category: 'image-processing',

  inputs: [
    {
      id: 'image',
      name: { zh: '输入图片', en: 'Input Image' },
      type: 'image',
      required: true
    },
    {
      id: 'x',
      name: { zh: 'X 坐标', en: 'X Position' },
      type: 'number',
      required: true,
      default: 0
    },
    {
      id: 'y',
      name: { zh: 'Y 坐标', en: 'Y Position' },
      type: 'number',
      required: true,
      default: 0
    },
    {
      id: 'width',
      name: { zh: '宽度', en: 'Width' },
      type: 'number',
      required: true
    },
    {
      id: 'height',
      name: { zh: '高度', en: 'Height' },
      type: 'number',
      required: true
    }
  ],

  outputs: [
    {
      id: 'output',
      name: { zh: '裁剪后图片', en: 'Cropped Image' },
      type: 'image'
    }
  ],

  execute: async (inputs) => {
    // TODO: 实现裁剪逻辑
    // 这里只是占位，实际实现在画布模式开发时完成
    const { image } = inputs

    return {
      output: image // 临时返回原图
    }
  }
})
