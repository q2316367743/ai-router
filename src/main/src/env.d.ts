/** main 侧构建期资源导入声明：vite ?raw 把文件内联为字符串常量 */
declare module '*.js?raw' {
  const src: string
  export default src
}

declare module '*.ts?raw' {
  const src: string
  export default src
}
