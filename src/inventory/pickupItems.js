const { goals } = require('mineflayer-pathfinder')

function isDroppedItem(entity) {
  return Boolean(
    entity &&
    entity.position &&
    (
      entity.name === 'item' ||
      entity.objectType === 'Item' ||
      typeof entity.getDroppedItem === 'function'
    )
  )
}

function inventoryCount(bot) {
  return bot.inventory.items().reduce(
    (total, item) => total + item.count,
    0
  )
}

async function waitForPickup(bot) {
  if (typeof bot.waitForTicks === 'function') {
    await bot.waitForTicks(10)
  } else {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function pickupItems(bot, options = {}) {
  const {
    signal,
    maxDistance = 16,
    maxItems = 16
  } = options
  const before = inventoryCount(bot)
  const targets = Object.values(bot.entities || {})
    .filter(isDroppedItem)
    .filter((entity) => (
      bot.entity.position.distanceTo(entity.position) <= maxDistance
    ))
    .sort((a, b) => (
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
    ))
    .slice(0, maxItems)

  for (const target of targets) {
    if (signal && signal.aborted) throw signal.reason
    if (!Object.values(bot.entities || {}).includes(target)) continue

    await bot.pathfinder.goto(
      new goals.GoalNear(
        target.position.x,
        target.position.y,
        target.position.z,
        1
      )
    )
    await waitForPickup(bot)
  }

  const pickedUp = Math.max(0, inventoryCount(bot) - before)
  console.log(`Earl picked up ${pickedUp} dropped items.`)
  return {
    targets: targets.length,
    pickedUp
  }
}

module.exports = pickupItems
module.exports.isDroppedItem = isDroppedItem
