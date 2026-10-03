#!/usr/bin/env node
/**
 * 生成并核对专业格式矩阵样本（任务 3.2）：`node scripts/video-edit-format-samples.cjs [--only id,id] [--force]`。
 * 样本定义与输出目录见 scripts/lib/videoEditFormatMatrix.cjs；Reality 场景 video-edit-format-matrix 会自动补齐缺失样本。
 */
const { ensureSamples } = require('./lib/videoEditFormatMatrix.cjs')

const args = process.argv.slice(2)
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1].split(',').map(value => value.trim()).filter(Boolean) : undefined
const started = Date.now()
const samples = ensureSamples({ only, force: args.includes('--force'), log: message => console.log(message) })
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)}MB`
for (const sample of samples) {
  const audio = sample.audio.map(stream => `${stream.codec}×${stream.channels}${stream.layout ? `(${stream.layout})` : ''}@${stream.sampleRate}`).join(' + ') || '无声'
  console.log([sample.id, `${sample.video.codec}/${sample.video.profile}`, sample.video.pixFmt, `${sample.video.width}x${sample.video.height}@${sample.video.rate}`, `${sample.video.frames}帧`, `首帧${sample.video.firstPts}s`, audio, mb(sample.bytes), `条码余量${sample.minCodeMargin}`].join(' | '))
}
console.log(`共 ${samples.length} 个样本，${mb(samples.reduce((sum, sample) => sum + sample.bytes, 0))}，${((Date.now() - started) / 1000).toFixed(1)}s`)
