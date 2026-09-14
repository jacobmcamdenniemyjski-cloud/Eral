const CROP_DEFINITIONS = {
  wheat: {
    crop: 'wheat',
    block: 'wheat',
    seed: 'wheat_seeds',
    maxAge: 7
  },
  carrots: {
    crop: 'carrots',
    block: 'carrots',
    seed: 'carrot',
    maxAge: 7
  },
  potatoes: {
    crop: 'potatoes',
    block: 'potatoes',
    seed: 'potato',
    maxAge: 7
  },
  beetroots: {
    crop: 'beetroots',
    block: 'beetroots',
    seed: 'beetroot_seeds',
    maxAge: 3
  }
}

const CROP_ALIASES = {
  wheat: 'wheat',
  wheat_crop: 'wheat',
  wheat_crops: 'wheat',
  wheat_seed: 'wheat',
  wheat_seeds: 'wheat',
  carrot: 'carrots',
  carrots: 'carrots',
  carrot_crop: 'carrots',
  carrot_crops: 'carrots',
  potato: 'potatoes',
  potatoes: 'potatoes',
  potato_crop: 'potatoes',
  potato_crops: 'potatoes',
  beetroot: 'beetroots',
  beetroots: 'beetroots',
  beetroot_crop: 'beetroots',
  beetroot_crops: 'beetroots',
  beetroot_seed: 'beetroots',
  beetroot_seeds: 'beetroots'
}

function normalizeCropName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveCropName(value, options = {}) {
  const normalized = normalizeCropName(value)
  if (
    options.allowAll !== false &&
    /^(?:all|any|crops?|all_crops?)$/.test(normalized)
  ) {
    return 'all'
  }

  return CROP_ALIASES[normalized] || null
}

function getCropDefinitions(cropName = 'all') {
  const resolved = resolveCropName(cropName)
  if (!resolved) return []
  if (resolved === 'all') return Object.values(CROP_DEFINITIONS)
  return [CROP_DEFINITIONS[resolved]]
}

function getCropAge(block) {
  if (!block) return null

  if (typeof block.getProperties === 'function') {
    const properties = block.getProperties()
    const age = properties && Number(properties.age)
    if (Number.isFinite(age)) return age
  }

  const metadata = Number(block.metadata)
  return Number.isFinite(metadata) ? metadata : null
}

function isMatureCrop(block, definition) {
  return Boolean(
    block &&
    definition &&
    block.name === definition.block &&
    getCropAge(block) >= definition.maxAge
  )
}

module.exports = {
  CROP_DEFINITIONS,
  getCropAge,
  getCropDefinitions,
  isMatureCrop,
  normalizeCropName,
  resolveCropName
}
