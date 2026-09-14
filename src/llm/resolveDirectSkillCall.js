const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

const { resolveCropName } = require('../farming/crops')

function cleanPrompt(prompt) {
  return String(prompt || '')
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/^please\s+|\s+please$/g, '')
    .trim()
}

function parseAmountAndResource(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  let amount = 1
  const parseAmount = (token) => {
    if (/^\d+$/.test(token)) return Number(token)
    return NUMBER_WORDS[token] || null
  }
  const firstAmount = parseAmount(tokens[0])
  const lastAmount = tokens.length > 1
    ? parseAmount(tokens[tokens.length - 1])
    : null

  if (firstAmount) {
    amount = firstAmount
    tokens.shift()
  } else if (lastAmount) {
    amount = lastAmount
    tokens.pop()
  }

  while (/^(?:a|an|some|the|of)$/.test(tokens[0] || '')) tokens.shift()
  if (tokens.length === 0 || amount < 1 || amount > 64) return null

  return { resource: tokens.join(' '), amount }
}

function resourceCall(
  text,
  pattern,
  name,
  key,
  extra = {},
  includeAmount = true
) {
  const match = text.match(pattern)
  if (!match) return null

  const parsed = parseAmountAndResource(match[1])
  if (!parsed) return null

  const input = { [key]: parsed.resource, ...extra }
  if (includeAmount) input.amount = parsed.amount

  return { name, input }
}

function resolveDirectSkillCall(prompt, username) {
  const text = cleanPrompt(prompt)
  const originalText = String(prompt || '')
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/^please\s+|\s+please$/gi, '')
    .trim()

  if (/^(?:follow me|come here|come to me|come with me)$/.test(text)) {
    return { name: 'follow_player', input: { player: username } }
  }

  const namedFollow = originalText.match(
    /^(?:follow|come with)\s+([a-z0-9_]{3,16})$/i
  )
  if (namedFollow) {
    return { name: 'follow_player', input: { player: namedFollow[1] } }
  }

  if (/^(?:look at me|face me)$/.test(text)) {
    return { name: 'look_at_player', input: { player: username } }
  }

  if (/^(?:stop|stop now|cancel|hold still|wait)$/.test(text)) {
    return { name: 'stop_all', input: {} }
  }

  if (
    /^(?:furnace status|inspect (?:the )?furnace|check (?:the )?furnace|what(?:'s| is) (?:in|inside) (?:the )?furnace)$/.test(text)
  ) {
    return { name: 'get_furnace_status', input: {} }
  }

  if (
    /^(?:furnace collect|collect|take|retrieve)(?: (?:the|all))? (?:furnace output|output from (?:the )?furnace|smelted items?|finished output)$/.test(text)
  ) {
    return { name: 'collect_furnace_output', input: {} }
  }

  const smeltMatch = text.match(/^(?:smelt|refine)\s+(.+)$/)
  if (smeltMatch) {
    const parts = smeltMatch[1].split(/\s+with\s+/)
    if (parts.length <= 2) {
      const input = parseAmountAndResource(parts[0])
      const fuel = parts[1] ? parseAmountAndResource(parts[1]) : null

      if (input && (!parts[1] || fuel)) {
        return {
          name: 'smelt_item',
          input: {
            item: input.resource,
            amount: input.amount,
            ...(fuel ? { fuel: fuel.resource } : {})
          }
        }
      }
    }
  }

  const allFarmMatch = text.match(
    /^(?:farm|harvest|replant|collect)\s+all(?:\s+(?:available|mature))?(?:\s+(?:of\s+)?(?:the\s+)?)?(.*)$/
  )
  if (allFarmMatch) {
    const crop = resolveCropName(allFarmMatch[1].trim() || 'all')
    if (crop) return { name: 'farm_all_available', input: { crop } }
  }

  const farmMatch = text.match(/^(?:farm|harvest|replant|collect)\s+(.+)$/)
  if (farmMatch) {
    const request = parseAmountAndResource(farmMatch[1])
    const crop = request && resolveCropName(request.resource)

    if (request && crop) {
      return {
        name: 'farm_crops',
        input: { crop, amount: request.amount }
      }
    }
  }

  const farmStatusMatch = text.match(
    /^(?:farm status|check (?:the )?farm|inspect (?:the )?(?:farm|crops?))(?:\s+(.+))?$/
  )
  if (farmStatusMatch) {
    const crop = resolveCropName(farmStatusMatch[1] || 'all')
    if (crop) return { name: 'get_farm_status', input: { crop } }
  }

  const coordinates = text.match(
    /^(?:go to|goto|move to|walk to)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/
  )
  if (coordinates) {
    return {
      name: 'go_to',
      input: {
        x: Number(coordinates[1]),
        y: Number(coordinates[2]),
        z: Number(coordinates[3])
      }
    }
  }

  const calls = [
    resourceCall(
      text,
      /^(?:gather|collect|mine|chop|dig)\s+(.+)$/,
      'gather_block',
      'block'
    ),
    resourceCall(
      text,
      /^(?:make|craft|create|produce)\s+(.+)$/,
      'make_item',
      'item'
    ),
    resourceCall(
      text,
      /^(?:store|deposit|put away)\s+(.+)$/,
      'store_item',
      'item'
    ),
    resourceCall(
      text,
      /^(?:take|withdraw)\s+(.+)$/,
      'take_item',
      'item'
    ),
    resourceCall(
      text,
      /^(?:attack|kill|fight)\s+(.+)$/,
      'attack_hostile',
      'mob',
      { maxDistance: 16 },
      false
    )
  ]

  return calls.find(Boolean) || null
}

module.exports = resolveDirectSkillCall
module.exports.parseAmountAndResource = parseAmountAndResource
