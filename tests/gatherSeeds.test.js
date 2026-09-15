const test = require('node:test')
const assert = require('node:assert/strict')
const gatherSeeds = require('../src/farming/gatherSeeds')
const resolveDirectSkillCall = require('../src/llm/resolveDirectSkillCall')
const selectSkillTools = require('../src/llm/selectSkillTools')

function key(position) {
  return `${position.x},${position.y},${position.z}`
}

function createBot(options = {}) {
  const chats = []
  const positions = options.positions || [
    { x: 0, y: 64, z: 0 },
    { x: 1, y: 64, z: 0 },
    { x: 2, y: 64, z: 0 }
  ]
  const remaining = new Set(positions.map(key))
  let seedCount = 0
  let digs = 0
  let moves = 0

  const blockAt = (position) => remaining.has(key(position))
    ? { name: 'short_grass', type: 5, position }
    : { name: 'air', type: 0, position }

  const bot = {
    registry: {
      blocksByName: {
        short_grass: { id: 5 }
      }
    },
    entity: {
      position: { x: 0, y: 64, z: 0 },
      eyeHeight: 1.62
    },
    entities: {},
    inventory: {
      items: () => seedCount > 0
        ? [{ name: 'wheat_seeds', count: seedCount }]
        : []
    },
    findBlocks: () => positions.filter((position) => remaining.has(key(position))),
    blockAt,
    pathfinder: {
      async goto(goal) {
        moves += 1
        bot.entity.position = { x: goal.x, y: goal.y, z: goal.z }
      },
      setGoal() {}
    },
    collectBlock: {
      async collect() {}
    },
    async dig(block) {
      digs += 1
      remaining.delete(key(block.position))
      if ((options.seedOnDigs || [2, 3]).includes(digs)) seedCount += 1
    },
    async lookAt() {},
    async waitForTicks() {},
    chat(message) {
      chats.push(message)
    }
  }

  return {
    bot,
    chats,
    get digs() { return digs },
    get moves() { return moves },
    get seeds() { return seedCount }
  }
}

test('seed gathering directly digs grass under Earl and continues until seeds exist', async () => {
  const state = createBot()
  const result = await gatherSeeds(state.bot, 2)

  assert.equal(result.complete, true)
  assert.equal(result.collected, 2)
  assert.equal(result.plantsBroken, 3)
  assert.equal(state.digs, 3)
  assert.equal(state.moves, 0)
  assert.match(state.chats.at(-1), /collected 2 wheat seeds/i)
})

test('seed gathering reports incomplete when vegetation drops no seeds', async () => {
  const state = createBot({
    positions: [{ x: 0, y: 64, z: 0 }],
    seedOnDigs: []
  })
  const result = await gatherSeeds(state.bot, 1)

  assert.equal(result.complete, false)
  assert.equal(result.collected, 0)
  assert.equal(result.plantsBroken, 1)
  assert.match(state.chats.at(-1), /collected 0 of 1/i)
})

test('seed gathering obeys cancellation before breaking vegetation', async () => {
  const controller = new AbortController()
  controller.abort(new Error('test cancellation'))
  const state = createBot()

  await assert.rejects(
    gatherSeeds(state.bot, 1, { signal: controller.signal }),
    /test cancellation/
  )
  assert.equal(state.digs, 0)
})

test('seed requests route to the dedicated skill instead of generic gathering', () => {
  assert.deepEqual(
    resolveDirectSkillCall('collect 4 wheat seeds', 'jacob48317'),
    { name: 'gather_seeds', input: { amount: 4 } }
  )

  const selected = selectSkillTools(
    'collect four wheat seeds for the farm',
    [
      { name: 'gather_block' },
      { name: 'gather_seeds' },
      { name: 'farm_crops' }
    ]
  )
  assert.deepEqual(selected.map((tool) => tool.name), ['gather_seeds'])
})
