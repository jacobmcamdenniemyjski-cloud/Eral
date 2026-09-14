const test = require('node:test')
const assert = require('node:assert/strict')
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
