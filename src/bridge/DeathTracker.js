const fs = require('node:fs/promises')
const path = require('node:path')
const goTo = require('../movement/goTo')

function dimensionOf(bot) {
  return bot.game && typeof bot.game.dimension === 'string'
    ? bot.game.dimension
    : null
}

class DeathTracker {
  constructor(bot, options = {}) {
    this.bot = bot
    this.filePath = options.filePath ||
      process.env.EARL_DEATHS_FILE ||
      path.join(process.cwd(), 'data', 'deaths.json')
    this.maxEntries = options.maxEntries || 20
    this.entries = []
    this.loaded = false
    this.started = false
    this.onDeath = this.onDeath.bind(this)
  }

  async load() {
    if (this.loaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      this.entries = Array.isArray(parsed.deaths)
        ? parsed.deaths.slice(-this.maxEntries)
        : []
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load death history: ${error.message}`)
      }
    }
    this.loaded = true
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, `${JSON.stringify({
      version: 1,
      deaths: this.entries
    }, null, 2)}\n`, 'utf8')
  }

  start() {
    if (this.started) return
    this.started = true
    this.bot.on('death', this.onDeath)
  }

  stop() {
    if (!this.started) return
    this.bot.removeListener('death', this.onDeath)
    this.started = false
  }

  async onDeath() {
    try {
      await this.record()
    } catch (error) {
      console.error(`Could not record Earl's death: ${error.message}`)
    }
  }

  async record() {
    await this.load()
    const position = this.bot.entity && this.bot.entity.position
    if (!position) throw new Error('Death position is unavailable.')

    const previous = this.entries.length > 0
      ? this.entries[this.entries.length - 1]
      : null
    const entry = {
      id: (previous ? previous.id : 0) + 1,
      time: new Date().toISOString(),
      dimension: dimensionOf(this.bot),
      position: {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z)
      },
      inventory: this.bot.inventory
        ? this.bot.inventory.items().map((item) => ({
          name: item.name,
          count: item.count
        }))
        : []
    }

    this.entries.push(entry)
    this.entries = this.entries.slice(-this.maxEntries)
    await this.save()
    console.log(
      `Recorded Earl death at ${entry.position.x}, ${entry.position.y}, ${entry.position.z}.`
    )
    return { ...entry }
  }

  async list() {
    await this.load()
    return this.entries.map((entry) => ({
      ...entry,
      position: { ...entry.position },
      inventory: [...entry.inventory]
    }))
  }

  async latest() {
    const entries = await this.list()
    return entries.length > 0 ? entries[entries.length - 1] : null
  }

  async returnToLatest(options = {}) {
    const latest = await this.latest()
    if (!latest) throw new Error('No death location has been recorded.')

    const currentDimension = dimensionOf(this.bot)
    if (
      latest.dimension &&
      currentDimension &&
      latest.dimension !== currentDimension
    ) {
      throw new Error(
        `The last death was in ${latest.dimension}, not ${currentDimension}.`
      )
    }

    const travel = options.travel || goTo
    await travel(
      this.bot,
      latest.position.x,
      latest.position.y,
      latest.position.z,
      { tolerance: 2, signal: options.signal }
    )
    return latest
  }
}

module.exports = DeathTracker
