const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const TaskManager = require('../src/bridge/TaskManager')

test('task manager runs one background skill and records completion', async () => {
  const registry = {
    execute: async (name, input) => ({
      ok: true,
      skill: name,
      data: { input }
    })
  }
  const manager = new TaskManager({ skillRegistry: registry })
  const started = manager.start('get_status', {})

  assert.equal(started.status, 'starting')
  await new Promise((resolve) => setImmediate(resolve))

  const completed = manager.get(started.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.result.ok, true)
  assert.equal(manager.getCurrent(), null)
})

test('task manager rejects overlap and cancels active work', async () => {
  let cancelled = false
  const registry = {
    execute: async (name, input, context) => new Promise((resolve) => {
      const finish = () => resolve({
        ok: false,
        skill: name,
        error: { code: 'SKILL_CANCELLED', message: 'cancelled' }
      })
      if (context.signal.aborted) finish()
      else context.signal.addEventListener('abort', finish, { once: true })
    })
  }
  const manager = new TaskManager({
    skillRegistry: registry,
    cancelActiveWork: async () => { cancelled = true }
  })
  const started = manager.start('gather_block', {
    block: 'stone',
    amount: 64
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.throws(
    () => manager.start('go_to', { x: 1, y: 2, z: 3 }),
    (error) => error.code === 'TASK_BUSY'
  )

  const stopped = await manager.cancel(started.id, 'test stop')
  assert.equal(stopped.status, 'cancelled')
  assert.equal(cancelled, true)
  assert.equal(manager.getCurrent(), null)
})


test('task manager preserves history and reconciles interrupted work', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'earl-task-'))
  const filePath = path.join(directory, 'tasks.json')
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      nextId: 8,
      tasks: [{
        id: 7,
        skill: 'gather_block',
        input: { block: 'oak_log', amount: 8 },
        requestedBy: 'hermes',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        result: null
      }]
    }))

    const manager = new TaskManager({
      skillRegistry: { execute: async () => ({ ok: true }) },
      filePath
    })
    const recovered = manager.get(7)
    assert.equal(recovered.status, 'interrupted')
    assert.equal(recovered.result.error.code, 'TASK_INTERRUPTED')
    assert.equal(manager.getCurrent(), null)
    assert.equal(manager.recoverySummary().recoveredTasks, 1)

    const reloaded = new TaskManager({
      skillRegistry: { execute: async () => ({ ok: true }) },
      filePath
    })
    assert.equal(reloaded.get(7).status, 'interrupted')
    assert.equal(reloaded.recoverySummary().recoveredTasks, 0)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
