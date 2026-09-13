const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const CombatReflex = require('../src/combat/CombatReflex')

function position(x, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    distanceTo(other) {
      return Math.sqrt(
        ((this.x || 0) - (other.x || 0)) ** 2 +
        ((this.y || 0) - (other.y || 0)) ** 2 +
        ((this.z || 0) - (other.z || 0)) ** 2
      )
    }
  }
}

function createFixture(distance = 3) {
  const bot = new EventEmitter()
  const scheduler = {
    task: null,
    setTask(task) { this.task = task; return true },
    clearTask() { this.task = null },
    getCurrentTask() { return this.task }
  }
  const zombie = {
    id: 2,
    type: 'hostile',
    name: 'zombie',
    position: position(distance)
  }
  let attacks = 0
  let cancellations = 0

  bot.health = 20
  bot.entity = { id: 1, position: position(0) }
  bot.entities = { 2: zombie }
  bot.players = {}
  bot.inventory = { items: () => [] }
  bot.heldItem = null
  bot.equip = async () => {}
  bot.chat = () => {}
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

  const reflex = new CombatReflex(bot, scheduler, {
    scanIntervalMs: 0,
    cancelForThreat: async () => { cancellations += 1 }
  })

  return {
    bot,
    zombie,
    reflex,
    get attacks() { return attacks },
    get cancellations() { return cancellations }
  }
}

test('defensive mode attacks an immediate nearby threat', async () => {
  const fixture = createFixture(3)

  await fixture.reflex.scan()

  assert.equal(fixture.attacks, 1)
  assert.equal(fixture.cancellations, 1)
})

test('defensive mode does not hunt a distant hostile', async () => {
  const fixture = createFixture(7)

  await fixture.reflex.scan()

  assert.equal(fixture.attacks, 0)
  assert.equal(fixture.cancellations, 0)
})

test('defensive mode responds farther away after Earl is hurt', async () => {
  const fixture = createFixture(7)

  await fixture.reflex.scan({
    reactiveOrigin: fixture.bot.entity.position,
    allowProvokedOnly: true
  })

  assert.equal(fixture.attacks, 1)
})

test('passive mode and low health both prevent reflex combat', async () => {
  const passive = createFixture(2)
  passive.reflex.setMode('passive')
  await passive.reflex.scan()
  assert.equal(passive.attacks, 0)

  const injured = createFixture(2)
  injured.bot.health = 8
  await injured.reflex.scan()
  assert.equal(injured.attacks, 0)
})

test('stop suppression prevents immediate re-engagement', async () => {
  const fixture = createFixture(2)
  fixture.reflex.suppress(10000)

  await fixture.reflex.scan()

  assert.equal(fixture.attacks, 0)
})
