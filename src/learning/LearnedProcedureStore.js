const fs = require('node:fs')
const path = require('node:path')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function saveJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, filePath)
}

function procedureError(message, code = 'INVALID_PROCEDURE') {
  const error = new Error(message)
  error.code = code
  return error
}

class LearnedProcedureStore {
  constructor(options) {
    if (!options || !options.skillRegistry) {
      throw new Error('LearnedProcedureStore requires a skill registry.')
    }
    this.skillRegistry = options.skillRegistry
    this.filePath = options.filePath || null
    this.maxProcedures = options.maxProcedures || 100
    this.maxSteps = options.maxSteps || 32
    this.procedures = []
    this.nextId = 1
    this.load()
  }

  load() {
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.procedures = Array.isArray(parsed.procedures)
        ? parsed.procedures.slice(-this.maxProcedures)
        : []
      this.nextId = Math.max(
        Number(parsed.nextId) || 1,
        ...this.procedures.map((entry) => Number(entry.id) + 1)
      )
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load learned procedures: ${error.message}`)
      }
    }
  }

  save() {
    if (!this.filePath) return
    saveJson(this.filePath, {
      version: 1,
      nextId: this.nextId,
      procedures: this.procedures
    })
  }

  validateDefinition(definition) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw procedureError('Procedure definition must be an object.')
    }

    const allowedKeys = new Set(['name', 'description', 'steps', 'createdBy'])
    const extraKeys = Object.keys(definition).filter((key) => !allowedKeys.has(key))
    if (extraKeys.length > 0) {
      throw procedureError(
        `Unsupported procedure fields: ${extraKeys.join(', ')}.`
      )
    }

    const name = String(definition.name || '').trim()
    if (!/^[a-z][a-z0-9_-]{1,47}$/.test(name)) {
      throw procedureError(
        'Procedure name must be 2-48 lowercase letters, numbers, underscores, or hyphens.'
      )
    }

    const description = String(definition.description || '').trim()
    if (description.length > 240) {
      throw procedureError('Procedure description must be 240 characters or fewer.')
    }

    if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
      throw procedureError('Procedure requires at least one skill step.')
    }
    if (definition.steps.length > this.maxSteps) {
      throw procedureError(`Procedure exceeds the ${this.maxSteps}-step limit.`)
    }

    const steps = definition.steps.map((step, index) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        throw procedureError(`Step ${index + 1} must be an object.`)
      }
      const keys = Object.keys(step)
      if (keys.some((key) => !['skill', 'input'].includes(key))) {
        throw procedureError(
          `Step ${index + 1} may contain only skill and input.`
        )
      }

      const skill = String(step.skill || '')
      const input = step.input === undefined ? {} : step.input
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw procedureError(`Step ${index + 1} input must be an object.`)
      }

      const validation = this.skillRegistry.validateInput(skill, input)
      if (!validation.ok) {
        throw procedureError(
          `Step ${index + 1} is invalid: ${validation.error.message}`
        )
      }
      return { skill, input: clone(input) }
    })

    return {
      name,
      description,
      createdBy: String(definition.createdBy || 'hermes').slice(0, 80),
      steps
    }
  }

  stage(definition) {
    const validated = this.validateDefinition(definition)
    const duplicate = this.procedures.find((entry) => (
      entry.name === validated.name && entry.status !== 'rejected'
    ))
    if (duplicate) {
      throw procedureError(
        `Procedure ${validated.name} already exists as #${duplicate.id}.`,
        'PROCEDURE_EXISTS'
      )
    }

    const entry = {
      id: this.nextId++,
      ...validated,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null
    }
    this.procedures.push(entry)
    this.procedures = this.procedures.slice(-this.maxProcedures)
    this.save()
    return clone(entry)
  }

  find(id) {
    return this.procedures.find((entry) => entry.id === Number(id)) || null
  }

  list(options = {}) {
    const status = options.status || 'all'
    return this.procedures
      .filter((entry) => status === 'all' || entry.status === status)
      .map(clone)
  }

  definitionOf(entry) {
    return {
      name: entry.name,
      description: entry.description,
      steps: entry.steps,
      createdBy: entry.createdBy
    }
  }

  approve(id, reviewedBy = 'player') {
    const entry = this.find(id)
    if (!entry) throw procedureError(`Unknown procedure id: ${id}`, 'NOT_FOUND')
    if (entry.status !== 'pending') {
      throw procedureError(
        `Procedure ${id} is already ${entry.status}.`,
        'PROCEDURE_REVIEWED'
      )
    }

    // Revalidate against the current registry before approval. A changed skill
    // schema can never silently turn an old proposal into a different action.
    this.validateDefinition(this.definitionOf(entry))
    entry.status = 'approved'
    entry.reviewedAt = new Date().toISOString()
    entry.reviewedBy = String(reviewedBy || 'player').slice(0, 80)
    this.save()
    return clone(entry)
  }

  reject(id, reason = 'rejected by player', reviewedBy = 'player') {
    const entry = this.find(id)
    if (!entry) throw procedureError(`Unknown procedure id: ${id}`, 'NOT_FOUND')
    if (entry.status !== 'pending') {
      throw procedureError(
        `Procedure ${id} is already ${entry.status}.`,
        'PROCEDURE_REVIEWED'
      )
    }

    entry.status = 'rejected'
    entry.reviewedAt = new Date().toISOString()
    entry.reviewedBy = String(reviewedBy || 'player').slice(0, 80)
    entry.rejectionReason = String(reason || 'rejected by player').slice(0, 240)
    this.save()
    return clone(entry)
  }

  async execute(id, context = {}) {
    const entry = this.find(id)
    if (!entry) throw procedureError(`Unknown procedure id: ${id}`, 'NOT_FOUND')
    if (entry.status !== 'approved') {
      throw procedureError(
        `Procedure ${id} requires player approval before execution.`,
        'PROCEDURE_NOT_APPROVED'
      )
    }

    const validated = this.validateDefinition(this.definitionOf(entry))
    const results = []
    for (const step of validated.steps) {
      if (context.signal && context.signal.aborted) throw context.signal.reason
      const result = await this.skillRegistry.execute(
        step.skill,
        step.input,
        context
      )
      results.push(result)
      if (!result.ok) {
        return {
          ok: false,
          procedure: entry.name,
          failedStep: results.length,
          results
        }
      }
    }

    return {
      ok: true,
      procedure: entry.name,
      completedSteps: results.length,
      results
    }
  }
}

module.exports = LearnedProcedureStore
module.exports.saveJson = saveJson
