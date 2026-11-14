import { spawn } from 'node:child_process'
import path from 'node:path'
import { videoEditExportEncodingSchema, type VideoEditExportEncoding } from '../../../../src/core/videoEdit/exportEncoding'

/** 等子进程真正退出才结束取消，确保调用方随后能安全删除中间文件。 */
export function runVideoEditExportFfmpeg(binary: string, args: string[], signal: AbortSignal, onLine?: (line: string) => void, cwd?: string): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', '-nostats', ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = '', pending = '', output = ''
    let failure: unknown
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    child.stderr.on('data', chunk => { tail = (tail + String(chunk)).slice(-16384) })
    child.stdout.on('data', chunk => {
      if (!onLine) { output += String(chunk); return }
      pending += String(chunk)
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ''
      try { for (const line of lines) onLine(line) } catch (error) { failure = error; child.kill() }
    })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('导出已取消。'))
      else if (failure) reject(failure)
      // 编码器的英文输出留在 cause 里随失败日志记下，界面只给能照着做的话。
      else if (code !== 0) reject(new Error(videoEditExportFfmpegUserMessage(tail), { cause: tail }))
      else resolve(output)
    })
  })
}
/** 压制失败给用户的话：磁盘满、写不进去与编码器问题的处理办法不同。 */
function videoEditExportFfmpegUserMessage(tail: string): string {
  if (/no space left on device|disk full/i.test(tail)) return '磁盘空间不足，视频压制没有完成。请清理后重试。'
  if (/permission denied|access is denied/i.test(tail)) return '成片位置写不进去（没有权限或文件被占用），请换一个保存位置后重试。'
  return '视频压制没有完成：编码器不接受当前设置，或正被其他程序占用。请关闭其他占用显卡编码的程序后重试，或在导出设置里换一种编码。'
}
export function videoEditExportFfmpegErrorSummary(error: unknown): string {
  const text = error instanceof Error ? typeof error.cause === 'string' ? error.cause : error.message : String(error)
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const details = lines.filter(line => /support|error|fail|cannot|minimum|invalid|busy|timeout|permission|no .*device|10.?bit/i.test(line))
  return (details.length ? details.slice(0, 6) : lines.slice(-6)).join(' ').slice(0, 1800) || '编码器未返回错误详情。'
}
export function videoEditExportFfmpegVideoArgs(input: VideoEditExportEncoding, fps: number, pass?: { number: 1 | 2; log: string }, videoBitrateMbps = 50): string[] {
  const value = videoEditExportEncodingSchema.parse(input)
  const nvenc = value.encoder.endsWith('_nvenc'), hevc = ['hevc_nvenc', 'libx265'].includes(value.encoder)
  const args = ['-c:v', value.encoder, '-preset', value.preset, '-g', String(Math.max(1, Math.round(value.keyframeSeconds * fps))), '-bf', String(value.bFrames),
    '-pix_fmt', value.tenBit ? nvenc ? 'p010le' : 'yuv420p10le' : 'yuv420p', '-profile:v', value.profile === 'auto' ? hevc ? value.tenBit ? 'main10' : 'main' : value.tenBit ? 'high10' : 'high' : value.profile]
  if (value.level !== 'auto' && value.encoder !== 'libx265') args.push('-level:v', value.level)
  if (nvenc) {
    args.push('-tune', 'hq', '-rc', value.rateControl === 'cbr' ? 'cbr' : 'vbr', '-rc-lookahead', String(value.lookaheadFrames), '-spatial-aq', String(Number(value.spatialAq)), '-temporal-aq', String(Number(value.temporalAq)))
    if (value.rateControl === 'quality') args.push('-cq', String(value.quality), '-b:v', '0')
    if (value.rateControl === 'two_pass') args.push('-multipass', 'fullres')
  } else if (value.rateControl === 'quality') args.push('-crf', String(value.quality))
  if (value.rateControl !== 'quality') args.push('-b:v', `${videoBitrateMbps}M`)
  if (value.rateControl === 'cbr') args.push('-minrate', `${videoBitrateMbps}M`, '-maxrate', `${videoBitrateMbps}M`)
  else if (value.maxBitrateMbps) args.push('-maxrate', `${value.maxBitrateMbps}M`)
  const maximum = value.rateControl === 'cbr' ? videoBitrateMbps : value.maxBitrateMbps
  const buffer = value.bufferMbps || maximum * 2
  if (buffer) args.push('-bufsize', `${buffer}M`)
  if (value.encoder === 'libx264') {
    args.push('-rc-lookahead', String(value.lookaheadFrames), '-aq-mode', value.spatialAq ? '1' : '0')
    if (value.rateControl === 'cbr') args.push('-x264-params', 'nal-hrd=cbr')
    if (pass) args.push('-pass', String(pass.number), '-passlogfile', pass.log)
  }
  if (value.encoder === 'libx265') {
    const options = [`rc-lookahead=${value.lookaheadFrames}`, `aq-mode=${value.spatialAq ? 1 : 0}`]
    if (value.level !== 'auto') options.push(`level-idc=${value.level}`)
    if (value.rateControl === 'cbr') options.push('strict-cbr=1')
    if (pass) options.push(`pass=${pass.number}`, `stats=${path.basename(pass.log)}`)
    args.push('-x265-params', options.join(':'))
  }
  const matrix = value.colorMatrix === 'bt2020nc' ? 'bt2020' : value.colorMatrix
  const primaries = value.colorMatrix === 'bt2020nc' ? 'bt2020' : value.colorMatrix
  const transfer = value.colorMatrix === 'bt2020nc' ? 'bt2020-10' : value.colorMatrix
  args.push('-vf', `scale=in_range=tv:in_color_matrix=bt709:out_range=${value.colorRange === 'full' ? 'pc' : 'tv'}:out_color_matrix=${matrix}`,
    '-color_range', value.colorRange === 'full' ? 'pc' : 'tv', '-colorspace', value.colorMatrix, '-color_primaries', primaries, '-color_trc', transfer)
  return args
}
export function videoEditExportFfmpegArgs(input: string, output: string, encoding: VideoEditExportEncoding, fps: number, cuda: boolean, pass?: { number: 1 | 2; log: string }, videoBitrateMbps = 50): string[] {
  return ['-y', ...(cuda ? ['-hwaccel', 'cuda'] : []), '-i', input, '-map', '0:v:0', ...(pass?.number === 1 ? ['-an'] : ['-map', '0:a?', '-c:a', 'copy']),
    ...videoEditExportFfmpegVideoArgs(encoding, fps, pass, videoBitrateMbps), '-progress', 'pipe:1', ...(pass?.number === 1 ? ['-f', 'null', '-'] : ['-movflags', '+faststart', '-f', 'mp4', output])]
}
