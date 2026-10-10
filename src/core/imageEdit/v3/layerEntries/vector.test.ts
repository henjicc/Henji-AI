import { describe, expect, it } from 'vitest'
import { imageEditLayersFromMarkDraftV3 } from './vectorDraft'
import { createImageEditDocumentV3 } from '../documentFactory'
import { parseImageEditDocumentV3 } from '../documentCodec'
import { ImageEditCommandHistoryV3 } from '../commandHistory'
import { ANNOTATION_DEFAULT_STROKE_HEX } from '../../../theme/colorTokens'
import { rectanglePath, ellipsePath } from '../../../imaging/vectorContent'
import { createImageEditSparseMaskReferenceV3 } from '../layerTypes'

describe('快速标记是正式内容图层', () => {
  it('文档保存重开保留布尔矢量蒙版与像素覆盖，拒绝损坏控制点而非丢弃字段', () => {
    const document = createImageEditDocumentV3({ width: 256, height: 256 })
    const layer = imageEditLayersFromMarkDraftV3({id:'masked',type:'rect',x:0,y:0,width:200,height:200,stroke:ANNOTATION_DEFAULT_STROKE_HEX,lineWidth:3})[0]
    layer.mask = {...createImageEditSparseMaskReferenceV3('editable-mask',false,0),vectorPaths:[{operation:'replace',path:rectanglePath(10,20,100,100)},{operation:'subtract',path:ellipsePath(40,50,30,30)}]}
    document.layers = [layer]
    const restored = parseImageEditDocumentV3(JSON.stringify(document))
    expect(restored.layers[0].mask).toEqual(layer.mask)
    expect(restored.layers[0].mask?.vectorPaths).not.toBe(layer.mask.vectorPaths)
    const damaged = JSON.parse(JSON.stringify(document))
    damaged.layers[0].mask.vectorPaths[0].path.commands[0].x = 'bad'
    expect(() => parseImageEditDocumentV3(damaged)).toThrow()
  })
  it('带说明的曲线箭头生成形状和文字，一次历史可整体撤销，落盘无旧标注模型或字体字节', () => {
    const layers = imageEditLayersFromMarkDraftV3({ id: 'arrow', type: 'arrow', points: [10, 20, 100, 60], curveControl: [45, 85], stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 3, label: '注意中文', labelFontSize: 32 })
    expect(layers.map(layer => layer.type)).toEqual(['shape', 'text'])
    expect(layers[0].type === 'shape' && layers[0].content.operands[0].path.commands[1]).toMatchObject({ kind:'quadratic', cx:45, cy:85 })
    const history = new ImageEditCommandHistoryV3(), initial = createImageEditDocumentV3({ width: 256, height: 256 })
    const document = history.execute(initial, { type: 'document.atomic', commandId: 'callout', expectedRevision: 0, commands: layers.map((layer, index) => ({ type: 'layer.add', commandId: `add-${index}`, expectedRevision: 0, resources:[], layer, index, parentId: null })) })
    expect(parseImageEditDocumentV3(JSON.parse(JSON.stringify(document))).layers).toEqual(layers)
    expect(JSON.stringify(document)).not.toMatch(/annotations|image_mark|fontBytes|fontFilePath/)
    expect(history.undo(document).document.layers).toEqual([])
  })
  it('数字标记和文字以可编辑 run 持有内容，旧标注图层直接拒绝', () => {
    const layer = imageEditLayersFromMarkDraftV3({ id: 'number', type: 'number', x: 10, y: 40, fontSize: 20, color: ANNOTATION_DEFAULT_STROKE_HEX }, 17)[0]
    expect(layer).toMatchObject({ type: 'text', content: { paragraphs: [{ runs: [{ text: '17' }] }], box: { x: 10, y: 20 } } })
    const document = createImageEditDocumentV3({ width: 100, height: 100 })
    expect(() => parseImageEditDocumentV3({ ...document, layers: [{ ...layer, type: 'annotation', annotations: [] }] })).toThrow()
  })
})
