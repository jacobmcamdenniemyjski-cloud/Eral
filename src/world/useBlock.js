const { goals } = require('mineflayer-pathfinder')
const findNearestBlock = require('../perception/findNearestBlock')

async function useBlock(bot, blockName, options = {}) {
  const { signal, maxDistance = 16 } = options
  if (signal && signal.aborted) throw signal.reason

  const found = findNearestBlock(bot, blockName, maxDistance)
  if (!found) {
    throw new Error(`No ${blockName} found within ${maxDistance} blocks.`)
  }

  if (bot.entity.position.distanceTo(found.position) > 4) {
    await bot.pathfinder.goto(
      new goals.GoalNear(
        found.position.x,
        found.position.y,
        found.position.z,
        2
      )
    )
  }

  if (signal && signal.aborted) throw signal.reason
  const current = bot.blockAt(found.position)
  if (!current || current.name !== blockName) {
    throw new Error(`The nearby ${blockName} is no longer available.`)
  }

  await bot.activateBlock(current)
  return {
    block: current.name,
    position: {
      x: current.position.x,
      y: current.position.y,
      z: current.position.z
    },
    openedWindow: Boolean(bot.currentWindow)
  }
}

module.exports = useBlock
