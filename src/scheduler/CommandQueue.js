const withTimeout = require('./withTimeout')

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

class CommandQueue {
  constructor(options = {}) {
    this.cancelActiveWork = options.cancelActiveWork || (async () => {})
    this.notify = options.notify || (() => {})
    this.onStart = options.onStart || (() => {})
    this.onFinish = options.onFinish || (() => {})
    this.onError = options.onError || (() => {})
    this.repeatDelayMs = options.repeatDelayMs || 1000
    this.maxSegments = options.maxSegments || 20
    this.activeRun = null
    this.sequence = 0
  }

  async cancel(reason = 'cancelled', alwaysCleanup = false) {
    const run = this.activeRun

    if (run && !run.controller.signal.aborted) {
      run.controller.abort(new Error(reason))
    }

    if (run || alwaysCleanup) {
      await this.cancelActiveWork(reason)
    }

    return Boolean(run)
  }

  async stop(reason = 'stopped by player') {
    this.sequence += 1
    return this.cancel(reason, true)
  }

  async run(fullText, context, matchStep) {
    const runNumber = ++this.sequence
    await this.cancel('replaced by a newer command')

    // A third command may have arrived while cancellation was settling.
    if (runNumber !== this.sequence) {
      return false
    }

    const controller = new AbortController()
    const run = { controller, runNumber }
    this.activeRun = run

    try {
      let commandText = fullText.trim()
      let repeatForever = false

      if (/^repeat$/i.test(commandText)) {
        repeatForever = true
        commandText = ''
      } else if (/\s+(?:then\s+)?repeat\s*$/i.test(commandText)) {
        repeatForever = true
        commandText = commandText
          .replace(/\s+(?:then\s+)?repeat\s*$/i, '')
          .trim()
      }

      const segments = commandText
        .split(/\s+then\s+/i)
        .map((segment) => segment.trim())
        .filter(Boolean)

      if (segments.length === 0) {
        this.notify(repeatForever ? 'Nothing to repeat.' : 'Tell me what to do.')
        return false
      }

      if (segments.length > this.maxSegments) {
        this.notify(`A queue can contain at most ${this.maxSegments} commands.`)
        return false
      }

      const steps = []

      for (const segment of segments) {
        const match = matchStep(segment)

        if (!match) {
          this.notify(`I don't know how to "${segment}", skipping.`)
          continue
        }

        steps.push({ ...match, label: segment })
      }

      if (steps.length === 0) {
        return false
      }

      let iteration = 0

      do {
        iteration += 1

        if (repeatForever) {
          console.log(`[queue] starting iteration ${iteration}`)
        }

        for (const step of steps) {
          if (controller.signal.aborted) {
            return false
          }

          this.onStart(step.label)

          try {
            await withTimeout(
              Promise.resolve().then(() => step.handler(
                step.args,
                { ...context, signal: controller.signal }
              )),
              step.timeoutMs,
              step.label,
              {
                onTimeout: async (error) => {
                  controller.abort(error)
                  await this.cancelActiveWork('action timed out')
                }
              }
            )

            if (controller.signal.aborted) {
              return false
            }

            this.onFinish(step.label)
          } catch (error) {
            const timedOut = error && error.code === 'ACTION_TIMEOUT'

            if (controller.signal.aborted && !timedOut) {
              return false
            }

            this.onError(step.label, error, timedOut)

            if (timedOut || controller.signal.aborted) {
              return false
            }
          }

          // Always yield to Mineflayer and incoming chat between steps.
          const continued = await wait(0, controller.signal)
          if (!continued) return false
        }

        if (repeatForever) {
          const continued = await wait(
            this.repeatDelayMs,
            controller.signal
          )
          if (!continued) return false
        }
      } while (repeatForever && !controller.signal.aborted)

      return true
    } finally {
      if (this.activeRun === run) {
        this.activeRun = null
      }
    }
  }
}

module.exports = CommandQueue
