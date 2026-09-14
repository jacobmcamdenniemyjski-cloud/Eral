const fs = require('node:fs/promises')
const path = require('node:path')

function normalizeLocationName(value) {
  const name = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  if (!name) throw new Error('Location name is required.')
  if (name.length > 48) throw new Error('Location names must be 48 characters or fewer.')
  if (!/^[a-z0-9 _-]+$/.test(name)) {
    throw new Error('Location names may use letters, numbers, spaces, dashes, and underscores.')
  }

  return name
}

function validCoordinate(value) {
  return Number.isFinite(value)
}

function validateLocation(location) {
  if (
    !location ||
    !validCoordinate(location.x) ||
    !validCoordinate(location.y) ||
    !validCoordinate(location.z)
  ) {
    throw new Error('Saved location has invalid coordinates.')
  }

  return {
    name: normalizeLocationName(location.name),
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
    dimension: typeof location.dimension === 'string'
      ? location.dimension
      : null,
    updatedAt: typeof location.updatedAt === 'string'
      ? location.updatedAt
      : new Date().toISOString()
  }
}

class LocationStore {
  constructor(options = {}) {
    this.filePath = options.filePath ||
      process.env.EARL_LOCATIONS_FILE ||
      path.join(process.cwd(), 'data', 'locations.json')
    this.locations = new Map()
    this.loaded = false
    this.loadPromise = null
  }

  async load() {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8')
        const parsed = JSON.parse(raw)
        const entries = Array.isArray(parsed.locations)
          ? parsed.locations
          : []

        this.locations.clear()
        for (const entry of entries) {
          const location = validateLocation(entry)
          this.locations.set(location.name, location)
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new Error(
            `Could not load saved locations: ${error.message}`
          )
        }
      }

      this.loaded = true
    })()

    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const payload = {
      version: 1,
      locations: [...this.locations.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8'
    )
  }

  async set(name, coordinates) {
    await this.load()
    const location = validateLocation({
      name,
      ...coordinates,
      updatedAt: new Date().toISOString()
    })

    this.locations.set(location.name, location)
    await this.save()
    return { ...location }
  }

  async get(name) {
    await this.load()
    const location = this.locations.get(normalizeLocationName(name))
    return location ? { ...location } : null
  }

  async list() {
    await this.load()
    return [...this.locations.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((location) => ({ ...location }))
  }

  async remove(name) {
    await this.load()
    const removed = this.locations.delete(normalizeLocationName(name))
    if (removed) await this.save()
    return removed
  }
}

module.exports = LocationStore
module.exports.normalizeLocationName = normalizeLocationName
