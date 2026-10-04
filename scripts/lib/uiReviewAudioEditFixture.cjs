/**
 * 界面核对步骤 `seedAudioEdit`：口播剪辑夹具工程（界面重设计 5.5 第二批）。
 * 在系统临时目录生成一段 12 秒的低音量正弦 WAV，经正式 preload 接口建工程；`transcript: true` 时写入
 * 一份固定逐字稿（含已删除的句子与语气词），不走语音识别、不产生费用。场景结束删除工程与临时文件。
 * 与 uiInspectionSceneAudioEdit.cjs 同一种建档方式，只是做成可复用的步骤。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RATE = 48000
const SECONDS = 12

function normalizeSeedAudioEdit(value) {
  const name = String(value?.name ?? '').trim()
  if (!name) throw new Error('seedAudioEdit 需要 name')
  return { name, transcript: value?.transcript !== false }
}

function writeFixtureWav(file) {
  const frames = RATE * SECONDS
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
  for (let index = 0; index < frames; index += 1) {
    // 每 2 秒一段“说话”，中间留 0.6 秒停顿，波形与停顿预览都有内容
    const second = index / RATE
    const speaking = second % 2 < 1.4
    const amplitude = speaking ? 2500 * (0.3 + 0.7 * Math.abs(Math.sin(second * 3))) : 40
    wav.writeInt16LE(Math.round(Math.sin(second * 440 * Math.PI * 2) * amplitude), 44 + index * 2)
  }
  fs.writeFileSync(file, wav)
}

async function seedAudioEditFixture(page, step) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-ui-review-audio-'))
  const file = path.join(directory, `${step.name}.wav`)
  writeFixtureWav(file)
  let projectId = null
  try {
    projectId = await page.evaluate(async ({ sourcePath, name, transcript, rate }) => {
      const audio = window.henjiNative.audio
      const project = await audio.createEditProject({ sourcePath, name })
      if (transcript) {
        project.transcript = [
          ['intro', '大家好，今天聊一聊口播剪辑', 0, 1.4, true],
          ['filler', '嗯', 2, 2.4, true],
          ['removed', '这一句说错了已经删掉', 2.4, 3.4, false],
          ['middle', '先把停顿和语气词清理干净', 4, 5.4, true],
          ['long', '然后逐词检查有没有需要保留的语气，长句子用来看逐字稿换行和波形上方字幕的截断效果', 6, 9.4, true],
          ['ending', '最后导出给剪辑软件继续编辑', 10, 11.4, true],
        ].map(([id, text, start, end, included]) => ({
          id, text, startFrame: Math.round(start * rate), endFrame: Math.round(end * rate), included, locked: false, granularity: 'segment',
        }))
      }
      const saved = await audio.saveEditProject(project)
      return saved.id
    }, { sourcePath: file, name: step.name, transcript: step.transcript, rate: RATE })
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return {
    cleanup: async () => {
      if (projectId) {
        await page.evaluate((id) => window.henjiNative.audio.deleteEditProject(id), projectId).catch(() => undefined)
      }
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

module.exports = { normalizeSeedAudioEdit, seedAudioEditFixture }
