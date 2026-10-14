import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { BUNDLED_OCR_MODELS, bundledModelsDirectory, resolveBundledOcrModel } from './bundledOcr'

it('开发从out/main定位，Windows/macOS安装从resourcesPath定位asar外资源', () => {
  const root = os.tmpdir(), mainDirectory = path.join(root, 'repo/out/main')
  expect(bundledModelsDirectory({ isPackaged: false, resourcesPath: root, mainDirectory })).toBe(path.join(root, 'repo/resources/local-models'))
  for (const resource of ['install/resources', 'App.app/Contents/Resources']) {
    const resourcesPath = path.join(root, resource)
    expect(bundledModelsDirectory({ isPackaged: true, resourcesPath, mainDirectory })).toBe(path.join(resourcesPath, 'resources/local-models'))
  }
})
it('直接离线校验真实tiny权重和字典；损坏/缺失拒绝，不生成文件或转下载', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-bundled-ocr-'))
  try {
    fs.cpSync(path.resolve('resources/local-models'), directory, { recursive: true })
    for (const id of ['text_detection_ppocr', 'text_recognition_ppocr'] as const) {
      for (const file of BUNDLED_OCR_MODELS[id]) expect(await resolveBundledOcrModel(directory, id, file.role)).toBe(path.join(directory, id, file.name))
    }
    const model = path.join(directory, 'text_recognition_ppocr', 'pp-ocrv6_tiny_rec_int8.onnx')
    const bytes = fs.readFileSync(model); bytes[20] ^= 1; fs.writeFileSync(model, bytes)
    await expect(resolveBundledOcrModel(directory, 'text_recognition_ppocr')).rejects.toThrow('重新安装')
    expect(fs.readFileSync(model).equals(bytes)).toBe(true)
    fs.unlinkSync(model)
    await expect(resolveBundledOcrModel(directory, 'text_recognition_ppocr')).rejects.toThrow('重新安装')
    expect(fs.readdirSync(path.dirname(model))).toEqual(['ppocrv6_tiny_dict.txt'])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
