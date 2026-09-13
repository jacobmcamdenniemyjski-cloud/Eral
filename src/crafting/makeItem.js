const craftItem = require('./craftItem')
const findCraftingTable = require('./findCraftingTable')

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Multi-step crafting was cancelled.')
  }
}

function getInventoryCounts(bot) {
  const counts = new Map()

  for (const item of bot.inventory.items()) {
    counts.set(item.type, (counts.get(item.type) || 0) + item.count)
  }

  return counts
}

function getItemName(bot, itemId) {
  const item = bot.registry.items[itemId]
  return item ? item.name : `item_${itemId}`
}

function addMissing(target, source) {
  for (const [itemId, count] of source) {
    target.set(itemId, (target.get(itemId) || 0) + count)
  }
}

function missingTotal(missing) {
  return Array.from(missing.values())
    .reduce((total, count) => total + count, 0)
}

function createMissingResult(inventory, steps, itemId, amount) {
  const available = inventory.get(itemId) || 0
  const shortfall = Math.max(0, amount - available)
  const nextInventory = new Map(inventory)

  // Add the absent material virtually so parent recipes can continue and
  // report every raw ingredient needed instead of stopping at the first one.
  nextInventory.set(itemId, amount)

  return {
    inventory: nextInventory,
    steps: [...steps],
    missing: new Map(shortfall > 0 ? [[itemId, shortfall]] : [])
  }
}

function planItem(bot, itemId, amount, inventory, steps, context) {
  const available = inventory.get(itemId) || 0
  if (available >= amount) {
    return { inventory, steps, missing: new Map() }
  }

  if (
    context.depth >= context.maxDepth ||
    context.visiting.has(itemId)
  ) {
    return createMissingResult(inventory, steps, itemId, amount)
  }

  const recipes = bot.recipesAll(itemId, null, {})

  if (recipes.length === 0) {
    return createMissingResult(inventory, steps, itemId, amount)
  }

  let bestResult = null

  for (const recipe of recipes) {
    const branchInventory = new Map(inventory)
    let branchSteps = [...steps]
    const branchMissing = new Map()
    const needed = amount - available
    const craftCount = Math.ceil(needed / (recipe.result.count || 1))
    const visiting = new Set(context.visiting)
    visiting.add(itemId)

    for (const ingredient of recipe.delta.filter((change) => change.count < 0)) {
      const required = Math.abs(ingredient.count) * craftCount
      const dependency = planItem(
        bot,
        ingredient.id,
        required,
        branchInventory,
        branchSteps,
        {
          ...context,
          depth: context.depth + 1,
          visiting
        }
      )

      branchSteps = dependency.steps
      addMissing(branchMissing, dependency.missing)

      const dependencyInventory = new Map(dependency.inventory)
      branchInventory.clear()
      for (const [id, count] of dependencyInventory) {
        branchInventory.set(id, count)
      }

      branchInventory.set(
        ingredient.id,
        (branchInventory.get(ingredient.id) || 0) - required
      )
    }

    for (const product of recipe.delta.filter((change) => change.count > 0)) {
      branchInventory.set(
        product.id,
        (branchInventory.get(product.id) || 0) + product.count * craftCount
      )
    }

    branchSteps.push({
      itemId,
      itemName: getItemName(bot, itemId),
      recipe,
      craftCount,
      outputCount: (recipe.result.count || 1) * craftCount
    })

    const result = {
      inventory: branchInventory,
      steps: branchSteps,
      missing: branchMissing
    }

    if (!bestResult || missingTotal(result.missing) < missingTotal(bestResult.missing)) {
      bestResult = result
    }

    if (result.missing.size === 0) break
  }

  return bestResult
}

function createCraftingPlan(bot, itemId, amount, options = {}) {
  const inventory = getInventoryCounts(bot)
  const desiredTotal = (inventory.get(itemId) || 0) + amount

  return planItem(bot, itemId, desiredTotal, inventory, [], {
    depth: 0,
    maxDepth: options.maxDepth || 8,
    visiting: new Set()
  })
}

function formatMissing(bot, missing) {
  return Array.from(missing)
    .map(([itemId, count]) => `${count} ${getItemName(bot, itemId)}`)
    .join(', ')
}

async function makeItem(bot, itemName, amount = 1, options = {}) {
  const { signal, maxSteps = 32 } = options
  const item = bot.registry.itemsByName[itemName]

  if (!item) {
    bot.chat(`I do not recognize ${itemName}.`)
    return false
  }

  throwIfCancelled(signal)
  const plan = createCraftingPlan(bot, item.id, amount)

  if (plan.missing.size > 0) {
    const missing = formatMissing(bot, plan.missing)
    console.log(`Cannot make ${itemName}; missing ${missing}.`)
    bot.chat(`To make ${itemName}, I still need ${missing}.`)
    return false
  }

  if (plan.steps.length === 0) {
    bot.chat(`I already have enough ${itemName}.`)
    return true
  }

  if (plan.steps.length > maxSteps) {
    bot.chat(`Making ${itemName} requires too many crafting steps.`)
    return false
  }

  if (
    plan.steps.some((step) => step.recipe.requiresTable) &&
    !findCraftingTable(bot)
  ) {
    bot.chat('I need a crafting table within 16 blocks for that plan.')
    return false
  }

  console.log(
    `Making ${amount} ${itemName} in ${plan.steps.length} crafting steps.`
  )

  for (const step of plan.steps) {
    throwIfCancelled(signal)

    const crafted = await craftItem(
      bot,
      step.itemName,
      step.outputCount,
      {
        signal,
        recipe: step.recipe,
        announce: false
      }
    )

    if (!crafted) {
      bot.chat(`The crafting plan stopped at ${step.itemName}.`)
      return false
    }

    console.log(
      `Crafting plan completed ${step.itemName} (${step.craftCount} crafts).`
    )
  }

  throwIfCancelled(signal)
  bot.chat(`Made ${amount} ${itemName}.`)
  console.log(`Made ${amount} ${itemName}.`)
  return true
}

module.exports = makeItem
module.exports.createCraftingPlan = createCraftingPlan
