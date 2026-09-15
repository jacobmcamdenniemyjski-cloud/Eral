const getStatus = require('./getStatus')
const getInventory = require('./getInventory')
const getNearbyEntities = require('./getNearbyEntities')

const INTERESTING_BLOCK = /(?:_bed|_door|_fence_gate|chest|barrel|furnace|crafting_table|farmland|wheat|carrots|potatoes|beetroots|_ore)$/

function distance(bot, position) {
  return Math.round(bot.entity.position.distanceTo(position) * 10) / 10
}

function getVisibleBlocks(bot, range) {
  if (typeof bot.findBlocks !== 'function') return []

  const positions = bot.findBlocks({
    matching: (block) => Boolean(block && INTERESTING_BLOCK.test(block.name)),
    maxDistance: range,
    count: 128
  }) || []
  const groups = new Map()

  for (const position of positions) {
    const block = bot.blockAt(position)
    if (!block) continue
    if (
      typeof bot.canSeeBlock === 'function' &&
      !bot.canSeeBlock(block)
    ) {
      continue
    }

    const blockDistance = distance(bot, position)
    const existing = groups.get(block.name) || {
      name: block.name,
      count: 0,
      nearestDistance: blockDistance,
      nearestPosition: {
        x: position.x,
        y: position.y,
        z: position.z
      }
    }

    existing.count += 1
    if (blockDistance < existing.nearestDistance) {
      existing.nearestDistance = blockDistance
      existing.nearestPosition = {
        x: position.x,
        y: position.y,
        z: position.z
      }
    }
    groups.set(block.name, existing)
  }

  return [...groups.values()]
    .sort((a, b) => a.nearestDistance - b.nearestDistance)
    .slice(0, 24)
}

function getScene(bot, range = 16) {
  const safeRange = Math.min(Math.max(Number(range) || 16, 4), 32)
  const status = getStatus(bot)
  const entities = getNearbyEntities(bot, safeRange)
  const blocks = getVisibleBlocks(bot, safeRange)
  const inventory = getInventory(bot)

  const entityText = entities.slice(0, 8)
    .map((entry) => `${entry.name} ${entry.distance} blocks away`)
    .join(', ') || 'no nearby entities'
  const blockText = blocks.slice(0, 8)
    .map((entry) => `${entry.name} x${entry.count}`)
    .join(', ') || 'no notable visible blocks'

  return {
    range: safeRange,
    dimension: bot.game && bot.game.dimension,
    timeOfDay: bot.time && bot.time.timeOfDay,
    raining: Boolean(bot.isRaining),
    status,
    inventory,
    entities,
    visibleBlocks: blocks,
    summary:
      `At ${status.position.x}, ${status.position.y}, ${status.position.z}; ` +
      `health ${status.health}, food ${status.food}. ` +
      `Nearby: ${entityText}. Visible: ${blockText}.`
  }
}

module.exports = getScene
module.exports.getVisibleBlocks = getVisibleBlocks
