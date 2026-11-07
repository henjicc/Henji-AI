import type { Linkage } from '@/core/types/Linkage'

/** 展示补丁里的联动与显隐要同时认三种场景的图片字段：生成提交、画布节点、对话面板。 */
export function uploadedImageCount(params: Record<string, unknown>): number {
  return Math.max(0, ...[params.uploadedFilePaths, params.images, params.uploadedImages].map(value => Array.isArray(value) ? value.length : 0))
}

/**
 * 输出张数与输入图共用一个总数上限（如 Seedream 输入加输出不超过 15 张）：可选范围随输入图收窄，
 * 已选的值超出时改到上限，界面显示的就是实际请求的张数。
 */
export function outputCountWithinImageBudget(countParamId: string, total: number): Linkage[] {
  const limit = (params: Record<string, unknown>): number => Math.max(1, total - uploadedImageCount(params))
  return [
    { trigger: [countParamId, 'images', 'uploadedImages'], effect: 'filterRange', target: countParamId, filter: (_, params) => ({ min: 1, max: limit(params), step: 1 }) },
    {
      trigger: [countParamId, 'images', 'uploadedImages'], effect: 'autoSwitch', target: countParamId,
      condition: (_, params) => Number(params[countParamId]) > limit(params), value: (_, params) => limit(params), noRestore: true,
    },
  ]
}
