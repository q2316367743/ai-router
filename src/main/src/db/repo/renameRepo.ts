import { sql, type SQL } from 'drizzle-orm'
import { usageDaily } from '../schema'

/**
 * 改名时的历史引用同步。
 *
 * 历史表的统计维度存的是**请求发生时的名字快照**（`provider_name` / `public_model`），看板与
 * 日志页都按名字分组、不 join 主表。好处是删除供应商/模型不影响历史，代价是**改名会让同一实体
 * 的历史裂成两组**（旧名一组、新名一组）。
 *
 * 本模块让改名跟随历史：按写入时一并落库的 `provider_id` / `model_id` 精确圈定历史行并改写名字。
 * 之所以用 id 而不是用名字圈定，是因为 `providers.name` 允许重名（同名两家各有一条历史），
 * 按名字改会误伤另一家。
 *
 * 两条纪律：
 * - **不改 `upstream_model`**：那是「这个请求实际发给了谁」的事实记录，改名不是改变历史事实。
 * - **模型改绑 providerId 不在此列**：历史请求确实发给了旧供应商，改了就是伪造历史。
 */

/** 改名改写所需的执行器：与 drizzle 事务对象结构兼容（避免引入其泛型签名） */
export interface SqlRunner {
  run(query: SQL): unknown
}

/**
 * 历史行归属：写入历史表（request_logs / usage_daily / usage_hourly）时一并落库的
 * 供应商 / 模型映射 ID。这些字段存在的唯一目的就是本模块的改名定位，故类型定义在此，
 * 写入方引用它以保证「写进去的就是改名要找的」。
 *
 * 可空：本地拦截（模型未命中）的请求没有归属实体；本次改动之前写入的历史行也没有值。
 */
export interface HistoryRef {
  providerId: string | null
  modelId: string | null
}

/** 计数列：取自 schema 列对象，避免与 `usageRepo.conflictSet` 的累加列表漂移 */
const COUNTER_COLUMNS = [
  usageDaily.requestCount,
  usageDaily.successCount,
  usageDaily.failCount,
  usageDaily.durationMs,
  usageDaily.promptTokens,
  usageDaily.completionTokens,
  usageDaily.reasoningTokens,
  usageDaily.cacheReadTokens,
  usageDaily.cacheWriteTokens,
  usageDaily.unrecognizedTokens,
  usageDaily.totalTokens
].map((column) => column.name)

/** 历史表里被改写的名字列 */
type NameColumn = 'provider_name' | 'public_model'
/** 圈定历史行的归属 id 列 */
type IdColumn = 'provider_id' | 'model_id'

/** 聚合表的改写目标：两张表只有时间桶键不同，其余一致 */
interface RenameTarget {
  table: string
  /** 时间桶列 */
  bucket: string
  /** 被改写的名字列 */
  changed: NameColumn
  /** 圈定历史行的归属 id 列 */
  idColumn: IdColumn
}

const PROVIDER_TARGETS: readonly RenameTarget[] = [
  { table: 'usage_daily', bucket: 'date', changed: 'provider_name', idColumn: 'provider_id' },
  { table: 'usage_hourly', bucket: 'hour_key', changed: 'provider_name', idColumn: 'provider_id' }
]

const MODEL_TARGETS: readonly RenameTarget[] = [
  { table: 'usage_daily', bucket: 'date', changed: 'public_model', idColumn: 'model_id' },
  { table: 'usage_hourly', bucket: 'hour_key', changed: 'public_model', idColumn: 'model_id' }
]

function ident(name: string): SQL {
  return sql.raw(`\`${name}\``)
}

/**
 * 改写中转用的会话级临时表。同一连接内串行使用、用完即删，固定名称即可。
 * 故意用**不带 schema 限定**的名字：`CREATE TEMP TABLE` 已把它放进 temp 库，而 SQLite 解析
 * 非限定名时先查 temp 再查 main，故引用一定命中它；带 `temp.` 前缀反而可能踩到解析限制。
 */
const TEMP_TABLE = sql.raw('`_rename_rows`')

/** 供应商改名：两张聚合表 + 日志表 */
export function applyProviderRename(
  runner: SqlRunner,
  providerId: string,
  oldName: string,
  newName: string
): void {
  for (const target of PROVIDER_TARGETS) {
    rewriteAggregate(runner, target, providerId, oldName, newName)
  }
  rewriteLogs(runner, 'provider_name', 'provider_id', providerId, newName)
}

