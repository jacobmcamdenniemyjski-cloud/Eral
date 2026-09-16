const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const SurvivalRecovery = require('../src/survival/SurvivalRecovery')

test('three recent deaths pause unsafe work and suppress combat', async () => {
  const bot = new EventEmitter()
  bot.health = 20
  bot.entity = { position: {} }
  let now = 1000
  const cancellations = []
  const suppressions = []
  const interruptions = []
  const recovery = new SurvivalRecovery(bot, {
    now: () => now,
    actionCoordinator: {
      async cancelAll(reason) { cancellations.push(reason) }
    },
    combatReflex: {
      suppress(duration) { suppressions.push(duration) }
    },
    autonomyController: {
      async interrupt(reason) { interruptions.push(reason) }
    },
    deathThreshold: 3
  })

  await recovery.onDeath()
  now += 1000
  await recovery.onDeath()
  now += 1000
  await recovery.onDeath()

  const status = recovery.getStatus()
  assert.equal(status.recoveryMode, true)
  assert.equal(status.recentDeathCount, 3)
  assert.equal(cancellations.length, 1)
  assert.equal(suppressions.length, 1)
  assert.equal(interruptions.length, 1)
})
