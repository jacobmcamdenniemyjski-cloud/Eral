const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const createFarm = require('../src/farming/createFarm')

function key(position) {
  return `${position.x},${position.y},${position.z}`
}

function block(name, position) {
  return {
    name,
    type: name === 'air' ? 0 : 1,
    position,
    boundingBox: name === 'air' ? 'empty' : 'block'
  }
}

function createBot(options = {}) {
  const world = new Map()
  const origin = new Vec3(0, 64, 0)
  world.set(key(new Vec3(-1, 64, 0)), block('water', new Vec3(-1, 64, 0)))
  for (let x = 0; x < 2; x += 1) {
    for (let z = 0; z < 2; z += 1) {
      const position = new Vec3(x, 64, z)
      world.set(key(position), block(
        options.blocked && x === 1 && z === 1 ? 'stone' : 'dirt',
        position
      ))
    }
  }
  const inventory = [
    { name: 'iron_hoe', type: 10, count: 1 },
    { name: 'wheat_seeds', type: 11, count: 4 }
  ]
  const bot = {
    registry: { itemsByName: { wheat_seeds: { id: 11 } } },
    inventory: { items: () => inventory },
    blockAt(position) {
      return world.get(key(position)) || block('air', position)
    },
    async waitForTicks() {},
    async equip(item) { bot.heldItem = item },
    async activateBlock(soil) {
      world.set(key(soil.position), block('farmland', soil.position))
    },
    async dig(target) { world.delete(key(target.position)) },
    async placeBlock(soil) {
      const position = soil.position.offset(0, 1, 0)
      world.set(key(position), block('wheat', position))
      inventory.find((item) => item.name === 'wheat_seeds').count -= 1
    }
  }
  return { bot, origin, world }
}

test('farm creation preserves water and verifies every tilled and planted cell', async () => {
  const { bot, origin } = createBot()
  const result = await createFarm(bot, {
    crop: 'wheat',
    origin,
    width: 2,
    depth: 2
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.tilled, 4)
  assert.equal(result.planted, 4)
  assert.equal(bot.blockAt(new Vec3(-1, 64, 0)).name, 'water')
  assert.equal(bot.blockAt(new Vec3(1, 65, 1)).name, 'wheat')
})

test('farm creation refuses a field containing unsafe solid terrain', async () => {
  const { bot, origin } = createBot({ blocked: true })
  const result = await createFarm(bot, {
    crop: 'wheat', origin, width: 2, depth: 2
  })
  assert.equal(result.status, 'failed')
  assert.match(result.problems[0].reason, /unsafe soil stone/)
})