/**
 * 模型对外名改名：两张聚合表 + 日志表。
 *
 * 2026-09-23 起对外名是「同名渠道行的组」，改名等于该名下**每一行**各改一次
 * （`modelRepo.renameModelGroup` 在同一事务里逐个 id 调用本函数）；
 * 入参 `modelId` 是**渠道行** id，历史行按它圈定，行与行之间互不干扰。
 */
export function applyModelRename(
  runner: SqlRunner,
  modelId: string,
  oldName: string,
  newName: string
): void {
  for (const target of MODEL_TARGETS) {
    rewriteAggregate(runner, target, modelId, oldName, newName)
  }
  rewriteLogs(runner, 'public_model', 'model_id', modelId, newName)
}

/**
 * 聚合表改名（集合式语句，不做 JS 行循环 —— 逐行改写会把几万行变成几万次语句往返，
 * 在同步驱动上直接卡住主进程）。
 *
 * 不能简单 UPDATE：聚合表主键含名字列，目标名可能已被占用（例如撞上**已删除供应商**留下的
 * 永久历史行），此时 UPDATE 会违反主键。因此走 `INSERT ... ON CONFLICT DO UPDATE`：
 * 无冲突行以新名插入，冲突行逐列累加合并，最后删掉旧名源行。
 *
 * 源行先抄到**临时表**再改名插入：直接 `INSERT INTO t SELECT ... FROM t` 会在同一张表上
 * 边读边写，SQLite 并不保证读取时看不到本语句刚插入的行，存在计数被重复累加的风险。
 * 临时表让「读源行」与「写目标行」彻底分离。
 */
function rewriteAggregate(
  runner: SqlRunner,
  target: RenameTarget,
  id: string,
  oldName: string,
  newName: string
): void {
  const { table, bucket, changed, idColumn } = target
  const quoted = (names: readonly string[]): string =>
    names.map((name) => `\`${name}\``).join(', ')
  const columnList = quoted([
    bucket,
    'provider_name',
    'public_model',
    'provider_id',
    'model_id',
    ...COUNTER_COLUMNS
  ])
  const conflictTarget = quoted([bucket, 'provider_name', 'public_model'])
  const additions = COUNTER_COLUMNS.map(
    (name) => `\`${name}\` = \`${name}\` + excluded.${name}`
  ).join(', ')

  // 抄源行 → 临时表内改名 → 合并插入 → 删源行；全部在同一事务内，任一步失败整体回滚。
  runner.run(sql`DROP TABLE IF EXISTS ${TEMP_TABLE}`)
  runner.run(sql`
    CREATE TEMP TABLE ${TEMP_TABLE} AS
    SELECT ${sql.raw(columnList)} FROM ${ident(table)}
     WHERE ${ident(idColumn)} = ${id} AND ${ident(changed)} = ${oldName}
  `)
  runner.run(sql`UPDATE ${TEMP_TABLE} SET ${ident(changed)} = ${newName}`)
  // SELECT 后面必须跟一个恒真 WHERE：`INSERT ... SELECT` 直接接 ON CONFLICT 时，SQLite 会把 ON 当成
  // join 的 ON 子句并在 prepare 阶段报语法错误（文档 "Parsing Ambiguity" 给的解法就是补一个 WHERE）
  runner.run(sql`
    INSERT INTO ${ident(table)} (${sql.raw(columnList)})
    SELECT ${sql.raw(columnList)} FROM ${TEMP_TABLE}
     WHERE true
    ON CONFLICT (${sql.raw(conflictTarget)})
    DO UPDATE SET ${sql.raw(additions)}
  `)
  runner.run(sql`
    DELETE FROM ${ident(table)}
     WHERE ${ident(idColumn)} = ${id} AND ${ident(changed)} = ${oldName}
  `)
  runner.run(sql`DROP TABLE IF EXISTS ${TEMP_TABLE}`)
}

/**
 * 日志表改名：request_logs 每请求一行、主键是自增 id，无聚合语义，按 id 直接改即可。
 * 按 id（而非「id + 旧名」）圈定，顺带覆盖任何遗留的旧名行。
 */
function rewriteLogs(
  runner: SqlRunner,
  changed: NameColumn,
  idColumn: IdColumn,
  id: string,
  newName: string
): void {
  runner.run(sql`
    UPDATE ${ident('request_logs')}
       SET ${ident(changed)} = ${newName}
     WHERE ${ident(idColumn)} = ${id}
  `)
}
