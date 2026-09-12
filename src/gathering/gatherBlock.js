async function gatherBlock(bot, blockName, amount = 1) {
  const blockType = bot.registry.blocksByName[blockName]

  if (!blockType) {
    console.log(`Unknown block: ${blockName}`)
    return false
  }

  const blocks = bot.findBlocks({
    matching: blockType.id,
    maxDistance: 32,
    count: amount
  })

  if (blocks.length === 0) {
    console.log(`No ${blockName} found nearby.`)
    return false
  }

  const targets = blocks
    .map(position => bot.blockAt(position))
    .filter(Boolean)

  try {
    await bot.collectBlock.collect(targets)
    console.log(`Collected ${targets.length} ${blockName}.`)
    return true
  } catch (error) {
    console.log(`Gathering failed: ${error.message}`)
    return false
  }
}

module.exports = gatherBlock