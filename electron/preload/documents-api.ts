import { DOCUMENT_IPC_CHANNELS, type DocumentsPlatform } from '../../src/platform/contracts/documents'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>

/** 文档底座桥：方法与 DocumentsPlatform 一一对应，通道表与主进程共用。 */
export function createDocumentsApi(invoke: NativeInvoke): DocumentsPlatform {
  const c = DOCUMENT_IPC_CHANNELS
  return {
    listDocuments: (query) => invoke(c.listDocuments, query),
    readDocument: (target) => invoke(c.readDocument, target),
    createDocument: (request) => invoke(c.createDocument, request),
    saveDocument: (request) => invoke(c.saveDocument, request),
    renameDocument: (request) => invoke(c.renameDocument, request),
    finalizeDocument: (request) => invoke(c.finalizeDocument, request),
    moveDocument: (request) => invoke(c.moveDocument, request),
    duplicateDocument: (request) => invoke(c.duplicateDocument, request),
    trashDocument: (target) => invoke(c.trashDocument, target),
    deleteEmptyDraft: (target) => invoke(c.deleteEmptyDraft, target),
    revealDocument: (target) => invoke(c.revealDocument, target),
    resolveDocumentLink: (link) => invoke(c.resolveDocumentLink, link),
    checkName: (request) => invoke(c.checkName, request),
    getDocumentCover: (docId) => invoke(c.getDocumentCover, { docId }),
    saveDocumentCover: (request) => invoke(c.saveDocumentCover, request),
    refreshIndex: () => invoke(c.refreshIndex),
    listProjects: (query) => invoke(c.listProjects, query),
    createProject: (request) => invoke(c.createProject, request),
    renameProject: (request) => invoke(c.renameProject, request),
    finalizeProject: (request) => invoke(c.finalizeProject, request),
    trashProject: (projectId) => invoke(c.trashProject, { projectId }),
    registerExternalProject: (folderPath) => invoke(c.registerExternalProject, { path: folderPath }),
    forgetExternalLocation: (folderPath) => invoke(c.forgetExternalLocation, { path: folderPath }),
    revealProject: (projectId) => invoke(c.revealProject, { projectId }),
  }
}
