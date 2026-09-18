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

  const approaches = [
    { x: bed.position.x + 1, y: bed.position.y, z: bed.position.z },
    { x: bed.position.x - 1, y: bed.position.y, z: bed.position.z },
    { x: bed.position.x, y: bed.position.y, z: bed.position.z + 1 },
    { x: bed.position.x, y: bed.position.y, z: bed.position.z - 1 }
  ].sort((left, right) => (
    bot.entity.position.distanceTo(left) - bot.entity.position.distanceTo(right)
  ))
  let lastError = null

  for (const approach of approaches) {
    checkCancelled(signal)
    if (bot.entity.position.distanceTo(bed.position) > 3.5) {
      try {
        await bot.pathfinder.goto(
          new goals.GoalNear(approach.x, approach.y, approach.z, 1)
        )
      } catch (error) {
        lastError = error
        continue
      }
    }

    const currentBed = bot.blockAt(bed.position)
    if (!currentBed || !bot.isABed(currentBed)) {
      throw new Error('The nearby bed is no longer available.')
    }

    try {
      await bot.sleep(currentBed)
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (/only.*night|monsters nearby|occupied/i.test(error.message)) break
      if (bot.entity.position.distanceTo(bed.position) <= 3.5) {
        try {
          await bot.pathfinder.goto(
            new goals.GoalNear(approach.x, approach.y, approach.z, 0)
          )
        } catch {}
      }
    }
  }

  if (!bot.isSleeping) {
    throw new Error(`Could not sleep: ${lastError ? lastError.message : 'no reachable side of the bed'}`)
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
