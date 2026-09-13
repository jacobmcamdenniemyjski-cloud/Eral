const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const CombatReflex = require('../src/combat/CombatReflex')
const { parseItemRequest } = require('../src/core/parseItemRequest')

const registryBot = {
  registry: {
    blocksByName: {
      birch_log: { id: 2 },
      oak_log: { id: 1 },
      crafting_table: {},
      dirt: {}
    },
    itemsByName: {
      birch_log: {},
      oak_log: {},
      oak_planks: {},
      iron_sword: {},
      dirt: {}
    }
  }
}

test('generic logs resolve to a nearby species for gathering', () => {
  const bot = {
    ...registryBot,
    findBlock: () => ({ name: 'birch_log' })
  }

  assert.deepEqual(
    parseItemRequest(bot, '4 logs', { kind: 'block' }),
    { name: 'birch_log', amount: 4, known: true }
  )
})

test('generic logs resolve to an available inventory species for storage', () => {
  const bot = {
    ...registryBot,
    inventory: {
      items: () => [
        { name: 'oak_log', count: 2 },
        { name: 'birch_log', count: 6 }
      ]
    }
  }

  assert.equal(
    parseItemRequest(bot, 'logs 4', { kind: 'item' }).name,
    'birch_log'
  )
})

test('resource requests accept amounts before or after the name', () => {
  assert.deepEqual(
    parseItemRequest(registryBot, '64 birch_logs', { kind: 'block' }),
    { name: 'birch_log', amount: 64, known: true }
  )
  assert.deepEqual(
    parseItemRequest(registryBot, 'dirt 5', { kind: 'item' }),
    { name: 'dirt', amount: 5, known: true }
  )
})

test('resource requests accept spaces, underscores, and safe plurals', () => {
  assert.equal(
    parseItemRequest(registryBot, 'oak logs 12', { kind: 'block' }).name,
    'oak_log'
  )
  assert.equal(
    parseItemRequest(registryBot, 'oak_planks 8', { kind: 'item' }).name,
    'oak_planks'
  )
  assert.equal(
    parseItemRequest(registryBot, 'iron sword', { kind: 'item' }).name,
    'iron_sword'
  )
})

test('nearby can be ignored for natural placement wording', () => {
  assert.deepEqual(
    parseItemRequest(registryBot, 'crafting table nearby', {
      kind: 'block',
      allowAmount: false,
      ignoredTrailingWords: ['nearby']
    }),
    { name: 'crafting_table', amount: 1, known: true }
  )
})

function position(x) {
  return {
    x,
    y: 0,
    z: 0,
    distanceTo(other) { return Math.abs(this.x - other.x) }
  }
}

function createCombatFixture(now) {
  const bot = new EventEmitter()
  const zombie = {
    id: 44,
    type: 'hostile',
    name: 'zombie',
    position: position(2)
  }
  let attacks = 0
  const scheduler = {
    task: null,
    setTask(task) { this.task = task; return true },
    clearTask() { this.task = null },
    getCurrentTask() { return this.task }
  }

  bot.health = 20
  bot.entity = { id: 1, position: position(0) }
  bot.entities = { 44: zombie }
  bot.players = {}
  bot.inventory = { items: () => [] }
  bot.chat = () => {}
  bot.equip = async () => {}
  bot.clearControlStates = () => {}
  bot.pvp = {
    target: null,
    async attack(target) {
      attacks += 1
      bot.pvp.target = target
      setImmediate(() => {
        bot.pvp.target = null
        bot.emit('entityGone', target)
      })
    },
    forceStop() {
      bot.pvp.target = null
      bot.emit('stoppedAttacking')
    }
  }

  return {
    bot,
    zombie,
    reflex: new CombatReflex(bot, scheduler, {
      scanIntervalMs: 0,
      reengageCooldownMs: 2000,
      now
    }),
    get attacks() { return attacks }
  }
}

test('combat reflex does not immediately re-engage the same entity', async () => {
  let currentTime = 1000
  const fixture = createCombatFixture(() => currentTime)

  await fixture.reflex.scan()
  await fixture.reflex.scan()
  assert.equal(fixture.attacks, 1)

  currentTime += 2001
  await fixture.reflex.scan()
  assert.equal(fixture.attacks, 2)
})
