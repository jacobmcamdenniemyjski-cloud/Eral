const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { breakBlockAt, inspectBlockAt } = require('../src/world/blockAt')

function createBot() {
  const target = new Vec3(2, 64, 3)
  let current = {
    name: 'oak_planks',
    type: 5,
    boundingBox: 'block',
    position: target,
    getProperties: () => ({})
  }
  const inventory = []
  const inspectedPositions = []
  let digs = 0
  const bot = {
    entity: { position: new Vec3(1, 64, 3) },
    registry: {
      blocks: { 5: { drops: [5], harvestTools: {} } },
      itemsByName: { oak_planks: { id: 5 } }
    },
    inventory: { items: () => inventory },
    blockAt: (position) => {
      inspectedPositions.push(position)
      assert.equal(typeof position.floored, 'function')
      return current
    },
    pathfinder: { async goto() {} },
    async waitForTicks() {},
    async dig() {
      digs += 1
      current = { name: 'air', type: 0, position: target }
      inventory.push({ name: 'oak_planks', type: 5, count: 1 })
    }
  }
  return { bot, target, inspectedPositions, get digs() { return digs } }
}

test('exact block inspection is read-only and reports server state', () => {
  const fixture = createBot()
  const result = inspectBlockAt(fixture.bot, fixture.target)

  assert.equal(result.name, 'oak_planks')
  assert.equal(fixture.digs, 0)
  assert.ok(fixture.inspectedPositions[0] instanceof Vec3)
})

test('exact breaking refuses a mismatched expected block', async () => {
  const fixture = createBot()
  const result = await breakBlockAt(fixture.bot, {
    position: fixture.target,
    expectedBlock: 'chest'
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.actualBlock, 'oak_planks')
  assert.equal(fixture.digs, 0)
})

test('exact breaking confirms both world change and recovered drop', async () => {
  const fixture = createBot()
  const result = await breakBlockAt(fixture.bot, {
    position: fixture.target,
    expectedBlock: 'oak_planks'
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.broken, true)
  assert.equal(result.recovered, 1)
  assert.equal(fixture.digs, 1)
})
