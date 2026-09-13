const attackNearestHostile = require('./attackNearestHostile')
const { HOSTILE_MOBS } = attackNearestHostile

const MODES = new Set(['passive', 'defensive', 'guard', 'aggressive'])
const PROVOKED_ONLY_MOBS = new Set(['enderman', 'zombified_piglin'])

const WEAPON_PRIORITY = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe',
  'golden_sword', 'wooden_sword', 'golden_axe', 'wooden_axe'
]

function distanceBetween(first, second) {
  if (!first || !second || typeof first.distanceTo !== 'function') {
    return Infinity
  }

  return first.distanceTo(second)
}

class CombatReflex {
  constructor(bot, scheduler, options = {}) {
    this.bot = bot
    this.scheduler = scheduler
    this.mode = options.mode || 'defensive'
    this.minimumHealth = options.minimumHealth || 8
    this.scanIntervalMs = options.scanIntervalMs === undefined
      ? 250
      : options.scanIntervalMs
    this.reengageCooldownMs = options.reengageCooldownMs === undefined
      ? 2000
      : options.reengageCooldownMs
    this.now = options.now || Date.now
    this.cancelForThreat = options.cancelForThreat || (async () => {})
    this.notify = options.notify || (() => {})
    this.ownerUsername = null
    this.scanTimer = null
    this.activeController = null
    this.activeTarget = null
    this.suppressedUntil = 0
    this.targetCooldowns = new Map()
    this.lastHealth = bot.health
    this.started = false

    this.onEntityHurt = this.onEntityHurt.bind(this)
    this.onHealth = this.onHealth.bind(this)
    this.onEnd = this.onEnd.bind(this)
  }

  start() {
    if (this.started) return
    this.started = true

    this.bot.on('entityHurt', this.onEntityHurt)
    this.bot.on('health', this.onHealth)
    this.bot.on('end', this.onEnd)

    if (this.scanIntervalMs > 0) {
      this.scanTimer = setInterval(() => {
        void this.scan().catch((error) => {
          console.error(`Combat reflex scan failed: ${error.message}`)
        })
      }, this.scanIntervalMs)

      if (typeof this.scanTimer.unref === 'function') {
        this.scanTimer.unref()
      }
    }
  }

  onEnd() {
    this.stop()
  }

  stop() {
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.scanTimer = null

    this.bot.removeListener('entityHurt', this.onEntityHurt)
    this.bot.removeListener('health', this.onHealth)
    this.bot.removeListener('end', this.onEnd)
    this.started = false
    this.cancelCurrentFight('combat reflex stopped')
    this.targetCooldowns.clear()
  }

  protect(username) {
    if (username) this.ownerUsername = username
  }

  setMode(mode, username) {
    const normalizedMode = String(mode || '').toLowerCase()
    if (!MODES.has(normalizedMode)) return false

    this.protect(username)
    this.mode = normalizedMode

    if (normalizedMode === 'passive') {
      this.cancelCurrentFight('combat mode changed to passive')
    } else {
      this.suppressedUntil = 0
    }

    return true
  }

  getStatus() {
    return {
      mode: this.mode,
      protecting: this.ownerUsername,
      fighting: this.activeTarget ? this.activeTarget.name : null,
      minimumHealth: this.minimumHealth
    }
  }

  suppress(durationMs = 10000) {
    this.suppressedUntil = this.now() + durationMs
    this.cancelCurrentFight('combat reflex temporarily suppressed')
  }

  cancelCurrentFight(reason) {
    if (this.activeController && !this.activeController.signal.aborted) {
      this.activeController.abort(new Error(reason))
    }

    if (this.bot.pvp && this.bot.pvp.target) {
      this.bot.pvp.forceStop()
    }
  }

  onEntityHurt(entity) {
    const owner = this.getOwnerEntity()
    if (entity !== this.bot.entity && entity !== owner) return

    void this.scan({
      reactiveOrigin: entity.position,
      allowProvokedOnly: true
    }).catch((error) => {
      console.error(`Combat reflex response failed: ${error.message}`)
    })
  }

  onHealth() {
    const health = this.bot.health

    if (
      Number.isFinite(health) &&
      Number.isFinite(this.lastHealth) &&
      health < this.lastHealth
    ) {
      this.onEntityHurt(this.bot.entity)
    }

    this.lastHealth = health

    if (health <= this.minimumHealth && this.activeTarget) {
      this.cancelCurrentFight('health is too low for reflex combat')
    }
  }

