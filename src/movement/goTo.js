const { goals } = require('mineflayer-pathfinder')

function distanceToCoordinates(position, x, y, z) {
  return Math.sqrt(
    Math.pow(position.x - x, 2) +
    Math.pow(position.y - y, 2) +
    Math.pow(position.z - z, 2)
  )
}

async function goTo(bot, x, y, z, options = {}) {
  const { tolerance = 2, signal } = options

  if (signal && signal.aborted) {
    throw signal.reason || new Error('Travel was cancelled.')
  }

  const goal = new goals.GoalNear(x, y, z, tolerance)
  console.log(`Earl is moving near ${x}, ${y}, ${z}.`)
  await bot.pathfinder.goto(goal)

  if (signal && signal.aborted) {
    throw signal.reason || new Error('Travel was cancelled.')
  }

  const distance = distanceToCoordinates(bot.entity.position, x, y, z)

  if (distance > tolerance + 0.25) {
    throw new Error(
      `did not reach (${x}, ${y}, ${z}); still ${distance.toFixed(1)} blocks away`
    )
  }

  console.log(
    `Earl arrived within ${tolerance} blocks of ${x}, ${y}, ${z}.`
  )
  return true
}

module.exports = goTo
