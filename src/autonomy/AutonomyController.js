const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_DRIVES = Object.freeze({
  survival: 1,
  safety: 0.9,
  food_security: 0.85,
  resource_security: 0.7,
  home_quality: 0.65,
  curiosity: 0.45,
  exploration: 0.4,
  organization: 0.5,
  social_interaction: 0.35,
  comfort: 0.3
})

const FOOD_NAMES = new Set([
  'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
  'cooked_mutton', 'cooked_rabbit', 'baked_potato', 'carrot',
  'golden_carrot', 'apple', 'melon_slice', 'pumpkin_pie', 'cookie'
])

const BLOCKED_OUTCOME_PATTERN = /\b(?:blocked|cannot|can't|could not|no path|sealed|stuck|unreachable|requires? (?:the )?player)\b/i
const BLOCKED_INTENTION_COOLDOWN_MS = 30 * 60 * 1000

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function saveJson(filePath, value) {
  if (!filePath) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
}

function inventoryCount(items, predicate) {
  return items.reduce((total, item) => (
    predicate(item.name) ? total + item.count : total
  ), 0)
}

function isNight(timeOfDay) {
  return Number.isFinite(timeOfDay) && timeOfDay >= 12542 && timeOfDay < 23460
}

class AutonomyController {
  constructor(options = {}) {
    if (!options.bot) throw new Error('AutonomyController requires a bot.')
    if (!options.chatBridge) {
      throw new Error('AutonomyController requires a chat bridge.')
    }

    this.bot = options.bot
    this.chatBridge = options.chatBridge
    this.taskManager = options.taskManager || null
    this.skillRegistry = options.skillRegistry || null
    this.combatReflex = options.combatReflex || null
    this.cancelActiveWork = options.cancelActiveWork || (async () => {})
    this.isBusy = options.isBusy || (() => false)
    this.filePath = options.filePath || null
    this.intervalMs = Math.max(Number(options.intervalMs) || 30000, 1000)
    this.minimumIntentIntervalMs = Math.max(
      Number(options.minimumIntentIntervalMs) || 120000,
      0
    )
    this.now = options.now || Date.now
    this.random = options.random || Math.random
    this.observeOverride = options.observe || null
    this.drives = { ...DEFAULT_DRIVES, ...(options.drives || {}) }
    this.timer = null
    this.runningTick = null
    this.urgentReason = null
    this.state = {
      version: 1,
      enabled: Boolean(options.enabled),
      nextIntentionId: 1,
      current: null,
      history: [],
      memories: [],
      lastEvaluationAt: null,
      lastIntentionAt: null
    }
    this.load()
  }

  load() {
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.state = {
        ...this.state,
        ...parsed,
        enabled: this.state.enabled,
        current: parsed.current || null,
        history: Array.isArray(parsed.history) ? parsed.history.slice(-50) : [],
        memories: Array.isArray(parsed.memories) ? parsed.memories.slice(-50) : []
      }

      if (this.state.current && this.state.current.status === 'active') {
        this.state.current.status = 'paused'
        this.state.current.pauseReason = 'Earl restarted during this intention.'
        this.state.current.updatedAt = new Date(this.now()).toISOString()
      }
      this.save()
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load autonomy state: ${error.message}`)
      }
    }
  }

  save() {
    saveJson(this.filePath, this.state)
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.error(`Autonomy evaluation failed: ${error.message}`)
      })
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()

    void this.tick().catch((error) => {
      console.error(`Initial autonomy evaluation failed: ${error.message}`)
    })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  setEnabled(enabled) {
    this.state.enabled = Boolean(enabled)
    this.save()
    if (this.state.enabled) void this.tick()
    return this.getStatus()
  }

  getStatus() {
    return {
      enabled: this.state.enabled,
      urgentReason: this.urgentReason,
      current: clone(this.state.current),
      recentHistory: clone(this.state.history.slice(-10).reverse()),
      drives: clone(this.drives),
      intervalMs: this.intervalMs
    }
  }

  hasPlayerWork() {
    return this.chatBridge.getCommands({ status: 'all', limit: 100 })
      .some((entry) => (
        entry.source !== 'autonomy' &&
        ['pending', 'claimed'].includes(entry.status)
      ))
  }

  commandForCurrent() {
    const current = this.state.current
    return current && current.commandId
      ? this.chatBridge.findCommand(current.commandId)
      : null
  }

  async observe() {
    if (this.observeOverride) return this.observeOverride()

    const inventory = this.bot.inventory && this.bot.inventory.items
      ? this.bot.inventory.items().map((item) => ({
          name: item.name,
          count: item.count
        }))
      : []
    const players = Object.entries(this.bot.players || {})
      .filter(([name, value]) => name !== this.bot.username && value && value.entity)
      .map(([name]) => name)
    let locations = []
    let farm = null

    if (this.skillRegistry && this.skillRegistry.locationStore) {
      locations = await this.skillRegistry.locationStore.list()
    }

    if (this.skillRegistry && this.skillRegistry.get('get_farm_status')) {
      const farmResult = await this.skillRegistry.execute(
        'get_farm_status',
        { crop: 'all' },
        { requestedBy: 'autonomy_observer' }
      )
      if (farmResult.ok) farm = farmResult.data
    }

    const home = locations.find((place) => place.name === 'home') || null
    const position = this.bot.entity && this.bot.entity.position
    const homeDistance = home && position && position.distanceTo
      ? position.distanceTo(home)
      : null

    const combat = this.combatReflex && this.combatReflex.getStatus
      ? this.combatReflex.getStatus()
      : { fighting: null }

    return {
      connected: Boolean(this.bot.entity),
      health: Number(this.bot.health),
      food: Number(this.bot.food),
      timeOfDay: this.bot.time ? Number(this.bot.time.timeOfDay) : null,
      inventory,
      inventorySlots: inventory.length,
      players,
      locations,
      home: home ? { ...home, distance: homeDistance } : null,
      farm,
      fighting: combat.fighting,
      physicalTask: this.taskManager ? this.taskManager.getCurrent() : null,
      commandQueueBusy: Boolean(this.isBusy())
    }
  }

  urgentFrom(snapshot) {
    if (snapshot.fighting) return `fighting ${snapshot.fighting}`
    if (Number.isFinite(snapshot.health) && snapshot.health <= 6) {
      return 'critically low health'
    }
    return null
  }

  generateCandidates(snapshot) {
    const items = snapshot.inventory || []
    const foodItems = inventoryCount(items, (name) => FOOD_NAMES.has(name))
    const wood = inventoryCount(items, (name) => (
      name.endsWith('_log') || name.endsWith('_planks')
    ))
    const stone = inventoryCount(items, (name) => (
      ['cobblestone', 'cobbled_deepslate', 'stone'].includes(name)
    ))
    const hasHome = (snapshot.locations || []).some((place) => place.name === 'home')
    const farmCrops = snapshot.farm && Array.isArray(snapshot.farm.crops)
      ? snapshot.farm.crops
      : []
    const matureCrops = farmCrops.reduce(
      (total, crop) => total + (Number(crop.mature) || 0),
      0
    )
    const emptyFarmland = snapshot.farm
      ? Number(snapshot.farm.emptyFarmland) || 0
      : 0
    const candidates = []

    const add = (drive, baseScore, title, reason, guidance) => {
      const recentlyBlocked = this.state.history.some((entry) => (
        entry.title === title &&
        entry.blocked === true &&
        this.now() - Date.parse(entry.updatedAt) < BLOCKED_INTENTION_COOLDOWN_MS
      ))
      if (recentlyBlocked) return
      const weight = Number(this.drives[drive]) || 0
      const recentCount = this.state.history.slice(-6)
        .filter((entry) => entry.drive === drive).length
      const noveltyPenalty = recentCount * 8
      candidates.push({
        drive,
        title,
        reason,
        guidance,
        score: Math.max(0, baseScore * weight - noveltyPenalty + this.random() * 4)
      })
    }

    if (snapshot.food <= 12 || foodItems < 3) {
      add(
        'food_security', 88,
        'secure a reliable food supply',
        `Food level is ${snapshot.food}; carried food supply is ${foodItems}.`,
        'Inspect nearby food and the farm, then obtain, prepare, or grow food safely.'
      )
    }

    if (!hasHome) {
      add(
        'safety', 76,
        'establish a safe home base',
        'No saved home location exists.',
        'Choose a safe site, establish a usable shelter, and mark it as home.'
      )
    } else if (isNight(snapshot.timeOfDay)) {
      add(
        'safety', 66,
        'return home and make the night safe',
        'It is night and a home location is available.',
        'Inspect immediate danger, return home if practical, and sleep or secure the shelter.'
      )
    }

    if (wood < 8 || stone < 12) {
      add(
        'resource_security', 58,
        'strengthen basic resource reserves',
        `Basic supplies are low: wood ${wood}, stone ${stone}.`,
        'Decide which versatile material is most useful, then gather a modest amount.'
      )
    }

    if (snapshot.inventorySlots >= 28) {
      add(
        'organization', 62,
        'organize carried supplies',
        `${snapshot.inventorySlots} inventory slots are occupied.`,
        'Return useful materials to storage, keep survival essentials, and remove clutter.'
      )
    }

    if (hasHome) {
      add(
        'home_quality', 46,
        'inspect and improve my home',
        'Basic survival permits a useful home improvement.',
        'Inspect the existing home first, choose one practical improvement, acquire what it needs, and verify the result.'
      )
      if (matureCrops > 0) {
        add(
          'food_security', 68,
          'harvest and maintain the ready crops',
          `${matureCrops} mature crops are visible nearby.`,
          'Verify farm status, harvest every ready crop, replant it, and collect the drops.'
        )
      } else if (emptyFarmland > 0) {
        add(
          'food_security', 54,
          'repair gaps in the nearby farm',
          `${emptyFarmland} empty farmland blocks are visible nearby.`,
          'Inspect the empty spaces and available seeds before planting or repairing the field.'
        )
      } else {
        add(
          'food_security', 42,
          'inspect and improve the farm',
          'A maintained food source improves long-term independence.',
          'Inspect farm condition before choosing whether to harvest, replant, expand, or repair it.'
        )
      }
    }

    if ((snapshot.players || []).length > 0) {
      add(
        'social_interaction', 34,
        'visit and check in with the player',
        `${snapshot.players.join(', ')} is nearby in the world.`,
        'Visit without interrupting their work, observe what they are doing, and offer brief useful help.'
      )
    }

    add(
      'exploration', 32,
      'explore the nearby area with a purpose',
      'No urgent need prevents a short survey.',
      'Explore conservatively, notice useful landmarks or resources, and preserve a safe route home.'
    )
    add(
      'curiosity', 29,
      'inspect something interesting nearby',
      'Curiosity can reveal useful opportunities.',
      'Observe the area, choose one unfamiliar or useful feature, and investigate without unnecessary risk.'
    )
    add(
      'comfort', 24,
      'start a small optional project',
      'Immediate survival needs appear manageable.',
      'Choose a modest decorative, path, lighting, or convenience project and leave the area usable.'
    )
    add(
      'comfort', 18,
      'rest and quietly observe',
      'Nothing requires constant activity.',
      'Pause in a safe place, observe the surroundings, and avoid inventing busywork.'
    )

    return candidates.sort((first, second) => second.score - first.score)
  }

  selectIntention(snapshot) {
    return this.generateCandidates(snapshot)[0] || null
  }

  intentionPrompt(intention) {
    return [
      `Autonomous intention #${intention.id}: ${intention.title}.`,
      `Reason: ${intention.reason}`,
      intention.guidance,
      'This is an intention, not a fixed command list. Observe current conditions, form a short adaptable plan, use only Earl validated skills, verify meaningful results, and stop if danger or a player request takes priority.'
    ].join(' ')
  }

  startIntention(candidate) {
    const timestamp = new Date(this.now()).toISOString()
    const intention = {
      id: this.state.nextIntentionId++,
      drive: candidate.drive,
      title: candidate.title,
      reason: candidate.reason,
      guidance: candidate.guidance,
      score: Number(candidate.score.toFixed(2)),
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      commandId: null,
      interruptions: [],
      outcome: null
    }
    const command = this.chatBridge.enqueue(
      'earl',
      this.intentionPrompt(intention),
      {
        source: 'autonomy',
        priority: 10,
        intentionId: intention.id
      }
    )
    intention.commandId = command.id
    this.state.current = intention
    this.state.lastIntentionAt = timestamp
    this.save()
    console.log(`[autonomy] selected: ${intention.title} (${intention.drive})`)
    return clone(intention)
  }

  finishCurrent(status, outcome) {
    const current = this.state.current
    if (!current) return null
    current.status = status
    current.outcome = clone(outcome)
    const outcomeText = typeof outcome === 'string'
      ? outcome
      : JSON.stringify(outcome || '')
    current.blocked = BLOCKED_OUTCOME_PATTERN.test(outcomeText)
    current.updatedAt = new Date(this.now()).toISOString()
    this.state.history.push(clone(current))
    this.state.history = this.state.history.slice(-50)
    this.state.memories.push({
      time: current.updatedAt,
      drive: current.drive,
      intention: current.title,
      outcome: status
    })
    this.state.memories = this.state.memories.slice(-50)
    this.state.current = null
    this.save()
    return clone(current)
  }

  syncCurrentCommand() {
    const command = this.commandForCurrent()
    if (!command || !this.state.current) return

    if (command.status === 'completed') {
      this.finishCurrent('completed', command.result)
    } else if (command.status === 'failed') {
      this.finishCurrent('failed', command.result)
    }
  }

  async interrupt(reason = 'urgent interruption') {
    this.urgentReason = reason
    const current = this.state.current
    if (current && current.status === 'active') {
      current.status = 'paused'
      current.pauseReason = reason
      current.updatedAt = new Date(this.now()).toISOString()
      current.interruptions.push({ time: current.updatedAt, reason })
      const command = this.commandForCurrent()
      if (command && ['pending', 'claimed'].includes(command.status)) {
        this.chatBridge.pauseCommand(command.id, reason)
      }
      this.save()
    }

    if (this.taskManager && this.taskManager.getCurrent()) {
      await this.taskManager.cancelCurrent(reason)
    }
    await this.cancelActiveWork(reason)
    return this.getStatus()
  }

  async resume(reason = 'interruption cleared') {
    this.urgentReason = null
    const current = this.state.current
    if (!current || current.status !== 'paused') return this.getStatus()
    if (this.hasPlayerWork() || this.isBusy()) return this.getStatus()

    const command = this.commandForCurrent()
    if (command && command.status === 'paused') {
      this.chatBridge.resumeCommand(command.id, {
        prefix: `Resume autonomous intention #${current.id} after interruption. `
      })
    } else if (!command || ['completed', 'failed'].includes(command.status)) {
      const queued = this.chatBridge.enqueue(
        'earl',
        `Resume autonomous intention #${current.id}: ${current.title}. ${current.guidance}`,
        { source: 'autonomy', priority: 10, intentionId: current.id }
      )
      current.commandId = queued.id
    }

    current.status = 'active'
    current.pauseReason = null
    current.updatedAt = new Date(this.now()).toISOString()
    current.resumeReason = reason
    this.save()
    return this.getStatus()
  }

  async tick() {
    if (this.runningTick) return this.runningTick
    this.runningTick = this.runTick().finally(() => {
      this.runningTick = null
    })
    return this.runningTick
  }

  async runTick() {
    if (!this.state.enabled) return this.getStatus()

    this.syncCurrentCommand()
    const snapshot = await this.observe()
    this.state.lastEvaluationAt = new Date(this.now()).toISOString()
    const urgent = this.urgentFrom(snapshot)

    if (urgent) {
      await this.interrupt(urgent)
      return this.getStatus()
    }

    if (this.state.current && this.state.current.status === 'paused') {
      await this.resume('conditions are safe again')
      return this.getStatus()
    }

    if (
      !snapshot.connected ||
      this.state.current ||
      this.hasPlayerWork() ||
      snapshot.physicalTask ||
      snapshot.commandQueueBusy ||
      this.isBusy()
    ) {
      this.save()
      return this.getStatus()
    }

    const lastAt = this.state.lastIntentionAt
      ? Date.parse(this.state.lastIntentionAt)
      : 0
    if (this.now() - lastAt < this.minimumIntentIntervalMs) {
      this.save()
      return this.getStatus()
    }

    const candidate = this.selectIntention(snapshot)
    if (candidate) this.startIntention(candidate)
    else this.save()
    return this.getStatus()
  }
}

module.exports = AutonomyController
module.exports.DEFAULT_DRIVES = DEFAULT_DRIVES
module.exports.isNight = isNight
module.exports.BLOCKED_OUTCOME_PATTERN = BLOCKED_OUTCOME_PATTERN
module.exports.BLOCKED_INTENTION_COOLDOWN_MS = BLOCKED_INTENTION_COOLDOWN_MS
