import type { TileOutputSink } from '../contracts'
import { BigTiffTileOutputSink } from './bigtiff-output-sink'
import type { RasterExportOptions } from './capabilities'
import {
  TranscodingTileOutputSink,
  type TranscodingExportOptions,
} from './transcoding-output-sink'

export * from './capabilities'
export * from './bigtiff-layout'
export * from './bigtiff-writer'
export * from './bigtiff-output-sink'
export * from './transcoding-output-sink'

export function createRasterTileOutputSink(
  targetPath: string,
  options: RasterExportOptions,
): TileOutputSink {
  if (options.format === 'bigtiff') {
    const { format: _format, ...bigTiffOptions } = options
    return new BigTiffTileOutputSink(targetPath, bigTiffOptions)
  }
  const transcodeOptions: TranscodingExportOptions = { ...options, format: options.format }
  return new TranscodingTileOutputSink(targetPath, transcodeOptions)
}
