import type { ModelTag } from '@/core/types';

/** 能收视频输入的视频功能：接了视频的节点只能在这些功能里换模型 */
const VIDEO_INPUT_TAGS: readonly ModelTag[] = ['reference-mode', 'video-to-video', 'video-extension', 'motion-control'];

/**
 * 按节点接进来的素材推断换模型时要预选的功能筛选：只在当前模型里能对上的功能唯一时预选，
 * 推不出唯一结果就不预选，让用户自己挑。用户仍可改筛选、选别的模型。
 */
export function inferModelFunctionFilter(
  mediaType: 'image' | 'video' | 'audio',
  modelTags: readonly string[],
  inputs: { images: number; videos: number; audios: number },
): ModelTag | null {
  const has = (tag: ModelTag): boolean => modelTags.includes(tag);
  if (mediaType === 'video') {
    if (inputs.videos > 0) {
      const matches = VIDEO_INPUT_TAGS.filter(has);
      return matches.length === 1 ? matches[0] : null;
    }
    if (inputs.audios > 0 && has('audio-to-video')) return 'audio-to-video';
    if (inputs.images === 1 && has('image-to-video')) return 'image-to-video';
    return null;
  }
  if (mediaType === 'image' && inputs.images > 0 && has('image-to-image')) return 'image-to-image';
  return null;
}
