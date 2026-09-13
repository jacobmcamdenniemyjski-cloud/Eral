function getMissingIngredients(bot, recipe, craftCount) {
  const missingByItem = new Map()

  for (const change of recipe.delta) {
    if (change.count >= 0) {
      continue
    }

    const required = Math.abs(change.count) * craftCount
    const available = bot.inventory.count(
      change.id,
      change.metadata
    )
    const missing = Math.max(0, required - available)

    if (missing === 0) {
      continue
    }

    const item = bot.registry.items[change.id]
    const name = item ? item.name : `item_${change.id}`
    const key = `${change.id}:${change.metadata ?? '*'}`
    const current = missingByItem.get(key)

    missingByItem.set(key, {
      name,
      count: missing + (current ? current.count : 0)
    })
  }

  return Array.from(missingByItem.values())
}

module.exports = getMissingIngredients
