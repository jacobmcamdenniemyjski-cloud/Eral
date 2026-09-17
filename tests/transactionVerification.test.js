const test = require('node:test')
const assert = require('node:assert/strict')
const { performCraft } = require('../src/crafting/craftItem')

function craftingBot(craft) {
  const inventory = [
    { type: 1, name: 'oak_planks', count: 2 },
    { type: 2, name: 'stick', count: 0 }
  ]
  return {
    registry: { itemsByName: { oak_planks: { id: 1 }, stick: { id: 2 } } },
    inventory: { items: () => inventory },
    async waitForTicks() {},
    async craft(...args) { return craft(inventory, ...args) },
    chat() {}
  }
}

const selection = {
  recipe: {
    result: { id: 2, count: 4 },
    delta: [{ id: 1, count: -2 }, { id: 2, count: 4 }]
  },
  craftCount: 1
}

test('crafting reconciles an update error when the output really appeared', async () => {
  const bot = craftingBot((inventory) => {
    inventory[0].count -= 2
    inventory[1].count += 4
    throw new Error('updateSlot timed out')
  })
  const result = await performCraft(bot, selection, null, 'stick', 4, {
    announce: false
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.reconciledAfterError, true)
  assert.equal(result.evidence.outputAfter, 4)
})

test('crafting never retries after ingredients changed without output', async () => {
  let calls = 0
  const bot = craftingBot((inventory) => {
    calls += 1
    inventory[0].count -= 2
    throw new Error('updateSlot timed out')
  })
  await assert.rejects(
    performCraft(bot, selection, null, 'stick', 4, { announce: false }),
    (error) => error.code === 'CRAFT_DESYNC'
  )
  assert.equal(calls, 1)
})

test('multi-craft requests commit and verify one recipe at a time', async () => {
  let calls = 0
  const bot = craftingBot((inventory, recipe, count) => {
    calls += 1
    assert.equal(count, 1)
    inventory[0].count -= 2
    inventory[1].count += 4
  })
  const result = await performCraft(bot, {
    ...selection,
    craftCount: 3
  }, null, 'stick', 12, { announce: false })

  assert.equal(calls, 3)
  assert.equal(result.crafted, 12)
  assert.equal(result.transactions, 3)
  assert.equal(result.evidence.transactions.length, 3)
})

test('multi-craft stops after the first ambiguous transaction', async () => {
  let calls = 0
  const bot = craftingBot((inventory) => {
    calls += 1
    inventory[0].count -= 2
    if (calls === 1) inventory[1].count += 4
    else throw new Error('updateSlot timed out')
  })

  await assert.rejects(
    performCraft(bot, { ...selection, craftCount: 3 }, null, 'stick', 12, {
      announce: false
    }),
    (error) => error.code === 'CRAFT_DESYNC'
  )
  assert.equal(calls, 2)
})
