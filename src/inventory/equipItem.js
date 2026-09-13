function getDestination(itemName) {
  if (itemName.endsWith('_helmet')) {
    return 'head'
  }

  if (itemName.endsWith('_chestplate') || itemName === 'elytra') {
    return 'torso'
  }

  if (itemName.endsWith('_leggings')) {
    return 'legs'
  }

  if (itemName.endsWith('_boots')) {
    return 'feet'
  }

  return 'hand'
}

async function equipItem(bot, itemName) {
  const item = bot.inventory.items()
    .find((inventoryItem) => inventoryItem.name === itemName)

  if (!item) {
    bot.chat(`I do not have ${itemName}.`)
    return false
  }

  const destination = getDestination(itemName)

  try {
    await bot.equip(item, destination)

    console.log(`Equipped ${itemName} in ${destination}.`)
    bot.chat(`Equipped ${itemName}.`)

    return true
  } catch (error) {
    console.error(`Equipping failed: ${error.message}`)
    bot.chat(`I could not equip ${itemName}.`)
    return false
  }
}

module.exports = equipItem
