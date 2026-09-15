const fs = require('node:fs')
const path = require('node:path')

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

class TaskManager {
  constructor(options = {}) {
    if (!options.skillRegistry) {
      throw new Error('TaskManager requires a skill registry.')
    }
    this.skillRegistry = options.skillRegistry
    this.cancelActiveWork = options.cancelActiveWork || (async () => {})
    this.maxHistory = options.maxHistory || 50
    this.filePath = options.filePath || null
    this.tasks = []
    this.current = null
    this.nextId = 1
    this.recoveredTasks = 0
    this.load()
  }

  publicTask(task) {
    if (!task) return null
    return {
      id: task.id,
      skill: task.skill,
      input: clone(task.input),
      requestedBy: task.requestedBy,
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      result: clone(task.result)
    }
  }

  load() {
    if (!this.filePath) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      this.tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
        .slice(-this.maxHistory)
        .map((task) => ({ ...task, controller: null, promise: null }))
      this.nextId = Math.max(
        Number(parsed.nextId) || 1,
        ...this.tasks.map((task) => Number(task.id) + 1)
      )

      const finishedAt = new Date().toISOString()
      for (const task of this.tasks) {
        if (!['starting', 'running'].includes(task.status)) continue
        task.status = 'interrupted'
        task.finishedAt = finishedAt
        task.result = {
          ok: false,
          skill: task.skill,
          error: {
            code: 'TASK_INTERRUPTED',
            message: 'Earl restarted before this task reported completion.'
          }
        }
        this.recoveredTasks += 1
      }
      if (this.recoveredTasks > 0) this.save()
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not load task history: ${error.message}`)
      }
    }
  }

  save() {
    saveJson(this.filePath, {
      version: 1,
      nextId: this.nextId,
      tasks: this.tasks.map((task) => this.publicTask(task))
    })
  }

  recoverySummary() {
    return {
      recoveredTasks: this.recoveredTasks,
      persistent: Boolean(this.filePath)
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
      input: clone(input),
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
    this.save()

    task.promise = Promise.resolve().then(async () => {
      task.status = 'running'
      this.save()
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
      this.save()
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
