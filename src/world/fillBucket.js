const { goals } = require('mineflayer-pathfinder')
const { inventoryCount, waitForCondition } = require('../actions/verifiedState')
const { configureSafeMovements } = require('../movement/configureDoorTraversal')

const HORIZONTAL_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

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

function isDryPassable(block) {
  return Boolean(block) &&
    block.name !== 'water' && block.name !== 'lava' &&
    block.boundingBox === 'empty'
}

function safeStandForSource(bot, source) {
  const above = bot.blockAt(source.position.offset(0, 1, 0))
  if (!isDryPassable(above)) return null
  for (const [x, z] of HORIZONTAL_OFFSETS) {
    const feet = source.position.offset(x, 1, z)
    const footBlock = bot.blockAt(feet)
    const headBlock = bot.blockAt(feet.offset(0, 1, 0))
    const support = bot.blockAt(feet.offset(0, -1, 0))
    if (
      isDryPassable(footBlock) && isDryPassable(headBlock) &&
      support && support.boundingBox === 'block'
    ) return feet
  }
  return null
}

async function fillBucket(bot, options = {}) {
  const { signal, maxDistance = 32 } = options
  if (signal && signal.aborted) throw signal.reason
  const empty = bot.inventory.items().find((item) => item.name === 'bucket')
  if (!empty) throw new Error('I do not have an empty bucket')
  const water = bot.registry.blocksByName.water
  if (!water) throw new Error('this Minecraft version has no water block')

  const positions = bot.findBlocks({ matching: water.id, maxDistance, count: 64 })
  const candidates = positions
    .map((position) => bot.blockAt(position))
    .filter(isSourceWater)
    .map((source) => ({ source, stand: safeStandForSource(bot, source) }))
    .filter((candidate) => candidate.stand)
    .sort((a, b) => (
      bot.entity.position.distanceTo(a.stand) -
      bot.entity.position.distanceTo(b.stand)
    ))
  const candidate = candidates[0]
  if (!candidate) {
    throw new Error(
      `I cannot find exposed source water with a dry, solid standing place within ${maxDistance} blocks`
    )
  }
  const { source, stand } = candidate

  if (bot.entity.position.distanceTo(stand) > 1.25) {
    const movements = configureSafeMovements(bot)
    if (movements && 'liquidCost' in movements) movements.liquidCost = 100
    await bot.pathfinder.goto(new goals.GoalBlock(stand.x, stand.y, stand.z))
  }
  if (signal && signal.aborted) throw signal.reason
  const feet = bot.entity.position.floored()
  const currentFeet = bot.blockAt(feet)
  if (!isDryPassable(currentFeet) || bot.entity.position.distanceTo(stand) > 1.5) {
    throw new Error('I could not reach the dry standing place beside source water')
  }
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
module.exports.safeStandForSource = safeStandForSource
