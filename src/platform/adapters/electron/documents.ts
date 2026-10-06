import type { DocumentsPlatform } from '@/platform/contracts/documents'

const DOMAIN = 'documents'

function getNativeDocuments(): DocumentsPlatform {
  const native = window.henjiNative
  if (!native?.documents) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.documents is not available`)
  }
  return native.documents
}

/** 文档底座：preload 桥已按 DocumentsPlatform 实现，这里只做可用性检查与转发。 */
export function createElectronDocuments(): DocumentsPlatform {
  return {
    listDocuments: (query) => getNativeDocuments().listDocuments(query),
    readDocument: (target) => getNativeDocuments().readDocument(target),
    createDocument: (request) => getNativeDocuments().createDocument(request),
    saveDocument: (request) => getNativeDocuments().saveDocument(request),
    renameDocument: (request) => getNativeDocuments().renameDocument(request),
    finalizeDocument: (request) => getNativeDocuments().finalizeDocument(request),
    moveDocument: (request) => getNativeDocuments().moveDocument(request),
    duplicateDocument: (request) => getNativeDocuments().duplicateDocument(request),
    trashDocument: (target) => getNativeDocuments().trashDocument(target),
    deleteEmptyDraft: (target) => getNativeDocuments().deleteEmptyDraft(target),
    forgetDocument: (docId) => getNativeDocuments().forgetDocument(docId),
    revealDocument: (target) => getNativeDocuments().revealDocument(target),
    collectDocumentMedia: (target) => getNativeDocuments().collectDocumentMedia(target),
    importFile: (request) => getNativeDocuments().importFile(request),
    resolveDocumentLink: (link) => getNativeDocuments().resolveDocumentLink(link),
    checkName: (request) => getNativeDocuments().checkName(request),
    getDocumentCover: (docId) => getNativeDocuments().getDocumentCover(docId),
    saveDocumentCover: (request) => getNativeDocuments().saveDocumentCover(request),
    refreshIndex: () => getNativeDocuments().refreshIndex(),
    readSessionState: (request) => getNativeDocuments().readSessionState(request),
    writeSessionState: (request) => getNativeDocuments().writeSessionState(request),
    listProjects: (query) => getNativeDocuments().listProjects(query),
    createProject: (request) => getNativeDocuments().createProject(request),
    renameProject: (request) => getNativeDocuments().renameProject(request),
    finalizeProject: (request) => getNativeDocuments().finalizeProject(request),
    setProjectMainDocument: (request) => getNativeDocuments().setProjectMainDocument(request),
    trashProject: (projectId) => getNativeDocuments().trashProject(projectId),
    registerExternalProject: (folderPath) => getNativeDocuments().registerExternalProject(folderPath),
    registerExternalDocument: (filePath) => getNativeDocuments().registerExternalDocument(filePath),
    forgetExternalLocation: (folderPath) => getNativeDocuments().forgetExternalLocation(folderPath),
    revealProject: (projectId) => getNativeDocuments().revealProject(projectId),
    exportDocumentPackage: (request) => getNativeDocuments().exportDocumentPackage(request),
    exportProjectPackage: (request) => getNativeDocuments().exportProjectPackage(request),
    importPackage: (request) => getNativeDocuments().importPackage(request),
  }
}
