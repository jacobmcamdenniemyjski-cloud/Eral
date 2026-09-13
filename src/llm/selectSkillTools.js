const TOOL_GROUPS = [
  {
    pattern: /\b(health|hurt|hunger|hungry|food level|position|coordinates|where are you|how are you|doing)\b/i,
    names: ['get_status']
  },
  {
    pattern: /\b(task|working on|current job)\b/i,
    names: ['get_task']
  },
  {
    pattern: /\b(inventory|carrying|what do you have|items?)\b/i,
    names: ['get_inventory']
  },
  {
    pattern: /\b(scan|around you|what do you see|entities|players?|mobs?)\b|what(?:'s| is) nearby/i,
    names: ['scan_nearby']
  },
  {
    pattern: /\b(find|locate|nearest|look for|search for)\b/i,
    names: ['find_block', 'get_status']
  },
  {
    pattern: /\b(follow|come with|stay with)\b/i,
    names: ['follow_player']
  },
  {
    pattern: /\b(look at|face me)\b/i,
    names: ['look_at_player']
  },
  {
    pattern: /\b(go to|goto|travel|walk to|move to|coordinate)\b/i,
    names: ['go_to', 'get_status']
  },
  {
    pattern: /\b(gather|mine|chop|collect|dig|harvest)\b/i,
    names: ['gather_block', 'find_block', 'get_inventory']
  },
  {
    pattern: /\b(craft|make|create|produce)\b/i,
    names: ['make_item']
  },
  {
    pattern: /\b(store|deposit|put away)\b|\bput\b.+\b(chest|barrel)\b/i,
    names: ['store_item', 'get_inventory']
  },
  {
    pattern: /\b(take|withdraw|get from (?:the )?(?:chest|barrel))\b/i,
    names: ['take_item', 'get_inventory']
  },
  {
    pattern: /\b(equip|hold|wear|put on)\b/i,
    names: ['equip_item', 'get_inventory']
  },
  {
    pattern: /\b(place|build|wall|floor|line|house|shelter|structure)\b/i,
    names: [
      'get_status',
      'get_inventory',
      'place_block',
      'build_line',
      'build_wall',
      'build_floor'
    ]
  },
  {
    pattern: /\b(attack|kill|fight|defend|protect|combat|guard|aggressive|passive|hostile|zombie|skeleton|spider|creeper)\b/i,
    names: [
      'attack_hostile',
      'set_combat_mode',
      'get_combat_status',
      'scan_nearby',
      'equip_item'
    ]
  },
  {
    pattern: /\b(stop|cancel|wait|hold still)\b/i,
    names: ['stop_all']
  }
]

function selectSkillTools(prompt, definitions, options = {}) {
  const maxTools = options.maxTools || 10
  const selectedNames = new Set()

  for (const group of TOOL_GROUPS) {
    if (!group.pattern.test(prompt)) continue
    for (const name of group.names) selectedNames.add(name)
  }

  return definitions
    .filter((definition) => selectedNames.has(definition.name))
    .slice(0, maxTools)
}

module.exports = selectSkillTools
module.exports.TOOL_GROUPS = TOOL_GROUPS
