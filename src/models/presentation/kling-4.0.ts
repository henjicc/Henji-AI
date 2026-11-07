/** Kling 4.0 分镜与元素参数的展示补丁，Fal 与 KIE 共用；取值范围与 SDK 的 shotList / subjectElements 校验一致。 */

import type { ParamPresentationEntry } from '@/core/types/ModelPresentation'

export const kling40ShotsPresentation: ParamPresentationEntry = {
  name: { zh: '分镜', en: 'Shots' },
  panel: 'shot-list',
  config: { minShotSeconds: 1, maxShotSeconds: 30, minTotalSeconds: 3, maxTotalSeconds: 30, maxPromptLength: 512, defaultShotSeconds: 5 },
  tooltip: {
    zh: '按顺序写每一镜的画面和秒数，成片时长是各镜之和。用了分镜就不再发送主提示词和时长。',
    en: 'Describe each shot and its length in order; the video length is their sum. With shots, the main prompt and duration are not sent.',
  },
  description: {
    zh: '多镜头分镜列表，值为 [{ id, prompt, duration }]：每镜提示词 1–512 字符、时长 1–30 秒，各镜之和 3–30 秒即成片时长。非空时替代主提示词与时长（两者都不发送）；空数组表示不分镜。视频编辑模式不可用。',
    en: 'Multi-shot list, value [{ id, prompt, duration }]: each shot prompt 1–512 characters and 1–30 seconds; the 3–30 second sum is the video length. When non-empty it replaces the main prompt and duration (neither is sent); an empty array means a single shot. Not available in video edit mode.',
  },
}

export function kling40ElementsPresentation(naming: 'indexed' | 'named'): ParamPresentationEntry {
  const named = naming === 'named'
  return {
    name: { zh: '元素', en: 'Elements' },
    panel: 'subject-elements',
    config: { naming, maxItems: 7, maxVideoItems: 3, minImages: 2, maxImages: 4, minVideoSeconds: 3, maxVideoSeconds: 8 },
    tooltip: named
      ? {
          zh: '要保持一致的角色或物体，每个用 2–4 张图（第 1 张为正面）或一段 3–8 秒单镜头视频。在提示词里用 @名称 引用。视频元素与参考视频合计最多 5 个。',
          en: 'Characters or objects to keep consistent, each from 2–4 images (front view first) or one 3–8 second single-shot video. Mention them as @name in the prompt. Up to 5 videos and video elements combined.',
        }
      : {
          zh: '要保持一致的角色或物体，每个用 2–4 张图（第 1 张为正面）或一段 3–8 秒单镜头视频。在提示词里按顺序用 @Element1、@Element2 引用。',
          en: 'Characters or objects to keep consistent, each from 2–4 images (front view first) or one 3–8 second single-shot video. Mention them in order as @Element1, @Element2 in the prompt.',
        },
    description: named
      ? {
          zh: '角色/物体元素列表，值为 [{ id, name, kind: "image"|"video", images: 本地图片路径[], videos: 本地视频路径[] }]，最多 7 个、视频元素最多 3 个；图片元素 2–4 张（第 1 张为正面主图），视频元素 1 段 3–8 秒单镜头视频。name 为 1–20 个汉字/字母/数字/下划线且不重复，不能用 image_N、video_N、first_frame 等保留名；提示词用 @name 引用。仅参考生视频模式可用。',
          en: 'Character/object elements, value [{ id, name, kind: "image"|"video", images: local image paths[], videos: local video paths[] }], up to 7 with at most 3 video elements; image elements take 2–4 images (front view first), video elements one 3–8 second single-shot clip. name is 1–20 unique Chinese characters, letters, digits or underscores, not reserved names like image_N, video_N or first_frame; mention it in the prompt as @name. Reference mode only.',
        }
      : {
          zh: '角色/物体元素列表，值为 [{ id, kind: "image"|"video", images: 本地图片路径[], videos: 本地视频路径[] }]，最多 7 个、视频元素最多 3 个；图片元素 2–4 张（第 1 张为正面主图），视频元素 1 段 3–8 秒单镜头视频。提示词按列表顺序用 @Element1、@Element2… 引用。参考生视频与视频编辑模式可用。',
          en: 'Character/object elements, value [{ id, kind: "image"|"video", images: local image paths[], videos: local video paths[] }], up to 7 with at most 3 video elements; image elements take 2–4 images (front view first), video elements one 3–8 second single-shot clip. Mention them in list order as @Element1, @Element2… in the prompt. Available in reference and video edit modes.',
        },
  }
}
