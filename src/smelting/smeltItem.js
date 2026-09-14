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
    throw signal.reason || new Error('Furnace work was cancelled.')
  }
}

function itemSummary(item) {
  return item ? { name: item.name, count: item.count } : null
}

function furnaceSnapshot(furnace, block) {
  return {
    position: block
      ? { x: block.position.x, y: block.position.y, z: block.position.z }
      : null,
    input: itemSummary(furnace.inputItem()),
    fuel: itemSummary(furnace.fuelItem()),
    output: itemSummary(furnace.outputItem()),
    progressPercent: Number.isFinite(furnace.progress)
      ? Math.round(furnace.progress * 100)
      : null,
    fuelSeconds: Number.isFinite(furnace.fuelSeconds)
      ? Math.max(0, Math.round(furnace.fuelSeconds * 10) / 10)
      : null
  }
}

function formatFurnaceStatus(status) {
  const show = (item) => item ? `${item.count} ${item.name}` : 'empty'
  const progress = status.progressPercent === null
    ? ''
    : `; progress ${status.progressPercent}%`

  return `Furnace: input ${show(status.input)}; fuel ${show(status.fuel)}; output ${show(status.output)}${progress}.`
}

async function openNearbyFurnace(bot, options = {}) {
  const { signal, maxDistance = 16 } = options
  throwIfCancelled(signal)

  const furnaceType = bot.registry.blocksByName.furnace
  if (!furnaceType) throw new Error('this Minecraft version has no furnace block')

  const block = bot.findBlock({
    matching: furnaceType.id,
    maxDistance
  })
  if (!block) throw new Error(`I cannot find a furnace within ${maxDistance} blocks`)

  await bot.pathfinder.goto(new goals.GoalNear(
    block.position.x,
    block.position.y,
    block.position.z,
    2
  ))
  throwIfCancelled(signal)

  const furnace = await bot.openFurnace(bot.blockAt(block.position))
  return { furnace, block }
}

function closeFurnace(furnace) {
  if (furnace && typeof furnace.close === 'function') furnace.close()
}

async function getFurnaceStatus(bot, options = {}) {
  let furnace = null

  try {
    const opened = await openNearbyFurnace(bot, options)
    furnace = opened.furnace
    const status = furnaceSnapshot(furnace, opened.block)
    const message = formatFurnaceStatus(status)
    console.log(message)
    bot.chat(message)
    return status
  } finally {
    closeFurnace(furnace)
  }
}

