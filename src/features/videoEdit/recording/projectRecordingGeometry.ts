/** 录制样子时间轴的固定几何（用户确认的样板屏草稿，2026-11-13）。 */
export const RECORDING_LANE_HEIGHT = 92
/** 块与轨道上下边的留白。 */
export const RECORDING_LANE_INSET = 3
/** 轨道左端留白，0 秒的刻度与第一块的左缘落在这里。 */
export const RECORDING_LANE_LEFT = 12
export const RECORDING_CLIP_TITLE_HEIGHT = 18
/** 结尾“接在这里”的空位宽度。 */
export const RECORDING_APPEND_SLOT_WIDTH = 150
/** 悬停“开始录制”时，指针后面渐隐斜纹的长度。 */
export const RECORDING_COVER_HINT_WIDTH = 260
/** 设置面板收进命令带之前，窗口至少要这么宽（画面区才不会被挤得比设置面板还窄）。 */
export const RECORDING_SETTINGS_INLINE_MIN_WIDTH = 1180

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
/** 标尺刻度：主刻度间隔取让相邻读数至少隔 80 像素的最小档，每档再分四格。 */
export function recordingRulerTicks(secondPixels: number, width: number): Array<{ seconds: number; major: boolean }> {
  const major = STEPS.find(step => step * secondPixels >= 80) ?? STEPS.at(-1)!
  const minor = major / 4
  const ticks: Array<{ seconds: number; major: boolean }> = []
  for (let seconds = 0; seconds * secondPixels <= width; seconds += minor) ticks.push({ seconds, major: seconds % major === 0 })
  return ticks
}
