import {
  exportProjectPackage,
  importProjectPackage,
  type ImportedProjectPackageDto,
  type PackageMediaFileDto,
} from '../services/project-package'
import { parseRecord, parseStringField, registerIpcHandler } from './registry'

interface ExportProjectPackagePayload {
  manifestJson: string
  mediaFiles: PackageMediaFileDto[]
  targetPath: string
}

export function registerProjectPackageIpc(): void {
  registerIpcHandler<ExportProjectPackagePayload, void>('projectPackage:export', parseExportPayload, (payload) => {
    return exportProjectPackage(payload.manifestJson, payload.mediaFiles, payload.targetPath)
  })
  registerIpcHandler<string, ImportedProjectPackageDto>('projectPackage:import', (input) => {
    return parseStringField(input, 'zipPath')
  }, (zipPath) => importProjectPackage(zipPath))
}

function parseExportPayload(input: unknown): ExportProjectPackagePayload {
  const record = parseRecord(input)
  return {
    manifestJson: readString(record, 'manifestJson'),
    mediaFiles: readMediaFiles(record.mediaFiles),
    targetPath: readString(record, 'targetPath'),
  }
}

function readMediaFiles(value: unknown): PackageMediaFileDto[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected mediaFiles array')
  }
  return value.map((item) => {
    const record = parseRecord(item)
    return {
      srcPath: readString(record, 'srcPath'),
      packagePath: readString(record, 'packagePath'),
    }
  })
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}
