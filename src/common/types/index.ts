/**
 * 三端共享类型（main / preload / renderer 经 @common/* 引用）：
 * 跨进程传递的数据契约定义在此，避免三处各写一份。
 */
export * from './app'
export * from './provider'
export * from './model'
export * from './service'
export * from './log'
export * from './usage'
export * from './quota'
export * from './dashboard'
