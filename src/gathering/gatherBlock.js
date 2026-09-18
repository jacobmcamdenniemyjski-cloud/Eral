const withTimeout = require('../scheduler/withTimeout')
const findNearbyContainer = require('../inventory/findNearbyContainer')
const {
  inventoryCount,
  inventoryTotal,
  waitForCondition
} = require('../actions/verifiedState')

const COLLECT_TIMEOUT_MS = 30000
const PLACED_RESOURCE_PATTERNS = [
  /_planks$/,
  /_door$/,
  /_bed$/,
  /_fence$/,
  /_fence_gate$/,
  /_wall$/,
  /_stairs$/,
  /_slab$/,
  /_glass$/,
  /glass_pane$/
]
const PLACED_RESOURCE_NAMES = new Set([
  'chest', 'barrel', 'crafting_table', 'furnace', 'blast_furnace',
  'smoker', 'torch', 'wall_torch', 'lantern', 'soul_lantern', 'iron_bars'
])

function requiresExactPosition(blockName) {
  return PLACED_RESOURCE_NAMES.has(blockName) ||
    PLACED_RESOURCE_PATTERNS.some((pattern) => pattern.test(blockName))
}

function cancellationError(signal) {
  const error = signal && signal.reason instanceof Error
    ? signal.reason
    : new Error('Gathering was cancelled.')

  error.code = error.code || 'ACTION_CANCELLED'
  return error
}

function throwIfCancelled(signal) {
  if (signal && signal.aborted) {
    throw cancellationError(signal)
  }
}

async function cancelCollecting(bot) {
  if (
    bot.collectBlock &&
    typeof bot.collectBlock.cancelTask === 'function'
  ) {
    await Promise.race([
      Promise.resolve(bot.collectBlock.cancelTask()),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ])
  }

  if (bot.pathfinder) bot.pathfinder.setGoal(null)
}

function expectedDropIds(bot, blockType, blockName) {
  const drops = Array.isArray(blockType.drops)
    ? blockType.drops.map(Number).filter(Number.isFinite)
    : []
  const blockItem = bot.registry.itemsByName &&
    bot.registry.itemsByName[blockName]
  if (drops.length === 0 && blockItem) drops.push(blockItem.id)
  return [...new Set(drops)]
}

function snapshotInventory(bot, ids) {
  if (ids.length === 0) return { total: inventoryTotal(bot), items: {} }
  return {
    total: inventoryTotal(bot),
    items: Object.fromEntries(ids.map((id) => [id, inventoryCount(bot, id)]))
  }
}

function inventoryGain(bot, snapshot, ids) {
  if (ids.length === 0) return Math.max(0, inventoryTotal(bot) - snapshot.total)
  return ids.reduce((total, id) => (
    total + Math.max(0, inventoryCount(bot, id) - (snapshot.items[id] || 0))
  ), 0)
}

async function readContainerCounts(bot, container, ids) {
  if (!container || typeof bot.openContainer !== 'function') return null
  let window
  try {
    window = await bot.openContainer(container)
    const items = typeof window.containerItems === 'function'
      ? window.containerItems()
      : typeof window.items === 'function'
        ? window.items()
        : []
    return Object.fromEntries(ids.map((id) => [
      id,
      items
        .filter((item) => item.type === id)
        .reduce((total, item) => total + Number(item.count || 0), 0)
    ]))
  } catch (error) {
    console.log(`[gather] container verification unavailable: ${error.message}`)
    return null
  } finally {
    try {
      if (window && typeof window.close === 'function') window.close()
      else if (window && typeof bot.closeWindow === 'function') {
        await bot.closeWindow(window)
      }
    } catch {}
  }
}

function containerGain(before, after, ids) {
  if (!before || !after) return 0
  return ids.reduce((total, id) => (
    total + Math.max(0, (after[id] || 0) - (before[id] || 0))
  ), 0)
}

async function ensureToolEquipped(bot, blockType, blockName) {
  const validToolIds = Object.keys(blockType.harvestTools || {})
    .map(Number)

  if (validToolIds.length === 0) return true

  if (bot.heldItem && validToolIds.includes(bot.heldItem.type)) {
    return true
  }

  const tool = bot.inventory.items()
    .find((item) => validToolIds.includes(item.type))

  if (!tool) {
    console.log(`Cannot gather ${blockName}: no valid tool in inventory.`)
    bot.chat(`I need a proper tool to gather ${blockName}.`)
    return false
  }

  await bot.equip(tool, 'hand')
  return true
}

