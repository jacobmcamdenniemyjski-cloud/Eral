const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

function toVec3(position) {
  if (!position || !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    throw new TypeError('position must contain finite x, y, and z coordinates')
  }

  return position instanceof Vec3
    ? position.floored()
    : new Vec3(position.x, position.y, position.z).floored()
}

async function breakBlockAt(bot, position, options = {}) {
  const { signal, maxDistance = 4.5 } = options
  if (signal && signal.aborted) throw signal.reason

  const target = toVec3(position)
  let block = bot.blockAt(target)
  if (!block || block.name === 'air' || block.boundingBox === 'empty') {
    throw new Error(`there is no breakable block at ${target.x},${target.y},${target.z}`)
  }

  const distance = bot.entity.position.distanceTo(
    target.offset(0.5, 0.5, 0.5)
  )
  if (distance > maxDistance) {
    if (!bot.pathfinder) throw new Error('the target block is out of reach')
    await bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 3))
  }
  if (signal && signal.aborted) throw signal.reason

  block = bot.blockAt(target)
  if (!block || block.name === 'air' || block.boundingBox === 'empty') {
    throw new Error(`the block at ${target.x},${target.y},${target.z} disappeared before it could be broken`)
  }
  if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(block)) {
    throw new Error(`${block.name} at ${target.x},${target.y},${target.z} is not reachable or breakable`)
  }

  await bot.dig(block, true)
  if (signal && signal.aborted) throw signal.reason

  const remaining = bot.blockAt(target)
  if (remaining && remaining.name !== 'air' && remaining.boundingBox !== 'empty') {
    throw new Error(`the server did not confirm that ${block.name} was removed`)
  }

  return {
    block: block.name,
    position: { x: target.x, y: target.y, z: target.z },
    broken: true
  }
}

module.exports = breakBlockAt
module.exports.toVec3 = toVec3
