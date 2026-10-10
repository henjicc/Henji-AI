/** Video host geometry stays in videoEdit; all text rasterization is shared. */
export { paintText as paintVideoEditText, textResolution as videoEditTextResolution, rasterizeText as rasterizeVideoEditText } from '@/services/vectorContent/textRaster'
export type { TextRaster as VideoEditTextRaster } from '@/services/vectorContent/textRaster'
