const { goals } = require('mineflayer-pathfinder')
const { configureSafeMovements } = require('./configureDoorTraversal')

function distanceToCoordinates(position, x, y, z) {
  return Math.sqrt(
    Math.pow(position.x - x, 2) +
    Math.pow(position.y - y, 2) +
    Math.pow(position.z - z, 2)
  )
}

function arrivalDistance(position, x, y, z) {
  return {
    horizontal: Math.hypot(position.x - x, position.z - z),
    vertical: Math.abs(position.y - y),
    direct: distanceToCoordinates(position, x, y, z)
  }
}

async function goTo(bot, x, y, z, options = {}) {
  const { tolerance = 2, signal } = options

  if (signal && signal.aborted) {
    throw signal.reason || new Error('Travel was cancelled.')
  }

  const goal = new goals.GoalNear(x, y, z, tolerance)
  console.log(`Earl is moving near ${x}, ${y}, ${z}.`)
  configureSafeMovements(bot)
  await bot.pathfinder.goto(goal)

  if (signal && signal.aborted) {
    throw signal.reason || new Error('Travel was cancelled.')
  }

  const distance = arrivalDistance(bot.entity.position, x, y, z)

  // GoalNear is fundamentally a proximity goal. The requested Y commonly
  // names the supporting block while the entity stands one block above it,
  // so a 2-block horizontal arrival can measure ~2.24 in 3D and was falsely
  // rejected after pathfinder had already succeeded.
  if (distance.horizontal > tolerance + 0.25 || distance.vertical > 1.5) {
    throw new Error(
      `did not reach (${x}, ${y}, ${z}); still ${distance.direct.toFixed(1)} ` +
      `blocks away (${distance.horizontal.toFixed(1)} horizontal, ` +
      `${distance.vertical.toFixed(1)} vertical)`
    )
  }

  console.log(
    `Earl arrived within ${tolerance} blocks of ${x}, ${y}, ${z}.`
  )
  return true
}

module.exports = goTo
module.exports.arrivalDistance = arrivalDistance
