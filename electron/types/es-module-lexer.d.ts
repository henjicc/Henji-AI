// Electron 工程沿用 node 模块解析；复用上游对同步 JS 入口声明的同一套公开类型。
declare module 'es-module-lexer/js' {
  export { parse } from 'es-module-lexer'
}
