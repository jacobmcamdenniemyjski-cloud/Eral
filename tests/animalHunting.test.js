const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const huntAnimals = require('../src/animals/huntAnimal')

function position(x, y = 64, z = 0) {
  return {
    x,
    y,
    z,
    distanceTo(other) {
      return Math.sqrt(
        (this.x - other.x) ** 2 +
        (this.y - other.y) ** 2 +
        (this.z - other.z) ** 2
      )
    }
  }
}

function createFixture() {
  const bot = new EventEmitter()
  const sheep = { id: 2, name: 'sheep', position: position(3) }
  let inventory = []
  let attacks = 0

  bot.entity = { id: 1, position: position(0) }
  bot.entities = { sheep }
  bot.inventory = { items: () => inventory }
  bot.chat = () => {}
  bot.clearControlStates = () => {}
  bot.waitForTicks = async () => {}
  bot.pathfinder = {
    goto: async () => {
      inventory = [
        { name: 'white_wool', count: 1 },
        { name: 'mutton', count: 1 }
      ]
      delete bot.entities.drop
    }
  }
  bot.pvp = {
    target: null,
    attack: async (target) => {
      attacks += 1
      bot.pvp.target = target
      setImmediate(() => {
        delete bot.entities.sheep
        bot.entities.drop = { id: 3, name: 'item', position: position(3) }
        bot.emit('entityGone', target)
      })
    },
    forceStop: () => { bot.pvp.target = null }
  }

  return { bot, get attacks() { return attacks } }
}

test('hunting sheep confirms the kill and collects resource drops', async () => {
  const fixture = createFixture()
  const result = await huntAnimals(fixture.bot, 'sheep', 1)

  assert.equal(fixture.attacks, 1)
  assert.equal(result.status, 'completed')
  assert.equal(result.hunted, 1)
  assert.deepEqual(result.acquired, { white_wool: 1, mutton: 1 })
})

test('animal hunting refuses targets outside the passive allowlist', async () => {
  const fixture = createFixture()
  const result = await huntAnimals(fixture.bot, 'villager', 1)

  assert.equal(fixture.attacks, 0)
  assert.equal(result.status, 'failed')
  assert.match(result.message, /not an approved passive animal target/)
})

test('animal hunting does not target custom-named animals', async () => {
  const fixture = createFixture()
  fixture.bot.entities.sheep.customName = 'Dinnerbone'
  const result = await huntAnimals(fixture.bot, 'sheep', 1)

  assert.equal(fixture.attacks, 0)
  assert.equal(result.status, 'failed')
  assert.equal(result.hunted, 0)
})

test('a confirmed kill without collected drops reports partial evidence', async () => {
  const fixture = createFixture()
  fixture.bot.pathfinder.goto = async () => {
    delete fixture.bot.entities.drop
  }
  const result = await huntAnimals(fixture.bot, 'sheep', 1)

  assert.equal(result.status, 'partial')
  assert.equal(result.hunted, 1)
  assert.deepEqual(result.acquired, {})
  assert.match(result.message, /no drops entered inventory/)
})
