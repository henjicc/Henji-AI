import { invoke } from '@tauri-apps/api/core'
import type {
  CropImageSourcePayload,
  ImageInfoResult,
  ImagePlatform,
  MergeStoryboardImagesPayload,
  MergeStoryboardImagesResult,
  PrepareNodeImageSourceResult,
  StoryboardImageMetadata,
} from '@/platform/contracts/image'

export function createTauriImage(): ImagePlatform {
  return {
    splitImage: (imageBase64, rows, cols, lineThickness) =>
      invoke<string[]>('split_image', { imageBase64, rows, cols, lineThickness }),
    splitImageSource: (source, rows, cols, lineThickness) =>
      invoke<string[]>('split_image_source', { source, rows, cols, lineThickness }),
    prepareNodeImageSource: (source, maxPreviewDimension) =>
      invoke<PrepareNodeImageSourceResult>('prepare_node_image_source', { source, maxPreviewDimension }),
    prepareNodeImageBinary: (bytes, extension, maxPreviewDimension) =>
      invoke<PrepareNodeImageSourceResult>('prepare_node_image_binary', {
        bytes: Array.from(bytes),
        extension,
        maxPreviewDimension,
      }),
    cropImageSource: (payload: CropImageSourcePayload) => invoke<string>('crop_image_source', { payload }),
    mergeStoryboardImages: (payload: MergeStoryboardImagesPayload) =>
      invoke<MergeStoryboardImagesResult>('merge_storyboard_images', { payload }),
    readStoryboardImageMetadata: (source) =>
      invoke<StoryboardImageMetadata | null>('read_storyboard_image_metadata', { source }),
    embedStoryboardImageMetadata: (source, metadata) =>
      invoke<string>('embed_storyboard_image_metadata', { source, metadata }),
    loadImage: (filePath) => invoke<string>('load_image', { filePath }),
    persistImageSource: (source) => invoke<string>('persist_image_source', { source }),
    persistImageBinary: (bytes, extension) =>
      invoke<string>('persist_image_binary', { bytes: Array.from(bytes), extension }),
    saveImageSourceToDownloads: (source, suggestedFileName) =>
      invoke<string>('save_image_source_to_downloads', { source, suggestedFileName }),
    saveImageSourceToPath: (source, targetPath) =>
      invoke<string>('save_image_source_to_path', { source, targetPath }),
    saveImageSourceToDirectory: (source, targetDir, suggestedFileName) =>
      invoke<string>('save_image_source_to_directory', { source, targetDir, suggestedFileName }),
    saveImageSourceToAppDebugDir: (source, category, suggestedFileName) =>
      invoke<string>('save_image_source_to_app_debug_dir', { source, category, suggestedFileName }),
    readImageInfo: (source) => invoke<ImageInfoResult>('read_image_info', { source }),
  }
}
