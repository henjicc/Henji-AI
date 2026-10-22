/** 只由元素变化和时间轴事件判定；找位置不产生元素运动。 */
export function classifyMotionCapture(elementChanged: boolean, playing: boolean, scrubbing: boolean, frameChanged: boolean): 'navigate' | 'pose' | 'trajectory' {
  if (!elementChanged) return 'navigate'
  return playing || scrubbing || frameChanged ? 'trajectory' : 'pose'
}

/** 复用已有会话身份，保持草稿与讲解在全局身份空间中互不冲突。 */
export const superKeyframeSessionId = (draftId: string): string => `super-keyframes:${draftId}`
