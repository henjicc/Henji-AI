import { withdrawCodeComponentRequestSchema, writeCodeVersionRequestSchema, readCodeFileRequestSchema, publishCodeComponentRequestSchema } from '../../../src/core/videoEdit/codeMaterial/storageContract'
import type { z } from 'zod'

import {
  createDocumentRequestSchema,
  createProjectRequestSchema,
  documentIdRequestSchema,
  documentLinkSchema,
  documentListQuerySchema,
  documentListPageQuerySchema,
  documentSessionStateKeySchema,
  documentTargetSchema,
  duplicateDocumentRequestSchema,
  exportDocumentPackageRequestSchema,
  exportProjectPackageRequestSchema,
  importPackageRequestSchema,
  finalizeDocumentRequestSchema,
  finalizeProjectRequestSchema,
  importFileRequestSchema,
  moveDocumentRequestSchema,
  nameCheckRequestSchema,
  pathRequestSchema,
  projectIdRequestSchema,
  projectListQuerySchema,
  projectListPageQuerySchema,
  renameDocumentRequestSchema,
  renameProjectRequestSchema,
  saveDocumentCoverRequestSchema,
  saveDocumentRequestSchema,
  setProjectMainDocumentRequestSchema,
  writeDocumentSessionStateRequestSchema,
} from '../../../src/core/documents/requests'
import { DOCUMENT_IPC_CHANNELS, type DocumentsPlatform } from '../../../src/platform/contracts/documents'
import { getDocumentService } from '../services/documents/runtime'
import { parseVoid, registerIpcHandler } from './registry'

/*
 * 文档底座 IPC（存储底座 2.2）。所有入参用共享 schema 校验后交给主进程 DocumentService，
 * 渲染层经 preload `henjiNative.documents` → PAL `DocumentsPlatform` → `src/commands/documents.ts` 调用。
 */

function parseWith<T>(schema: z.ZodType<T>, optional = false): (input: unknown) => T {
  return (input) => schema.parse(optional && input === undefined ? {} : input)
}

