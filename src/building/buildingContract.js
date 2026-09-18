const CONTRACT_VERSION = 1
const MIN_INTERIOR_HEIGHT = 2
const RECOMMENDED_INTERIOR_HEIGHT = 3
const MIN_BUILD_LIGHT = 8
const DEFAULT_SITE_MARGIN = 2

const REQUIRED_UTILITIES = Object.freeze([
  'storage',
  'crafting_table',
  'furnace',
  'light_source'
])

const PHASES = Object.freeze([
  'survey',
  'validate_plan',
  'clear_and_level_site',
  'build_floor',
  'build_shell',
  'install_door_and_windows',
  'add_lighting_and_utilities',
  'inspect_and_repair',
  'walk_through_door'
])

const AIR_NAMES = new Set(['air', 'cave_air', 'void_air'])
const STORAGE_NAMES = new Set(['chest', 'trapped_chest', 'barrel'])
const FURNACE_NAMES = new Set(['furnace', 'blast_furnace', 'smoker'])
const LIGHT_PATTERN = /(?:torch|lantern|glowstone|sea_lantern|shroomlight|froglight|redstone_lamp|end_rod|jack_o_lantern|campfire|candle)$/
const WINDOW_PATTERN = /(?:glass|glass_pane|iron_bars|_fence)$/

function key(position) {
  return `${position.x},${position.y},${position.z}`
}

function isIntegerPosition(position) {
  return position && ['x', 'y', 'z'].every((axis) => (
    Number.isInteger(position[axis])
  ))
}

function boundarySide(origin, width, depth, position) {
  const minX = origin.x
  const maxX = origin.x + width - 1
  const minZ = origin.z
  const maxZ = origin.z + depth - 1
  const onWest = position.x === minX
  const onEast = position.x === maxX
  const onNorth = position.z === minZ
  const onSouth = position.z === maxZ
  const onBoundary = onWest || onEast || onNorth || onSouth
  const atCorner = (onWest || onEast) && (onNorth || onSouth)

  if (!onBoundary || atCorner) return null
  if (onWest) return 'west'
  if (onEast) return 'east'
  if (onNorth) return 'north'
  return 'south'
}

function doorwayApproaches(plan) {
  const side = boundarySide(
    plan.origin,
    plan.width,
    plan.depth,
    plan.doorPosition
  )
  if (!side) return null

  const offsets = {
    west: [{ x: -1, z: 0 }, { x: 1, z: 0 }],
    east: [{ x: 1, z: 0 }, { x: -1, z: 0 }],
    north: [{ x: 0, z: -1 }, { x: 0, z: 1 }],
    south: [{ x: 0, z: 1 }, { x: 0, z: -1 }]
  }[side]

  return {
    side,
    outside: {
      x: plan.doorPosition.x + offsets[0].x,
      y: plan.doorPosition.y,
      z: plan.doorPosition.z + offsets[0].z
    },
    inside: {
      x: plan.doorPosition.x + offsets[1].x,
      y: plan.doorPosition.y,
      z: plan.doorPosition.z + offsets[1].z
    }
  }
}

function contractSummary() {
  return {
    version: CONTRACT_VERSION,
    minimumInteriorHeight: MIN_INTERIOR_HEIGHT,
    recommendedInteriorHeight: RECOMMENDED_INTERIOR_HEIGHT,
    minimumBuildLight: MIN_BUILD_LIGHT,
    defaultSiteMargin: DEFAULT_SITE_MARGIN,
    requiredUtilities: [...REQUIRED_UTILITIES],
    phases: [...PHASES]
  }
}

