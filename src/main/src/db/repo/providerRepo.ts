import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ProviderInfo, ProviderInput } from '@common/types'
import { db } from '../client'
import { models, providers } from '../schema'

export function listProviders(): ProviderInfo[] {
  return db()
    .select({
      id: providers.id,
      name: providers.name,
      baseUrl: providers.baseUrl,
      apiKey: providers.apiKey,
      enabled: providers.enabled,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      modelCount: sql<number>`(select count(*) from ${models} where ${models.providerId} = ${providers.id})`
    })
    .from(providers)
    .orderBy(providers.createdAt)
    .all()
}

export function createProvider(input: ProviderInput): string {
  const now = Date.now()
  const id = nanoid()
  db()
    .insert(providers)
    .values({
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now
    })
    .run()
  return id
}

export function updateProvider(input: ProviderInput): void {
  db()
    .update(providers)
    .set({
      name: input.name,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      enabled: input.enabled,
      updatedAt: Date.now()
    })
    .where(sql`${providers.id} = ${input.id}`)
    .run()
}

export function removeProvider(id: string): void {
  db().delete(providers).where(sql`${providers.id} = ${id}`).run()
}
