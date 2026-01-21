/**
 * History Migration Dialog Component
 *
 * UI for migrating history.json to SQLite database
 */

import { useState } from 'react'
import { migrateHistoryToDatabase } from '@/scripts/migration/migrateHistory'
import type { MigrationResult } from '@/scripts/migration/migrateHistory'

export function HistoryMigrationDialog() {
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
        <h2 className="text-xl font-bold mb-4">数据库迁移</h2>

        {!result && (
          <>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              检测到旧版本的历史记录文件，需要迁移到新的数据库格式。
            </p>
            <p className="text-sm text-gray-500 mb-6">
              此操作将：
              <br />• 备份现有数据
              <br />• 清理 Base64 数据以减小存储
              <br />• 迁移到 SQLite 数据库
              <br />• 支持更快的查询和筛选
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleMigrate}
                disabled={isMigrating}
                className="flex-1 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {isMigrating ? '迁移中...' : '开始迁移'}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                disabled={isMigrating}
                className="px-4 py-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                稍后
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            {result.success ? (
              <div className="text-green-600 mb-4">✓ 迁移成功！</div>
            ) : (
              <div className="text-red-600 mb-4">✗ 迁移失败</div>
            )}

            <div className="text-sm space-y-2 mb-6">
              <div>总记录数: {result.totalRecords}</div>
              <div>成功迁移: {result.migratedRecords}</div>
              <div>跳过记录: {result.skippedRecords}</div>
              <div>
                文件大小: {(result.originalSize / 1024 / 1024).toFixed(2)} MB
                → {(result.newSize / 1024).toFixed(2)} KB
              </div>
              <div>
                节省空间: {((1 - result.newSize / result.originalSize) * 100).toFixed(1)}%
              </div>

              {result.errors.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-red-600">
                    查看错误 ({result.errors.length})
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
              完成
            </button>
          </>
        )}
      </div>
    </div>
  )
}
