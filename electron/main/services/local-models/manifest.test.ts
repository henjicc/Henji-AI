import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isLocalModelId, LOCAL_MODEL_IDS } from '../../../../src/platform/contracts/localModels'
import { LOCAL_MODEL_MANIFEST } from './manifest'
import { BUNDLED_OCR_MODELS } from './bundledOcr'

describe('图片修补模型的固定下载契约', () => {
  it('闭合 ID 与清单一致，新模型经现有实体列表自动被发现', () => {
    expect(new Set(LOCAL_MODEL_MANIFEST.map(model => model.id))).toEqual(new Set(LOCAL_MODEL_IDS))
    for (const id of ['image_inpainting_migan', 'image_inpainting_lama']) expect(isLocalModelId(id)).toBe(true)
    expect(isLocalModelId('tensor')).toBe(false)
  })
  it.each([
    ['image_inpainting_migan', 29_546_882, '406830d0fa60666da0071c342ad2fbc8f30c5c64', 'MIT'],
    ['image_inpainting_lama', 208_044_816, 'c3c0c9e468934d62e79c329e35d82dd09ff8c444', 'Apache-2.0'],
  ])('%s 有大小、完整哈希、固定上游 revision 和许可来源', (id, size, revision, license) => {
    const model = LOCAL_MODEL_MANIFEST.find(model => model.id === id)!
    expect(model.availability).toBe('available'); expect(model.license.spdx).toBe(license)
    expect(model.files).toHaveLength(1)
    expect(model.files[0].sizeBytes).toBe(size)
    expect(model.files[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(model.files[0].sources.find(source => source.region === 'global')?.url).toContain(`/resolve/${revision}/`)
  })
})

it('OCR只有内置tiny；公共下载目录不存在OCR，资源逐字节符合固定清单', () => {
  expect(Object.keys(BUNDLED_OCR_MODELS)).toEqual(['text_detection_ppocr', 'text_recognition_ppocr'])
  for (const [id, files] of Object.entries(BUNDLED_OCR_MODELS)) {
    expect(isLocalModelId(id)).toBe(false)
    for (const file of files) {
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(file).not.toHaveProperty('sources')
      const bytes = fs.readFileSync(path.resolve('resources/local-models', id, file.name))
      expect(bytes.length).toBe(file.sizeBytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
    }
  }
  expect(BUNDLED_OCR_MODELS.text_recognition_ppocr.map(f => f.role)).toEqual(['model', 'dict'])
  expect(isLocalModelId('text_recognition_ppocr_precise')).toBe(false)
  expect(LOCAL_MODEL_MANIFEST.flatMap(model => model.files).some(file => /ppocr|pp-ocr/.test(file.name))).toBe(false)
  const resourceRoot = path.resolve('resources/local-models')
  const actual = fs.readdirSync(resourceRoot, { recursive: true }).map(String).filter(file => fs.statSync(path.join(resourceRoot, file)).isFile()).map(file => file.split(path.sep).join('/')).sort()
  const expected = Object.entries(BUNDLED_OCR_MODELS).flatMap(([id, files]) => files.map(file => `${id}/${file.name}`)).sort()
  expect(actual).toEqual(expected)
  expect(fs.readFileSync('electron-builder.yml', 'utf8')).toMatch(/extraResources:\s+- from: resources\/local-models\s+to: resources\/local-models/)
})

it('听音模型 CLAP：六个文件各有大小与完整哈希，国内为自有 ModelScope 仓库，国外为 Xenova 导出', () => {
  const model = LOCAL_MODEL_MANIFEST.find(model => model.id === 'audio_understanding_clap')!
  expect(model.license.spdx).toBe('Apache-2.0'); expect(model.availability).toBe('available')
  expect(model.files.map(file => file.name)).toEqual(['larger_clap_general_audio_fp16.onnx', 'larger_clap_general_text_fp16.onnx', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'config.json'])
  expect(model.files.reduce((sum, file) => sum + file.sizeBytes, 0)).toBe(396_572_609)
  for (const file of model.files) {
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(file.sources.find(source => source.region === 'domestic')?.url).toBe(`https://www.modelscope.cn/models/henjicc/henji-ai-local-models/resolve/master/audio_understanding_clap/${file.name}`)
    expect(file.sources.find(source => source.region === 'global')?.url).toMatch(/^https:\/\/huggingface\.co\/Xenova\/larger_clap_general\/resolve\/d78c3994912c441f0151a5cc44d86f6b7bf4c861\//)
  }
})

it('呼吸声检测 Respiro：一个 ONNX 文件，大小与完整哈希写死，只从自有 ModelScope 仓库下载，MIT', () => {
  const model = LOCAL_MODEL_MANIFEST.find(model => model.id === 'speech_breath_respiro')!
  expect(model.license.spdx).toBe('MIT'); expect(model.availability).toBe('available')
  expect(model.files).toEqual([expect.objectContaining({ name: 'respiro-en.onnx', sizeBytes: 12_867_269, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })])
  expect(model.files[0].sources).toEqual([{ region: 'domestic', label: 'own-modelscope', url: 'https://www.modelscope.cn/models/henjicc/henji-ai-local-models/resolve/master/speech_breath_respiro/respiro-en.onnx' }])
})

it('节拍模型 Beat This!：三个文件各有大小与完整哈希，国内为自有 ModelScope 仓库，国外固定 musetric 导出版本，MIT', () => {
  const model = LOCAL_MODEL_MANIFEST.find(model => model.id === 'music_beats_beat_this')!
  expect(model.license.spdx).toBe('MIT'); expect(model.availability).toBe('available')
  expect(model.files.map(file => file.name)).toEqual(['beat_this.onnx', 'mel-filterbank.bin', 'config.json'])
  expect(model.files.reduce((sum, file) => sum + file.sizeBytes, 0)).toBe(190_912_694)
  for (const file of model.files) {
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(file.sources.find(source => source.region === 'domestic')?.url).toBe(`https://www.modelscope.cn/models/henjicc/henji-ai-local-models/resolve/master/music_beats_beat_this/${file.name}`)
    expect(file.sources.find(source => source.region === 'global')?.url).toBe(`https://huggingface.co/musetric/beat-this-onnx/resolve/25308706dda545c0d5950065bb0604ad71bcf1f5/${file.name}`)
  }
})
