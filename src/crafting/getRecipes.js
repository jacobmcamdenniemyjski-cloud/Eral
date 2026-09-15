function itemName(bot, id) {
  const item = bot.registry.items && bot.registry.items[id]
  return item ? item.name : `item_${id}`
}

function summarizeIngredients(bot, recipe) {
  if (Array.isArray(recipe.delta)) {
    return recipe.delta
      .filter((entry) => entry.count < 0)
      .map((entry) => ({
        item: itemName(bot, entry.id),
        count: Math.abs(entry.count)
      }))
  }

  if (Array.isArray(recipe.ingredients)) {
    const counts = new Map()
    for (const ingredient of recipe.ingredients.flat(Infinity)) {
      if (!ingredient) continue
      const id = ingredient.id === undefined ? ingredient.type : ingredient.id
      const count = Math.abs(ingredient.count || 1)
      const name = itemName(bot, id)
      counts.set(name, (counts.get(name) || 0) + count)
    }
    return [...counts.entries()].map(([item, count]) => ({ item, count }))
  }

  return []
}

function getRecipes(bot, requestedItem) {
  const item = bot.registry.itemsByName[requestedItem]
  if (!item) throw new Error(`Unknown item: ${requestedItem}`)

  const recipes = bot.recipesAll(item.id, null, {}) || []
  return {
    item: requestedItem,
    recipes: recipes.slice(0, 12).map((recipe) => ({
      resultCount: recipe.result && recipe.result.count
        ? recipe.result.count
        : 1,
      requiresTable: Boolean(recipe.requiresTable),
      ingredients: summarizeIngredients(bot, recipe)
    }))
  }
}

module.exports = getRecipes
module.exports.summarizeIngredients = summarizeIngredients
