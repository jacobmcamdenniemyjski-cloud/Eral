const { buildBlocks } = require('./placeBlock')

const HORIZONTAL_DIRECTIONS = {
  east: [1, 0],
  west: [-1, 0],
  south: [0, 1],
  north: [0, -1]
}

async function buildWall(
  bot,
  blockName,
  origin,
  direction,
  width,
  height,
  options = {}
) {
  const offset = HORIZONTAL_DIRECTIONS[direction]

  if (!offset) {
    bot.chat('Wall direction must be north, south, east, or west.')
    return false
  }

  if (!Number.isInteger(width) || width < 1 || width > 16) {
    bot.chat('Wall width must be between 1 and 16.')
    return false
  }

  if (!Number.isInteger(height) || height < 1 || height > 5) {
    bot.chat('Wall height must be between 1 and 5.')
    return false
  }

  const positions = []

  // Build each complete row before starting the next one so upper
  // blocks can use the finished row beneath them as support.
  for (let y = 0; y < height; y += 1) {
    for (let index = 0; index < width; index += 1) {
      positions.push({
        x: origin.x + offset[0] * index,
        y: origin.y + y,
        z: origin.z + offset[1] * index
      })
    }
  }

  return buildBlocks(
    bot,
    blockName,
    positions,
    `${width}x${height} wall`,
    options
  )
}

module.exports = buildWall