async function collectFurnaceOutput(bot, options = {}) {
  let furnace = null

  try {
    const opened = await openNearbyFurnace(bot, options)
    furnace = opened.furnace
    const available = furnace.outputItem()

    if (!available) {
      bot.chat('The nearby furnace has no finished output yet.')
      return { collected: null, status: furnaceSnapshot(furnace, opened.block) }
    }

    const output = await furnace.takeOutput()
    const result = {
      collected: itemSummary(output),
      status: furnaceSnapshot(furnace, opened.block)
    }
    console.log(`Collected ${output.count} ${output.name} from the furnace.`)
    bot.chat(`Collected ${output.count} ${output.name} from the furnace.`)
    return result
  } finally {
    closeFurnace(furnace)
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

function planAdditionalFuel(bot, furnace, smeltCount, requestedFuel) {
  const slotFuel = furnace.fuelItem()
  const activeSmelts = Number.isFinite(furnace.fuelSeconds)
    ? furnace.fuelSeconds / 10
    : 0
  const perItemCapacity = slotFuel ? fuelCapacity(slotFuel.name) : 0
  const slotCapacity = slotFuel
    ? slotFuel.count * perItemCapacity
    : 0
  const remainingSmelts = Math.max(0, smeltCount - activeSmelts - slotCapacity)

  if (remainingSmelts === 0) {
    return {
      item: slotFuel,
      count: 0,
      capacity: slotFuel ? fuelCapacity(slotFuel.name) : 0
    }
  }

  if (slotFuel) {
    if (perItemCapacity === 0) {
      throw new Error(
        `I cannot safely calculate the existing ${slotFuel.name} fuel; let it finish or remove it`
      )
    }

    if (requestedFuel && requestedFuel !== slotFuel.name) {
      throw new Error(
        `the furnace already contains ${slotFuel.name}; add that fuel or let it finish first`
      )
    }

    const capacity = perItemCapacity
    const count = Math.ceil(remainingSmelts / capacity)
    const item = bot.inventory.items().find((entry) => (
      entry.name === slotFuel.name
    ))

    if (!item || inventoryCount(bot, slotFuel.name) < count) {
      throw new Error(`I need ${count} more ${slotFuel.name} for this furnace load`)
    }

    return { item, count, capacity }
  }

  const fuel = selectFuel(bot, remainingSmelts, requestedFuel)
  if (!fuel) {
    throw new Error(
      requestedFuel
        ? `I do not have enough ${requestedFuel}`
        : 'I need furnace fuel such as coal, charcoal, wood, or planks'
    )
  }

  return fuel
}

async function smeltItem(bot, inputName, amount = 1, options = {}) {
  const { fuel: requestedFuel = null, signal } = options
  throwIfCancelled(signal)

  const input = bot.inventory.items().find((item) => item.name === inputName)
  if (!input || inventoryCount(bot, inputName) < amount) {
    throw new Error(`I do not have ${amount} ${inputName}`)
  }

  if (requestedFuel && !fuelCapacity(requestedFuel)) {
    throw new Error(`${requestedFuel} is not a supported furnace fuel`)
  }

  let furnace = null

  try {
    const opened = await openNearbyFurnace(bot, { signal })
    furnace = opened.furnace

    let collectedBefore = null
    if (furnace.outputItem()) {
      collectedBefore = itemSummary(await furnace.takeOutput())
    }

    const existingInput = furnace.inputItem()
    if (
      existingInput &&
      (
        existingInput.name !== inputName ||
        (existingInput.metadata ?? 0) !== (input.metadata ?? 0)
      )
    ) {
      throw new Error(`the furnace already contains ${existingInput.name}`)
    }

    const existingCount = existingInput ? existingInput.count : 0
    const stackSize = existingInput?.stackSize || input.stackSize || 64
    const totalToSmelt = existingCount + amount
    if (totalToSmelt > stackSize) {
      throw new Error(`the furnace input slot can hold only ${stackSize} items`)
    }

    const fuel = planAdditionalFuel(
      bot,
      furnace,
      totalToSmelt,
      requestedFuel
    )

    await furnace.putInput(input.type, input.metadata ?? null, amount)
    if (fuel.count > 0) {
      await furnace.putFuel(
        fuel.item.type,
        fuel.item.metadata ?? null,
        fuel.count
      )
    }

    throwIfCancelled(signal)
    await waitForOutput(furnace, totalToSmelt, { signal })
    throwIfCancelled(signal)

    const output = await furnace.takeOutput()
    const result = {
      input: inputName,
      added: amount,
      existingInput: existingCount,
      output: output.name,
      count: output.count,
      fuel: fuel.item ? fuel.item.name : furnace.fuelItem()?.name || null,
      fuelAdded: fuel.count,
      collectedBefore
    }

    console.log(`Smelted furnace load into ${output.count} ${output.name}.`)
    bot.chat(`Collected ${output.count} ${output.name} from the furnace.`)
    return result
  } finally {
    closeFurnace(furnace)
  }
}

module.exports = smeltItem
module.exports.collectFurnaceOutput = collectFurnaceOutput
module.exports.formatFurnaceStatus = formatFurnaceStatus
module.exports.fuelCapacity = fuelCapacity
module.exports.furnaceSnapshot = furnaceSnapshot
module.exports.getFurnaceStatus = getFurnaceStatus
module.exports.openNearbyFurnace = openNearbyFurnace
module.exports.planAdditionalFuel = planAdditionalFuel
module.exports.selectFuel = selectFuel
module.exports.waitForOutput = waitForOutput
