const { goals } = require('mineflayer-pathfinder')
const findCraftingTable = require('./findCraftingTable')
const selectRecipe = require('./selectRecipe')
const getMissingIngredients = require('./getMissingIngredients')
const {
  inventoryCount,
  waitForCondition,
  waitTicks
} = require('../actions/verifiedState')

function getCraftCount(recipe, amount) {
  return Math.ceil(amount / (recipe.result.count || 1))
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Crafting was cancelled.')
  }
}

function chooseClosestRecipe(bot, recipes, amount) {
  let best = null

  for (const recipe of recipes) {
    const craftCount = getCraftCount(recipe, amount)
    const missing = getMissingIngredients(bot, recipe, craftCount)
    const missingCount = missing.reduce(
      (total, ingredient) => total + ingredient.count,
      0
    )

    if (!best || missingCount < best.missingCount) {
      best = { recipe, craftCount, missing, missingCount }
    }
  }

  return best
}

function reportMissingIngredients(bot, recipes, itemName, amount) {
  const closest = chooseClosestRecipe(bot, recipes, amount)

  if (!closest || closest.missing.length === 0) {
    bot.chat(`I cannot currently craft ${itemName}.`)
    return
  }

  const list = closest.missing
    .map((ingredient) => `${ingredient.count} ${ingredient.name}`)
    .join(', ')

  console.log(`Missing ingredients for ${itemName}: ${list}.`)
  bot.chat(`To craft ${itemName}, I still need ${list}.`)
}

async function performCraft(
  bot,
  selection,
  craftingTable,
  itemName,
  amount,
  options = {}
) {
  const {
    signal,
    announce = true,
    maxAttempts = 2
  } = options
  throwIfCancelled(signal)

  const outputId = selection.recipe.result.id
  const expectedIncrease = (selection.recipe.result.count || 1) *
    selection.craftCount
  const ingredientIds = selection.recipe.delta
    .filter((change) => change.count < 0)
    .map((change) => change.id)
  const beforeOutput = inventoryCount(bot, outputId)
  const beforeIngredients = new Map(
    ingredientIds.map((id) => [id, inventoryCount(bot, id)])
  )
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfCancelled(signal)
    let craftError = null
    try {
      await bot.craft(
        selection.recipe,
        selection.craftCount,
        craftingTable
      )
    } catch (error) {
      craftError = error
      lastError = error
    }

    throwIfCancelled(signal)
    const confirmed = await waitForCondition(bot, () => {
      const afterOutput = inventoryCount(bot, outputId)
      return afterOutput - beforeOutput >= expectedIncrease
        ? afterOutput
        : null
    }, { signal, ticks: 12 })
    const afterOutput = inventoryCount(bot, outputId)
    const ingredientChanges = ingredientIds.map((id) => ({
      id,
      before: beforeIngredients.get(id) || 0,
      after: inventoryCount(bot, id)
    }))
    const inventoryChanged = afterOutput !== beforeOutput ||
      ingredientChanges.some((entry) => entry.after !== entry.before)

    if (confirmed !== null) {
      const result = {
        status: 'completed',
        item: itemName,
        requested: amount,
        crafted: afterOutput - beforeOutput,
        attempts: attempt,
        reconciledAfterError: Boolean(craftError),
        evidence: {
          outputBefore: beforeOutput,
          outputAfter: afterOutput,
          expectedIncrease,
          ingredientChanges
        }
      }
      if (craftError) {
        console.log(
          `[craft] ${itemName} appeared despite error: ${craftError.message}`
        )
      }
      if (announce) {
        console.log(`Crafted ${itemName} (requested ${amount}).`)
        bot.chat(`Crafted ${itemName}.`)
      }
      return result
    }

    if (inventoryChanged) {
      const error = new Error(
        `inventory changed but the server did not confirm ${itemName} output`
      )
      error.code = 'CRAFT_DESYNC'
      error.evidence = {
        outputBefore: beforeOutput,
        outputAfter: afterOutput,
        expectedIncrease,
        ingredientChanges
      }
      throw error
    }

    if (attempt < maxAttempts) {
      console.log(
        `[craft] retrying ${itemName}; attempt ${attempt} changed no inventory.`
      )
      await waitTicks(bot, 2)
      continue
    }

    throw craftError || new Error(
      `the server did not confirm ${itemName} in inventory`
    )
  }

  throw lastError || new Error(`could not craft ${itemName}`)
}

