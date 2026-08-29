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
    readFile: async (path) => {
      return await getNative().fs.readFile(path)
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
      const result = await getNative().http.fetch({
        url,
        method: init?.method,
        headers: normalizeFetchHeaders(init?.headers),
        body: await normalizeFetchBody(init?.body),
      })
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      })
    },
  }
}

export function createElectronSystem(): SystemPlatform {
  return {
    fs: createFs(),
    dialog: createDialog(),
    shell: createShell(),
    paths: createPaths(),
    http: createHttp(),
  }
}
