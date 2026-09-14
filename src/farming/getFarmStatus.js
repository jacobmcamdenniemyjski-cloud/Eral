const {
  getCropDefinitions,
  getCropAge,
  resolveCropName
} = require('./crops')

function getFarmStatus(bot, cropName = 'all', maxDistance = 16) {
  const crop = resolveCropName(cropName)
  if (!crop) return null

  const definitions = getCropDefinitions(crop)
  const blockIds = definitions
    .map((definition) => bot.registry.blocksByName[definition.block])
    .filter(Boolean)
    .map((block) => block.id)
  const byBlockId = new Map(
    definitions.map((definition) => [
      bot.registry.blocksByName[definition.block]?.id,
      definition
    ])
  )
  const counts = new Map(definitions.map((definition) => [
    definition.crop,
    { crop: definition.crop, mature: 0, growing: 0, total: 0 }
  ]))

  const positions = blockIds.length === 0
    ? []
    : bot.findBlocks({
        matching: blockIds,
        maxDistance,
        count: 512
      })

  for (const position of positions) {
    const block = bot.blockAt(position)
    const definition = block && byBlockId.get(block.type)
    if (!definition || block.name !== definition.block) continue

    const cropCount = counts.get(definition.crop)
    cropCount.total += 1
    if (getCropAge(block) >= definition.maxAge) cropCount.mature += 1
    else cropCount.growing += 1
  }

  const farmland = bot.registry.blocksByName.farmland
  const emptyFarmland = farmland
    ? bot.findBlocks({
        matching: farmland.id,
        maxDistance,
        count: 512
      }).filter((position) => {
        const above = bot.blockAt(position.offset(0, 1, 0))
        return !above || above.type === 0
      }).length
    : 0

  return {
    range: maxDistance,
    emptyFarmland,
    crops: Array.from(counts.values())
  }
}

module.exports = getFarmStatus
