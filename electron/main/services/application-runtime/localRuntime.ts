import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'

export interface LocalRuntime {
  usage: string
  node: { path: string; env: Record<string, string> }
  ffmpeg?: string
  ffprobe?: string
}

/**
 * 软件自带、助手在本机做项目扩展时可以直接用的程序：外部助手从应用契约读到，内置助手从命令的环境变量拿到。
 * 用户电脑上没装 Node、ffmpeg 也能跑扩展；看画面、看规格仍先用应用自己的观察工具。
 */
export async function describeLocalRuntime(): Promise<LocalRuntime> {
  const [ffmpeg, ffprobe] = await Promise.all([loadFfmpegPath().catch(() => undefined), loadFfprobePath().catch(() => undefined)])
  return {
    usage: '做项目扩展（技能 project-extensions）时用：node 按给出的环境变量运行（应用主程序当 Node 用，用法同 node）；ffmpeg/ffprobe 是应用解码导出用的同一份。项目文件夹读 documents.project.path，扩展放在它下面的“扩展”（英文项目 Extensions）。',
    node: { path: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
    ...(ffmpeg ? { ffmpeg } : {}),
    ...(ffprobe ? { ffprobe } : {}),
  }
}
