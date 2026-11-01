/** Video host geometry stays in videoEdit; all text rasterization is shared. */
export { textResolution as videoEditTextResolution, rasterizeText as rasterizeVideoEditText, textRasterSize as videoEditTextRasterSize } from '@/services/vectorContent/textRaster'
export type { TextRaster as VideoEditTextRaster } from '@/services/vectorContent/textRaster'
