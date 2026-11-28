import { channelStateKey } from '../core/channelState.ts'
import { z } from 'zod'
import { ExtensionError } from './plugos/protocol.ts'

const DB_NAME = channelStateKey('syntax-extensions-v1')
const DB_VERSION = 1
const STORE_NAME = 'documents'

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
export const MAX_DOCUMENTS_PER_EXTENSION = 250

/**
 * Syntax-owned document envelope persisted in IndexedDB.
 * Survives extension disable, uninstall, reinstall, and failed updates.
 */
export interface DocumentEnvelope<T = unknown> {
  id: string
  type: string
  title: string
  schemaVersion: number
  createdByExtensionId: string
  revision: number
  createdAt: number
  updatedAt: number
  data: T
}

export interface CreateDocumentInput<T = unknown> {
  id?: string
  type: string
  title: string
  schemaVersion?: number
  createdByExtensionId: string
  data: T
}

export interface SaveDocumentInput<T = unknown> {
  id: string
  expectedRevision: number
  /** When set (all extension syscalls), enforces that caller owns the document. */
  ownerExtensionId?: string
  title?: string
  schemaVersion?: number
  data: T
}

export interface DocumentStore {
  get<T = unknown>(id: string, ownerExtensionId?: string): Promise<DocumentEnvelope<T> | null>
  list(type?: string, ownerExtensionId?: string): Promise<DocumentEnvelope[]>
  create<T = unknown>(input: CreateDocumentInput<T>): Promise<DocumentEnvelope<T>>
  save<T = unknown>(input: SaveDocumentInput<T>): Promise<DocumentEnvelope<T>>
  /** Explicit user-initiated delete only; never called on extension disable or uninstall. */
  delete(id: string): Promise<void>
  /** Host-only rename for user Library organization; increments revision safely. */
  rename(id: string, title: string): Promise<DocumentEnvelope>
  /** Host-only restore for Undo after an explicit user delete. Never exposed to extensions. */
  restore<T = unknown>(envelope: DocumentEnvelope<T>): Promise<DocumentEnvelope<T>>
}

