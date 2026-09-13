const test = require('node:test')
const assert = require('node:assert/strict')
const gatherBlock = require('../src/gathering/gatherBlock')

function createBot(options = {}) {
  const chats = []
  const collected = []
  const positions = options.positions || [{ x: 1, y: 64, z: 1 }]
  const tool = options.tool

  const bot = {
    heldItem: null,
    registry: {
      blocksByName: {
        stone: {
          id: 1,
          harvestTools: { 257: true }
        }
      }
    },
    inventory: {
      items: () => tool ? [tool] : []
    },
    findBlocks: () => positions,
    blockAt: (position) => ({ type: 1, position }),
    collectBlock: {
      async collect(block) {
        collected.push(block.position)
      },
      cancelTask() {}
    },
    pathfinder: {
      setGoal() {}
    },
    async equip(item) {
      bot.heldItem = item
    },
    chat(message) {
      chats.push(message)
    }
  }

  return { bot, chats, collected }
}

test('missing-tool feedback includes the real block name', async () => {
  const { bot, chats } = createBot()
  const result = await gatherBlock(bot, 'stone', 1)

  assert.equal(result, false)
  assert.deepEqual(chats, ['I need a proper tool to gather stone.'])
})

test('gathering equips a valid tool and reaches the requested amount', async () => {
  const { bot, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' },
    positions: [
      { x: 1, y: 64, z: 1 },
      { x: 2, y: 64, z: 1 },
      { x: 3, y: 64, z: 1 }
    ]
  })

  const result = await gatherBlock(bot, 'stone', 2)

  assert.equal(result, true)
  assert.equal(bot.heldItem.name, 'iron_pickaxe')
  assert.equal(collected.length, 2)
})

test('an already-cancelled gathering action does no work', async () => {
  const controller = new AbortController()
  controller.abort(new Error('test cancellation'))

  const { bot, collected } = createBot({
    tool: { type: 257, name: 'iron_pickaxe' }
  })

  await assert.rejects(
    gatherBlock(bot, 'stone', 1, { signal: controller.signal }),
    /test cancellation/
  )
  assert.equal(collected.length, 0)
})
