const withTimeout = require("../scheduler/withTimeout")
const COLLECT_TIMEOUT_MS = 10000

/**
 * @param {import('mineflayer').Bot} bot
 * @returns The matching item, null if no tool is needed, or undefined if none available
 */
function findUsableTool(bot, blockType) {
  if (!blockType.harvestTools) return null // no tool required

  const validToolIds = Object.keys(blockType.harvestTools).map(Number)
  if (validToolIds.length === 0) return null // no tool required

  const tool = bot.inventory.items().find((item) => validToolIds.includes(item.type))
  return tool || undefined // undefined = a tool IS required but none available
}

/**
 * @param {import('mineflayer').Bot} bot
 * @returns {Promise<boolean>} True if equipped, false otherwise
 */
async function ensureToolEquipped(bot, blockType, blockName) {
  if (!blockType.harvestTools) return true

  const validToolIds = Object.keys(blockType.harvestTools).map(Number)
  if (validToolIds.length === 0) return true

  const alreadyHeld = bot.heldItem && validToolIds.includes(bot.heldItem.type)
  if (alreadyHeld) return true

  const tool = bot.inventory.items().find((item) => validToolIds.includes(item.type))

  if (!tool) {
    console.log("Cannot gather ${blockName}: no valid tool in inventory.")
    bot.chat("I need a proper tool to gather ${blockName}.")
    return false
  }

  await bot.equip(tool, "hand")
  return true
}

/**
 * @param {import('mineflayer').Bot} bot
 * @returns {Promise<boolean>} True if at least one block was collected successfully
 */
async function gatherBlock(bot, blockName, amount = 1) {
  const blockType = bot.registry.blocksByName[blockName]

  if (!blockType) {
    console.log("Unknown block: ${blockName}")
    return false
  }

  const canProceed = await ensureToolEquipped(bot, blockType, blockName)
  if (!canProceed) return false

  const positions = bot.findBlocks({
    matching: blockType.id,
    maxDistance: 32,
    count: amount
  })

  if (positions.length === 0) {
    console.log("No ${blockName} found nearby.")
    return false
  }

  let collected = 0

  for (const position of positions) {
    if (collected >= amount) break

    const block = bot.blockAt(position)
    if (!block || block.type !== blockType.id) continue

    try {
      await withTimeout(
        bot.collectBlock.collect(block),
        COLLECT_TIMEOUT_MS,
        "collecting ${blockName} at ${position.x},${position.y},${position.z}"
      )
      collected++
      console.log("Collected ${blockName} (${collected}/${amount}).")
    } catch (error) {
      console.log("Skipping ${blockName} at ${position.x},${position.y},${position.z}: ${error.message}")

      if (bot.pathfinder) bot.pathfinder.setGoal(null)
      if (bot.collectBlock && typeof bot.collectBlock.cancelTask === "function") {
        bot.collectBlock.cancelTask()
      }
    }
  }

  if (collected === 0) {
    console.log("Could not collect any ${blockName}.")
    return false
  }

  return true
}

module.exports = gatherBlock