function validateBuildPlan(plan) {
  const problems = []
  const origin = plan && plan.origin
  const door = plan && plan.doorPosition
  const width = plan && plan.width
  const depth = plan && plan.depth
  const interiorHeight = plan && plan.interiorHeight

  if (!isIntegerPosition(origin)) problems.push('origin must use integer coordinates')
  if (!Number.isInteger(width) || width < 3 || width > 16) {
    problems.push('width must be between 3 and 16 blocks')
  }
  if (!Number.isInteger(depth) || depth < 3 || depth > 16) {
    problems.push('depth must be between 3 and 16 blocks')
  }
  if (Number.isInteger(width) && Number.isInteger(depth) && width * depth > 128) {
    problems.push('floor footprint must not exceed 128 blocks')
  }
  if (!Number.isInteger(interiorHeight) || interiorHeight < MIN_INTERIOR_HEIGHT || interiorHeight > 4) {
    problems.push('interiorHeight must be between 2 and 4 blocks')
  }
  if (!isIntegerPosition(door)) {
    problems.push('doorPosition must use integer coordinates')
  }

  if (
    isIntegerPosition(origin) &&
    isIntegerPosition(door) &&
    Number.isInteger(width) && width >= 3 &&
    Number.isInteger(depth) && depth >= 3
  ) {
    if (door.y !== origin.y + 1) {
      problems.push('door bottom must be exactly one block above the finished floor')
    }
    if (!boundarySide(origin, width, depth, door)) {
      problems.push('door must be on a perimeter wall and not in a corner')
    }
  }

  return {
    contract: contractSummary(),
    valid: problems.length === 0,
    problems,
    plan: plan || null,
    doorway: problems.length === 0 ? doorwayApproaches(plan) : null
  }
}

function isPassable(block) {
  return Boolean(block) && (
    AIR_NAMES.has(block.name) ||
    block.boundingBox === 'empty'
  )
}

function isSolid(block) {
  return Boolean(block) && block.boundingBox === 'block'
}

function isWindow(block) {
  return Boolean(block) && WINDOW_PATTERN.test(block.name)
}

function isDoor(block) {
  return Boolean(block) && /_door$/.test(block.name)
}

function forEachFootprint(plan, callback) {
  for (let x = plan.origin.x; x < plan.origin.x + plan.width; x += 1) {
    for (let z = plan.origin.z; z < plan.origin.z + plan.depth; z += 1) {
      callback({ x, z })
    }
  }
}

