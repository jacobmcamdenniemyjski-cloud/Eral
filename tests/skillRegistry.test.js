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

test('execution guards block unsafe skills before their executor runs', async () => {
  let executions = 0
  const registry = createEchoRegistry(async () => { executions += 1 })
  registry.addExecutionGuard(() => ({
    allowed: false,
    code: 'TEST_SAFETY_GATE',
    message: 'blocked for test'
  }))

  const result = await registry.execute('echo_message', { message: 'hello' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'TEST_SAFETY_GATE')
  assert.equal(executions, 0)
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

  assert.equal(registry.list().length, 59)
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
    'gather_seeds',
    'create_farm',
    'validate_build_plan',
    'create_build_plan',
    'place_build_plan_block',
    'get_build_plan',
    'list_build_plans',
    'resume_build_plan',
    'abort_build_plan',
    'advance_build_plan',
    'prepare_build_plan_site',
    'inspect_build_plan_shelter',
    'inspect_build_site',
    'inspect_block_at',
    'break_block_at',
    'clear_build_site',
    'inspect_shelter',
    'traverse_nearby_door',
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

test('planned placements cannot bypass verified construction phases', async () => {
  const scheduler = {
    getCurrentTask: () => null,
    setTask: () => true,
    clearTask: () => {}
  }
  const registry = createSkillRegistry({
    bot: {},
    scheduler,
    combatReflex: {
      getStatus: () => ({ mode: 'defensive' }),
      setMode: () => true,
      suppress: () => {}
    },
    deathTracker: { list: async () => [], returnToLatest: async () => null }
  })
  const created = await registry.execute('create_build_plan', {
    origin: { x: 0, y: 64, z: 0 },
    width: 5,
    depth: 5,
    interiorHeight: 3,
    doorPosition: { x: 2, y: 65, z: 0 }
  })
  const placement = await registry.execute('place_build_plan_block', {
    id: created.data.id,
    phase: 'floor',
    block: 'oak_planks',
    position: { x: 1, y: 64, z: 1 }
  })

  assert.equal(placement.ok, false)
  assert.equal(placement.data.status, 'failed')
  assert.equal(placement.data.code, 'BUILD_PLAN_PHASE_VIOLATION')

  registry.buildPlanStore.advance(created.data.id, 'site_ready')
  for (let x = 0; x < 5; x += 1) {
    for (let z = 0; z < 5; z += 1) {
      registry.buildPlanStore.recordPosition(
        created.data.id,
        { x, y: 64, z },
        { phase: 'floor', block: 'oak_planks' }
      )
    }
  }
  registry.buildPlanStore.advance(created.data.id, 'floor')
  const blockedDoorway = await registry.execute('place_build_plan_block', {
    id: created.data.id,
    phase: 'walls',
    block: 'oak_planks',
    position: { x: 2, y: 65, z: 0 }
  })
  assert.equal(blockedDoorway.ok, false)
  assert.match(blockedDoorway.data.message, /doorway/i)
})