function generateDocId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function cloneData<T>(value: T): T {
  if (value === undefined) return undefined as T
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

function assertDocumentPayloadWithinLimit(data: unknown): void {
  if (data === undefined || data === null) return
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(data)
  } catch (err) {
    throw new ExtensionError(
      'DATA_CLONE_ERROR',
      `Document data could not be serialized: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (serialized && serialized.length > MAX_DOCUMENT_BYTES) {
    throw new ExtensionError(
      'SYSCALL_DENIED',
      `Document exceeds maximum size (${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB).`,
    )
  }
}

function assertDocumentOwner(doc: DocumentEnvelope, ownerExtensionId?: string): void {
  if (ownerExtensionId && doc.createdByExtensionId !== ownerExtensionId) {
    throw new ExtensionError(
      'SYSCALL_DENIED',
      `Extension "${ownerExtensionId}" cannot access a document owned by "${doc.createdByExtensionId}".`,
      { extensionId: ownerExtensionId },
    )
  }
}

/**
 * In-memory DocumentStore for Node unit tests (identical revision conflict semantics).
 */
export function createMemoryDocumentStore(): DocumentStore {
  const docs = new Map<string, DocumentEnvelope>()

  return {
    async get<T = unknown>(id: string, ownerExtensionId?: string) {
      const found = docs.get(id)
      if (!found) return null
      assertDocumentOwner(found, ownerExtensionId)
      return cloneData(found) as DocumentEnvelope<T>
    },
    async list(type?: string, ownerExtensionId?: string) {
      let all = [...docs.values()]
      if (ownerExtensionId) {
        all = all.filter(d => d.createdByExtensionId === ownerExtensionId)
      }
      const filtered = type ? all.filter(d => d.type === type) : all
      return filtered.sort((a, b) => b.updatedAt - a.updatedAt).map(d => cloneData(d))
    },
    async create<T = unknown>(input: CreateDocumentInput<T>) {
      if (!input.type || !input.type.trim()) {
        throw new ExtensionError('SYSCALL_DENIED', 'Document type is required.')
      }
      assertDocumentPayloadWithinLimit(input.data)
      let ownedCount = 0
      for (const existing of docs.values()) {
        if (existing.createdByExtensionId === input.createdByExtensionId) ownedCount += 1
      }
      if (ownedCount >= MAX_DOCUMENTS_PER_EXTENSION) {
        throw new ExtensionError(
          'SYSCALL_DENIED',
          `Document limit reached (${MAX_DOCUMENTS_PER_EXTENSION} documents per extension).`,
          { extensionId: input.createdByExtensionId },
        )
      }
      const id = input.id?.trim() || generateDocId()
      if (docs.has(id)) {
        throw new ExtensionError('REVISION_CONFLICT', `Document "${id}" already exists.`)
      }
      const now = Date.now()
      const env: DocumentEnvelope<T> = {
        id,
        type: input.type.trim(),
        title: (typeof input.title === 'string' ? input.title.trim() : '') || 'Untitled',
        schemaVersion: input.schemaVersion ?? 1,
        createdByExtensionId: input.createdByExtensionId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        data: cloneData(input.data),
      }
      docs.set(id, env)
      return cloneData(env)
    },
    async save<T = unknown>(input: SaveDocumentInput<T>) {
      assertDocumentPayloadWithinLimit(input.data)
      const existing = docs.get(input.id)
      if (!existing) {
        throw new ExtensionError('REVISION_CONFLICT', `Document "${input.id}" does not exist.`)
      }
      assertDocumentOwner(existing, input.ownerExtensionId)
      if (existing.revision !== input.expectedRevision) {
        throw new ExtensionError(
          'REVISION_CONFLICT',
          `Document "${existing.title}" was modified elsewhere (expected revision ${input.expectedRevision}, current is ${existing.revision}).`,
        )
      }
      const next: DocumentEnvelope<T> = {
        ...existing,
        title: input.title !== undefined ? input.title.trim() || existing.title : existing.title,
        schemaVersion: input.schemaVersion ?? existing.schemaVersion,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
        data: cloneData(input.data),
      }
      docs.set(input.id, next)
      return cloneData(next)
    },
    async delete(id: string) {
      docs.delete(id)
    },
    async rename(id: string, rawTitle: string) {
      const existing = docs.get(id)
      if (!existing) {
        throw new ExtensionError('REVISION_CONFLICT', `Document "${id}" does not exist.`)
      }
      const cleanTitle = rawTitle.trim().slice(0, 160)
      if (!cleanTitle) {
        throw new ExtensionError('SYSCALL_DENIED', 'Document title cannot be empty.')
      }
      const next: DocumentEnvelope = {
        ...existing,
        title: cleanTitle,
        revision: existing.revision + 1,
        updatedAt: Date.now(),
      }
      docs.set(id, next)
      return cloneData(next)
    },

    async restore<T = unknown>(envelope: DocumentEnvelope<T>) {
      const cloned = cloneData(envelope)
      docs.set(cloned.id, cloned)
      return cloneData(cloned)
    },
  }
}

function openDocumentsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('type', 'type', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'))
  })
}

export function createIndexedDbDocumentStore(): DocumentStore {
  if (typeof indexedDB === 'undefined') {
    return createMemoryDocumentStore()
  }

  let dbPromise: Promise<IDBDatabase> | null = null
  const getDb = () => {
    if (!dbPromise) {
      dbPromise = openDocumentsDb()
        .then(db => {
          db.onversionchange = () => {
            db.close()
            dbPromise = null
          }
          db.onclose = () => {
            dbPromise = null
          }
          return db
        })
        .catch(err => {
          dbPromise = null
          throw err
        })
    }
    return dbPromise
  }

  return {
    async get<T = unknown>(id: string, ownerExtensionId?: string) {
      const db = await getDb()
      const found = await new Promise<DocumentEnvelope<T> | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(id)
        req.onsuccess = () => resolve((req.result as DocumentEnvelope<T> | undefined) ?? null)
        req.onerror = () => reject(req.error ?? new Error('Read failed'))
      })
      if (!found) return null
      assertDocumentOwner(found, ownerExtensionId)
      return found
    },

    async list(type?: string, ownerExtensionId?: string) {
      const db = await getDb()
      return await new Promise<DocumentEnvelope[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = type ? store.index('type').getAll(type) : store.getAll()
        req.onsuccess = () => {
          let rows = (req.result as DocumentEnvelope[] | undefined) ?? []
          if (ownerExtensionId) {
            rows = rows.filter(d => d.createdByExtensionId === ownerExtensionId)
          }
          resolve(rows.sort((a, b) => b.updatedAt - a.updatedAt))
        }
        req.onerror = () => reject(req.error ?? new Error('List failed'))
      })
    },

    async create<T = unknown>(input: CreateDocumentInput<T>) {
      if (!input.type || !input.type.trim()) {
        throw new ExtensionError('SYSCALL_DENIED', 'Document type is required.')
      }
      assertDocumentPayloadWithinLimit(input.data)
      const db = await getDb()
      const id = input.id?.trim() || generateDocId()
      const now = Date.now()
      const env: DocumentEnvelope<T> = {
        id,
        type: input.type.trim(),
        title: (typeof input.title === 'string' ? input.title.trim() : '') || 'Untitled',
        schemaVersion: input.schemaVersion ?? 1,
        createdByExtensionId: input.createdByExtensionId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        data: cloneData(input.data),
      }
      return await new Promise<DocumentEnvelope<T>>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        let settled = false
        let reqErr: Error | null = null
        const fail = (err: Error) => {
          if (settled) return
          settled = true
          reject(err)
        }
        const ok = (val: DocumentEnvelope<T>) => {
          if (settled) return
          settled = true
          resolve(val)
        }
        const allReq = store.getAll()
        allReq.onsuccess = () => {
          const rows = (allReq.result as DocumentEnvelope[] | undefined) ?? []
          const ownedCount = rows.filter(
            r => r.createdByExtensionId === input.createdByExtensionId,
          ).length
          if (ownedCount >= MAX_DOCUMENTS_PER_EXTENSION) {
            reqErr = new ExtensionError(
              'SYSCALL_DENIED',
              `Document limit reached (${MAX_DOCUMENTS_PER_EXTENSION} documents per extension).`,
              { extensionId: input.createdByExtensionId },
            )
            tx.abort()
            return
          }
          const req = store.add(env)
          req.onerror = () => {
            reqErr =
              req.error?.name === 'ConstraintError'
                ? new ExtensionError('REVISION_CONFLICT', `Document "${id}" already exists.`)
                : (req.error ?? new Error('Create failed'))
            fail(reqErr)
          }
        }
        allReq.onerror = () => {
          reqErr = allReq.error ?? new Error('Quota check failed')
          fail(reqErr)
        }
        tx.onabort = () => fail(reqErr ?? tx.error ?? new Error('Create aborted'))
        tx.onerror = () => fail(reqErr ?? tx.error ?? new Error('Create transaction failed'))
        tx.oncomplete = () => ok(cloneData(env))
      })
    },

    async save<T = unknown>(input: SaveDocumentInput<T>) {
      assertDocumentPayloadWithinLimit(input.data)
      const db = await getDb()
      return await new Promise<DocumentEnvelope<T>>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const getReq = store.get(input.id)
        let saved: DocumentEnvelope<T> | null = null
        let conflictErr: ExtensionError | null = null
        let settled = false
        const fail = (err: Error) => {
          if (settled) return
          settled = true
          reject(err)
        }
        const ok = (val: DocumentEnvelope<T>) => {
          if (settled) return
          settled = true
          resolve(val)
        }

        getReq.onsuccess = () => {
          const existing = getReq.result as DocumentEnvelope<T> | undefined
          if (!existing) {
            conflictErr = new ExtensionError(
              'REVISION_CONFLICT',
              `Document "${input.id}" does not exist.`,
            )
            tx.abort()
            return
          }
          if (
            input.ownerExtensionId &&
            existing.createdByExtensionId !== input.ownerExtensionId
          ) {
            conflictErr = new ExtensionError(
              'SYSCALL_DENIED',
              `Extension "${input.ownerExtensionId}" cannot access a document owned by "${existing.createdByExtensionId}".`,
              { extensionId: input.ownerExtensionId },
            )
            tx.abort()
            return
          }
          if (existing.revision !== input.expectedRevision) {
            conflictErr = new ExtensionError(
              'REVISION_CONFLICT',
              `Document "${existing.title}" was modified elsewhere (expected revision ${input.expectedRevision}, current is ${existing.revision}).`,
            )
            tx.abort()
            return
          }
          saved = {
            ...existing,
            title:
              typeof input.title === 'string' ? input.title.trim() || existing.title : existing.title,
            schemaVersion: input.schemaVersion ?? existing.schemaVersion,
            revision: existing.revision + 1,
            updatedAt: Date.now(),
            data: cloneData(input.data),
          }
          store.put(saved)
        }
        getReq.onerror = () => {
          fail(getReq.error ?? new Error('Read before save failed'))
        }
        tx.onabort = () => {
          fail(conflictErr ?? tx.error ?? new Error('Save aborted'))
        }
        tx.onerror = () => {
          fail(conflictErr ?? tx.error ?? new Error('Save transaction failed'))
        }
        tx.oncomplete = () => {
          if (saved) ok(cloneData(saved))
          else fail(new Error('Save completed without result'))
        }
      })
    },

    async delete(id: string) {
      const db = await getDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        let settled = false
        const fail = (err: Error) => {
          if (settled) return
          settled = true
          reject(err)
        }
        tx.objectStore(STORE_NAME).delete(id)
        tx.oncomplete = () => {
          if (settled) return
          settled = true
          resolve()
        }
        tx.onabort = () => fail(tx.error ?? new Error('Delete aborted'))
        tx.onerror = () => fail(tx.error ?? new Error('Delete failed'))
      })
    },

    async rename(id: string, rawTitle: string) {
      const cleanTitle = rawTitle.trim().slice(0, 160)
      if (!cleanTitle) {
        throw new ExtensionError('SYSCALL_DENIED', 'Document title cannot be empty.')
      }
      const db = await getDb()
      return await new Promise<DocumentEnvelope>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const getReq = store.get(id)
        let renamed: DocumentEnvelope | null = null
        let reqErr: Error | null = null
        let settled = false
        const fail = (err: Error) => {
          if (settled) return
          settled = true
          reject(err)
        }
        const ok = (val: DocumentEnvelope) => {
          if (settled) return
          settled = true
          resolve(val)
        }
        getReq.onsuccess = () => {
          const existing = getReq.result as DocumentEnvelope | undefined
          if (!existing) {
            reqErr = new ExtensionError('REVISION_CONFLICT', `Document "${id}" does not exist.`)
            tx.abort()
            return
          }
          renamed = {
            ...existing,
            title: cleanTitle,
            revision: existing.revision + 1,
            updatedAt: Date.now(),
          }
          store.put(renamed)
        }
        getReq.onerror = () => fail(getReq.error ?? new Error('Read before rename failed'))
        tx.onabort = () => fail(reqErr ?? tx.error ?? new Error('Rename aborted'))
        tx.onerror = () => fail(reqErr ?? tx.error ?? new Error('Rename failed'))
        tx.oncomplete = () => {
          if (renamed) ok(cloneData(renamed))
          else fail(new Error('Rename completed without result'))
        }
      })
    },

    async restore<T = unknown>(envelope: DocumentEnvelope<T>) {
      const db = await getDb()
      const cloned = cloneData(envelope)
      return await new Promise<DocumentEnvelope<T>>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        let settled = false
        const fail = (err: Error) => {
          if (settled) return
          settled = true
          reject(err)
        }
        tx.objectStore(STORE_NAME).put(cloned)
        tx.oncomplete = () => {
          if (settled) return
          settled = true
          resolve(cloneData(cloned))
        }
        tx.onabort = () => fail(tx.error ?? new Error('Restore aborted'))
        tx.onerror = () => fail(tx.error ?? new Error('Restore failed'))
      })
    },
  }
}

export const documentStore: DocumentStore = createIndexedDbDocumentStore()

const importedDocumentSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  type: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  schemaVersion: z.number().int().min(1).default(1),
  createdByExtensionId: z.string().trim().min(3).max(64),
  data: z.unknown(),
})

export function parseImportedDocumentJson(rawText: string): CreateDocumentInput {
  if (rawText.length > MAX_DOCUMENT_BYTES + 4096) {
    throw new ExtensionError(
      'SYSCALL_DENIED',
      `Document file exceeds maximum size (${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB).`,
    )
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawText)
  } catch {
    throw new ExtensionError('MANIFEST_INVALID', 'File is not valid JSON.')
  }
  const check = importedDocumentSchema.safeParse(parsedJson)
  if (!check.success) {
    throw new ExtensionError(
      'MANIFEST_INVALID',
      'File does not look like a Syntax document backup (.syntaxdoc.json).',
    )
  }
  assertDocumentPayloadWithinLimit(check.data.data)
  return {
    type: check.data.type,
    title: check.data.title,
    schemaVersion: check.data.schemaVersion,
    createdByExtensionId: check.data.createdByExtensionId,
    data: check.data.data,
  }
}

export function exportDocumentFilename(doc: Pick<DocumentEnvelope, 'id' | 'title'>): string {
  const slug = doc.title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `${slug || doc.id}.syntaxdoc.json`
}

const DOCUMENTS_CHANNEL_NAME = channelStateKey('syntax-documents-v1')
let docsChannel: BroadcastChannel | null = null

function getDocumentsChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!docsChannel) {
    try {
      docsChannel = new BroadcastChannel(DOCUMENTS_CHANNEL_NAME)
    } catch {
      return null
    }
  }
  return docsChannel
}

/** Notifies both the current tab and any other open Syntax tabs that documents changed. */
export function notifyDocumentsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('syntax:documents-changed'))
  }
  try {
    getDocumentsChannel()?.postMessage({ type: 'changed', ts: Date.now() })
  } catch {
    // ignore BroadcastChannel failures
  }
}

export function subscribeDocumentsChanged(callback: () => void): () => void {
  if (typeof window !== 'undefined') {
    window.addEventListener('syntax:documents-changed', callback)
  }
  const channel = getDocumentsChannel()
  const onMessage = () => callback()
  channel?.addEventListener('message', onMessage)
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('syntax:documents-changed', callback)
    }
    channel?.removeEventListener('message', onMessage)
  }
}
