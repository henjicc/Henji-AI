/* eslint-disable @typescript-eslint/no-var-requires -- Electron 巡检使用 CommonJS。 */
const { loadTypeScript } = require('../check-persistence-compat.cjs')
/** 只从正式构造器取得巡检种子的版本与共同字段，不维护第二份默认值。 */
function imageEditInspectionModel() {
  const { createImageEditDocumentV3 } = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
  const { createImageEditLayerCommonV3, createImageEditSparseMaskReferenceV3 } = loadTypeScript('src/core/imageEdit/v3/layerTypes.ts')
  return { document: createImageEditDocumentV3({ width: 1, height: 1, documentId: 'inspection-template' }),
    common: createImageEditLayerCommonV3('inspection-template', '巡检图层'), mask: createImageEditSparseMaskReferenceV3('inspection-template') }
}
module.exports = { imageEditInspectionModel }
