const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile, spawnSync } = require('node:child_process')
const { pipeline } = require('node:stream/promises')
const { Transform } = require('node:stream')
const { performance } = require('node:perf_hooks')

const mode = process.env.HENJI_MEDIA_BENCH_MODE
if (!mode) {
  for (const runMode of ['cold', 'prewarmed']) {
    const child = spawnSync(process.execPath, [__filename], {
      cwd: process.cwd(),
      env: { ...process.env, HENJI_MEDIA_BENCH_MODE: runMode },
      encoding: 'utf8',
    })
    if (child.status !== 0) {
      process.stderr.write(child.stderr || child.stdout)
      process.exit(child.status || 1)
    }
    process.stdout.write(child.stdout)
  }
  process.exit(0)
}

function timed(task) {
  const startedAt = performance.now()
  return Promise.resolve(task()).then((value) => ({ value, ms: Math.round((performance.now() - startedAt) * 10) / 10 }))
}

function exec(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`))
      else resolve(stdout)
    })
  })
}

async function hashCopy(sourcePath, targetDir) {
  const tempPath = path.join(targetDir, `.media-import-bench-${crypto.randomUUID()}.tmp`)
  const hash = crypto.createHash('sha256')
  const tee = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(fs.createReadStream(sourcePath), tee, fs.createWriteStream(tempPath))
  const targetPath = path.join(targetDir, `${hash.digest('hex')}${path.extname(sourcePath)}`)
  try {
    await fsp.rename(tempPath, targetPath)
  } catch {
    await fsp.unlink(tempPath).catch(() => undefined)
  }
  return targetPath
}

function makeWav(seconds = 2, sampleRate = 8000) {
  const samples = seconds * sampleRate
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

function makeSvg(width = 1024, height = 1024) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#446688"/></svg>`)
}

async function main() {
  const benchDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-media-import-bench-'))
  try {
    const imagePath = path.join(benchDir, 'fixture.svg')
    const audioPath = path.join(benchDir, 'fixture.wav')
    const videoPath = path.join(process.cwd(), 'scripts', 'fixtures', 'plain_video.mp4')
    await Promise.all([fsp.writeFile(imagePath, makeSvg()), fsp.writeFile(audioPath, makeWav())])

    const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static')
    if (!ffmpegPath || !ffprobePath) throw new Error('当前平台没有可用的 ffmpeg / ffprobe 二进制')
    const sharp = require('sharp')
    if (mode === 'prewarmed') {
      await Promise.all([
        sharp(makeSvg(1, 1)).metadata(),
        exec(ffprobePath, ['-version']),
        exec(ffmpegPath, ['-version']),
      ])
    }

    const copyImage = await timed(() => hashCopy(imagePath, benchDir))
    const imageProbe = await timed(() => sharp(copyImage.value).metadata())
    const imagePreview = await timed(() => sharp(copyImage.value).resize(512, 512, { fit: 'inside' }).jpeg().toFile(path.join(benchDir, 'preview.jpg')))
    const copyVideo = await timed(() => hashCopy(videoPath, benchDir))
    const videoProbe = await timed(() => exec(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', copyVideo.value]))
    const videoPoster = await timed(() => exec(ffmpegPath, ['-y', '-ss', '0', '-i', copyVideo.value, '-frames:v', '1', '-vf', 'scale=480:-1', path.join(benchDir, 'poster.jpg')]))
    const copyAudio = await timed(() => hashCopy(audioPath, benchDir))
    const audioProbe = await timed(() => exec(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', copyAudio.value]))

    console.log(JSON.stringify({
      mode,
      phasesMs: {
        imageCopyHash: copyImage.ms,
        imageProbe: imageProbe.ms,
        imagePreview: imagePreview.ms,
        videoCopyHash: copyVideo.ms,
        videoProbe: videoProbe.ms,
        videoPoster: videoPoster.ms,
        audioCopyHash: copyAudio.ms,
        audioProbe: audioProbe.ms,
      },
    }))
  } finally {
    await fsp.rm(benchDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
