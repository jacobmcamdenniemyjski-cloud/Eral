const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const sleepInBed = require('../src/survival/sleepInBed')

function createBot(options = {}) {
  const bed = options.bed === false
    ? null
    : { name: 'red_bed', position: new Vec3(8, 64, 0) }
  let pathCalls = 0
  let sleepCalls = 0

  const bot = {
    isSleeping: Boolean(options.sleeping),
    entity: { position: new Vec3(0, 64, 0) },
    findBlock: () => bed,
    isABed: (block) => Boolean(block && block.name.endsWith('_bed')),
    blockAt: () => bed,
    pathfinder: {
      async goto() {
        pathCalls += 1
        bot.entity.position = new Vec3(7, 64, 0)
      }
    },
    async sleep() {
      sleepCalls += 1
      if (options.firstSleepFails && sleepCalls === 1) {
        throw new Error('bot is not sleeping')
      }
      bot.isSleeping = true
    }
  }

  return {
    bot,
    calls: {
      get path() { return pathCalls },
      get sleep() { return sleepCalls }
    }
  }
}

test('sleep action approaches a nearby bed and sleeps', async () => {
  const { bot, calls } = createBot()
  const result = await sleepInBed(bot, {
    signal: new AbortController().signal
  })

  assert.equal(calls.path, 1)
  assert.equal(calls.sleep, 1)
  assert.equal(result.sleeping, true)
  assert.deepEqual(result.bed, { x: 8, y: 64, z: 0 })
})

test('sleep action reports when no bed is nearby', async () => {
  const { bot } = createBot({ bed: false })

  await assert.rejects(
    sleepInBed(bot),
    /No bed found within 32 blocks/
  )
})

test('sleep action does not reuse a bed when already sleeping', async () => {
  const { bot, calls } = createBot({ sleeping: true })
  const result = await sleepInBed(bot)

  assert.equal(result.alreadySleeping, true)
  assert.equal(calls.path, 0)
  assert.equal(calls.sleep, 0)
})

test('sleep action retries from a bed side after an interaction failure', async () => {
  const { bot, calls } = createBot({ firstSleepFails: true })
  const result = await sleepInBed(bot)

  assert.equal(result.sleeping, true)
  assert.equal(calls.sleep, 2)
  assert.equal(calls.path, 2)
})
