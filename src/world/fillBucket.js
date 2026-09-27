const { goals } = require('mineflayer-pathfinder')
const { inventoryCount, waitForCondition } = require('../actions/verifiedState')

function isSourceWater(block) {
  if (!block || block.name !== 'water') return false
  try {
    const properties = typeof block.getProperties === 'function'
      ? block.getProperties()
      : {}
    return properties.level === undefined || Number(properties.level) === 0
  } catch {
    return block.metadata === undefined || Number(block.metadata) === 0
  }
}

async function fillBucket(bot, options = {}) {
  const { signal, maxDistance = 32 } = options
  if (signal && signal.aborted) throw signal.reason
  const empty = bot.inventory.items().find((item) => item.name === 'bucket')
  if (!empty) throw new Error('I do not have an empty bucket')
  const water = bot.registry.blocksByName.water
  if (!water) throw new Error('this Minecraft version has no water block')

  const positions = bot.findBlocks({ matching: water.id, maxDistance, count: 64 })
  const source = positions
    .map((position) => bot.blockAt(position))
    .filter(isSourceWater)
    .sort((a, b) => (
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
    ))[0]
  if (!source) throw new Error(`I cannot find source water within ${maxDistance} blocks`)

  if (bot.entity.position.distanceTo(source.position) > 4) {
    await bot.pathfinder.goto(new goals.GoalNear(
      source.position.x, source.position.y, source.position.z, 3
    ))
  }
  if (signal && signal.aborted) throw signal.reason
  await bot.equip(empty, 'hand')
  const bucketsBefore = inventoryCount(bot, 'bucket')
  const waterBefore = inventoryCount(bot, 'water_bucket')
  await bot.activateBlock(bot.blockAt(source.position))
  const confirmed = await waitForCondition(bot, () => (
    inventoryCount(bot, 'water_bucket') > waterBefore &&
    inventoryCount(bot, 'bucket') < bucketsBefore
  ), { signal, ticks: 40 })
  if (!confirmed) throw new Error('the server did not confirm filling the bucket')

  return {
    status: 'completed',
    source: { x: source.position.x, y: source.position.y, z: source.position.z },
    bucketBefore: bucketsBefore,
    bucketAfter: inventoryCount(bot, 'bucket'),
    waterBucketBefore: waterBefore,
    waterBucketAfter: inventoryCount(bot, 'water_bucket')
  }
}

module.exports = fillBucket
module.exports.isSourceWater = isSourceWater
