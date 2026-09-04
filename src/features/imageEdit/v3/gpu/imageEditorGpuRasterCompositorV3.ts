/**
 * 唯一 GPU Scene compositor 的稳定入口。具体实现拆到 pipeline 文件，避免让
 * RenderGraph 接线继续膨胀公共门面；flat raster 与复杂 graph 共用同一 atlas。
 */
export {
  ImageEditorGpuRasterPipelineV3 as ImageEditorGpuRasterCompositorV3,
} from './imageEditorGpuRasterPipelineV3'
export type {
  ImageEditorGpuRasterCompositorOptionsV3,
  ImageEditorGpuRasterCompositorStatsV3,
  ImageEditorGpuRasterCompositorV3Like,
  ImageEditorGpuRasterFrameV3,
  ImageEditorGpuRasterTextureV3,
} from './imageEditorGpuRasterPipelineContractsV3'
