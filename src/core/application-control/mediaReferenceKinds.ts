/** 可交给应用媒体消费入口的稳定引用；新增来源需同时实现解析并覆盖连续操作。 */
export const APPLICATION_MEDIA_REFERENCE_KINDS = ['asset', 'generation.result', 'image_edit.preview'] as const

/**
 * 可经 `read_application_media` 读回字节的引用。
 *
 * **它比上面那份短，这不是遗漏。** 媒体读取只认已经落盘的稳定业务实体；
 * `image_edit.preview` 是尚未保存的中间产物，渲染层内存里的一份操作文档，
 * 要读它的字节必须先 `commit_image_edit` 落盘。两份清单曾经只差在各自的
 * 枚举里，客户端按「媒体引用」的字面理解去读预览就会撞上 INVALID_INPUT，
 * 而错误信息看不出这是设计边界还是漏做。现在把差异写成两个具名常量。
 */
export const APPLICATION_READABLE_MEDIA_KINDS = ['generation.result', 'asset', 'canvas.node'] as const

export const APPLICATION_MEDIA_REFERENCE_GUIDANCE = 'params.uploadedImages / uploadedVideos / uploadedAudios 接受 {kind,id}：asset 为素材，generation.result 为历史结果，image_edit.preview 为编辑后的图片；直接引用，无需加入素材库。其中 image_edit.preview 是尚未保存的中间产物，只能作为输入；要读回它的字节，先用 commit_image_edit 落盘再读。'
