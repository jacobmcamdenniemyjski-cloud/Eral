const fs = require('node:fs')
const path = require('node:path')

const PHASES = Object.freeze([
  'planned',
  'site_ready',
  'floor',
  'walls',
  'roof',
  'door_and_windows',
  'furnishing',
  'inspection',
  'door_test',
  'completed'
])

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

function geometryOf(definition) {
  return {
    origin: clone(definition.origin),
    width: Number(definition.width),
    depth: Number(definition.depth),
    interiorHeight: Number(definition.interiorHeight),
    doorPosition: clone(definition.doorPosition)
  }
}

function sameGeometry(left, right) {
  return JSON.stringify(geometryOf(left)) === JSON.stringify(geometryOf(right))
}

function requiredCells(definition, phase) {
  const cells = []
  const origin = definition.origin
  const maxX = origin.x + definition.width - 1
  const maxZ = origin.z + definition.depth - 1
  if (phase === 'floor' || phase === 'roof') {
    const y = phase === 'floor'
      ? origin.y
      : origin.y + definition.interiorHeight + 1
    for (let x = origin.x; x <= maxX; x += 1) {
      for (let z = origin.z; z <= maxZ; z += 1) cells.push(`${x},${y},${z}`)
    }
  }
  return cells
}

class BuildPlanStore {
  constructor(options = {}) {
    this.filePath = options.filePath || null
    this.maxPlans = options.maxPlans || 50
    this.plans = []
    this.nextId = 1
    this.recoveredPlans = 0
    this.load()
  }

