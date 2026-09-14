const test = require('node:test')
const assert = require('node:assert/strict')
const SkillRegistry = require('../src/skills/SkillRegistry')
const createSkillRegistry = require('../src/skills/createSkillRegistry')

function createEchoRegistry(execute = async ({ message }) => message) {
  const registry = new SkillRegistry()
  registry.register({
    name: 'echo_message',
    description: 'Return one validated message.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 1 }
      },
      required: ['message'],
      additionalProperties: false
    },
    execute
  })
  return registry
}

test('a registered skill returns a structured success result', async () => {
  const registry = createEchoRegistry()
  const result = await registry.execute('echo_message', { message: 'hello' })

  assert.deepEqual(result, {
    ok: true,
    skill: 'echo_message',
    data: 'hello'
  })
})

test('invalid arguments never reach the skill executor', async () => {
  let executions = 0
  const registry = createEchoRegistry(async () => {
    executions += 1
  })

  const missing = await registry.execute('echo_message', {})
  const extra = await registry.execute('echo_message', {
    message: 'hello',
    inventedArgument: true
  })

  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'INVALID_ARGUMENTS')
  assert.equal(extra.ok, false)
  assert.equal(extra.error.code, 'INVALID_ARGUMENTS')
  assert.equal(executions, 0)
})

test('unknown and ordinary skill failures are structured', async () => {
  const registry = createEchoRegistry(async () => false)
  const unknown = await registry.execute('not_registered', {})
  const failed = await registry.execute('echo_message', { message: 'hello' })

  assert.equal(unknown.error.code, 'UNKNOWN_SKILL')
  assert.equal(failed.error.code, 'SKILL_FAILED')
})

test('a skill timeout aborts work and invokes cleanup', async () => {
  let cleanups = 0
  const registry = new SkillRegistry()
  registry.register({
    name: 'slow_skill',
    description: 'Never finishes without cancellation.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    timeoutMs: 10,
    execute: async (input, context) => new Promise((resolve, reject) => {
      context.signal.addEventListener(
        'abort',
        () => reject(context.signal.reason),
        { once: true }
      )
    })
  })

  const result = await registry.execute('slow_skill', {}, {
    cancelActiveWork: async () => { cleanups += 1 }
  })

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'SKILL_TIMEOUT')
  assert.equal(cleanups, 1)
})

test('an external abort returns a cancellation result', async () => {
  const registry = createEchoRegistry(async (input, context) => (
    new Promise((resolve, reject) => {
      context.signal.addEventListener(
        'abort',
        () => reject(context.signal.reason),
        { once: true }
      )
    })
  ))
  const controller = new AbortController()
  const pending = registry.execute(
    'echo_message',
    { message: 'hello' },
    { signal: controller.signal }
  )

  controller.abort(new Error('cancelled by test'))
  const result = await pending

  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'SKILL_CANCELLED')
  assert.match(result.error.message, /cancelled by test/)
})

test('tool definitions expose schemas but not executable functions', () => {
  const definitions = createEchoRegistry().getToolDefinitions()

  assert.deepEqual(definitions, [{
    name: 'echo_message',
    description: 'Return one validated message.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 1 }
      },
      required: ['message'],
      additionalProperties: false
    }
  }])
  assert.equal('execute' in definitions[0], false)
})

test('Earl exposes every current capability through structured skills', () => {
  const scheduler = {
    getCurrentTask: () => null,
    setTask: () => true,
    clearTask: () => {}
  }
  const combatReflex = {
    getStatus: () => ({ mode: 'defensive' }),
    setMode: () => true,
    suppress: () => {}
  }
  const deathTracker = {
    list: async () => [],
    returnToLatest: async () => null
  }
  const registry = createSkillRegistry({
    bot: {},
    scheduler,
    combatReflex,
    deathTracker
  })

  assert.equal(registry.list().length, 41)
  for (const name of [
    'get_status',
    'get_inventory',
    'get_scene',
    'get_recipes',
    'get_deaths',
    'return_to_death',
    'pickup_items',
    'eat_now',
    'flee_from_hostiles',
    'use_nearby_block',
    'get_saved_locations',
    'mark_location',
    'forget_location',
    'go_to_location',
    'sleep_in_bed',
    'make_item',
    'get_farm_status',
    'farm_crops',
    'farm_all_available',
    'smelt_item',
    'get_furnace_status',
    'collect_furnace_output',
    'build_wall',
    'stop_all'
  ]) {
    assert.ok(registry.get(name), `missing skill: ${name}`)
  }
})
