const { EventEmitter } = require('node:events')

class ActionInterruptedError extends Error {
  constructor(message = 'Physical action was interrupted.') {
    super(message)
    this.name = 'ActionInterruptedError'
    this.code = 'ACTION_INTERRUPTED'
  }
}

function interruptionError(reason) {
  if (reason instanceof Error) {
    if (!reason.code) reason.code = 'ACTION_INTERRUPTED'
    return reason
  }
  return new ActionInterruptedError(String(reason || 'Physical action was interrupted.'))
}

class PhysicalActionCoordinator extends EventEmitter {
  constructor(options = {}) {
    super()
    this.cleanup = options.cleanup || (async () => {})
    this.prepare = options.prepare || (async () => {})
    this.now = options.now || Date.now
    this.current = null
    this.queue = []
    this.nextId = 1
    this.pumping = false
  }

  isBusy() {
    return Boolean(this.current)
  }

  getStatus() {
    return {
      current: this.current
        ? {
            id: this.current.id,
            name: this.current.name,
            priority: this.current.priority,
            requestedBy: this.current.requestedBy,
            startedAt: this.current.startedAt
          }
        : null,
      waiting: this.queue.map((entry) => ({
        id: entry.id,
        name: entry.name,
        priority: entry.priority,
        requestedBy: entry.requestedBy,
        queuedAt: entry.queuedAt
      }))
    }
  }

  run(name, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error('PhysicalActionCoordinator requires an action handler.')
    }

    const externalSignal = options.signal || null
    if (externalSignal && externalSignal.aborted) {
      return Promise.reject(interruptionError(externalSignal.reason))
    }

    const entry = {
      id: this.nextId++,
      name: String(name || 'physical_action'),
      handler,
      priority: Number(options.priority) || 100,
      requestedBy: options.requestedBy || 'unknown',
      preempt: Boolean(options.preempt),
      queuedAt: new Date(this.now()).toISOString(),
      startedAt: null,
      controller: null,
      resolve: null,
      reject: null,
      externalSignal,
      externalAbort: null,
      cleanupStarted: false
    }

    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve
      entry.reject = reject
    })

    if (
      entry.preempt &&
      this.current &&
      entry.priority > this.current.priority
    ) {
      this.queue.unshift(entry)
      void this.interruptCurrent(
        `${entry.name} preempted ${this.current.name}`
      )
    } else {
      this.queue.push(entry)
      this.queue.sort((left, right) => (
        right.priority - left.priority || left.id - right.id
      ))
    }

    if (externalSignal) {
      entry.externalAbort = () => {
        if (this.current === entry) {
          void this.interruptCurrent(externalSignal.reason || 'action cancelled')
          return
        }
        const index = this.queue.indexOf(entry)
        if (index >= 0) {
          this.queue.splice(index, 1)
          entry.reject(interruptionError(externalSignal.reason))
        }
      }
      externalSignal.addEventListener('abort', entry.externalAbort, {
        once: true
      })
    }

    this.pump()
    return promise
  }

  async cleanupEntry(entry, reason) {
    if (!entry || entry.cleanupStarted) return
    entry.cleanupStarted = true
    try {
      await this.cleanup(reason, entry)
    } catch (error) {
      console.error(`[action ${entry.id}] cleanup failed: ${error.message}`)
    }
  }

  async interruptCurrent(reason = 'physical action interrupted') {
    const entry = this.current
    if (!entry) return false
    const error = interruptionError(reason)

    if (entry.controller && !entry.controller.signal.aborted) {
      entry.controller.abort(error)
      this.emit('interrupted', {
        id: entry.id,
        name: entry.name,
        reason: error.message
      })
    }
    await this.cleanupEntry(entry, error.message)
    return true
  }

  async cancelAll(reason = 'all physical actions cancelled') {
    const error = interruptionError(reason)
    const queued = this.queue.splice(0)
    for (const entry of queued) {
      if (entry.externalSignal && entry.externalAbort) {
        entry.externalSignal.removeEventListener('abort', entry.externalAbort)
      }
      entry.reject(error)
    }
    const interrupted = await this.interruptCurrent(error)
    if (!interrupted) await this.cleanup(error.message, null)
    return { interrupted, queued: queued.length }
  }

  pump() {
    if (this.pumping || this.current || this.queue.length === 0) return
    this.pumping = true
    const entry = this.queue.shift()
    this.current = entry
    entry.controller = new AbortController()
    entry.startedAt = new Date(this.now()).toISOString()
    this.emit('started', this.getStatus().current)
    console.log(
      `[action ${entry.id}] started ${entry.name} requestedBy=${entry.requestedBy}`
    )

    void (async () => {
      let result
      let failure = null
      try {
        await this.prepare(`preparing ${entry.name}`, entry)
        if (entry.controller.signal.aborted) throw entry.controller.signal.reason
        result = await entry.handler(entry.controller.signal, {
          actionId: entry.id,
          actionName: entry.name
        })
        console.log(`[action ${entry.id}] completed ${entry.name}`)
      } catch (error) {
        failure = error
        const state = entry.controller.signal.aborted ? 'interrupted' : 'failed'
        console.log(`[action ${entry.id}] ${state} ${entry.name}: ${error.message}`)
      } finally {
        if (entry.externalSignal && entry.externalAbort) {
          entry.externalSignal.removeEventListener('abort', entry.externalAbort)
        }
        if (this.current === entry) this.current = null
        this.emit('finished', {
          id: entry.id,
          name: entry.name,
          interrupted: entry.controller.signal.aborted
        })
        if (!this.current && this.queue.length === 0) this.emit('idle')
        this.pumping = false
        this.pump()
      }

      if (failure) entry.reject(failure)
      else entry.resolve(result)
    })()
  }
}

module.exports = PhysicalActionCoordinator
module.exports.ActionInterruptedError = ActionInterruptedError