async function gatherBlock(bot, blockName, amount = 1, options = {}) {
  const { signal, isProtectedPosition = () => false } = options
  const blockType = bot.registry.blocksByName[blockName]

  if (!blockType) {
    console.log(`Unknown block: ${blockName}`)
    bot.chat(`I do not recognize the block ${blockName}.`)
    return false
  }

  if (requiresExactPosition(blockName)) {
    const message =
      `${blockName} is normally player-placed; use break_block_at with exact ` +
      'coordinates and the expected block name.'
    console.log(`[gather] ${message}`)
    bot.chat(`I will not gather ${blockName} by type. Give me its exact coordinates.`)
    return {
      status: 'failed',
      requested: amount,
      collected: 0,
      brokenNotRecovered: 0,
      protectedSkipped: 0,
      evidence: [],
      message
    }
  }

  throwIfCancelled(signal)

  const canProceed = await ensureToolEquipped(
    bot,
    blockType,
    blockName
  )

  if (!canProceed) return false

  const candidateCount = Math.min(Math.max(amount * 3, amount), 192)
  const positions = bot.findBlocks({
    matching: blockType.id,
    maxDistance: 32,
    count: candidateCount
  })

  if (positions.length === 0) {
    console.log(`No ${blockName} found nearby.`)
    bot.chat(`I cannot find ${blockName} nearby.`)
    return false
  }

  const container = findNearbyContainer(bot)
  const chestLocations = container ? [container.position] : []
  const inventoryIsFull = (
    bot.inventory &&
    typeof bot.inventory.emptySlotCount === 'function' &&
    bot.inventory.emptySlotCount() === 0
  )

  if (inventoryIsFull && chestLocations.length === 0) {
    console.log(`Cannot gather ${blockName}: inventory is full and no nearby container exists.`)
    bot.chat('My inventory is full. Put a chest or barrel within 16 blocks, or clear a slot.')
    return false
  }

  if (inventoryIsFull) {
    console.log(`Inventory full; using nearby ${container.name} while gathering.`)
    bot.chat(`My inventory is full, so I will use the nearby ${container.name}.`)
  }

  let collected = 0
  let brokenNotRecovered = 0
  let protectedSkipped = 0
  let inventoryBlocked = false
  const expectedIds = expectedDropIds(bot, blockType, blockName)
  const evidence = []

  for (const position of positions) {
    if (collected >= amount) break
    throwIfCancelled(signal)

    const block = bot.blockAt(position)
    if (!block || block.type !== blockType.id) continue
    const protection = isProtectedPosition(position, block)
    if (protection) {
      protectedSkipped += 1
      evidence.push({
        position: { x: position.x, y: position.y, z: position.z },
        protected: true,
        reason: typeof protection === 'string'
          ? protection
          : 'protected build or saved location'
      })
      continue
    }
    const beforeInventory = snapshotInventory(bot, expectedIds)
    const beforeContainer = inventoryIsFull
      ? await readContainerCounts(bot, container, expectedIds)
      : null

    try {
      await withTimeout(
        bot.collectBlock.collect(block, { chestLocations }),
        COLLECT_TIMEOUT_MS,
        `collecting ${blockName} at ${position.x},${position.y},${position.z}`,
        {
          onTimeout: () => cancelCollecting(bot)
        }
      )

      throwIfCancelled(signal)
      const changed = await waitForCondition(bot, () => {
        const current = bot.blockAt(position)
        return !current || current.type !== block.type ? true : null
      }, { signal, ticks: 20 })
      const gainedInventory = await waitForCondition(bot, () => {
        const gained = inventoryGain(bot, beforeInventory, expectedIds)
        return gained > 0 ? gained : null
      }, { signal, ticks: 12 }) || 0
      const afterContainer = beforeContainer
        ? await readContainerCounts(bot, container, expectedIds)
        : null
      const gainedContainer = containerGain(
        beforeContainer,
        afterContainer,
        expectedIds
      )
      const acquired = gainedInventory + gainedContainer

      evidence.push({
        position: { x: position.x, y: position.y, z: position.z },
        blockChanged: Boolean(changed),
        inventoryGain: gainedInventory,
        containerGain: gainedContainer
      })

      if (!changed) {
        console.log(
          `[gather] ${blockName} at ${position.x},${position.y},${position.z} was not broken.`
        )
        continue
      }
      if (acquired <= 0) {
        brokenNotRecovered += 1
        console.log(
          `[gather] broke ${blockName} at ${position.x},${position.y},${position.z} but did not recover its drop.`
        )
        continue
      }

      collected += 1
      console.log(`Collected ${blockName} (${collected}/${amount}).`)
    } catch (error) {
      if (signal && signal.aborted) {
        throw cancellationError(signal)
      }

      if (/no defined chest locations/i.test(error.message)) {
        inventoryBlocked = true
        console.log(
          `Cannot continue gathering ${blockName}: inventory became full and no nearby container exists.`
        )
        bot.chat(
          'My inventory became full. Put a chest or barrel within 16 blocks, or clear a slot.'
        )
        await cancelCollecting(bot)
        break
      }

      console.log(
        `Skipping ${blockName} at ${position.x},${position.y},${position.z}: ${error.message}`
      )

      await cancelCollecting(bot)
    }
  }

  if (inventoryBlocked) {
    return {
      status: collected > 0 ? 'partial' : 'failed',
      requested: amount,
      collected,
      brokenNotRecovered,
      protectedSkipped,
      evidence,
      message: `Inventory became full after collecting ${collected} of ${amount} ${blockName}.`
    }
  }

  if (collected === 0) {
    console.log(`Could not collect any ${blockName}.`)
    bot.chat(`I could not collect any ${blockName}.`)
    return {
      status: brokenNotRecovered > 0 ? 'partial' : 'failed',
      requested: amount,
      collected,
      brokenNotRecovered,
      protectedSkipped,
      evidence,
      message: brokenNotRecovered > 0
        ? `Broke ${brokenNotRecovered} ${blockName}, but recovered none of the drops.`
        : protectedSkipped > 0
          ? `Refused to break ${protectedSkipped} protected ${blockName} block(s).`
          : `Could not collect any ${blockName}.`
    }
  }

  if (collected < amount) {
    bot.chat(`I collected ${collected} of ${amount} ${blockName}.`)
    return {
      status: 'partial',
      requested: amount,
      collected,
      brokenNotRecovered,
      protectedSkipped,
      evidence,
      message: `Collected ${collected} of ${amount} ${blockName}.`
    }
  }

  console.log(`Collected ${collected} ${blockName}.`)
  return {
    status: 'completed',
    requested: amount,
    collected,
    brokenNotRecovered,
    protectedSkipped,
    evidence
  }
}

module.exports = gatherBlock
module.exports.requiresExactPosition = requiresExactPosition
