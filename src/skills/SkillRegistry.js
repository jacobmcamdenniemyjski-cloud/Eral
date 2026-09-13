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

  async execute(name, input = {}, context = {}) {
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

      const data = await withTimeout(
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason

          return skill.execute(input, {
            ...context,
            signal: controller.signal
          })
        }),
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
