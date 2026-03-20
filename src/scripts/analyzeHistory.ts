import { createLogger } from '@/core/logging'

const logger = createLogger('scripts.analyzeHistory')
/**
 * History Analysis Script
 *
 * Analyzes existing history.json file
 */

import { readTextFile } from '@tauri-apps/plugin-fs'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import type { LegacyHistoryItem, MigrationStats } from './migration/types'

/**
 * Analyze history.json file
 *
 * Provides statistics about:
 * - Total records
 * - File size
 * - Base64 data count and size
 * - Valid file paths
 * - Type distribution
 * - Provider distribution
 *
 * @returns Migration statistics
 */
export async function analyzeHistoryFile(): Promise<MigrationStats> {
  const appDataDir = await appLocalDataDir()
  const historyPath = await join(appDataDir, 'Henji-AI', 'history.json')

  try {
    const content = await readTextFile(historyPath)
    const data: LegacyHistoryItem[] = JSON.parse(content)

    logger.info('========== History Data Analysis ==========')
    logger.info(`Total records: ${data.length}`)
    logger.info(`File size: ${(content.length / 1024 / 1024).toFixed(2)} MB`)

    // Statistics
    let base64Count = 0
    let base64Size = 0
    let validFilePathCount = 0
    let missingFileCount = 0

    for (const item of data) {
      if (item.result?.url?.startsWith('data:')) {
        base64Count++
        base64Size += item.result.url.length
      }

      if (item.result?.filePath) {
        validFilePathCount++
      } else {
        missingFileCount++
      }
    }

    logger.info(`\nBase64 data statistics:`)
    logger.info(`  Records with Base64: ${base64Count}`)
    logger.info(`  Base64 data size: ${(base64Size / 1024 / 1024).toFixed(2)} MB`)
    logger.info(`  Percentage of file: ${((base64Size / content.length) * 100).toFixed(1)}%`)

    logger.info(`\nFile path statistics:`)
    logger.info(`  Valid paths: ${validFilePathCount}`)
    logger.info(`  Missing paths: ${missingFileCount}`)

    // Type statistics
    const typeStats = data.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    logger.info(`\nType distribution:`)
    Object.entries(typeStats).forEach(([type, count]) => {
      logger.info(`  ${type}: ${count}`)
    })

    // Provider statistics
    const providerStats = data.reduce((acc, item) => {
      acc[item.provider] = (acc[item.provider] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    logger.info(`\nProvider distribution:`)
    Object.entries(providerStats).forEach(([provider, count]) => {
      logger.info(`  ${provider}: ${count}`)
    })

    return {
      totalRecords: data.length,
      base64Count,
      base64Size,
      validFilePathCount,
      missingFileCount,
      typeStats,
      providerStats,
    }
  } catch (error) {
    logger.error('Failed to analyze history file:', error)
    throw error
  }
}

