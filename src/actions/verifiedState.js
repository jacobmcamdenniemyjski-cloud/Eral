function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Action was cancelled.')
  }
}

function waitTicks(bot, ticks = 1) {
  if (typeof bot.waitForTicks === 'function') return bot.waitForTicks(ticks)
  return new Promise((resolve) => setTimeout(resolve, ticks * 50))
}

function inventoryCount(bot, item) {
  const id = typeof item === 'number'
    ? item
    : bot.registry && bot.registry.itemsByName && bot.registry.itemsByName[item]
      ? bot.registry.itemsByName[item].id
      : null

  return (bot.inventory && typeof bot.inventory.items === 'function'
    ? bot.inventory.items()
    : [])
    .filter((entry) => (
      id !== null ? entry.type === id : entry.name === item
    ))
    .reduce((total, entry) => total + Number(entry.count || 0), 0)
}

function inventoryTotal(bot) {
  return (bot.inventory && typeof bot.inventory.items === 'function'
    ? bot.inventory.items()
    : [])
    .reduce((total, entry) => total + Number(entry.count || 0), 0)
}

async function waitForCondition(bot, predicate, options = {}) {
  const {
    signal,
    ticks = 20,
    intervalTicks = 1
  } = options

  for (let attempt = 0; attempt <= ticks; attempt += intervalTicks) {
    throwIfCancelled(signal)
    const value = predicate()
    if (value) return value
    if (attempt < ticks) await waitTicks(bot, intervalTicks)
  }
  return null
}

async function waitForInventoryIncrease(bot, item, before, options = {}) {
  const observed = await waitForCondition(bot, () => {
    const after = inventoryCount(bot, item)
    return after > before ? { before, after, delta: after - before } : null
  }, options)
  return observed || {
    before,
    after: inventoryCount(bot, item),
    delta: inventoryCount(bot, item) - before
  }
}

async function waitForBlock(bot, position, predicate, options = {}) {
  const observed = await waitForCondition(bot, () => {
    const block = bot.blockAt(position)
    return predicate(block) ? block : null
  }, options)
  return observed || bot.blockAt(position)
}

module.exports = {
  inventoryCount,
  inventoryTotal,
  throwIfCancelled,
  waitForBlock,
  waitForCondition,
  waitForInventoryIncrease,
  waitTicks
}

