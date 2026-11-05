declare module 'bidi-js' {
  interface EmbeddingLevels { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] }
  export default function bidiFactory(): { getEmbeddingLevels(text: string, baseDirection?: 'ltr' | 'rtl'): EmbeddingLevels }
}
