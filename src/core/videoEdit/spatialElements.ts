import type { VideoEditClip, VideoEditComposition } from './document'
import { spatialClipEnabled, spatialClipMatrix } from './spatialEvaluation'
import { spatialIdentityMatrix, spatialInverse, spatialMultiply, spatialScale, spatialTranslation } from './spatialMatrices'
import type { SpatialFrame, SpatialMat4, SpatialOutput } from './spatialTypes'

/**
 * 作者 three 场景的根变换：作者片段卡片的 uv → 世界，换成作者用的居中、Y 向上坐标；空间帧里没有它的卡片时是单位阵。
 * 宿主把作者场景挂在这个根下，作者坐标都在根空间里。
 */
export function spatialAuthorRoot(frame: SpatialFrame, clipId: string): SpatialMat4 {
  const card = frame.cards.find(value => value.clipId === clipId)
  return card ? spatialMultiply(card.uvToWorld, spatialTranslation(.5, .5, 0), spatialScale(frame.output.displayHeight / frame.output.displayWidth, -1, 1)) : spatialIdentityMatrix()
}

/**
 * 被引用片段的画面（整幅序列大小、片段按二维摆放画在上面）上的 uv → 世界：先按它在画面平面上的摆放换回片段自身，
 * 再用它在三维里的变换放到真实位置；没开空间时就在画面平面上。`clip` 是本帧求值后的片段。
 */
export function spatialElementPictureToWorld(document: VideoEditComposition, clip: VideoEditClip, output: SpatialOutput): SpatialMat4 {
  const aspect = output.displayWidth / output.displayHeight
  const frame = spatialMultiply(spatialTranslation(-aspect / 2, .5, 0), spatialScale(aspect, -1, 1))
  if (!spatialClipEnabled(clip)) return frame
  const flat = spatialClipMatrix(document, { ...clip, spatial: { enabled: false } }, output)
  return spatialMultiply(spatialClipMatrix(document, clip, output), spatialInverse(flat), frame)
}

/** 被引用片段画面 uv → 作者根空间。 */
export function spatialElementPictureToAuthor(document: VideoEditComposition, element: VideoEditClip, frame: SpatialFrame, authorClipId: string): SpatialMat4 {
  return spatialMultiply(spatialInverse(spatialAuthorRoot(frame, authorClipId)), spatialElementPictureToWorld(document, element, frame.output))
}
