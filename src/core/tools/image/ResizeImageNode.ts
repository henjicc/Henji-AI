/**
 * ResizeImageNode - 图片缩放节点
 */

import { defineToolNode } from '../../defineToolNode'

export const resizeImageNode = defineToolNode({
  type: 'image-resize',
  name: { zh: '图片缩放', en: 'Resize Image' },
  description: { zh: '缩放图片到指定尺寸', en: 'Resize image to specified size' },
  icon: 'resize',
  category: 'image-processing',

  inputs: [
    {
      id: 'image',
      name: { zh: '输入图片', en: 'Input Image' },
      type: 'image',
      required: true
    },
    {
      id: 'width',
      name: { zh: '目标宽度', en: 'Target Width' },
      type: 'number',
      required: false
    },
    {
      id: 'height',
      name: { zh: '目标高度', en: 'Target Height' },
      type: 'number',
      required: false
    },
    {
      id: 'maintainAspectRatio',
      name: { zh: '保持比例', en: 'Maintain Aspect Ratio' },
      type: 'boolean',
      required: false,
      default: true
    }
  ],

  outputs: [
    {
      id: 'output',
      name: { zh: '缩放后图片', en: 'Resized Image' },
      type: 'image'
    }
  ],

  execute: async (inputs) => {
    // TODO: 实现缩放逻辑
    return { output: inputs.image }
  }
})
