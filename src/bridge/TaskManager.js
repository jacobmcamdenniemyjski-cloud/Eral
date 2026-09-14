class TaskManager {
  constructor(options) {
    this.skillRegistry = options.skillRegistry
    this.cancelActiveWork = options.cancelActiveWork || (async () => {})
    this.maxHistory = options.maxHistory || 50
    this.tasks = []
    this.current = null
    this.nextId = 1
  }

  publicTask(task) {
    if (!task) return null
    return {
      id: task.id,
      skill: task.skill,
      input: task.input,
      requestedBy: task.requestedBy,
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      result: task.result
    }
  }

  getCurrent() {
    return this.publicTask(this.current)
  }

  get(id) {
    return this.publicTask(
      this.tasks.find((task) => task.id === Number(id)) || null
    )
  }

  list() {
    return this.tasks
      .slice(-this.maxHistory)
      .reverse()
      .map((task) => this.publicTask(task))
  }

  start(skill, input = {}, context = {}) {
    if (this.current && ['starting', 'running'].includes(this.current.status)) {
      const error = new Error(
        `Task ${this.current.id} (${this.current.skill}) is already running.`
      )
      error.code = 'TASK_BUSY'
      throw error
    }

    const controller = new AbortController()
    const task = {
      id: this.nextId++,
      skill,
      input,
      requestedBy: context.requestedBy || 'hermes',
      status: 'starting',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      controller,
      promise: null
    }

    this.tasks.push(task)
    this.tasks = this.tasks.slice(-this.maxHistory)
    this.current = task

    task.promise = Promise.resolve().then(async () => {
      task.status = 'running'
      const result = await this.skillRegistry.execute(skill, input, {
        ...context,
        signal: controller.signal,
        cancelActiveWork: this.cancelActiveWork
      })

      task.result = result
      task.status = controller.signal.aborted
        ? 'cancelled'
        : result.ok
          ? 'completed'
          : 'failed'
      return result
    }).catch((error) => {
      task.result = {
        ok: false,
        skill,
        error: {
          code: controller.signal.aborted ? 'SKILL_CANCELLED' : 'TASK_ERROR',
          message: error.message
        }
      }
      task.status = controller.signal.aborted ? 'cancelled' : 'failed'
      return task.result
    }).finally(() => {
      task.finishedAt = new Date().toISOString()
      if (this.current === task) this.current = null
    })

    return this.publicTask(task)
  }

  async cancel(id, reason = 'cancelled by Hermes') {
    const task = this.tasks.find((entry) => entry.id === Number(id))
    if (!task) throw new Error(`Unknown task id: ${id}`)
    if (!['starting', 'running'].includes(task.status)) {
      return this.publicTask(task)
    }

    const error = new Error(reason)
    error.code = 'TASK_CANCELLED'
    task.controller.abort(error)
    await this.cancelActiveWork(reason)
    await task.promise
    return this.publicTask(task)
  }

  async cancelCurrent(reason = 'cancelled by Hermes') {
    if (!this.current) return null
    return this.cancel(this.current.id, reason)
  }
}

module.exports = TaskManager
