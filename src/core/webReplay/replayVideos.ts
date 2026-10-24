/*
 * 重演视频的命名：都在录制文件夹里，`replay-<渲染时间>.mp4` 画了鼠标（给人看重演效果），
 * `replay-<渲染时间>.clean.mp4` 是不画鼠标的干净画面（给剪辑用，剪辑里重画鼠标与点击）。
 * 渲染时间是 ISO 时间去掉冒号和点，按文件名排序就是按时间排序。
 */
export const REPLAY_CLEAN_SUFFIX = '.clean.mp4'

const REPLAY_VIDEO = /^replay-.*\.mp4$/

export function isReplayVideoName(name: string): boolean { return REPLAY_VIDEO.test(name) }
export function isCleanReplayName(name: string): boolean { return isReplayVideoName(name) && name.endsWith(REPLAY_CLEAN_SUFFIX) }

/** 最新的重演视频；clean 给 true 时只在干净画面里挑。 */
export function newestReplayName(names: readonly string[], options: { clean?: boolean } = {}): string | null {
  return names.filter(name => options.clean ? isCleanReplayName(name) : isReplayVideoName(name)).sort().at(-1) ?? null
}
