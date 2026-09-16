const fs = require('node:fs')
const path = require('node:path')
const eatNow = require('./eatNow')
const fleeFromHostiles = require('../movement/fleeFromHostiles')

function saveJson(filePath, value) {
  if (!filePath) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
}

class SurvivalRecovery {
  constructor(bot, options = {}) {
    this.bot = bot
    this.actionCoordinator = options.actionCoordinator || null
    this.combatReflex = options.combatReflex || null
    this.autonomyController = options.autonomyController || null
    this.filePath = options.filePath || null
    this.now = options.now || Date.now
    this.criticalHealth = options.criticalHealth || 6
    this.deathWindowMs = options.deathWindowMs || 10 * 60 * 1000
    this.deathThreshold = options.deathThreshold || 3
    this.recoveryCooldownMs = options.recoveryCooldownMs || 5 * 60 * 1000
    this.state = {
      recoveryMode: false,
      recoveryUntil: 0,
      recentDeaths: [],
      lastReason: null,
      criticalResponses: 0
    }
    this.responding = false
    this.lastCriticalResponseAt = Number.NEGATIVE_INFINITY
    this.criticalResponseCooldownMs = options.criticalResponseCooldownMs || 30000
    this.started = false
    this.load()
    this.onDeath = this.onDeath.bind(this)
    this.onHealth = this.onHealth.bind(this)
    this.onSpawn = this.onSpawn.bind(this)
  }

  load() {
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.state = { ...this.state, ...parsed }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load survival recovery state: ${error.message}`)
      }
    }
    this.pruneDeaths()
  }

  save() {
    saveJson(this.filePath, this.state)
  }

  pruneDeaths() {
    const cutoff = this.now() - this.deathWindowMs
    this.state.recentDeaths = this.state.recentDeaths
      .map(Number)
      .filter((time) => time >= cutoff)
    if (this.state.recoveryMode && this.state.recoveryUntil <= this.now()) {
      this.state.recoveryMode = false
      this.state.lastReason = 'Recovery cooldown completed.'
    }
  }

  start() {
    if (this.started) return
    this.started = true
    this.bot.on('death', this.onDeath)
    this.bot.on('health', this.onHealth)
    this.bot.on('spawn', this.onSpawn)
  }

  stop() {
    if (!this.started) return
    this.bot.removeListener('death', this.onDeath)
    this.bot.removeListener('health', this.onHealth)
    this.bot.removeListener('spawn', this.onSpawn)
    this.started = false
  }

  async enterRecovery(reason) {
    this.state.recoveryMode = true
    this.state.recoveryUntil = this.now() + this.recoveryCooldownMs
    this.state.lastReason = reason
    this.save()
    if (this.combatReflex) this.combatReflex.suppress(this.recoveryCooldownMs)
    if (this.actionCoordinator) {
      await this.actionCoordinator.cancelAll(reason)
    }
    if (this.autonomyController) {
      await this.autonomyController.interrupt(reason)
    }
  }

  async onDeath() {
    this.state.recentDeaths.push(this.now())
    this.pruneDeaths()
    if (this.state.recentDeaths.length >= this.deathThreshold) {
      await this.enterRecovery(
        `${this.state.recentDeaths.length} deaths within ten minutes; unsafe work paused.`
      )
    } else {
      this.save()
    }
  }

  onSpawn() {
    this.pruneDeaths()
    if (this.state.recoveryMode && this.combatReflex) {
      this.combatReflex.suppress(
        Math.max(1000, this.state.recoveryUntil - this.now())
      )
    }
  }

  onHealth() {
    if (!Number.isFinite(this.bot.health) || this.bot.health > this.criticalHealth) return
    if (
      this.responding ||
      !this.bot.entity ||
      this.now() - this.lastCriticalResponseAt < this.criticalResponseCooldownMs
    ) return
    void this.respondToCriticalHealth().catch((error) => {
      console.error(`[survival] critical response failed: ${error.message}`)
    })
  }

  async respondToCriticalHealth() {
    this.responding = true
    this.lastCriticalResponseAt = this.now()
    this.state.criticalResponses += 1
    this.state.lastReason = `Critical health: ${this.bot.health}`
    this.save()
    if (this.combatReflex) this.combatReflex.suppress(30000)

    const response = async (signal) => {
      const evidence = {}
      try {
        evidence.flee = await fleeFromHostiles(this.bot, {
          signal,
          distance: 16,
          searchRange: 24
        })
      } catch (error) {
        evidence.fleeError = error.message
      }
      if (this.bot.food < 20) {
        try {
          evidence.eat = await eatNow(this.bot, { signal })
        } catch (error) {
          evidence.eatError = error.message
        }
      }
      return evidence
    }

    try {
      if (this.actionCoordinator) {
        await this.actionCoordinator.run('critical_survival', response, {
          priority: 1200,
          preempt: true,
          requestedBy: 'survival_recovery'
        })
      } else {
        await response(new AbortController().signal)
      }
    } finally {
      this.responding = false
    }
  }

  clear() {
    this.state.recoveryMode = false
    this.state.recoveryUntil = 0
    this.state.recentDeaths = []
    this.state.lastReason = 'Recovery mode cleared by player.'
    this.save()
    return this.getStatus()
  }

  getStatus() {
    this.pruneDeaths()
    return {
      ...this.state,
      recentDeathCount: this.state.recentDeaths.length,
      responding: this.responding,
      persistent: Boolean(this.filePath)
    }
  }
}

module.exports = SurvivalRecovery
