const { goals } = require('mineflayer-pathfinder')
const findNearbyContainer = require('./findNearbyContainer')

async function storeItem(bot, itemName, amount = 1) {
  const matchingItems = bot.inventory.items()
    .filter((item) => item.name === itemName)

  const available = matchingItems
    .reduce((total, item) => total + item.count, 0)

  if (available < amount) {
    bot.chat(`I only have ${available} ${itemName}.`)
    return false
  }

  const containerBlock = findNearbyContainer(bot)

  if (!containerBlock) {
    bot.chat('I cannot find a chest or barrel within 16 blocks.')
    return false
  }

  let container = null

  try {
    await bot.pathfinder.goto(
      new goals.GoalNear(
        containerBlock.position.x,
        containerBlock.position.y,
        containerBlock.position.z,
        2
      )
    )

    const currentBlock = bot.blockAt(containerBlock.position)
    container = await bot.openContainer(currentBlock)

    await container.deposit(
      matchingItems[0].type,
      null,
      amount
    )

    console.log(`Stored ${amount} ${itemName}.`)
    bot.chat(`Stored ${amount} ${itemName}.`)

    return true
  } catch (error) {
    console.error(`Storing failed: ${error.message}`)
    bot.chat(`I could not store ${itemName}.`)
    return false
  } finally {
    if (container) {
      container.close()
    }
  }
}

module.exports = storeItem
