/**
 * Fal 模型工具函数
 */

/**
 * 解析图片尺寸参数
 * 将 "width*height" 格式转换为 Fal API 需要的格式
 */
export function parseImageSize(sizeParam?: string): DynamicValue {
  if (!sizeParam) {
    return 'landscape_4_3'
  }

  // 如果是 "width*height" 格式，转换为对象
  if (sizeParam.includes('*')) {
    const [width, height] = sizeParam.split('*').map(Number)
    return { width, height }
  }

  // 否则直接使用预设值
  return sizeParam
}
