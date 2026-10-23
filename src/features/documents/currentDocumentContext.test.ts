// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { currentDocumentContext, registerCurrentDocumentProvider } from './currentDocumentContext'
import { useNavigationStore } from '@/stores/navigationStore'

vi.mock('./documentSessionRegistry', () => ({ getDocumentSessionRegistry: () => ({
  get: (id: string) => ({ documentMeta: { container: id === 'video' ? { kind: 'project', projectId: 'project-video' } : { kind: 'standalone' } } }),
}) }))
const release: Array<() => void> = []
afterEach(() => { release.splice(0).forEach(dispose => dispose()) })

it('按当前宿主取文档，切换后不会把后台文档及其项目带入上下文', () => {
  release.push(registerCurrentDocumentProvider('video', host => host.activeWorkspace === 'videoEdit' ? 'video' : undefined))
  release.push(registerCurrentDocumentProvider('audio', host => host.activeWorkspace === 'tools' && host.activeToolId === 'audioEdit' ? 'audio' : undefined))
  useNavigationStore.setState({ activeWorkspace: 'videoEdit' })
  expect(currentDocumentContext()).toEqual({ documentId: 'video', projectId: 'project-video' })
  useNavigationStore.setState({ activeWorkspace: 'tools', activeToolId: 'audioEdit' })
  expect(currentDocumentContext()).toEqual({ documentId: 'audio' })
  useNavigationStore.setState({ activeWorkspace: 'assets' })
  expect(currentDocumentContext()).toEqual({ documentId: undefined })
})

it('重复装配可替换提供者，旧实例注销不能移除新实例；歧义不猜文档', () => {
  const old = registerCurrentDocumentProvider('test', () => 'old')
  release.push(old, registerCurrentDocumentProvider('test', () => 'video'))
  old()
  expect(currentDocumentContext()).toEqual({ documentId: 'video', projectId: 'project-video' })
  const other = registerCurrentDocumentProvider('other', () => 'audio')
  release.push(other)
  expect(currentDocumentContext()).toEqual({ documentId: undefined })
  other()
  expect(currentDocumentContext().documentId).toBe('video')
})
