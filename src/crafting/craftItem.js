async function craftItem(bot, itemName, amount = 1) {
  const item = bot.registry.itemsByName[itemName]

  if (!item) {
    console.log(`Unknown item: ${itemName}`)
    return false
  }

  const recipes = bot.recipesFor(item.id, null, 1, null)

  if (recipes.length === 0) {
    console.log(`No currently craftable inventory recipe found for ${itemName}.`)
    return false
  }

  const recipe = recipes[0]
  const outputPerCraft = recipe.result && recipe.result.count
    ? recipe.result.count
    : 1
  const craftCount = Math.ceil(amount / outputPerCraft)

  try {
    await bot.craft(recipe, craftCount, null)
    console.log(`Crafted ${itemName} (requested ${amount}).`)
    bot.chat(`Crafted ${itemName}.`)
    return true
  } catch (error) {
    console.log(`Crafting failed: ${error.message}`)
    return false
  }
}

module.exports = craftItem
