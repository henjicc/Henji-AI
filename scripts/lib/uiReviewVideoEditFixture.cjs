/**
 * 界面核对步骤 `seedVideoEdit`：剪辑夹具工程（界面重设计 5.5 第三批）。
 * 在系统临时目录用本机 FFmpeg 生成一段 6 秒 1280×720 测试画面 + 正弦声音的 MP4，经正式文档接口建一个项目，
 * 放进两序列的剪辑（画面、声音、文字片段，若干字幕与时间标记，两个素材箱），并在剪辑页点开这个项目（3.1：剪辑是项目里的文档）。
 * 场景结束删除临时素材目录（项目留在隔离资料目录里）。只读写本机临时文件，不产生费用。
 * 工程结构与 uiInspectionSceneVideoEditLinks.cjs 的夹具同一格式。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { openVideoEditFixture } = require('./uiInspectionVideoEditDocuments.cjs')

const FPS = 30

function normalizeSeedVideoEdit(value) {
  const name = String(value?.name ?? '').trim()
  if (!name) throw new Error('seedVideoEdit 需要 name')
  const captions = value?.captions === undefined ? 6 : Number(value.captions)
  if (!Number.isInteger(captions) || captions < 0 || captions > 200) throw new Error('seedVideoEdit.captions 只能是 0–200 的整数')
  return { name, captions }
}

function buildProject({ id, name, source, captions }) {
  const base = { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  const tracks = (prefix) => [...Array.from({ length: 4 }, (_, index) => ({ id: `${prefix}-track-${index}`, name: index ? `视频 ${index}` : '音频 1', index, kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false })),
    { id: `${prefix}-track-4`, name: '音频 2', index: 4, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }]
  const captionTexts = ['大家好，这是第一条字幕', '第二条字幕稍长一些，用来看列表里的截断效果是否正常', '第三条', '锚定在画面片段上的字幕', '结尾前的一句', '最后一条字幕']
  return {
    format: 'henji-video-project', version: 2, id, name, revision: 0,
    media: [{ id: `${id}-media`, name: '核对素材.mp4', path: source, kind: 'video', width: 1280, height: 720, durationSeconds: 6, hasAudio: true, frameRate: { numerator: FPS, denominator: 1 } }],
    bins: [{ id: `${id}-bin-a`, name: '镜头' }, { id: `${id}-bin-b`, name: '配乐与音效' }],
    items: [
      { id: `${id}-item`, name: '核对素材', kind: 'video', mediaId: `${id}-media` },
      { id: `${id}-item-2`, name: '核对素材（第二机位，名称很长用来看截断）', kind: 'video', mediaId: `${id}-media`, tags: ['机位二', '待选'] },
      { id: `${id}-item-3`, name: '镜头箱里的素材', kind: 'video', mediaId: `${id}-media`, binId: `${id}-bin-a` },
      { id: `${id}-title-item`, name: '标题文字', kind: 'text' },
    ],
    sequences: [
      {
        id: `${id}-seq`, name: '主序列', width: 1280, height: 720, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
        tracks: tracks(`${id}-a`),
        clips: [
          { ...base, id: `${id}-picture`, name: '核对画面', kind: 'video', track: 1, start: 0, duration: 150, itemId: `${id}-item`, sourceComponent: 'video', linkId: `${id}-take` },
          { ...base, id: `${id}-sound`, name: '核对声音', kind: 'audio', track: 0, start: 0, duration: 150, itemId: `${id}-item`, sourceComponent: 'audio', linkId: `${id}-take` },
          { ...base, id: `${id}-title`, name: '标题文字', kind: 'text', track: 2, start: 30, duration: 90, itemId: `${id}-title-item`, text: '核对标题', scale: 0.6, volume: 0 },
        ],
        annotations: [],
        captions: captionTexts.slice(0, captions).map((text, index) => ({ id: `${id}-caption-${index}`, start: index * 24, duration: 20, text, ...(index === 3 ? { clipId: `${id}-picture` } : {}) })),
        markers: [{ id: `${id}-marker-0`, frame: 15, name: '开场' }, { id: `${id}-marker-1`, frame: 90, name: '转场点' }],
      },
      {
        id: `${id}-seq-2`, name: '备用序列', width: 1280, height: 720, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
        tracks: tracks(`${id}-b`), clips: [], annotations: [],
      },
    ],
  }
}

async function seedVideoEditFixture(runtime, step) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-ui-review-video-'))
  try {
    const source = path.join(root, 'review-av.mp4')
    const { ffmpegPath } = require('./mediaBinaries.cjs')
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${FPS}`, '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
      '-t', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true, timeout: 60000 })
    const id = `review-${runtime.sceneId || 'video'}`.replace(/[^a-z0-9-]/gi, '-')
    const project = buildProject({ id, name: step.name, source, captions: step.captions })
    await openVideoEditFixture(runtime.activePage ?? runtime.mainPage, project)
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
  return { cleanup: async () => { fs.rmSync(root, { recursive: true, force: true }) } }
}

module.exports = { normalizeSeedVideoEdit, seedVideoEditFixture, buildVideoEditReviewProject: buildProject }
