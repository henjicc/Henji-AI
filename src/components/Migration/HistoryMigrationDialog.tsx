/**
 * History Migration Dialog Component
 *
 * UI for migrating history.json to SQLite database
 */

import { useState } from 'react'
import { migrateHistoryToDatabase } from '@/scripts/migration/migrateHistory'
import type { MigrationResult } from '@/scripts/migration/migrateHistory'
import { useI18n } from '@/hooks/useI18n'

export function HistoryMigrationDialog() {
  const { t } = useI18n('history')
  const [isOpen, setIsOpen] = useState(true)
  const [isMigrating, setIsMigrating] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)

  const handleMigrate = async () => {
    setIsMigrating(true)
    try {
      const migrationResult = await migrateHistoryToDatabase()
      setResult(migrationResult)
    } catch (error) {
      console.error('Migration failed:', error)
    } finally {
      setIsMigrating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">{t('migration.title')}</h2>

        {!result && (
          <>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              {t('migration.notice')}
            </p>
            <p className="text-sm text-gray-500 mb-6">
              {t('migration.willDo')}
              <br />• {t('migration.steps.backup')}
              <br />• {t('migration.steps.cleanupBase64')}
              <br />• {t('migration.steps.migrateSqlite')}
              <br />• {t('migration.steps.fasterQuery')}
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleMigrate}
                disabled={isMigrating}
                className="flex-1 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {isMigrating ? t('migration.actions.migrating') : t('migration.actions.start')}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                disabled={isMigrating}
                className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t('migration.actions.later')}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            {result.success ? (
              <div className="text-green-600 mb-4">{t('migration.result.success')}</div>
            ) : (
              <div className="text-red-600 mb-4">{t('migration.result.failed')}</div>
            )}

            <div className="text-sm space-y-2 mb-6">
              <div>{t('migration.stats.total', { count: result.totalRecords })}</div>
              <div>{t('migration.stats.migrated', { count: result.migratedRecords })}</div>
              <div>{t('migration.stats.skipped', { count: result.skippedRecords })}</div>
              <div>
                {t('migration.stats.fileSize', {
                  original: (result.originalSize / 1024 / 1024).toFixed(2),
                  current: (result.newSize / 1024).toFixed(2)
                })}
              </div>
              <div>
                {t('migration.stats.saved', {
                  percent: ((1 - result.newSize / result.originalSize) * 100).toFixed(1)
                })}
              </div>

              {result.errors.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-red-600">
                    {t('migration.stats.viewErrors', { count: result.errors.length })}
                  </summary>
                  <div className="mt-2 max-h-40 overflow-auto text-xs">
                    {result.errors.map((err, i) => (
                      <div key={i} className="text-red-500">{err}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              {t('migration.actions.done')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
