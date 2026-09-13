const { buildBlocks } = require('./placeBlock')

async function buildFloor(
  bot,
  blockName,
  origin,
  width,
  depth,
  options = {}
) {
  if (!Number.isInteger(width) || width < 1 || width > 16) {
    bot.chat('Floor width must be between 1 and 16.')
    return false
  }

  if (!Number.isInteger(depth) || depth < 1 || depth > 16) {
    bot.chat('Floor depth must be between 1 and 16.')
    return false
  }

  if (width * depth > 128) {
    bot.chat('A floor can contain at most 128 blocks per command.')
    return false
  }

  const positions = []

  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) {
      positions.push({
        x: origin.x + x,
        y: origin.y,
        z: origin.z + z
      })
    }
  }

  return buildBlocks(
    bot,
    blockName,
    positions,
    `${width}x${depth} floor`,
    options
  )
}

module.exports = buildFloor
