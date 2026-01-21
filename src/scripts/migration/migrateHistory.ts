/**
 * History Migration Script
 *
 * Migrates history.json to SQLite database
 */

import { readTextFile, writeTextFile, exists, copyFile } from '@tauri-apps/plugin-fs'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { databaseService } from '@/services/database/DatabaseService'
import { cleanHistoryItem } from './cleanHistory'
import type { LegacyHistoryItem } from './types'

export interface MigrationResult {
  success: boolean
  totalRecords: number
  migratedRecords: number
  skippedRecords: number
  errors: string[]
  backupPath: string
  originalSize: number
  newSize: number
}

/**
 * Migrate history.json to SQLite database
 *
 * Steps:
 * 1. Check if history.json exists
 * 2. Backup original file
 * 3. Read and parse JSON
 * 4. Initialize database
 * 5. Clean and migrate data
 * 6. Verify migration
 * 7. Clear old file
 *
 * @returns Migration result with statistics
 */
export async function migrateHistoryToDatabase(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    totalRecords: 0,
    migratedRecords: 0,
    skippedRecords: 0,
    errors: [],
    backupPath: '',
    originalSize: 0,
    newSize: 0,
  }

  const appDataDir = await appLocalDataDir()
  const historyPath = await join(appDataDir, 'Henji-AI', 'history.json')
  const backupPath = await join(
    appDataDir,
    'Henji-AI',
    `history.backup.${Date.now()}.json`
  )

  try {
    // Step 1: Check if file exists
    const fileExists = await exists(historyPath)
    if (!fileExists) {
      console.log('[Migration] History file does not exist, skipping migration')
      result.success = true
      return result
    }

    // Step 2: Backup original file
    console.log('[Migration] Backing up history file...')
    await copyFile(historyPath, backupPath)
    result.backupPath = backupPath
    console.log(`[Migration] Backup complete: ${backupPath}`)

    // Step 3: Read and parse
    console.log('[Migration] Reading history file...')
    const content = await readTextFile(historyPath)
    result.originalSize = content.length

    const legacyData: LegacyHistoryItem[] = JSON.parse(content)
    result.totalRecords = legacyData.length
    console.log(`[Migration] Found ${result.totalRecords} records`)

    // Step 4: Initialize database
    console.log('[Migration] Initializing database...')
    await databaseService.init()

    // Step 5: Clean and migrate data
    console.log('[Migration] Starting data migration...')
    for (let i = 0; i < legacyData.length; i++) {
      const legacy = legacyData[i]

      if (i % 100 === 0) {
        console.log(`[Migration] Progress: ${i}/${result.totalRecords}`)
      }

      try {
        const cleaned = cleanHistoryItem(legacy)

        if (!cleaned) {
          result.skippedRecords++
          continue
        }

        await databaseService.insertHistory(cleaned)
        result.migratedRecords++
      } catch (error: any) {
        result.errors.push(`Record ${legacy.id}: ${error.message}`)
        result.skippedRecords++
      }
    }

    // Step 6: Verify migration
    console.log('[Migration] Verifying migration result...')
    const migratedCount = (
      await databaseService.getHistory({ limit: 1000000 })
    ).length

    if (migratedCount !== result.migratedRecords) {
      throw new Error(
        `Migration count mismatch: expected ${result.migratedRecords}, got ${migratedCount}`
      )
    }

    // Step 7: Clear old file (keep structure)
    console.log('[Migration] Clearing old history file...')
    await writeTextFile(historyPath, JSON.stringify([]))
    result.newSize = 2  // "[]"

    result.success = true
    console.log('[Migration] Migration complete!')
    console.log(`  Total records: ${result.totalRecords}`)
    console.log(`  Migrated: ${result.migratedRecords}`)
    console.log(`  Skipped: ${result.skippedRecords}`)
    console.log(`  Errors: ${result.errors.length}`)
    console.log(`  File size: ${(result.originalSize / 1024 / 1024).toFixed(2)} MB -> ${(result.newSize / 1024).toFixed(2)} KB`)
    console.log(`  Space saved: ${((1 - result.newSize / result.originalSize) * 100).toFixed(1)}%`)

    return result
  } catch (error: any) {
    console.error('[Migration] Migration failed:', error)
    result.errors.push(error.message)

    // Try to restore backup
    if (result.backupPath) {
      console.log('[Migration] Attempting to restore from backup...')
      try {
        await copyFile(backupPath, historyPath)
        console.log('[Migration] Restore successful')
      } catch (restoreError) {
        console.error('[Migration] Restore failed:', restoreError)
      }
    }

    throw error
  }
}
