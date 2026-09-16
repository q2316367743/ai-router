import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ModelMappingInfo, ModelMappingInput } from '@common/types'
import { db } from '../client'
import { models, providers } from '../schema'

export function listModelMappings(): ModelMappingInfo[] {
  return db()
    .select({
      id: models.id,
      providerId: models.providerId,
      providerName: providers.name,
      publicName: models.publicName,
      upstreamName: models.upstreamName,
      enabled: models.enabled,
      createdAt: models.createdAt
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .orderBy(models.createdAt)
    .all()
}

/** 代理转发路由：按对外模型名一次联表取齐映射与提供商信息 */
export interface MappingRoute {
  publicName: string
  upstreamName: string
  mappingEnabled: boolean
  providerId: string
  providerName: string
  providerBaseUrl: string
  providerApiKey: string
  providerEnabled: boolean
}

export function findMapping(publicName: string): MappingRoute | null {
  const row = db()
    .select({
      publicName: models.publicName,
      upstreamName: models.upstreamName,
      mappingEnabled: models.enabled,
      providerId: providers.id,
      providerName: providers.name,
      providerBaseUrl: providers.baseUrl,
      providerApiKey: providers.apiKey,
      providerEnabled: providers.enabled
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.publicName, publicName))
    .get()
  return row ?? null
}

export function createModelMapping(input: ModelMappingInput): string {
  ensurePublicNameAvailable(input.publicName, input.id)
  const id = nanoid()
  db()
    .insert(models)
    .values({
      id,
      providerId: input.providerId,
      publicName: input.publicName,
      upstreamName: input.upstreamName,
      enabled: input.enabled,
      createdAt: Date.now()
    })
    .run()
  return id
}

export function updateModelMapping(input: ModelMappingInput): void {
  ensurePublicNameAvailable(input.publicName, input.id)
  db()
    .update(models)
    .set({
      providerId: input.providerId,
      publicName: input.publicName,
      upstreamName: input.upstreamName,
      enabled: input.enabled
    })
    .where(eq(models.id, input.id ?? ''))
    .run()
}

export function removeModelMapping(id: string): void {
  db().delete(models).where(eq(models.id, id)).run()
}

function ensurePublicNameAvailable(publicName: string, excludeId?: string): void {
  const row = db()
    .select({ id: models.id })
    .from(models)
    .where(eq(models.publicName, publicName))
    .get()
  if (row && row.id !== excludeId) {
    throw new Error(`对外模型名「${publicName}」已存在`)
  }
}
