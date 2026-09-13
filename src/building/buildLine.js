const { buildBlocks } = require('./placeBlock')

const DIRECTIONS = {
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
  south: [0, 0, 1],
  north: [0, 0, -1]
}

async function buildLine(
  bot,
  blockName,
  origin,
  direction,
  length,
  options = {}
) {
  const offset = DIRECTIONS[direction]

  if (!offset) {
    bot.chat('Direction must be north, south, east, west, up, or down.')
    return false
  }

  if (!Number.isInteger(length) || length < 1 || length > 32) {
    bot.chat('Line length must be between 1 and 32.')
    return false
  }

  const positions = []

  for (let index = 0; index < length; index += 1) {
    positions.push({
      x: origin.x + offset[0] * index,
      y: origin.y + offset[1] * index,
      z: origin.z + offset[2] * index
    })
  }

  return buildBlocks(
    bot,
    blockName,
    positions,
    `${length}-block line`,
    options
  )
}

module.exports = buildLine
