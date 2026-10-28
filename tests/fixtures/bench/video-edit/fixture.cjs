'use strict'

/**
 * 播放基准台的固定合成夹具：一段 10 秒 1080p60 的“录屏”（深色界面、网格面板、上下浮动的内容区、移动的光标）
 * 和一份引用它的剪辑。录屏由 FFmpeg 的 lavfi 源合成，生成物放 generated/（不入库），缺了才生成。
 *
 * 生成不解码任何输入（全是 lavfi 合成源），`-hwaccel cuda` 只作用于解码，这里用不上；编码用 libx264，
 * 同一 FFmpeg 版本输出确定，一次性生成，文件只有几 MB。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const GENERATED = path.join(__dirname, 'generated')
const RECORDING = path.join(GENERATED, 'screen-recording-1080p60.mp4')
const WIDTH = 1920
const HEIGHT = 1080
const FPS = 60
const SECONDS = 10
const FRAMES = FPS * SECONDS

function ensureBenchRecording({ force = false } = {}) {
  if (!force && fs.existsSync(RECORDING) && fs.statSync(RECORDING).size > 0) return RECORDING
  const { ffmpegPath } = require('../../../../scripts/lib/mediaBinaries.cjs')
  fs.mkdirSync(GENERATED, { recursive: true })
  const partial = `${RECORDING}.partial.mp4`
  const graph = [
    `[0]drawgrid=w=240:h=135:t=1:c=0x2b2d31,drawbox=x=0:y=0:w=${WIDTH}:h=56:c=0x2b2d31:t=fill,drawbox=x=0:y=56:w=280:h=${HEIGHT - 56}:c=0x26282c:t=fill[ui]`,
    "[ui][1]overlay=x=440:y='180+40*sin(t)'[content]",
    "[content][2]overlay=x='300+mod(t*320,1500)':y='300+200*sin(t*1.3)'[out]",
  ].join(';')
  execFileSync(ffmpegPath, ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1e1f22:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SECONDS}`,
    '-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=${FPS}:d=${SECONDS}`,
    '-f', 'lavfi', '-i', `color=c=white:s=18x26:r=${FPS}:d=${SECONDS}`,
    '-filter_complex', graph, '-map', '[out]', '-frames:v', String(FRAMES),
    // 录屏常见的长关键帧间隔（5 秒）。
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', String(FPS * 5), '-keyint_min', String(FPS * 5), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', partial,
  ], { windowsHide: true, timeout: 180000 })
  fs.renameSync(partial, RECORDING)
  return RECORDING
}

/** 旧剪辑工程形状（`seedVideoEditProject` 接受的夹具）：视频 1 轨是录屏；代码标题条由基准台经正式接口加到视频 2 轨。 */
function benchProject(recording) {
  const id = 'bench-video-edit'
  const track = (index, kind, name) => ({ id: `${id}-track-${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  return { format: 'henji-video-project', version: 5, id, name: '播放基准', revision: 0,
    media: [{ id: 'recording', name: '合成录屏', path: recording, kind: 'video', durationSeconds: SECONDS, width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 }, frameRateMode: 'sampled-constant', hasAudio: false }],
    bins: [], items: [{ id: 'recording-item', name: '合成录屏', kind: 'video', mediaId: 'recording' }],
    sequences: [{ id: 'main', name: '序列 1', width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1'), track(2, 'video', '视频 2')],
      clips: [{ id: 'recording-clip', itemId: 'recording-item', name: '合成录屏', kind: 'video', track: 1, start: 0, duration: FRAMES, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }],
      annotations: [] }] }
}

module.exports = { ensureBenchRecording, benchProject, BENCH_FRAMES: FRAMES, BENCH_FPS: FPS }

if (require.main === module) console.log(ensureBenchRecording({ force: process.argv.includes('--force') }))
