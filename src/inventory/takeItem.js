const { goals } = require('mineflayer-pathfinder')
const findNearbyContainer = require('./findNearbyContainer')

async function takeItem(bot, itemName, amount = 1) {
  const itemType = bot.registry.itemsByName[itemName]

  if (!itemType) {
    bot.chat(`I do not recognize ${itemName}.`)
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

    const available = container.containerItems()
      .filter((item) => item.name === itemName)
      .reduce((total, item) => total + item.count, 0)

    if (available < amount) {
      bot.chat(`The container only has ${available} ${itemName}.`)
      return false
    }

    await container.withdraw(itemType.id, null, amount)

    console.log(`Took ${amount} ${itemName}.`)
    bot.chat(`Took ${amount} ${itemName}.`)

    return true
  } catch (error) {
    console.error(`Taking item failed: ${error.message}`)
    bot.chat(`I could not take ${itemName}.`)
    return false
  } finally {
    if (container) {
      container.close()
    }
  }
}

module.exports = takeItem
