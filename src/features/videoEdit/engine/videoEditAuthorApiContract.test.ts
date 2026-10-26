import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

/**
 * resources/video-edit-author/author-api.d.ts 是给作者源码类型检查用的接口声明，宿主真实契约在
 * videoEditAuthorModule.ts。两份必须说同一件事：字段集合相同；宿主传给作者的实参满足作者看到的
 * 参数类型；作者按声明写出的对象被宿主接受。唯一的有意放宽是 bounds/clip 写成 number[]。
 * 这里用正式 TypeScript 工程设置编译一段只含类型断言的文件，任何一侧漂移都会报出具体断言。
 */
const ASSERTIONS = `/// <reference types="@webgpu/types" />
import type * as Host from './videoEditAuthorModule'
import type * as Author from '../../../../resources/video-edit-author/author-api'
type Assert<T extends true> = T
type Extends<A, B> = [A] extends [B] ? true : false
type Mutual<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
type SameKeys<A, B> = Mutual<keyof A, keyof B>
type Fn<T> = Extract<T, (...args: never[]) => unknown>
type Args<T> = Parameters<Fn<T>>
/** 宿主运行时按下标读取 bounds/clip，作者侧接受任意长度数组。 */
type Relaxed<T> = Omit<T, 'bounds' | 'clip'> & { bounds?: readonly number[]; clip?: readonly number[] }
type AuthorLayerKeys = keyof Author.AuthorStaticLayer | keyof Author.AuthorPosedLayer
type ModuleFields = 'name' | 'kind' | 'mode' | 'width' | 'height' | 'durationSeconds' | 'frames' | 'params' | 'types' | 'motionBlur'

export type FrameInfo = [
  Assert<SameKeys<Host.AuthorFrameInfo, Author.AuthorFrameInfo>>,
  Assert<Mutual<Host.AuthorFrameInfo, Author.AuthorFrameInfo>>,
  Assert<SameKeys<NonNullable<Host.AuthorFrameInfo['audio']>, Author.AuthorAudioAnalysis>>,
  Assert<SameKeys<Host.AuthorPose, Author.AuthorPose>>,
  Assert<Mutual<Host.AuthorPose, Author.AuthorPose>>,
  Assert<Mutual<Host.AuthorAssets, Author.AuthorAssets>>,
  Assert<Extends<Host.AuthorParameters, Author.AuthorParams>>,
]
export type Layer = [
  // 宿主自己解析的 sourceSpan 不由作者书写。
  Assert<Mutual<Exclude<keyof Host.AuthorLayer, 'sourceSpan'>, AuthorLayerKeys>>,
  Assert<Extends<Author.AuthorLayer, Relaxed<Host.AuthorLayer>>>,
  Assert<Mutual<Args<Host.AuthorLayer['draw']>, Args<Author.AuthorLayer['draw']>>>,
  Assert<Mutual<Args<Host.AuthorLayer['pose']>, Args<Author.AuthorPosedLayer['pose']>>>,
  Assert<Mutual<Host.AuthorLayer['data'], Author.AuthorStaticLayer['data']>>,
  Assert<Mutual<Host.AuthorLayer['factory'], Author.AuthorStaticLayer['factory']>>,
  Assert<Mutual<Host.AuthorLayer['blurShape'], Author.AuthorStaticLayer['blurShape']>>,
]
export type Module = [
  Assert<SameKeys<Host.AuthorModule, Author.AuthorModule>>,
  Assert<Extends<Pick<Author.AuthorModule, ModuleFields>, Pick<Host.AuthorModule, ModuleFields>>>,
  Assert<Mutual<Host.AuthorModule['kind'], Author.AuthorModule['kind']>>,
  Assert<Mutual<Host.AuthorModule['mode'], Author.AuthorModule['mode']>>,
  Assert<Mutual<Host.AuthorModule['motionBlur'], Author.AuthorModule['motionBlur']>>,
  // 宿主传给入口的实参满足作者看到的参数类型。
  Assert<Extends<Args<Host.AuthorModule['draw']>, Args<Author.AuthorModule['draw']>>>,
  Assert<Extends<Args<Host.AuthorModule['layers']>, Args<Author.AuthorModule['layers']>>>,
  Assert<Extends<ReturnType<Fn<Author.AuthorModule['layers']>>[number], Relaxed<Host.AuthorLayer>>>,
  Assert<Extends<Args<Host.AuthorModule['createWebGL']>, Args<Author.AuthorModule['createWebGL']>>>,
  Assert<SameKeys<Host.AuthorWebGL, Author.AuthorWebGL>>,
  Assert<Extends<Args<Host.AuthorWebGL['draw']>, Args<Author.AuthorWebGL['draw']>>>,
  Assert<SameKeys<Host.AuthorWebGPU, Author.AuthorWebGPU>>,
  Assert<SameKeys<Host.AuthorGpuInputs, Author.AuthorGpuInputs>>,
  // 宿主的 GPU 类型只是最小结构子集：设备只核对成员名（宿主 writeBuffer 的数据参数比 WebGPU 声明宽，
  // 结构比较会被 ArrayBuffer 泛型挡住），纹理与输入按结构核对真实类型满足宿主。
  Assert<Extends<keyof NonNullable<Args<Host.AuthorModule['createWebGPU']>[0]>, keyof GPUDevice>>,
  Assert<Extends<Author.AuthorGpuInputs, Host.AuthorGpuInputs>>,
  Assert<Extends<Args<Author.AuthorWebGPU['draw']>[0], Args<Host.AuthorWebGPU['draw']>[0]>>,
  Assert<Mutual<Args<Host.AuthorWebGPU['draw']>[1], Args<Author.AuthorWebGPU['draw']>[1]>>,
  Assert<Extends<Args<Host.AuthorWebGPU['draw']>[2], Args<Author.AuthorWebGPU['draw']>[2]>>,
  Assert<Mutual<Args<Host.AuthorWebGPU['draw']>[6], Args<Author.AuthorWebGPU['draw']>[6]>>,
]
`

it('作者接口声明与宿主契约逐字段一致', () => {
  const root = path.resolve()
  const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')) } })!
  const options: ts.CompilerOptions = { ...config.options, types: [], noEmit: true, incremental: false, tsBuildInfoFile: undefined }
  const file = path.join(root, 'src/features/videoEdit/engine/videoEditAuthorApiContract.check.ts').replace(/\\/g, '/')
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile, fileExists = host.fileExists, readFile = host.readFile
  host.getSourceFile = (name, language, ...rest) => name.replace(/\\/g, '/') === file ? ts.createSourceFile(name, ASSERTIONS, language) : getSourceFile.call(host, name, language, ...rest)
  host.fileExists = name => name.replace(/\\/g, '/') === file || fileExists.call(host, name)
  host.readFile = name => name.replace(/\\/g, '/') === file ? ASSERTIONS : readFile.call(host, name)
  const program = ts.createProgram([file], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map(diagnostic => {
    const line = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 0
    return `${line}: ${ASSERTIONS.split('\n')[line - 1]?.trim()} — ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
  })
  expect(diagnostics).toEqual([])
}, 60_000)