function inspectShelter(bot, plan) {
  const validation = validateBuildPlan(plan)
  if (!validation.valid) return validation

  const problems = []
  const missingFloor = []
  const missingRoof = []
  const wallHoles = []
  const features = {
    doors: 0,
    windows: 0,
    storage: 0,
    craftingTables: 0,
    furnaces: 0,
    lightSources: 0,
    minimumInteriorBlockLight: null,
    walkableInteriorCells: 0
  }

  const blockAt = (position) => {
    const current = bot.entity && bot.entity.position
    if (current && typeof current.floored === 'function') {
      const base = current.floored()
      return bot.blockAt(base.offset(
        position.x - base.x,
        position.y - base.y,
        position.z - base.z
      ))
    }
    return bot.blockAt(position)
  }
  const doorKey = key(plan.doorPosition)
  const doorUpperKey = key({
    ...plan.doorPosition,
    y: plan.doorPosition.y + 1
  })

  forEachFootprint(plan, ({ x, z }) => {
    const floor = blockAt({ x, y: plan.origin.y, z })
    if (!isSolid(floor)) missingFloor.push({ x, y: plan.origin.y, z })
    const roofPosition = {
      x,
      y: plan.origin.y + plan.interiorHeight + 1,
      z
    }
    if (!isSolid(blockAt(roofPosition))) missingRoof.push(roofPosition)

    for (let y = plan.origin.y + 1; y <= plan.origin.y + plan.interiorHeight; y += 1) {
      const position = { x, y, z }
      const block = blockAt(position)
      const name = block && block.name

      const onBoundary = (
        x === plan.origin.x ||
        x === plan.origin.x + plan.width - 1 ||
        z === plan.origin.z ||
        z === plan.origin.z + plan.depth - 1
      )
      if (!onBoundary) {
        if (STORAGE_NAMES.has(name)) features.storage += 1
        if (name === 'crafting_table') features.craftingTables += 1
        if (FURNACE_NAMES.has(name)) features.furnaces += 1
      }
      if (name && LIGHT_PATTERN.test(name)) features.lightSources += 1
      if (onBoundary) {
        if (isDoor(block)) features.doors += 1
        else if (isWindow(block)) features.windows += 1
        else if (!isSolid(block) && key(position) !== doorKey && key(position) !== doorUpperKey) {
          wallHoles.push(position)
        }
      }
    }
  })

  for (
    let x = plan.origin.x + 1;
    x < plan.origin.x + plan.width - 1;
    x += 1
  ) {
    for (
      let z = plan.origin.z + 1;
      z < plan.origin.z + plan.depth - 1;
      z += 1
    ) {
      const feet = blockAt({ x, y: plan.origin.y + 1, z })
      const head = blockAt({ x, y: plan.origin.y + 2, z })
      if (!isPassable(feet) || !isPassable(head)) continue

      features.walkableInteriorCells += 1
      if (Number.isFinite(feet.light)) {
        features.minimumInteriorBlockLight = (
          features.minimumInteriorBlockLight === null
            ? feet.light
            : Math.min(features.minimumInteriorBlockLight, feet.light)
        )
      }
    }
  }

  const lowerDoor = blockAt(plan.doorPosition)
  const upperDoor = blockAt({
    ...plan.doorPosition,
    y: plan.doorPosition.y + 1
  })
  const approaches = doorwayApproaches(plan)

  if (missingFloor.length > 0) {
    problems.push(`floor has ${missingFloor.length} missing or non-solid blocks`)
  }
  if (missingRoof.length > 0) {
    problems.push(`roof has ${missingRoof.length} missing or non-solid blocks`)
  }
  if (wallHoles.length > 0) {
    problems.push(`walls have ${wallHoles.length} unfilled openings`)
  }
  if (!isDoor(lowerDoor) || !isDoor(upperDoor)) {
    problems.push('the planned doorway does not contain a complete two-block door')
  }
  for (const label of ['inside', 'outside']) {
    const position = approaches[label]
    const feet = blockAt(position)
    const head = blockAt({ ...position, y: position.y + 1 })
    if (!isPassable(feet) || !isPassable(head)) {
      problems.push(`${label} doorway approach is blocked`)
    }
  }
  if (features.storage === 0) problems.push('missing a chest or barrel')
  if (features.craftingTables === 0) problems.push('missing a crafting table')
  if (features.furnaces === 0) problems.push('missing a furnace')
  if (features.lightSources === 0) problems.push('missing an interior light source')
  if (features.walkableInteriorCells === 0) {
    problems.push('interior has no two-block-high walkable cell')
  } else if (
    features.lightSources === 0 &&
    features.minimumInteriorBlockLight !== null &&
    features.minimumInteriorBlockLight < MIN_BUILD_LIGHT
  ) {
    problems.push(`interior block light falls below ${MIN_BUILD_LIGHT}`)
  }

  return {
    contract: contractSummary(),
    valid: problems.length === 0,
    problems,
    features,
    samples: {
      missingFloor: missingFloor.slice(0, 8),
      missingRoof: missingRoof.slice(0, 8),
      wallHoles: wallHoles.slice(0, 8)
    },
    doorway: approaches
  }
}

module.exports = {
  CONTRACT_VERSION,
  DEFAULT_SITE_MARGIN,
  MIN_BUILD_LIGHT,
  MIN_INTERIOR_HEIGHT,
  PHASES,
  RECOMMENDED_INTERIOR_HEIGHT,
  REQUIRED_UTILITIES,
  boundarySide,
  contractSummary,
  doorwayApproaches,
  inspectShelter,
  isDoor,
  isPassable,
  validateBuildPlan
}