async function moveToCraftingTable(bot, signal) {
  const nearbyTable = findCraftingTable(bot)

  if (!nearbyTable) {
    bot.chat('I need a crafting table within 16 blocks.')
    return null
  }

  throwIfCancelled(signal)
  await bot.pathfinder.goto(
    new goals.GoalNear(
      nearbyTable.position.x,
      nearbyTable.position.y,
      nearbyTable.position.z,
      2
    )
  )
  throwIfCancelled(signal)

  const craftingTable = bot.blockAt(nearbyTable.position)

  if (!craftingTable || craftingTable.name !== 'crafting_table') {
    bot.chat('The crafting table is no longer there.')
    return null
  }

  return craftingTable
}

async function craftItem(bot, itemName, amount = 1, options = {}) {
  const {
    signal,
    recipe: plannedRecipe = null,
    announce = true
  } = options
  const item = bot.registry.itemsByName[itemName]

  if (!item) {
    console.log(`Unknown item: ${itemName}`)
    bot.chat(`I do not recognize ${itemName}.`)
    return false
  }

  try {
    throwIfCancelled(signal)

    if (plannedRecipe) {
      const craftCount = getCraftCount(plannedRecipe, amount)
      const missing = getMissingIngredients(bot, plannedRecipe, craftCount)

      if (missing.length > 0) {
        if (announce) {
          reportMissingIngredients(
            bot,
            [plannedRecipe],
            itemName,
            amount
          )
        }
        return false
      }

      const craftingTable = plannedRecipe.requiresTable
        ? await moveToCraftingTable(bot, signal)
        : null

      if (plannedRecipe.requiresTable && !craftingTable) return false

      return await performCraft(
        bot,
        { recipe: plannedRecipe, craftCount },
        craftingTable,
        itemName,
        amount,
        { signal, announce }
      )
    }

    const inventorySelection = selectRecipe(
      bot,
      item.id,
      amount,
      null
    )

    if (inventorySelection) {
      return await performCraft(
        bot,
        inventorySelection,
        null,
        itemName,
        amount,
        { signal, announce }
      )
    }

    // A truthy placeholder lets recipesAll include table recipes for
    // inspection. It is never passed to bot.craft.
    const allRecipes = bot.recipesAll(item.id, null, {})

    if (allRecipes.length === 0) {
      bot.chat(`There is no crafting recipe for ${itemName}.`)
      return false
    }

    const inventoryRecipes = allRecipes.filter(
      (recipe) => !recipe.requiresTable
    )
    const tableRecipes = allRecipes.filter(
      (recipe) => recipe.requiresTable
    )

    if (tableRecipes.length === 0) {
      reportMissingIngredients(
        bot,
        inventoryRecipes,
        itemName,
        amount
      )
      return false
    }

    const craftingTable = await moveToCraftingTable(bot, signal)

    if (!craftingTable) {
      if (inventoryRecipes.length > 0) {
        reportMissingIngredients(
          bot,
          inventoryRecipes,
          itemName,
          amount
        )
      }

      return false
    }

    const tableSelection = selectRecipe(
      bot,
      item.id,
      amount,
      craftingTable
    )

    if (!tableSelection) {
      reportMissingIngredients(
        bot,
        allRecipes,
        itemName,
        amount
      )
      return false
    }

    return await performCraft(
      bot,
      tableSelection,
      craftingTable,
      itemName,
      amount,
      { signal, announce }
    )

  } catch (error) {
    if (signal && signal.aborted) throw error

    console.error(`Crafting failed: ${error.message}`)
    bot.chat(`I could not craft ${itemName}: ${error.message}`)
    return false
  }
}

module.exports = craftItem
module.exports.performCraft = performCraft
