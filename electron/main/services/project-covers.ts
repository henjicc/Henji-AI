import fsp from 'node:fs/promises'
import path from 'node:path'
import { getDb, getHenjiDataDir } from './db'
import { loadSharp } from './image/sharp-loader'
import { resolveSourceBytes } from './image/source'
import { generateVideoThumbnailBytes } from './video/ops'
import { createMainLogger } from './logging'
import {
  selectProjectCoverSources,
  type ProjectCoverSourceDto,
} from './project-cover-layout'

export type { ProjectCoverSourceDto, ProjectCoverSourceKind } from './project-cover-layout'

/**
 * 工程封面：画布工程与 3D 镜头参考工程共用同一套落盘、清理与登记逻辑。
 *
 * 封面来源由渲染层决定（生成结果 / 视口截图），这里只负责统一转码成小尺寸 webp、
 * 写进数据目录、把路径登记回各自的工程表——两个工程列表因此不会长出两份缩略图实现。
 */

export type ProjectCoverScope = 'canvas' | 'camera-stage'

export interface SaveProjectCoverPayloadDto {
  scope: ProjectCoverScope
  projectId: string
  sources: ProjectCoverSourceDto[]
}

export interface ProjectCoverResultDto {
  projectId: string
  coverPath: string | null
}

/** 项目卡封面固定 4:3；640 宽能覆盖常见 2x DPR，同时控制单张文件体积。 */
const COVER_WIDTH = 640
const COVER_HEIGHT = 480
const COVER_DIR_NAME = 'ProjectCovers'
const SCOPE_TABLES: Record<ProjectCoverScope, string> = {
  canvas: 'storyboard_projects',
  'camera-stage': 'camera_stage_projects',
}

const logger = createMainLogger('main.project-covers')
const coverSaveQueues = new Map<string, Promise<void>>()

function coverDir(): string {
  return path.join(getHenjiDataDir(), COVER_DIR_NAME)
}

function readCoverPath(scope: ProjectCoverScope, projectId: string): string | null {
  const row = getDb()
    .prepare(`SELECT cover_path FROM ${SCOPE_TABLES[scope]} WHERE id = ? LIMIT 1`)
    .get(projectId) as { cover_path: string | null } | undefined
  return row?.cover_path ?? null
}

function writeCoverPath(scope: ProjectCoverScope, projectId: string, coverPath: string | null): void {
  getDb()
    .prepare(`UPDATE ${SCOPE_TABLES[scope]} SET cover_path = ? WHERE id = ?`)
    .run(coverPath, projectId)
}

async function removeFileQuietly(target: string | null): Promise<void> {
  if (!target) return
  try {
    await fsp.unlink(target)
  } catch {
    // 封面文件可能已被用户或上一次清理删掉，缺失不是错误
  }
}

async function renderSourceTile(
  source: ProjectCoverSourceDto,
  width: number,
  height: number,
): Promise<Buffer> {
  const input = source.sourceKind === 'video'
    ? await generateVideoThumbnailBytes(source.source, Math.max(width, height))
    : (await resolveSourceBytes(source.source)).bytes
  const sharp = await loadSharp()
  return await sharp(input)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toBuffer()
}

async function renderProjectCover(sources: ProjectCoverSourceDto[]): Promise<Buffer> {
  const selected = sources
  if (selected.length === 0) throw new Error('Project cover requires at least one source')
  if (selected.length === 1) {
    return await renderSourceTile(selected[0], COVER_WIDTH, COVER_HEIGHT)
  }

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
  return await sharp({
    create: {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).composite(tiles).webp({ quality: 80 }).toBuffer()
}

/**
 * 落盘一张工程封面并登记到工程表。
 *
 * 文件名带时间戳且落盘后删除上一张：`<img>` 与协议层都会按 URL 缓存，
 * 同名覆盖会让卡片继续显示旧封面。
 */
async function persistProjectCover(payload: SaveProjectCoverPayloadDto): Promise<ProjectCoverResultDto> {
  const { scope, projectId, sources } = payload
  const selectedSources = selectProjectCoverSources(sources)
  const bytes = await renderProjectCover(selectedSources)

  const directory = coverDir()
  await fsp.mkdir(directory, { recursive: true })
  const previousPath = readCoverPath(scope, projectId)
  const target = path.join(directory, `${scope}-${projectId}-${Date.now()}.webp`)
  await fsp.writeFile(target, bytes)
  writeCoverPath(scope, projectId, target)
  await removeFileQuietly(previousPath)

  return { projectId, coverPath: target }
}

/** 同一工程的自动更新与退出补刷新串行执行，避免并发覆盖留下孤儿封面文件。 */
export async function saveProjectCover(payload: SaveProjectCoverPayloadDto): Promise<ProjectCoverResultDto> {
  const { scope, projectId, sources } = payload
  const selectedSources = selectProjectCoverSources(sources)
  const queueKey = `${scope}:${projectId}`
  const previous = coverSaveQueues.get(queueKey) ?? Promise.resolve()
  logger.info('开始更新工程封面', {
    event: 'project_cover.save.start',
    context: { scope, projectId, requestedSourceCount: sources.length },
  })

  const task = previous.catch(() => undefined).then(async () => await persistProjectCover(payload))
  const completion = task.then(() => undefined, () => undefined)
  coverSaveQueues.set(queueKey, completion)
  try {
    const result = await task
    logger.info('工程封面已更新', {
      event: 'project_cover.save.completed',
      context: {
        scope,
        projectId,
        sourceCount: selectedSources.length,
        sourceKinds: selectedSources.map((item) => item.sourceKind),
      },
    })
    return result
  } catch (error) {
    logger.error('工程封面更新失败', {
      event: 'project_cover.save.failed',
      context: { scope, projectId, error: String(error) },
    })
    throw error
  } finally {
    if (coverSaveQueues.get(queueKey) === completion) coverSaveQueues.delete(queueKey)
  }
}

/** 删除工程时清掉封面文件；工程行本身由各自的 delete 语句带走。 */
export async function clearProjectCover(scope: ProjectCoverScope, projectId: string): Promise<void> {
  const previousPath = readCoverPath(scope, projectId)
  writeCoverPath(scope, projectId, null)
  await removeFileQuietly(previousPath)
}
