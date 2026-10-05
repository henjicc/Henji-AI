import { loadSharp } from '../image/sharp-loader'
import { resolveSourceBytes } from '../image/source'
import { generateVideoThumbnailBytes } from '../video/ops'
import { selectProjectCoverSources, type ProjectCoverSourceDto } from '../project-cover-layout'

/*
 * 封面渲染：工程封面（画布、镜头参考，3.x 换成通用封面前继续使用）与通用文档封面共用这一份实现。
 * 来源由渲染层决定（生成结果 / 视口截图）；这里统一转码成固定 4:3 的小尺寸 webp。
 */

/** 卡片封面固定 4:3；640 宽能覆盖常见 2x DPR，同时控制单张文件体积。 */
export const COVER_WIDTH = 640
export const COVER_HEIGHT = 480

export type CoverSource = ProjectCoverSourceDto

async function renderSourceTile(source: CoverSource, width: number, height: number): Promise<Buffer> {
  const input = source.sourceKind === 'video'
    ? await generateVideoThumbnailBytes(source.source, Math.max(width, height))
    : (await resolveSourceBytes(source.source)).bytes
  const sharp = await loadSharp()
  return await sharp(input)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toBuffer()
}

/**
 * 1 张原图；2/3 张取前 2 张左右拼接；4 张按 2×2 拼接（取舍规则见 selectProjectCoverSources）。
 * 返回实际使用的来源，供调用方记日志。
 */
export async function renderCoverImage(sources: readonly CoverSource[]): Promise<{ bytes: Buffer; selected: CoverSource[] }> {
  const selected = selectProjectCoverSources([...sources])
  if (selected.length === 0) throw new Error('Project cover requires at least one source')
  if (selected.length === 1) return { bytes: await renderSourceTile(selected[0], COVER_WIDTH, COVER_HEIGHT), selected }

  const columns = 2
  const rows = selected.length === 4 ? 2 : 1
  const tileWidth = COVER_WIDTH / columns
  const tileHeight = COVER_HEIGHT / rows
  const tiles = await Promise.all(selected.map(async (source, index) => ({
    input: await renderSourceTile(source, tileWidth, tileHeight),
    left: (index % columns) * tileWidth,
    top: Math.floor(index / columns) * tileHeight,
  })))
  const sharp = await loadSharp()
  const bytes = await sharp({
    create: {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).composite(tiles).webp({ quality: 80 }).toBuffer()
  return { bytes, selected }
}
