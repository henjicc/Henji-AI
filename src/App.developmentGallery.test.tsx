/** @vitest-environment jsdom */
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// 编译真实应用壳，仅隔离与入口无关的领域服务/工作区；检查编译期裁剪而非运行时 stubEnv。
async function compileApp(dev: boolean) {
  // esbuild 必须在 Node 的同一 TypedArray realm 中运行；jsdom 的 TextEncoder/Uint8Array 不同源。
  const script = `require('esbuild').build({
    entryPoints: [process.argv[1]], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'es2020', treeShaking: true, minifySyntax: true,
    define: { 'import.meta.env.DEV': process.argv[2] },
    plugins: [{ name: 'isolate-app-shell', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return undefined
        if (args.path === '@/features/devGallery/UiGalleryPage') return { path: args.path, namespace: 'gallery-fixture' }
        return { path: args.path, external: true }
      })
      builder.onLoad({ filter: /.*/, namespace: 'gallery-fixture' }, () => ({
        contents: "import React from 'react'; export function UiGalleryPage() { return React.createElement('div', {'data-design-system-fixture': ''}) }",
        loader: 'js',
      }))
    } }],
  }).then(result => process.stdout.write(result.outputFiles[0].text)).catch(error => { console.error(error); process.exitCode = 1 })`
  return execFileSync(process.execPath, ['-e', script, path.resolve(__dirname, 'App.tsx'), String(dev)], { encoding: 'utf8' })
}

async function mountApp(dev: boolean, surfaceId: string | null) {
  const code = await compileApp(dev)
  const empty = ({ children }: React.PropsWithChildren) => children ?? null
  const noop = () => undefined
  const state = { activeWorkspace: 'generation', view: 'closed', open: false, mode: 'right',
    size: { width: 300 }, startupWorkspace: 'assets', openSettings: noop, closeSettings: noop }
  const store = Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state })
  const openAssetLibrary = vi.fn()
  const openApplicationSurface = vi.fn()
  const namespaces: Record<string, unknown> = {
    react: { ...React, default: React, __esModule: true },
    'react/jsx-runtime': jsxRuntime,
    '@/core/logging': { createLogger: () => ({ info: noop, warn: noop, error: noop }) },
    './components/TabContainer': () => <div data-normal-workspace />,
    './components/WindowControls': empty,
    '@/core/development/developmentLaunch': { readDevelopmentLaunchOptions: () => ({ surfaceId }) },
    '@/core/development/developmentLaunchContract': {
      DEVELOPMENT_SURFACE_IDS: { uiGallery: 'dev.ui_gallery' }, isDevelopmentSurfaceId: (id: string) => id.startsWith('dev.'),
    },
    '@/stores/navigationStore': { useNavigationStore: store, openAssetLibrary, closeAssetLibrary: noop, switchWorkspace: noop },
    '@/features/navigation/application/surfaceNavigationService': { openApplicationSurface },
    '@/platform/runtime': { getPlatform: () => ({ window: { onCloseRequested: () => noop } }) },
    './services/customModels/CustomModelService': { getCustomModelService: () => ({ loadEnabledModels: noop }) },
    './services/modelscopeCustomModels/ModelscopeCustomModelService': { modelscopeCustomModelService: { loadModelsToRegistry: noop } },
    '@/features/onboarding/application/onboardingManager': { onboardingManager: { reconcileConfiguredProviders: noop } },
  }
  const module: { exports: { default?: React.ComponentType } } = { exports: {} }
  runInNewContext(code, { module, exports: module.exports, window, HTMLElement, performance, setTimeout, clearTimeout,
    require: (id: string) => namespaces[id] ?? new Proxy({ __esModule: true, default: empty }, {
      get(target, key) {
        if (key in target) return Reflect.get(target, key)
        const name = String(key)
        if (name.startsWith('use') && name.endsWith('Store')) return store
        return /^[A-Z]/.test(name) ? empty : noop
      },
    }),
  })
  const App = module.exports.default!
  return { ...render(<App />), openAssetLibrary, openApplicationSurface }
}

it('正式构建裁掉中心页模块引用与快捷键代码', async () => {
  const code = await compileApp(false)
  expect(code).not.toContain('features/devGallery/UiGalleryPage')
  expect(code).not.toContain('data-design-system-fixture')
  expect(code).not.toContain('"F8"')
})

it('正式包带开发页参数仍显示工作区，执行默认启动定位且不响应开发快捷键', async () => {
  const view = await mountApp(false, 'dev.ui_gallery')
  expect(view.container.querySelector('[data-normal-workspace]')).not.toBeNull()
  expect(view.openAssetLibrary).toHaveBeenCalledWith('workspace')
  expect(view.openApplicationSurface).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'F8', ctrlKey: true, shiftKey: true })
  expect(view.container.querySelector('[data-normal-workspace]')).not.toBeNull()
  expect(view.container.querySelector('[data-design-system-fixture]')).toBeNull()
})

it('开发构建快捷键切换中心页并清理监听，不触发正式导航或用户设置', async () => {
  const view = await mountApp(true, null)
  expect(view.container.querySelector('[data-normal-workspace]')).not.toBeNull()
  fireEvent.keyDown(window, { key: 'G', ctrlKey: true, shiftKey: true })
  expect(view.container.querySelector('[data-normal-workspace]')).not.toBeNull()
  expect(view.container.querySelector('[data-design-system-fixture]')).toBeNull()
  fireEvent.keyDown(window, { key: 'F8', ctrlKey: true, shiftKey: true, altKey: true })
  expect(view.container.querySelector('[data-design-system-fixture]')).toBeNull()
  const handled = new KeyboardEvent('keydown', { key: 'F8', ctrlKey: true, shiftKey: true, cancelable: true })
  handled.preventDefault()
  fireEvent(window, handled)
  expect(view.container.querySelector('[data-design-system-fixture]')).toBeNull()
  fireEvent.keyDown(window, { key: 'F8', ctrlKey: true, shiftKey: true, isComposing: true })
  expect(view.container.querySelector('[data-normal-workspace]')).not.toBeNull()
  fireEvent.keyDown(window, { key: 'F8', ctrlKey: true, shiftKey: true })
  await waitFor(() => expect(view.container.querySelector('[data-design-system-fixture]')).not.toBeNull())
  fireEvent.keyDown(window, { key: 'F8', ctrlKey: true, shiftKey: true, repeat: true })
  expect(view.container.querySelector('[data-design-system-fixture]')).not.toBeNull()
  fireEvent.keyDown(window, { key: 'F8', ctrlKey: true, shiftKey: true })
  expect(view.container.querySelector('[data-normal-workspace]')).not.toBeNull()
  expect(view.openApplicationSurface).not.toHaveBeenCalled()
  const remove = vi.spyOn(window, 'removeEventListener')
  view.unmount()
  expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
  remove.mockRestore()
})

it('开发启动参数仍直接进入中心页', async () => {
  const view = await mountApp(true, 'dev.ui_gallery')
  await waitFor(() => expect(view.container.querySelector('[data-design-system-fixture]')).not.toBeNull())
  expect(view.openAssetLibrary).not.toHaveBeenCalled()
})

it('中心页守卫保留现有正式 Surface 的巡检定位', async () => {
  const view = await mountApp(false, 'tool.image_edit')
  expect(view.openApplicationSurface).toHaveBeenCalledWith('tool.image_edit', { requestId: 'development-launch' })
  expect(view.openAssetLibrary).not.toHaveBeenCalled()
})
