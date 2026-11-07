/** 展示补丁里的联动与显隐要同时认三种场景的图片字段：生成提交、画布节点、对话面板。 */
export function uploadedImageCount(params: Record<string, unknown>): number {
  return Math.max(0, ...[params.uploadedFilePaths, params.images, params.uploadedImages].map(value => Array.isArray(value) ? value.length : 0))
}
