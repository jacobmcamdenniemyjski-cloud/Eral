const { goals } = require('mineflayer-pathfinder')

const FIXED_FUELS = {
  lava_bucket: 100,
  coal_block: 80,
  dried_kelp_block: 20,
  blaze_rod: 12,
  coal: 8,
  charcoal: 8,
  stick: 0.5,
  bamboo: 0.25
}

function fuelCapacity(itemName) {
  if (FIXED_FUELS[itemName]) return FIXED_FUELS[itemName]
  if (/(?:_planks|_log|_wood|_stem|_hyphae)$/.test(itemName)) return 1.5
  return 0
}

function inventoryCount(bot, itemName) {
  return bot.inventory.items()
    .filter((item) => item.name === itemName)
    .reduce((total, item) => total + item.count, 0)
}

function selectFuel(bot, amount, requestedFuel = null) {
  const candidates = requestedFuel
    ? [requestedFuel]
    : [
        'coal',
        'charcoal',
        'dried_kelp_block',
        'blaze_rod',
        'coal_block',
        ...bot.inventory.items().map((item) => item.name)
      ]

  for (const name of [...new Set(candidates)]) {
    const capacity = fuelCapacity(name)
    if (!capacity) continue

    const required = Math.ceil(amount / capacity)
    if (inventoryCount(bot, name) >= required) {
      const item = bot.inventory.items().find((entry) => entry.name === name)
      return { item, count: required, capacity }
    }
  }

  return null
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('Smelting was cancelled.')
  }
}

function waitForOutput(furnace, amount, options = {}) {
  const { signal, timeoutMs = amount * 12000 + 10000 } = options

  return new Promise((resolve, reject) => {
    let timer = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      furnace.removeListener('update', check)
      if (signal) signal.removeEventListener('abort', abort)
    }

    const finish = (callback, value) => {
      cleanup()
      callback(value)
    }

    const check = () => {
      const output = furnace.outputItem()
      if (output && output.count >= amount) finish(resolve, output)
    }

    const abort = () => finish(
      reject,
      signal.reason || new Error('Smelting was cancelled.')
    )

    timer = setTimeout(() => finish(
      reject,
      new Error(`furnace did not produce ${amount} items in time`)
    ), timeoutMs)

    furnace.on('update', check)
    if (signal) signal.addEventListener('abort', abort, { once: true })
    check()
  })
}

async function smeltItem(bot, inputName, amount = 1, options = {}) {
  const { fuel: requestedFuel = null, signal } = options
  throwIfCancelled(signal)

  const input = bot.inventory.items()
    .find((item) => item.name === inputName && item.count >= amount)

  if (!input) {
    throw new Error(`I do not have ${amount} ${inputName}`)
  }

  if (requestedFuel && !fuelCapacity(requestedFuel)) {
    throw new Error(`${requestedFuel} is not a supported furnace fuel`)
  }

  const fuel = selectFuel(bot, amount, requestedFuel)
  if (!fuel) {
    throw new Error(
      requestedFuel
        ? `I do not have enough ${requestedFuel}`
        : 'I need furnace fuel such as coal, charcoal, wood, or planks'
    )
  }

  const furnaceType = bot.registry.blocksByName.furnace
  if (!furnaceType) throw new Error('this Minecraft version has no furnace block')

  const furnaceBlock = bot.findBlock({
    matching: furnaceType.id,
    maxDistance: 16
  })

  if (!furnaceBlock) {
    throw new Error('I cannot find a furnace within 16 blocks')
  }

  let furnace = null

  try {
    await bot.pathfinder.goto(new goals.GoalNear(
      furnaceBlock.position.x,
      furnaceBlock.position.y,
      furnaceBlock.position.z,
      2
    ))
    throwIfCancelled(signal)

    furnace = await bot.openFurnace(bot.blockAt(furnaceBlock.position))

    if (furnace.inputItem()) {
      throw new Error('the nearby furnace input slot is already occupied')
    }

    if (furnace.outputItem()) {
      await furnace.takeOutput()
    }

    const existingFuel = furnace.fuelItem()
    if (existingFuel && existingFuel.name !== fuel.item.name) {
      throw new Error(`the furnace already contains ${existingFuel.name} fuel`)
    }

    await furnace.putInput(input.type, input.metadata ?? null, amount)
    await furnace.putFuel(fuel.item.type, fuel.item.metadata ?? null, fuel.count)

    throwIfCancelled(signal)
    await waitForOutput(furnace, amount, { signal })
    throwIfCancelled(signal)

    const output = await furnace.takeOutput()
    const result = {
      input: inputName,
      output: output.name,
      count: output.count,
      fuel: fuel.item.name,
      fuelUsed: fuel.count
    }

    console.log(`Smelted ${amount} ${inputName} into ${output.count} ${output.name}.`)
    bot.chat(`Smelted ${amount} ${inputName} into ${output.count} ${output.name}.`)
    return result
  } finally {
    if (furnace) furnace.close()
  }
}

module.exports = smeltItem
module.exports.fuelCapacity = fuelCapacity
module.exports.selectFuel = selectFuel
module.exports.waitForOutput = waitForOutput
