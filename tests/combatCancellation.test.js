const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const attackNearestHostile = require('../src/combat/attackNearestHostile')

function createBot() {
  const bot = new EventEmitter()
  const target = {
    type: 'hostile',
    name: 'zombie',
    position: { distance: 3 }
  }
  let forceStops = 0

  bot.entity = {
    position: {
      distanceTo(position) {
        return position.distance
      }
    }
  }
  bot.entities = { target }
  bot.pvp = {
    target: null,
    async attack(entity) {
      bot.pvp.target = entity
    },
    forceStop() {
      forceStops += 1
      bot.pvp.target = null
      bot.emit('stoppedAttacking')
    }
  }
  bot.chat = () => {}
  bot.clearControlStates = () => {}

  return {
    bot,
    target,
    get forceStops() { return forceStops }
  }
}

test('combat resolves and removes listeners when its target disappears', async () => {
  const fixture = createBot()
  const attacking = attackNearestHostile(fixture.bot, 'zombie')

  await new Promise((resolve) => setImmediate(resolve))
  fixture.bot.emit('entityGone', fixture.target)

  assert.equal(await attacking, fixture.target)
  assert.equal(fixture.bot.listenerCount('entityGone'), 0)
  assert.equal(fixture.bot.listenerCount('stoppedAttacking'), 0)
})

test('aborting combat force-stops PVP and removes listeners', async () => {
  const fixture = createBot()
  const controller = new AbortController()
  const attacking = attackNearestHostile(
    fixture.bot,
    'zombie',
    16,
    { signal: controller.signal }
  )

  await new Promise((resolve) => setImmediate(resolve))
  controller.abort(new Error('test cancellation'))

  await assert.rejects(attacking, /test cancellation/)
  assert.ok(fixture.forceStops >= 1)
  assert.equal(fixture.bot.listenerCount('entityGone'), 0)
  assert.equal(fixture.bot.listenerCount('stoppedAttacking'), 0)
})
