/** 可交给应用媒体消费入口的稳定引用；新增来源需同时实现解析并覆盖连续操作。 */
export const APPLICATION_MEDIA_REFERENCE_KINDS = ['asset', 'generation.result', 'image_edit.preview'] as const

export const APPLICATION_MEDIA_REFERENCE_GUIDANCE = 'params.uploadedImages / uploadedVideos / uploadedAudios 接受 {kind,id}：asset 为素材，generation.result 为历史结果，image_edit.preview 为编辑后的图片；直接引用，无需加入素材库。'
