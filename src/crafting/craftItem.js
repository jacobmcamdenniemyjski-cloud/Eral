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
  const outputPerCraft = selection.recipe.result.count || 1
  const requestedCrafts = Math.max(1, Number(selection.craftCount) || 1)
  const ingredientIds = [...new Set(selection.recipe.delta
    .filter((change) => change.count < 0)
    .map((change) => change.id))]
  const transactionEvidence = []
  const totalOutputBefore = inventoryCount(bot, outputId)
  let reconciledAfterError = false

  // Mineflayer may time out waiting for updateSlot even after the server has
  // consumed ingredients. Submitting a whole batch makes an ambiguous result
  // capable of destroying many recipes at once. Commit exactly one recipe,
  // verify its inventory delta, and only then start the next transaction.
  for (let craftIndex = 0; craftIndex < requestedCrafts; craftIndex += 1) {
    let completed = false

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      throwIfCancelled(signal)
      const outputBefore = inventoryCount(bot, outputId)
      const ingredientBefore = new Map(
        ingredientIds.map((id) => [id, inventoryCount(bot, id)])
      )
      let craftError = null

      try {
        await bot.craft(selection.recipe, 1, craftingTable)
      } catch (error) {
        craftError = error
      }

      throwIfCancelled(signal)
      const confirmed = await waitForCondition(bot, () => {
        const outputAfter = inventoryCount(bot, outputId)
        return outputAfter - outputBefore >= outputPerCraft
          ? outputAfter
          : null
      }, { signal, ticks: 40 })
      const outputAfter = inventoryCount(bot, outputId)
      const ingredientChanges = ingredientIds.map((id) => ({
        id,
        before: ingredientBefore.get(id) || 0,
        after: inventoryCount(bot, id)
      }))
      const inventoryChanged = outputAfter !== outputBefore ||
        ingredientChanges.some((entry) => entry.after !== entry.before)
      const evidence = {
        craft: craftIndex + 1,
        attempt,
        outputBefore,
        outputAfter,
        expectedIncrease: outputPerCraft,
        ingredientChanges
      }

      if (confirmed !== null) {
        transactionEvidence.push(evidence)
        reconciledAfterError ||= Boolean(craftError)
        if (craftError) {
          console.log(
            `[craft] ${itemName} transaction ${craftIndex + 1} ` +
            `appeared despite error: ${craftError.message}`
          )
        }
        completed = true
        break
      }

      if (inventoryChanged) {
        const error = new Error(
          `craft transaction ${craftIndex + 1}/${requestedCrafts} changed ` +
          `inventory but did not produce ${itemName}; stopped without retrying`
        )
        error.code = 'CRAFT_DESYNC'
        error.evidence = evidence
        throw error
      }

      if (attempt < maxAttempts) {
        console.log(
          `[craft] retrying ${itemName} transaction ${craftIndex + 1}; ` +
          `attempt ${attempt} changed no inventory.`
        )
        await waitTicks(bot, 2)
        continue
      }

      throw craftError || new Error(
        `the server did not confirm ${itemName} in inventory`
      )
    }

    if (!completed) throw new Error(`could not craft ${itemName}`)
  }

  const totalOutputAfter = inventoryCount(bot, outputId)
  const crafted = totalOutputAfter - totalOutputBefore
  const expectedIncrease = outputPerCraft * requestedCrafts
  if (crafted < expectedIncrease) {
    const error = new Error(
      `verified only ${crafted}/${expectedIncrease} ${itemName}; stopped`
    )
    error.code = 'CRAFT_PARTIAL'
    error.evidence = transactionEvidence
    throw error
  }

  const result = {
    status: 'completed',
    item: itemName,
    requested: amount,
    crafted,
    attempts: transactionEvidence.reduce(
      (total, entry) => total + entry.attempt,
      0
    ),
    transactions: requestedCrafts,
    reconciledAfterError,
    evidence: {
      outputBefore: totalOutputBefore,
      outputAfter: totalOutputAfter,
      expectedIncrease,
      transactions: transactionEvidence
    }
  }
  if (announce) {
    console.log(`Crafted ${crafted} ${itemName} in ${requestedCrafts} verified transaction(s).`)
    bot.chat(`Crafted ${crafted} ${itemName}.`)
  }
  return result
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