  load() {
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.plans = (Array.isArray(parsed.plans) ? parsed.plans : [])
        .slice(-this.maxPlans)
      this.nextId = Math.max(
        Number(parsed.nextId) || 1,
        ...this.plans.map((plan) => Number(plan.id) + 1)
      )
      const recoveredAt = new Date().toISOString()
      for (const plan of this.plans) {
        if (plan.status !== 'active') continue
        plan.status = 'paused'
        plan.pauseReason = 'Earl restarted during this build plan.'
        plan.updatedAt = recoveredAt
        plan.recoveryCount = (Number(plan.recoveryCount) || 0) + 1
        this.recoveredPlans += 1
      }
      if (this.recoveredPlans > 0) this.save()
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load build plans: ${error.message}`)
      }
    }
  }

  save() {
    saveJson(this.filePath, {
      version: 1,
      nextId: this.nextId,
      plans: this.plans
    })
  }

  publicPlan(plan) {
    return plan ? clone(plan) : null
  }

  create(definition, metadata = {}) {
    const timestamp = new Date().toISOString()
    const plan = {
      id: this.nextId++,
      requestId: metadata.requestId === undefined
        ? null
        : Number(metadata.requestId),
      intentionId: metadata.intentionId === undefined
        ? null
        : Number(metadata.intentionId),
      status: 'active',
      phase: 'planned',
      definition: geometryOf(definition),
      material: metadata.material || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      recoveryCount: 0,
      pauseReason: null,
      phaseHistory: [{ phase: 'planned', time: timestamp, note: null }],
      confirmedPositions: [],
      failures: [],
      outcome: null
    }
    this.plans.push(plan)
    this.plans = this.plans.slice(-this.maxPlans)
    this.save()
    return this.publicPlan(plan)
  }

  find(id) {
    return this.plans.find((plan) => plan.id === Number(id)) || null
  }

  get(id) {
    return this.publicPlan(this.find(id))
  }

  list(options = {}) {
    const status = options.status || 'all'
    return this.plans
      .filter((plan) => status === 'all' || plan.status === status)
      .slice()
      .reverse()
      .map((plan) => this.publicPlan(plan))
  }

  findProtectingPlan(position, options = {}) {
    if (!position) return null
    const margin = Math.max(0, Number(options.margin) || 0)
    const x = Number(position.x)
    const y = Number(position.y)
    const z = Number(position.z)

    const plan = this.plans.find((candidate) => {
      if (candidate.status === 'failed') return false
      const definition = candidate.definition || {}
      const origin = definition.origin || {}
      const roofY = Number(origin.y) + Number(definition.interiorHeight || 0) + 1
      return x >= Number(origin.x) - margin &&
        x < Number(origin.x) + Number(definition.width || 0) + margin &&
        z >= Number(origin.z) - margin &&
        z < Number(origin.z) + Number(definition.depth || 0) + margin &&
        y >= Number(origin.y) - margin &&
        y <= roofY + margin
    })

    return this.publicPlan(plan)
  }

  require(id) {
    const plan = this.find(id)
    if (!plan) throw new Error(`Unknown build plan id: ${id}`)
    return plan
  }

  assertGeometry(id, definition) {
    const plan = this.require(id)
    if (!sameGeometry(plan.definition, definition)) {
      const error = new Error(
        `Build plan ${id} geometry is locked; reuse its original origin and elevation.`
      )
      error.code = 'BUILD_PLAN_DRIFT'
      throw error
    }
    return this.publicPlan(plan)
  }

  advance(id, phase, note = null) {
    const plan = this.require(id)
    const currentIndex = PHASES.indexOf(plan.phase)
    const nextIndex = PHASES.indexOf(phase)
    if (nextIndex < 0) throw new Error(`Unknown build phase: ${phase}`)
    if (nextIndex < currentIndex) {
      throw new Error(
        `Build plan ${id} cannot move backward from ${plan.phase} to ${phase}.`
      )
    }
    if (nextIndex > currentIndex + 1) {
      const error = new Error(
        `Build plan ${id} must verify the next phase after ${plan.phase} before advancing to ${phase}.`
      )
      error.code = 'BUILD_PHASE_SKIPPED'
      throw error
    }
    const required = requiredCells(plan.definition, phase)
    if (required.length > 0) {
      const confirmed = new Set(
        plan.confirmedPositions
          .filter((entry) => entry.phase === phase)
          .map((entry) => entry.key)
      )
      const missing = required.filter((cell) => !confirmed.has(cell))
      if (missing.length > 0) {
        const error = new Error(
          `Build plan ${id} cannot advance to ${phase}; ` +
          `${missing.length} required cell(s) are not server-confirmed.`
        )
        error.code = 'BUILD_PHASE_INCOMPLETE'
        error.missing = missing.slice(0, 20)
        throw error
      }
    }
    if (phase === 'walls') {
      const perimeter = (2 * plan.definition.width) +
        (2 * plan.definition.depth) - 4
      const fullWallCells = (perimeter * plan.definition.interiorHeight) - 2
      const minimumWallCells = Math.max(1, fullWallCells - 4)
      const confirmedWallCells = new Set(
        plan.confirmedPositions
          .filter((entry) => entry.phase === 'walls')
          .map((entry) => entry.key)
      ).size
      if (confirmedWallCells < minimumWallCells) {
        const error = new Error(
          `Build plan ${id} cannot advance to walls; ` +
          `${confirmedWallCells}/${minimumWallCells} required wall cells are server-confirmed ` +
          '(up to four window openings are allowed).'
        )
        error.code = 'BUILD_PHASE_INCOMPLETE'
        throw error
      }
    }
    const timestamp = new Date().toISOString()
    plan.phase = phase
    plan.status = phase === 'completed' ? 'completed' : 'active'
    plan.pauseReason = null
    plan.updatedAt = timestamp
    plan.phaseHistory.push({ phase, time: timestamp, note: note || null })
    this.save()
    return this.publicPlan(plan)
  }

  pause(id, reason) {
    const plan = this.require(id)
    if (['completed', 'failed'].includes(plan.status)) return this.publicPlan(plan)
    plan.status = 'paused'
    plan.pauseReason = String(reason || 'paused')
    plan.updatedAt = new Date().toISOString()
    this.save()
    return this.publicPlan(plan)
  }

  resume(id, reason = 'Plan reviewed and explicitly resumed.') {
    const plan = this.require(id)
    if (plan.status === 'completed') return this.publicPlan(plan)
    if (plan.status === 'failed') {
      throw new Error(`Build plan ${id} is failed and cannot be resumed.`)
    }
    plan.status = 'active'
    plan.pauseReason = null
    plan.updatedAt = new Date().toISOString()
    plan.phaseHistory.push({
      phase: plan.phase,
      time: plan.updatedAt,
      note: String(reason)
    })
    this.save()
    return this.publicPlan(plan)
  }

  abort(id, reason = 'Build plan aborted by the player.') {
    const plan = this.require(id)
    if (plan.status === 'completed') {
      throw new Error(`Completed build plan ${id} cannot be aborted.`)
    }
    const timestamp = new Date().toISOString()
    plan.status = 'failed'
    plan.pauseReason = null
    plan.updatedAt = timestamp
    plan.outcome = { reason: String(reason), aborted: true }
    plan.failures.push({ time: timestamp, ...plan.outcome })
    this.save()
    return this.publicPlan(plan)
  }

  recordPosition(id, position, details = {}) {
    const plan = this.require(id)
    const key = `${position.x},${position.y},${position.z}`
    const entry = { key, position: clone(position), ...clone(details) }
    const index = plan.confirmedPositions.findIndex((value) => value.key === key)
    if (index >= 0) plan.confirmedPositions[index] = entry
    else plan.confirmedPositions.push(entry)
    plan.updatedAt = new Date().toISOString()
    this.save()
    return this.publicPlan(plan)
  }

  fail(id, reason, details = null) {
    const plan = this.require(id)
    const timestamp = new Date().toISOString()
    plan.status = 'failed'
    plan.updatedAt = timestamp
    plan.outcome = { reason: String(reason || 'failed'), details: clone(details) }
    plan.failures.push({ time: timestamp, ...plan.outcome })
    this.save()
    return this.publicPlan(plan)
  }

  complete(id, outcome = null) {
    const plan = this.require(id)
    plan.phase = 'completed'
    plan.status = 'completed'
    plan.outcome = clone(outcome)
    plan.updatedAt = new Date().toISOString()
    plan.phaseHistory.push({
      phase: 'completed',
      time: plan.updatedAt,
      note: outcome && outcome.summary ? outcome.summary : null
    })
    this.save()
    return this.publicPlan(plan)
  }

  summary() {
    return {
      active: this.plans.filter((plan) => plan.status === 'active').length,
      paused: this.plans.filter((plan) => plan.status === 'paused').length,
      recoveredPlans: this.recoveredPlans,
      persistent: Boolean(this.filePath)
    }
  }
}

module.exports = BuildPlanStore
module.exports.PHASES = PHASES
module.exports.sameGeometry = sameGeometry
module.exports.requiredCells = requiredCells
