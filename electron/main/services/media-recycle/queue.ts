import fs from 'node:fs/promises'
import path from 'node:path'
import { getDb } from '../db'
import { getProgramDataDir, getProgramStoreDir, getUserFolderDir } from '../appPaths'
import { canonicalPath, fileIdentity, localMediaPath, pathKey, within } from './paths'

/** Deliberately excludes project folders, exports and the general user root. */
export function managedMediaRoots(): string[] {
  return [getUserFolderDir('generated'), getUserFolderDir('uploads'), getProgramStoreDir('thumbnails'),
    path.join(getProgramDataDir(), 'EditStates')]
}

export function isManagedMediaPath(value: string): boolean {
  const local = localMediaPath(value)
  return !!local && managedMediaRoots().some(root => within(root, local))
}

export function overlapsManagedMediaRoot(value: string): boolean {
  return managedMediaRoots().some(root => pathKey(root) === pathKey(value) || within(value, root) || within(root, value))
}

/** Called only by application writers after creating a file, never by import-as-reference. */
export async function registerOwnedMedia(filePath: string, sourcePath?: string, newlyCreated = true): Promise<void> {
  if (!isManagedMediaPath(filePath)) return
  const canonical = await canonicalPath(filePath)
  const roots = await Promise.all(managedMediaRoots().map(canonicalPath))
  if (!canonical || !roots.some(root => root && within(root, canonical))) return
  // Updating an external/original file is not a transfer of deletion ownership.
  if (!newlyCreated && !getDb().prepare('SELECT 1 FROM media_recycle_owned WHERE path = ?').get(canonical)) return
  const stat = await fs.lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) return
  getDb().prepare('INSERT OR REPLACE INTO media_recycle_owned(path, identity, source_path) VALUES (?, ?, ?)').run(canonical, fileIdentity(stat), sourcePath ? await canonicalPath(sourcePath) : null)
}

/** Durable intent, not permission to unlink. May contain external paths: sweep rejects them. */
export function enqueueMediaCandidates(paths: readonly string[], protectedBy: readonly string[] = []): void {
  if (!paths.length) return
  getDb().prepare("INSERT INTO media_recycle_candidates(source, payload) VALUES ('paths', ?)").run(JSON.stringify({ paths, protectedBy }))
}

/** Removing a location from the catalog is not evidence its documents were destroyed.
 * Re-scan it as a detached root; if it is offline the provider must fail closed. */
export function retainDetachedMediaLocation(owner: string): void {
  getDb().prepare('INSERT OR IGNORE INTO media_recycle_retained(owner) VALUES (?)').run(owner)
}