  getOwnerEntity() {
    return this.ownerUsername &&
      this.bot.players &&
      this.bot.players[this.ownerUsername]
      ? this.bot.players[this.ownerUsername].entity
      : null
  }

  getSearchOrigins(reactiveOrigin) {
    if (reactiveOrigin) return [reactiveOrigin]

    const origins = [this.bot.entity && this.bot.entity.position]
    const owner = this.getOwnerEntity()

    if (owner && owner.position) origins.push(owner.position)
    return origins.filter(Boolean)
  }

  getRadius(reactiveOrigin) {
    if (reactiveOrigin) return 10
    if (this.mode === 'defensive') return 4
    if (this.mode === 'guard') return 8
    if (this.mode === 'aggressive') return 16
    return 0
  }

  getTargetKey(entity) {
    return entity && entity.id !== undefined ? entity.id : entity
  }

  isCoolingDown(entity) {
    const key = this.getTargetKey(entity)
    const expiresAt = this.targetCooldowns.get(key)

    if (!expiresAt) return false
    if (expiresAt > this.now()) return true

    this.targetCooldowns.delete(key)
    return false
  }

  findThreat(options = {}) {
    const {
      reactiveOrigin = null,
      allowProvokedOnly = this.mode === 'aggressive'
    } = options
    const radius = this.getRadius(reactiveOrigin)
    const origins = this.getSearchOrigins(reactiveOrigin)

    return Object.values(this.bot.entities || {})
      .filter((entity) => {
        if (
          !entity ||
          !entity.position ||
          entity === this.bot.entity ||
          entity.type === 'player' ||
          !HOSTILE_MOBS.has(entity.name) ||
          this.isCoolingDown(entity)
        ) {
          return false
        }

        if (!allowProvokedOnly && PROVOKED_ONLY_MOBS.has(entity.name)) {
          return false
        }

        return origins.some((origin) => (
          distanceBetween(origin, entity.position) <= radius
        ))
      })
      .sort((first, second) => {
        const botPosition = this.bot.entity && this.bot.entity.position
        return distanceBetween(botPosition, first.position) -
          distanceBetween(botPosition, second.position)
      })[0] || null
  }

  async equipBestWeapon() {
    if (!this.bot.inventory || typeof this.bot.equip !== 'function') return

    const items = this.bot.inventory.items()
    const weapon = WEAPON_PRIORITY
      .map((name) => items.find((item) => item.name === name))
      .find(Boolean)

    if (weapon && (!this.bot.heldItem || this.bot.heldItem.name !== weapon.name)) {
      await this.bot.equip(weapon, 'hand')
    }
  }

  async scan(options = {}) {
    if (
      this.mode === 'passive' ||
      this.now() < this.suppressedUntil ||
      this.activeTarget ||
      (this.bot.pvp && this.bot.pvp.target) ||
      !this.bot.entity ||
      this.bot.health <= this.minimumHealth
    ) {
      return null
    }

    const threat = this.findThreat(options)
    if (!threat) return null

    return this.engage(threat)
  }

  async engage(threat) {
    if (this.activeTarget) return null
    this.activeTarget = threat

    try {
      await this.cancelForThreat(
        `interrupted by nearby ${threat.name}`
      )

      if (
        this.mode === 'passive' ||
        this.now() < this.suppressedUntil ||
        this.bot.health <= this.minimumHealth ||
        !Object.values(this.bot.entities || {}).includes(threat)
      ) {
        return null
      }

      await this.equipBestWeapon()

      const controller = new AbortController()
      this.activeController = controller
      this.scheduler.setTask({
        type: 'reflex-attack',
        target: threat.name,
        priority: 1000
      })

      console.log(`Earl's ${this.mode} reflex engaged ${threat.name}.`)
      this.notify(`Defending against ${threat.name}.`)

      return await attackNearestHostile(
        this.bot,
        threat.name,
        20,
        {
          signal: controller.signal,
          target: threat,
          announce: false
        }
      )
    } catch (error) {
      if (!this.activeController || !this.activeController.signal.aborted) {
        console.error(`Combat reflex failed: ${error.message}`)
      }
      return null
    } finally {
      this.targetCooldowns.set(
        this.getTargetKey(threat),
        this.now() + this.reengageCooldownMs
      )

      const currentTask = this.scheduler.getCurrentTask()
      if (currentTask && currentTask.type === 'reflex-attack') {
        this.scheduler.clearTask()
      }

      this.activeController = null
      this.activeTarget = null
    }
  }
}

module.exports = CombatReflex
module.exports.MODES = MODES
