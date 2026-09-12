function getInventory(bot) {
  return bot.inventory.items().map(item => ({
    name: item.name,
    count: item.count
  }))
}

module.exports = getInventory