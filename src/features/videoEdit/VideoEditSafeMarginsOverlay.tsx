import { useSyncExternalStore } from 'react'
import { videoEditSafeArea } from '@/core/videoEdit/safeMargins'
import { subscribeVideoEdit } from './application/videoEditService'
import { videoEditSafeMarginsVisible } from './application/videoEditSafeMargins'

/**
 * 监视器上的安全框：动作安全区、字幕与图形安全区两个框加画面中心十字。铺满画面盒子（盒子就是合成画面的显示区域，
 * 缩放与留黑都已算进去），线宽按屏幕像素固定，不挡指针。
 */
export function VideoEditSafeMarginsOverlay(): React.ReactElement | null {
  const shown = useSyncExternalStore(subscribeVideoEdit, videoEditSafeMarginsVisible)
  if (!shown) return null
  const rect = (kind: 'action' | 'title') => { const area = videoEditSafeArea(kind); return { x: area.x * 1000, y: area.y * 1000, width: area.width * 1000, height: area.height * 1000 } }
  // icon-token-allow: 安全框是按画面比例计算的辅助线，不是图标
  return <svg aria-hidden="true" data-video-edit-safe-margins className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
    <rect {...rect('action')} fill="none" className="stroke-media-line" strokeWidth={1} vectorEffect="non-scaling-stroke" data-video-edit-safe-margin="action" />
    <rect {...rect('title')} fill="none" className="stroke-media-line" strokeWidth={1} vectorEffect="non-scaling-stroke" data-video-edit-safe-margin="title" />
    <path d="M 485 500 H 515 M 500 485 V 515" className="stroke-media-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
  </svg>
}
