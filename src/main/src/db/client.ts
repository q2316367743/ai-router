/**
 * SQLite 单例（main 进程）：DB 文件位于 ~/.ai-router/db/ai-router.db。
 *
 * - 数据库打开与迁移均在 main 完成，渲染进程只经 IPC 调用领域仓储方法，不感知路径。
 * - 使用 better-sqlite3（同步、Drizzle 最成熟驱动）+ drizzle-orm，所有 SQL 逻辑都在 main。
 * - 表结构走 drizzle-kit 迁移流水线：schema 变更 → `npx drizzle-kit generate` → 运行时 `migrate()` 应用
 *   （迁移文件在 resources/drizzle/，electron-vite 主进程 publicDir + asarUnpack，经 __dirname 相对路径解析）。
 * - pragma WAL：崩溃恢复更稳、读写并发更友好（应用单实例，主要为抗崩溃/断电抖动）。
 */
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

let instance: BetterSQLite3Database<typeof schema> | null = null
/** 原始 better-sqlite3 句柄：WAL 维护等 pragma 需要它（drizzle 只暴露查询接口） */
let raw: InstanceType<typeof Database> | null = null

/**
 * 迁移目录运行时绝对路径。
 * 遵循 electron-vite 资源规范：主进程 publicDir 为项目根 resources/，文件随应用打包并由
 * electron-builder asarUnpack（electron-builder.yml 已配置 resources/**）。运行时相对于打包后的
 * __dirname（out/main）解析 `../../resources/drizzle`：dev 命中源码布局，prod 经 Electron asar
 * 补丁透明读取解包文件。
 */
const migrationsDir = () => join(__dirname, '../../resources/drizzle')

/** 惰性打开并迁移数据库；幂等，多调用返回同一实例 */
export function initDb(): BetterSQLite3Database<typeof schema> {
  if (instance) return instance
  const dir = join(app.getPath('home'), '.ai-router', 'db')
  mkdirSync(dir, { recursive: true })
  const sqlite = new Database(join(dir, 'ai-router.db'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  raw = sqlite
  const db = drizzle(sqlite, { schema })
  // 迁移由 `npx drizzle-kit generate` 产出；迁移目录尚未生成（未定义任何表）时跳过
  if (existsSync(join(migrationsDir(), 'meta', '_journal.json'))) {
    migrate(db, { migrationsFolder: migrationsDir() })
  }
  instance = db
  return db
}

/** 获取已初始化的数据库实例（须先调用 initDb，否则抛错提示时序问题） */
export function db(): BetterSQLite3Database<typeof schema> {
  if (!instance) throw new Error('[db] initDb() 未调用')
  return instance
}

/**
 * 手动 WAL checkpoint（TRUNCATE）：把 WAL 内容写回主库并截断 wal 文件，由每日定时任务调用。
 *
 * 被未结束的读事务占住时 SQLite 返回 `busy` 而不是抛错，此时本轮跳过、不重试，等下一次触发。
 */
export function checkpointWal(): void {
  if (!raw) throw new Error('[db] initDb() 未调用')
  const row: unknown = raw.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
  if (typeof row !== 'object' || row === null || !('busy' in row) || !('checkpointed' in row)) {
    console.log('[db] WAL checkpoint 已完成（无结果行）')
    return
  }
  if (typeof row.busy === 'number' && row.busy !== 0) {
    console.warn('[db] WAL checkpoint 被占用（存在未结束的读事务），本轮跳过')
    return
  }
  console.log(
    `[db] WAL checkpoint 已完成：写回 ${typeof row.checkpointed === 'number' ? row.checkpointed : 0} 页`
  )
}
