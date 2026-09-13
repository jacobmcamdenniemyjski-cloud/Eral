function findCraftingTable(bot, maxDistance = 16) {
  const craftingTable = bot.registry.blocksByName.crafting_table

  if (!craftingTable) {
    return null
  }

  return bot.findBlock({
    matching: craftingTable.id,
    maxDistance
  })
}

module.exports = findCraftingTable