export function registerDocumentsIpc(): void {
  const service = (): DocumentsPlatform => getDocumentService()
  const c = DOCUMENT_IPC_CHANNELS
  registerIpcHandler(c.withdrawCodeComponent, parseWith(withdrawCodeComponentRequestSchema), request => service().withdrawCodeComponent(request))
  registerIpcHandler(c.writeCodeVersion, parseWith(writeCodeVersionRequestSchema), request => service().writeCodeVersion(request))
  registerIpcHandler(c.readCodeFile, parseWith(readCodeFileRequestSchema), file => service().readCodeFile(file))
  registerIpcHandler(c.listCodeComponents, parseWith(documentTargetSchema), target => service().listCodeComponents(target))
  registerIpcHandler(c.publishCodeComponent, parseWith(publishCodeComponentRequestSchema), request => service().publishCodeComponent(request))
  registerIpcHandler(c.listDocuments, parseWith(documentListQuerySchema, true), (query) => service().listDocuments(query))
  registerIpcHandler(c.listDocumentsPage, parseWith(documentListPageQuerySchema, true), (query) => service().listDocumentsPage(query))
  registerIpcHandler(c.readDocument, parseWith(documentTargetSchema), (target) => service().readDocument(target))
  registerIpcHandler(c.createDocument, parseWith(createDocumentRequestSchema), (request) => service().createDocument(request))
  registerIpcHandler(c.saveDocument, parseWith(saveDocumentRequestSchema), (request) => service().saveDocument(request))
  registerIpcHandler(c.renameDocument, parseWith(renameDocumentRequestSchema), (request) => service().renameDocument(request))
  registerIpcHandler(c.finalizeDocument, parseWith(finalizeDocumentRequestSchema), (request) => service().finalizeDocument(request))
  registerIpcHandler(c.moveDocument, parseWith(moveDocumentRequestSchema), (request) => service().moveDocument(request))
  registerIpcHandler(c.duplicateDocument, parseWith(duplicateDocumentRequestSchema), (request) => service().duplicateDocument(request))
  registerIpcHandler(c.trashDocument, parseWith(documentTargetSchema), (target) => service().trashDocument(target))
  registerIpcHandler(c.deleteEmptyDraft, parseWith(documentTargetSchema), (target) => service().deleteEmptyDraft(target))
  registerIpcHandler(c.forgetDocument, parseWith(documentIdRequestSchema), ({ docId }) => service().forgetDocument(docId))
  registerIpcHandler(c.markDocumentOpened, parseWith(documentIdRequestSchema), ({ docId }) => service().markDocumentOpened(docId))
  registerIpcHandler(c.revealDocument, parseWith(documentTargetSchema), (target) => service().revealDocument(target))
  registerIpcHandler(c.collectDocumentMedia, parseWith(documentTargetSchema), (target) => service().collectDocumentMedia(target))
  registerIpcHandler(c.importFile, parseWith(importFileRequestSchema), (request) => service().importFile(request))
  registerIpcHandler(c.resolveDocumentLink, parseWith(documentLinkSchema), (link) => service().resolveDocumentLink(link))
  registerIpcHandler(c.checkName, parseWith(nameCheckRequestSchema), (request) => service().checkName(request))
  registerIpcHandler(c.getDocumentCover, parseWith(documentIdRequestSchema), ({ docId }) => service().getDocumentCover(docId))
  registerIpcHandler(c.saveDocumentCover, parseWith(saveDocumentCoverRequestSchema), (request) => service().saveDocumentCover(request))
  registerIpcHandler(c.refreshIndex, parseVoid, () => service().refreshIndex())
  registerIpcHandler(c.readSessionState, parseWith(documentSessionStateKeySchema), (request) => service().readSessionState(request))
  registerIpcHandler(c.writeSessionState, parseWith(writeDocumentSessionStateRequestSchema), (request) => service().writeSessionState(request))
  registerIpcHandler(c.listProjects, parseWith(projectListQuerySchema, true), (query) => service().listProjects(query))
  registerIpcHandler(c.listProjectsPage, parseWith(projectListPageQuerySchema, true), (query) => service().listProjectsPage(query))
  registerIpcHandler(c.createProject, parseWith(createProjectRequestSchema, true), (request) => service().createProject(request))
  registerIpcHandler(c.renameProject, parseWith(renameProjectRequestSchema), (request) => service().renameProject(request))
  registerIpcHandler(c.finalizeProject, parseWith(finalizeProjectRequestSchema), (request) => service().finalizeProject(request))
  registerIpcHandler(c.setProjectMainDocument, parseWith(setProjectMainDocumentRequestSchema), (request) => service().setProjectMainDocument(request))
  registerIpcHandler(c.trashProject, parseWith(projectIdRequestSchema), ({ projectId }) => service().trashProject(projectId))
  registerIpcHandler(c.registerExternalProject, parseWith(pathRequestSchema), ({ path }) => service().registerExternalProject(path))
  registerIpcHandler(c.registerExternalDocument, parseWith(pathRequestSchema), ({ path }) => service().registerExternalDocument(path))
  registerIpcHandler(c.forgetExternalLocation, parseWith(pathRequestSchema), ({ path }) => service().forgetExternalLocation(path))
  registerIpcHandler(c.revealProject, parseWith(projectIdRequestSchema), ({ projectId }) => service().revealProject(projectId))
  registerIpcHandler(c.exportDocumentPackage, parseWith(exportDocumentPackageRequestSchema), (request) => service().exportDocumentPackage(request))
  registerIpcHandler(c.exportProjectPackage, parseWith(exportProjectPackageRequestSchema), (request) => service().exportProjectPackage(request))
  registerIpcHandler(c.importPackage, parseWith(importPackageRequestSchema), (request) => service().importPackage(request))
}
