function selectRecipe(bot, itemId, amount, craftingTable = null) {
  const recipes = bot.recipesFor(
    itemId,
    null,
    amount,
    craftingTable
  )

  if (recipes.length === 0) {
    return null
  }

  const recipe = recipes[0]
  const outputPerCraft = recipe.result.count || 1

  return {
    recipe,
    craftCount: Math.ceil(amount / outputPerCraft)
  }
}

module.exports = selectRecipe
