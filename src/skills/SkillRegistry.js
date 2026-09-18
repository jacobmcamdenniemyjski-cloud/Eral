const Ajv = require('ajv')
const withTimeout = require('../scheduler/withTimeout')

function formatValidationErrors(errors = []) {
  return errors.map((error) => {
    const location = error.instancePath || 'input'
    return `${location} ${error.message}`
  }).join('; ')
}

class SkillRegistry {
  constructor(options = {}) {
    this.ajv = options.ajv || new Ajv({
      allErrors: true,
      strict: true
    })
    this.skills = new Map()
    this.actionCoordinator = options.actionCoordinator || null
    this.executionGuards = []
  }

  addExecutionGuard(guard) {
    if (typeof guard !== 'function') {
      throw new Error('Skill execution guard must be a function.')
    }
    this.executionGuards.push(guard)
    return this
  }

  register(definition) {
    const {
      name,
      description,
      inputSchema,
      execute,
      timeoutMs = 30000,
      safety = 'normal'
    } = definition

    if (!/^[a-z][a-z0-9_]*$/.test(name || '')) {
      throw new Error(`Invalid skill name: ${name}`)
    }

    if (this.skills.has(name)) {
      throw new Error(`Skill already registered: ${name}`)
    }

    if (typeof execute !== 'function') {
      throw new Error(`Skill ${name} requires an execute function.`)
    }

    const validate = this.ajv.compile(inputSchema)
    this.skills.set(name, {
      name,
      description,
      inputSchema,
      execute,
      timeoutMs,
      safety,
      validate
    })

    return this
  }

  get(name) {
    return this.skills.get(name) || null
  }

  list() {
    return Array.from(this.skills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      inputSchema: skill.inputSchema,
      timeoutMs: skill.timeoutMs,
      safety: skill.safety
    }))
  }

  getToolDefinitions() {
    return this.list().map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema
    }))
  }

  validateInput(name, input = {}) {
    const skill = this.skills.get(name)
    if (!skill) {
      return {
        ok: false,
        skill: name,
        error: {
          code: 'UNKNOWN_SKILL',
          message: `Unknown skill: ${name}`
        }
      }
    }

    if (!skill.validate(input)) {
      const details = (skill.validate.errors || []).map((error) => ({
        instancePath: error.instancePath,
        keyword: error.keyword,
        message: error.message,
        params: error.params
      }))
      return {
        ok: false,
        skill: name,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: formatValidationErrors(details),
          details
        }
      }
    }
    return { ok: true, skill: name }
  }

  async execute(name, input = {}, context = {}) {
    const validation = this.validateInput(name, input)
    if (!validation.ok) return validation
    const skill = this.skills.get(name)

    for (const guard of this.executionGuards) {
      const decision = await guard({ name, skill, input, context })
      if (decision === false || (decision && decision.allowed === false)) {
        return {
          ok: false,
          skill: name,
          error: {
            code: decision && decision.code
              ? decision.code
              : 'SKILL_BLOCKED',
            message: decision && decision.message
              ? decision.message
              : `${name} is currently blocked by Earl safety policy.`
          }
        }
      }
    }

    const controller = new AbortController()
    const externalSignal = context.signal
    const onExternalAbort = () => {
      controller.abort(
        externalSignal.reason || new Error(`${name} was cancelled.`)
      )
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, {
          once: true
        })
      }
    }

    try {
      if (controller.signal.aborted) throw controller.signal.reason

      const executeSkill = (signal, action = {}) => {
        if (signal.aborted) throw signal.reason
        return skill.execute(input, {
          ...context,
          ...action,
          signal
        })
      }
      const coordinated = Boolean(
        this.actionCoordinator &&
        !['read_only', 'control'].includes(skill.safety)
      )
      const operation = coordinated
        ? this.actionCoordinator.run(
            name,
            executeSkill,
            {
              signal: controller.signal,
              requestedBy: context.requestedBy || 'unknown',
              priority: skill.safety === 'combat' ? 500 : 100,
              preempt: skill.safety === 'combat'
            }
          )
        : Promise.resolve().then(() => executeSkill(controller.signal))

      const data = await withTimeout(
        operation,
        skill.timeoutMs,
        name,
        {
          onTimeout: async (error) => {
            controller.abort(error)
            if (typeof context.cancelActiveWork === 'function') {
              await context.cancelActiveWork('skill timed out')
            }
          }
        }
      )

      if (controller.signal.aborted) throw controller.signal.reason

      if (data === false) {
        return {
          ok: false,
          skill: name,
          error: {
            code: 'SKILL_FAILED',
            message: `${name} could not complete its task.`
          }
        }
      }

      if (
        data &&
        typeof data === 'object' &&
        ['failed', 'partial'].includes(data.status)
      ) {
        return {
          ok: false,
          skill: name,
          data,
          error: {
            code: data.status === 'partial' ? 'SKILL_PARTIAL' : 'SKILL_FAILED',
            message: data.message || `${name} reported ${data.status}.`
          }
        }
      }

      return { ok: true, skill: name, data: data ?? null }
    } catch (error) {
      const timedOut = error && error.code === 'ACTION_TIMEOUT'
      const cancelled = controller.signal.aborted && !timedOut

      return {
        ok: false,
        skill: name,
        error: {
          code: timedOut
            ? 'SKILL_TIMEOUT'
            : cancelled
              ? 'SKILL_CANCELLED'
              : 'SKILL_ERROR',
          message: error.message
        }
      }
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort)
      }
    }
  }
}

module.exports = SkillRegistry
