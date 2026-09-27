const { goals } = require('mineflayer-pathfinder')
const { findNearbyContainers } = require('./findNearbyContainer')

async function storeItem(bot, itemName, amount = 1) {
  const matchingItems = bot.inventory.items()
    .filter((item) => item.name === itemName)

  const available = matchingItems
    .reduce((total, item) => total + item.count, 0)

  if (available < amount) {
    bot.chat(`I only have ${available} ${itemName}.`)
    return false
  }

  const containerBlocks = findNearbyContainers(bot)

  if (containerBlocks.length === 0) {
    bot.chat('I cannot find a chest or barrel within 16 blocks.')
    return false
  }

  const failures = []
  let fullContainers = 0
  for (const containerBlock of containerBlocks) {
    let container = null
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        containerBlock.position.x, containerBlock.position.y,
        containerBlock.position.z, 2
      ))
      const currentBlock = bot.blockAt(containerBlock.position)
      container = await bot.openContainer(currentBlock)
      await container.deposit(matchingItems[0].type, null, amount)
      console.log(`Stored ${amount} ${itemName}.`)
      bot.chat(`Stored ${amount} ${itemName}.`)
      return {
        status: 'completed', amount, item: itemName,
        container: { x: currentBlock.position.x, y: currentBlock.position.y, z: currentBlock.position.z }
      }
    } catch (error) {
      const message = String(error.message || error)
      if (/full|no empty|not enough room|destination/i.test(message)) fullContainers += 1
      failures.push({
        position: containerBlock.position,
        message
      })
    } finally {
      if (container) container.close()
    }
  }

  const allFull = fullContainers === containerBlocks.length
  const message = allFull
    ? `Every reachable nearby container is full; I could not store ${itemName}.`
    : `I could not open or use any nearby container for ${itemName}.`
  console.error(`Storing failed: ${JSON.stringify(failures)}`)
  bot.chat(message)
  return { status: 'failed', code: allFull ? 'CONTAINERS_FULL' : 'NO_USABLE_CONTAINER', message, failures }
}

module.exports = storeItem
