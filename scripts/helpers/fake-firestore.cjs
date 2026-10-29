// An in-memory stand-in for the Firestore `db` the backend imports from
// backend/functions/src/admin.ts, so tests can run the real services
// (entries, expenses, P&L, tax estimate) without Firebase. Covers only what
// those services use: docs, collections, where/limit/count, getAll and
// transactions. Usage:
//   const { installFakeFirestore } = require("./helpers/fake-firestore.cjs")
//   const db = installFakeFirestore()   // before requiring any backend file
//   db.reset()                           // between scenarios
const path = require("node:path")
const Module = require("node:module")

function clone(value) {
  if (value === undefined) return undefined
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function deepMerge(target, source) {
  const out = { ...(target ?? {}) }
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value
  }
  return out
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (!isPlainObject(value)) return value
  const out = {}
  for (const [key, inner] of Object.entries(value)) {
    if (inner !== undefined) out[key] = stripUndefined(inner)
  }
  return out
}

function getField(data, field) {
  return field.split(".").reduce((value, key) => (value == null ? undefined : value[key]), data)
}

const OPS = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  ">=": (a, b) => a != null && a >= b,
  "<=": (a, b) => a != null && a <= b,
  ">": (a, b) => a != null && a > b,
  "<": (a, b) => a != null && a < b,
  "array-contains": (a, b) => Array.isArray(a) && a.includes(b),
  in: (a, b) => Array.isArray(b) && b.includes(a),
}

let autoId = 0

function createFakeDb() {
  const store = new Map() // full doc path → data

  class DocSnap {
    constructor(ref, data) {
      this.ref = ref
      this.id = ref.id
      this.exists = data !== undefined
      this._data = data
    }
    data() {
      return clone(this._data)
    }
    get(field) {
      return getField(this._data, field)
    }
  }

  class DocRef {
    constructor(docPath) {
      this.path = docPath
      this.id = docPath.split("/").pop()
    }
    collection(name) {
      return new Query(`${this.path}/${name}`)
    }
    async get() {
      return new DocSnap(this, clone(store.get(this.path)))
    }
    async set(data, opts) {
      const value = stripUndefined(clone(data))
      store.set(this.path, opts?.merge ? deepMerge(store.get(this.path), value) : value)
    }
    async create(data) {
      if (store.has(this.path)) {
        const err = new Error(`ALREADY_EXISTS: ${this.path}`)
        err.code = 6
        throw err
      }
      await this.set(data)
    }
    async update(data) {
      if (!store.has(this.path)) {
        const err = new Error(`NOT_FOUND: ${this.path}`)
        err.code = 5
        throw err
      }
      store.set(this.path, deepMerge(store.get(this.path), stripUndefined(clone(data))))
    }
    async delete() {
      store.delete(this.path)
    }
  }

  class Query {
    constructor(colPath, filters = [], max = null) {
      this.path = colPath
      this._filters = filters
      this._limit = max
    }
    doc(id) {
      return new DocRef(`${this.path}/${id ?? `auto${++autoId}`}`)
    }
    where(field, op, value) {
      if (!OPS[op]) throw new Error(`fake-firestore: unsupported operator ${op}`)
      return new Query(this.path, [...this._filters, { field, op, value }], this._limit)
    }
    orderBy() {
      return this
    }
    limit(n) {
      return new Query(this.path, this._filters, n)
    }
    _matches() {
      const prefix = `${this.path}/`
      const docs = []
      for (const [docPath, data] of store) {
        if (!docPath.startsWith(prefix) || docPath.slice(prefix.length).includes("/")) continue
        if (this._filters.every(({ field, op, value }) => OPS[op](getField(data, field), value))) {
          docs.push(new DocSnap(new DocRef(docPath), clone(data)))
        }
      }
      docs.sort((a, b) => a.id.localeCompare(b.id))
      return this._limit == null ? docs : docs.slice(0, this._limit)
    }
    async get() {
      const docs = this._matches()
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) }
    }
    count() {
      return { get: async () => ({ data: () => ({ count: this._matches().length }) }) }
    }
  }

  const db = {
    collection: (colPath) => new Query(colPath),
    doc: (docPath) => new DocRef(docPath),
    getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get())),
    settings() {},
    batch() {
      const ops = []
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => {
          for (const op of ops) await op()
        },
      }
    },
    // Writes apply when the callback finishes, like a real transaction.
    async runTransaction(fn) {
      const ops = []
      const tx = {
        get: (refOrQuery) => refOrQuery.get(),
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        create: (ref, data) => ops.push(() => ref.create(data)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
      }
      const result = await fn(tx)
      for (const op of ops) await op()
      return result
    },
    // ---- test helpers ----
    reset: () => store.clear(),
    seed: (docPath, data) => store.set(docPath, stripUndefined(clone(data))),
    read: (docPath) => clone(store.get(docPath)),
    paths: (prefix = "") => [...store.keys()].filter((key) => key.startsWith(prefix)).sort(),
  }
  return db
}

// Puts the fake in place of backend/functions/src/admin.ts. Call before
// requiring any backend file.
function installFakeFirestore() {
  const db = createFakeDb()
  const adminPath = path.join(__dirname, "..", "..", "backend", "functions", "src", "admin.ts")
  const fakeModule = new Module(adminPath)
  fakeModule.filename = adminPath
  fakeModule.loaded = true
  fakeModule.exports = { db, auth: {}, storage: {}, messaging: {}, appCheck: {} }
  require.cache[adminPath] = fakeModule
  return db
}

module.exports = { installFakeFirestore }
