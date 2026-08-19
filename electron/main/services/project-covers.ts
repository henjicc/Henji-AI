import fsp from 'node:fs/promises'
import path from 'node:path'
import { getDb, getHenjiDataDir } from './db'
import { generateImageThumbnailBytes } from './image/ops'
import { generateVideoThumbnailBytes } from './video/ops'
import { createMainLogger } from './logging'

/**
 * 工程封面：画布工程与 3D 镜头参考工程共用同一套落盘、清理与登记逻辑。
 *
 * 封面来源由渲染层决定（生成结果 / 视口截图），这里只负责统一转码成小尺寸 webp、
 * 写进数据目录、把路径登记回各自的工程表——两个工程列表因此不会长出两份缩略图实现。
 */

export type ProjectCoverScope = 'canvas' | 'camera-stage'
export type ProjectCoverSourceKind = 'image' | 'video'

export interface SaveProjectCoverPayloadDto {
  scope: ProjectCoverScope
  projectId: string
  /** 任意媒体形态：本地路径 / file:// / henji-media:// / http(s) / data: */
  source: string
  sourceKind: ProjectCoverSourceKind
}

export interface ProjectCoverResultDto {
  projectId: string
  coverPath: string | null
}

/** 封面在卡片里最大也就 ~360 CSS px 宽，2x DPR 下 720；640 足够且单张仅十几 KB */
const COVER_MAX_EDGE = 640
const COVER_DIR_NAME = 'ProjectCovers'
const SCOPE_TABLES: Record<ProjectCoverScope, string> = {
  canvas: 'storyboard_projects',
  'camera-stage': 'camera_stage_projects',
}

const logger = createMainLogger('main.project-covers')

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

/**
 * 落盘一张工程封面并登记到工程表。
 *
 * 文件名带时间戳且落盘后删除上一张：`<img>` 与协议层都会按 URL 缓存，
 * 同名覆盖会让卡片继续显示旧封面。
 */
export async function saveProjectCover(payload: SaveProjectCoverPayloadDto): Promise<ProjectCoverResultDto> {
  const { scope, projectId, source, sourceKind } = payload
  const bytes = sourceKind === 'video'
    ? await generateVideoThumbnailBytes(source, COVER_MAX_EDGE)
    : await generateImageThumbnailBytes(source, COVER_MAX_EDGE)

  const directory = coverDir()
  await fsp.mkdir(directory, { recursive: true })
  const previousPath = readCoverPath(scope, projectId)
  const target = path.join(directory, `${scope}-${projectId}-${Date.now()}.webp`)
  await fsp.writeFile(target, bytes)
  writeCoverPath(scope, projectId, target)
  await removeFileQuietly(previousPath)

  logger.info('工程封面已更新', {
    event: 'project_cover.saved',
    context: { scope, projectId, sourceKind, byteLength: bytes.byteLength },
  })
  return { projectId, coverPath: target }
}

/** 删除工程时清掉封面文件；工程行本身由各自的 delete 语句带走。 */
export async function clearProjectCover(scope: ProjectCoverScope, projectId: string): Promise<void> {
  const previousPath = readCoverPath(scope, projectId)
  writeCoverPath(scope, projectId, null)
  await removeFileQuietly(previousPath)
}
