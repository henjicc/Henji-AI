#!/usr/bin/env node
/*
 * 生成硬件解码能力检测用的极小测试视频（resources/hardware-probe/），随包分发。
 * 每段 256×144、4 帧，覆盖 H.264 / HEVC / AV1 / VP9 × 8/10 位 × 4:2:0/4:2:2/4:4:4 中实际存在的组合
 * （AV1 的 4:2:2 只在专业档、VP9 与 H.264 的 10 位 4:4:4 很少见，按需裁剪）。
 * 用随包 FFmpeg（native/video-decoder/target/release/ffmpeg.exe）或 PATH 中的 ffmpeg：
 *   node scripts/generate-hardware-probe-clips.cjs
 * 产物已提交入库；只有增删组合时才需要重新生成。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'resources', 'hardware-probe')
const bundled = path.join(root, 'native', 'video-decoder', 'target', 'release', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffmpeg = fs.existsSync(bundled) ? bundled : 'ffmpeg'

const PIXEL_FORMATS = {
  '8-420': 'yuv420p', '8-422': 'yuv422p', '8-444': 'yuv444p',
  '10-420': 'yuv420p10le', '10-422': 'yuv422p10le', '10-444': 'yuv444p10le',
}
const ENCODERS = {
  h264: { codec: 'libx264', variants: ['8-420', '8-422', '8-444', '10-420', '10-422'], args: ['-preset', 'veryfast', '-g', '4', '-bf', '0'] },
  hevc: { codec: 'libx265', variants: ['8-420', '8-422', '8-444', '10-420', '10-422', '10-444'], args: ['-preset', 'ultrafast', '-x265-params', 'log-level=error:keyint=4:bframes=0', '-tag:v', 'hvc1'] },
  av1: { codec: 'libaom-av1', variants: ['8-420', '10-420', '8-444', '10-444'], args: ['-cpu-used', '8', '-row-mt', '1', '-g', '4'] },
  vp9: { codec: 'libvpx-vp9', variants: ['8-420', '8-444', '10-420', '10-444'], args: ['-deadline', 'realtime', '-cpu-used', '8', '-g', '4'] },
}

fs.mkdirSync(output, { recursive: true })
for (const [codec, spec] of Object.entries(ENCODERS)) {
  for (const variant of spec.variants) {
    const file = path.join(output, `${codec}-${variant}.mp4`)
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=30', '-frames:v', '4',
      '-pix_fmt', PIXEL_FORMATS[variant], '-c:v', spec.codec, ...spec.args, '-an', '-movflags', '+faststart', file], { stdio: 'inherit' })
    console.log(`${path.relative(root, file)} ${fs.statSync(file).size} B`)
  }
}
