import { ImageResult } from '@/adapters/base/BaseAdapter'

export const parseImageResponse = (responseData: any): ImageResult => {
  // 魔搭API异步模式返回 task_id
  if (responseData.task_id) {
    return {
      taskId: responseData.task_id,
      status: 'QUEUED'
    }
  }

  // 同步模式返回图片URL（新格式：images 数组）
  if (responseData.images && Array.isArray(responseData.images)) {
    // images 数组中每个元素是 { url: "..." } 格式
    const urls = responseData.images.map((img: any) => img.url)
    return {
      url: urls.length > 1 ? urls.join('|||') : urls[0],
      status: 'COMPLETED'
    }
  }

  // 同步模式返回图片URL（旧格式：output_images 数组，兼容）
  if (responseData.output_images && Array.isArray(responseData.output_images)) {
    const urls = responseData.output_images
    return {
      url: urls.length > 1 ? urls.join('|||') : urls[0],
      status: 'COMPLETED'
    }
  }

  throw new Error('No image or task_id returned from ModelScope API')
}
