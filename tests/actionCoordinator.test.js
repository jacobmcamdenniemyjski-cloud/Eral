const test = require('node:test')
const assert = require('node:assert/strict')
const PhysicalActionCoordinator = require('../src/actions/PhysicalActionCoordinator')
const SkillRegistry = require('../src/skills/SkillRegistry')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('physical actions run one at a time in request order', async () => {
  const coordinator = new PhysicalActionCoordinator()
  const gate = deferred()
  const events = []

  const first = coordinator.run('build', async () => {
    events.push('build:start')
    await gate.promise
    events.push('build:end')
    return 'built'
  })
  const second = coordinator.run('craft', async () => {
    events.push('craft:start')
    return 'crafted'
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['build:start'])
  assert.equal(coordinator.getStatus().waiting[0].name, 'craft')

  gate.resolve()
  assert.equal(await first, 'built')
  assert.equal(await second, 'crafted')
  assert.deepEqual(events, ['build:start', 'build:end', 'craft:start'])
  assert.equal(coordinator.isBusy(), false)
})

test('urgent combat aborts and cleans up a lower priority action', async () => {
  const cleanups = []
  const coordinator = new PhysicalActionCoordinator({
    cleanup: async (reason, action) => cleanups.push({ reason, action: action.name })
  })
  const events = []

  const building = coordinator.run('build', (signal) => new Promise((resolve, reject) => {
    events.push('build:start')
    signal.addEventListener('abort', () => {
      events.push('build:abort')
      reject(signal.reason)
    }, { once: true })
  }))
  await new Promise((resolve) => setImmediate(resolve))

  const combat = coordinator.run('reflex_attack', async () => {
    events.push('combat:start')
    return true
  }, { priority: 1000, preempt: true })

  await assert.rejects(building, /preempted/)
  assert.equal(await combat, true)
  assert.deepEqual(events, ['build:start', 'build:abort', 'combat:start'])
  assert.equal(cleanups.length, 1)
  assert.equal(cleanups[0].action, 'build')
})

test('skill registry coordinates writes while read operations remain immediate', async () => {
  const coordinator = new PhysicalActionCoordinator()
  const registry = new SkillRegistry({ actionCoordinator: coordinator })
  const gate = deferred()
  const events = []
  const emptySchema = {
    type: 'object',
    properties: {},
    additionalProperties: false
  }

  registry.register({
    name: 'physical_one',
    description: 'First physical action.',
    inputSchema: emptySchema,
    safety: 'world_write',
    execute: async () => {
      events.push('one:start')
      await gate.promise
      return true
    }
  })
  registry.register({
    name: 'physical_two',
    description: 'Second physical action.',
    inputSchema: emptySchema,
    safety: 'inventory_write',
    execute: async () => {
      events.push('two:start')
      return true
    }
  })
  registry.register({
    name: 'read_status',
    description: 'Read state.',
    inputSchema: emptySchema,
    safety: 'read_only',
    execute: async () => {
      events.push('read')
      return true
    }
  })

  const one = registry.execute('physical_one')
  const two = registry.execute('physical_two')
  const read = await registry.execute('read_status')
  assert.equal(read.ok, true)
  assert.deepEqual(events, ['one:start', 'read'])

  gate.resolve()
  assert.equal((await one).ok, true)
  assert.equal((await two).ok, true)
  assert.deepEqual(events, ['one:start', 'read', 'two:start'])
})

test('a new physical action clears stale movement before taking ownership', async () => {
  const events = []
  const coordinator = new PhysicalActionCoordinator({
    prepare: async (reason) => events.push(reason)
  })
  await coordinator.run('gather_block', async () => {
    events.push('gathering')
  })
  assert.deepEqual(events, ['preparing gather_block', 'gathering'])
})
