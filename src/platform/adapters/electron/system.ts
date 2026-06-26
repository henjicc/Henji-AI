import { PlatformNotImplementedError } from '@/platform/types'
import type {
  DialogPlatform,
  FsPlatform,
  HttpPlatform,
  PathsPlatform,
  ShellPlatform,
  SystemPlatform,
} from '@/platform/contracts/system'

const DOMAIN = 'system'

function createFs(): FsPlatform {
  return {
    readFile: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.readFile')
    },
    readTextFile: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.readTextFile')
    },
    writeFile: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.writeFile')
    },
    writeTextFile: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.writeTextFile')
    },
    exists: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.exists')
    },
    mkdir: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.mkdir')
    },
    readDir: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.readDir')
    },
    copyFile: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.copyFile')
    },
    remove: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'fs.remove')
    },
  }
}

function createDialog(): DialogPlatform {
  return {
    save: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'dialog.save')
    },
    open: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'dialog.open')
    },
  }
}

function createShell(): ShellPlatform {
  return {
    openExternal: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'shell.openExternal')
    },
  }
}

function createPaths(): PathsPlatform {
  return {
    appLocalDataDir: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'paths.appLocalDataDir')
    },
    downloadDir: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'paths.downloadDir')
    },
    join: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'paths.join')
    },
    dirname: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'paths.dirname')
    },
  }
}

function createHttp(): HttpPlatform {
  return {
    fetch: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'http.fetch')
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
