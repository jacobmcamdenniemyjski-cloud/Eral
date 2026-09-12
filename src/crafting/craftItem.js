async function craftItem(bot, itemName, recipeCount = 1) {
  const item = bot.registry.itemsByName[itemName]

  if (!item) {
    console.log(`Unknown item: ${itemName}`)
    return false
  }

  const recipes = bot.recipesFor(item.id, null, 1, null)

  if (recipes.length === 0) {
    console.log(`No craftable recipe found for ${itemName}.`)
    return false
  }

  try {
    await bot.craft(recipes[0], recipeCount, null)
    console.log(`Crafted ${itemName}.`)
    return true
  } catch (error) {
    console.log(`Crafting failed: ${error.message}`)
    return false
  }
}

module.exports = craftItem