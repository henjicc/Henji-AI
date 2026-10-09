// 像素投影与编码归 CPU 执行核心；导出宿主与 Worker 复用同一实现。
export { projectImageEditorV3RenderedRegionToOutput, encodeImageEditorV3RenderedOutputTile } from '../../../../core/imageEdit/v3/execution/cpuOutputTile'
