const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const DeathTracker = require('../src/bridge/DeathTracker')

function position(x, y, z) {
  return { x, y, z }
}

test('death tracker persists inventory and returns to the latest death', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'earl-deaths-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const bot = new EventEmitter()
  bot.entity = { position: position(12.8, 64.9, -4.1) }
  bot.game = { dimension: 'overworld' }
  bot.inventory = {
    items: () => [{ name: 'iron_sword', count: 1 }]
  }

  const tracker = new DeathTracker(bot, {
    filePath: path.join(directory, 'deaths.json')
  })
  const recorded = await tracker.record()

  assert.deepEqual(recorded.position, { x: 12, y: 64, z: -5 })
  assert.deepEqual(recorded.inventory, [{ name: 'iron_sword', count: 1 }])

  const reloaded = new DeathTracker(bot, {
    filePath: path.join(directory, 'deaths.json')
  })
  assert.equal((await reloaded.list()).length, 1)

  let destination
  await reloaded.returnToLatest({
    travel: async (usedBot, x, y, z, options) => {
      destination = { usedBot, x, y, z, options }
    }
  })

  assert.equal(destination.usedBot, bot)
  assert.deepEqual(
    { x: destination.x, y: destination.y, z: destination.z },
    { x: 12, y: 64, z: -5 }
  )
  assert.equal(destination.options.tolerance, 2)
})

test('death tracker refuses cross-dimension recovery', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'earl-deaths-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const bot = new EventEmitter()
  bot.entity = { position: position(0, 64, 0) }
  bot.game = { dimension: 'the_nether' }
  bot.inventory = { items: () => [] }
  const tracker = new DeathTracker(bot, {
    filePath: path.join(directory, 'deaths.json')
  })
  await tracker.record()
  bot.game.dimension = 'overworld'

  await assert.rejects(
    tracker.returnToLatest({ travel: async () => {} }),
    /last death was in the_nether/
  )
})
