import type {
  DialogPlatform,
  FsPlatform,
  HttpPlatform,
  PathsPlatform,
  ShellPlatform,
  SystemPlatform,
} from '@/platform/contracts/system'

const DOMAIN = 'system'

function getNative(): NonNullable<typeof window.henjiNative> {
  const native = window.henjiNative
  if (!native) {
    throw new Error(`[platform:${DOMAIN}] henjiNative is not available`)
  }
  return native
}

function createFs(): FsPlatform {
  return {
    readFile: async (path, options) => {
      return await getNative().fs.readFile(path, options)
    },
    readTextFile: async (path) => {
      return await getNative().fs.readTextFile(path)
    },
    writeFile: async (path, data, options) => {
      await getNative().fs.writeFile(path, data, options)
    },
    writeTextFile: async (path, data) => {
      await getNative().fs.writeTextFile(path, data)
    },
    exists: async (path) => {
      return await getNative().fs.exists(path)
    },
    mkdir: async (path, options) => {
      await getNative().fs.mkdir(path, options)
    },
    readDir: async (path) => {
      return await getNative().fs.readDir(path)
    },
    readDirPage: async (path, options) => getNative().fs.readDirPage(path, options),
    copyFile: async (src, dest) => {
      await getNative().fs.copyFile(src, dest)
    },
    remove: async (path, options) => {
      await getNative().fs.remove(path, options)
    },
  }
}

function createDialog(): DialogPlatform {
  return {
    save: async (options) => {
      return await getNative().dialog.save(options)
    },
    open: async (options) => {
      return await getNative().dialog.open(options)
    },
  }
}

function createShell(): ShellPlatform {
  return {
    openExternal: async (url) => {
      await getNative().shell.openExternal(url)
    },
  }
}

function createPaths(): PathsPlatform {
  return {
    appLocalDataDir: async () => {
      return await getNative().paths.appLocalDataDir()
    },
    appDirectories: async (options) => {
      return await getNative().paths.appDirectories(options)
    },
    downloadDir: async () => {
      return await getNative().paths.downloadDir()
    },
    join: async (...parts) => {
      return await getNative().paths.join(...parts)
    },
    dirname: async (path) => {
      return await getNative().paths.dirname(path)
    },
    tempDir: async () => {
      return await getNative().paths.tempDir()
    },
  }
}

function normalizeFetchHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }
  return Object.fromEntries(new Headers(headers).entries())
}

async function normalizeFetchBody(body: BodyInit | null | undefined): Promise<string | Uint8Array | undefined> {
  if (!body) {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof URLSearchParams) {
    return body.toString()
  }
  if (body instanceof Uint8Array) {
    return body
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer())
  }
  throw new Error('Unsupported native fetch body type')
}

function createHttp(): HttpPlatform {
  return {
    fetch: async (url, init) => {
      const signal = init?.signal
      const abortError = (): DOMException => new DOMException('Aborted', 'AbortError')
      if (signal?.aborted) throw abortError()
      let onAbort: (() => void) | undefined
      const aborted = signal ? new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError())
        signal.addEventListener('abort', onAbort, { once: true })
      }) : undefined
      try {
        const execute = async () => {
          const body = await normalizeFetchBody(init?.body)
          if (signal?.aborted) throw abortError()
          // preload 原样透传请求对象；AbortSignal 留在渲染层，时限以可序列化字段进入主进程。
          const request = {
            url,
            method: init?.method,
            headers: normalizeFetchHeaders(init?.headers),
            body,
            timeoutMs: init?.timeoutMs,
          }
          return await getNative().http.fetch(request)
        }
        const result = await (aborted ? Promise.race([execute(), aborted]) : execute())
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        })
      } finally {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

export function createElectronSystem(): SystemPlatform {
  return {
    memoryInfo: () => getNative().diagnostics.memoryInfo(),
    fs: createFs(),
    dialog: createDialog(),
    shell: createShell(),
    paths: createPaths(),
    http: createHttp(),
  }
}
