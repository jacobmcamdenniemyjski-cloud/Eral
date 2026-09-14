const { goals } = require('mineflayer-pathfinder')
const { HOSTILE_MOBS } = require('../combat/attackNearestHostile')

function nearestHostile(bot, range) {
  return Object.values(bot.entities || {})
    .filter((entity) => (
      entity &&
      entity.position &&
      HOSTILE_MOBS.has(entity.name) &&
      bot.entity.position.distanceTo(entity.position) <= range
    ))
    .sort((a, b) => (
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
    ))[0] || null
}

async function fleeFromHostiles(bot, options = {}) {
  const {
    signal,
    distance = 16,
    searchRange = 24
  } = options
  if (signal && signal.aborted) throw signal.reason

  const hostile = nearestHostile(bot, searchRange)
  if (!hostile) return { fled: false, reason: 'no_hostile_nearby' }

  const origin = bot.entity.position
  let dx = origin.x - hostile.position.x
  let dz = origin.z - hostile.position.z
  const magnitude = Math.sqrt(dx * dx + dz * dz) || 1
  dx /= magnitude
  dz /= magnitude

  const target = {
    x: Math.floor(origin.x + dx * distance),
    y: Math.floor(origin.y),
    z: Math.floor(origin.z + dz * distance)
  }

  await bot.pathfinder.goto(
    new goals.GoalNear(target.x, target.y, target.z, 2)
  )
  if (signal && signal.aborted) throw signal.reason

  const finalDistance = bot.entity.position.distanceTo(hostile.position)
  console.log(
    `Earl fled from ${hostile.name}; now ${finalDistance.toFixed(1)} blocks away.`
  )
  return {
    fled: true,
    hostile: hostile.name,
    position: target,
    distanceFromHostile: Math.round(finalDistance * 10) / 10
  }
}

module.exports = fleeFromHostiles
module.exports.nearestHostile = nearestHostile
