const { goals } = require('mineflayer-pathfinder')

function checkCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Sleeping was cancelled.')
  }
}

function findNearestBed(bot, maxDistance = 32) {
  if (typeof bot.isABed !== 'function') {
    throw new Error('Bed detection is unavailable for this Minecraft version.')
  }

  return bot.findBlock({
    matching: (block) => Boolean(block && bot.isABed(block)),
    maxDistance
  })
}

async function sleepInBed(bot, options = {}) {
  const { signal, maxDistance = 32 } = options
  checkCancelled(signal)

  if (bot.isSleeping) {
    return { alreadySleeping: true, sleeping: true }
  }

  const bed = findNearestBed(bot, maxDistance)
  if (!bed) {
    throw new Error(`No bed found within ${maxDistance} blocks.`)
  }

  const distance = bot.entity.position.distanceTo(bed.position)
  if (distance > 3.5) {
    await bot.pathfinder.goto(
      new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2)
    )
  }

  checkCancelled(signal)
  const currentBed = bot.blockAt(bed.position)
  if (!currentBed || !bot.isABed(currentBed)) {
    throw new Error('The nearby bed is no longer available.')
  }

  try {
    await bot.sleep(currentBed)
  } catch (error) {
    throw new Error(`Could not sleep: ${error.message}`)
  }

  checkCancelled(signal)
  console.log(
    `Earl is sleeping at ${bed.position.x}, ${bed.position.y}, ${bed.position.z}.`
  )

  return {
    sleeping: Boolean(bot.isSleeping),
    bed: {
      x: bed.position.x,
      y: bed.position.y,
      z: bed.position.z
    }
  }
}

module.exports = sleepInBed
module.exports.findNearestBed = findNearestBed
