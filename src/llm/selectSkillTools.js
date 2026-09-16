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
    pattern: /\b(follow|come with|stay with|come here|come to me)\b/i,
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
    pattern: /\b(farm|farming|harvest|replant|crops?|wheat|carrots?|potatoes?|beetroots?)\b/i,
    names: ['get_farm_status', 'farm_crops']
  },
  {
    pattern: /\b(gather|mine|chop|collect|dig)\b/i,
    names: ['gather_block']
  },
  {
    pattern: /\b(craft|make|create|produce)\b/i,
    names: ['make_item']
  },
  {
    pattern: /\b(smelt|smelting|cook ore|refine ore)\b/i,
    names: ['smelt_item']
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
      'get_scene',
      'get_inventory',
      'create_build_plan',
      'prepare_build_plan_site',
      'place_block',
      'build_line',
      'build_wall',
      'build_floor',
      'inspect_build_plan_shelter',
      'traverse_nearby_door'
    ]
  },
  {
    pattern: /\b(clear|prepare|clean|terraform)\b.*\b(site|footprint|area|grass|plants?|flowers?)\b/i,
    names: ['get_scene', 'clear_build_site']
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
    pattern: /\b(scene|surroundings|survey|look around|what can you see)\b/i,
    names: ['get_scene']
  },
  {
    pattern: /\b(recipe|recipes|ingredients|how do you make)\b/i,
    names: ['get_recipes']
  },
  {
    pattern: /\b(pick up|pickup|dropped items?|collect drops?)\b/i,
    names: ['pickup_items']
  },
  {
    pattern: /\b(flee|run away|retreat|escape)\b/i,
    names: ['flee_from_hostiles']
  },
  {
    pattern: /\b(eat now|eat food|have something to eat)\b/i,
    names: ['eat_now']
  },
  {
    pattern: /\b(deathpoint|death point|last death|where did you die|death history)\b/i,
    names: ['get_deaths', 'return_to_death', 'pickup_items']
  },
  {
    pattern: /\b(use|activate|interact with|open)\b.*\b(block|door|gate|lever|button|furnace|chest|barrel)\b/i,
    names: ['use_nearby_block']
  },
  {
    pattern: /\b(stop|cancel|wait|hold still)\b/i,
    names: ['stop_all']
  }
]

const LOCATION_INTENTS = [
  {
    pattern: /\b(?:mark|save|remember)\b.*\b(?:home|location|place|spot|base|mine|farm|village)\b/i,
    names: ['mark_location']
  },
  {
    pattern: /\b(?:list|show|what|where)\b.*\b(?:saved locations?|marked places?|locations?|marks?)\b|\b(?:locations|saved places|marks)\b/i,
    names: ['get_saved_locations']
  },
  {
    pattern: /\b(?:forget|remove|delete)\b.*\b(?:home|location|place|spot|base|mine|farm|village)\b/i,
    names: ['forget_location']
  },
  {
    pattern: /\b(?:go|return|travel|walk)(?: back)?(?: to)?\b.*\b(?:home|saved location|marked place|base|mine|farm|village)\b/i,
    names: ['go_to_location']
  },
  {
    pattern: /^(?:please )?(?:sleep|go to sleep|go to bed|sleep in (?:a|the) nearby bed)(?: please)?[.!]?$/i,
    names: ['sleep_in_bed']
  }
]

const FURNACE_INTENTS = [
  {
    pattern: /\b(?:furnace status|inspect (?:the )?furnace|check (?:the )?furnace)\b|\bwhat(?:'s| is) (?:in|inside) (?:the )?furnace\b/i,
    names: ['get_furnace_status']
  },
  {
    pattern: /\b(?:furnace collect|collect|take|retrieve)\b.*\b(?:furnace|furnace output|smelted items?|finished output)\b|\b(?:furnace output|smelted items?|finished output)\b.*\b(?:collect|take|retrieve)\b/i,
    names: ['collect_furnace_output']
  }
]

const FARM_INTENTS = [
  {
    pattern: /\b(?:build|create|start|make|prepare)\b.*\b(?:farm|field)\b/i,
    names: ['get_scene', 'get_inventory', 'create_farm']
  },
  {
    pattern: /\b(?:gather|collect|get|find)\b.*\b(?:wheat\s+)?seeds?\b|\b(?:wheat\s+)?seeds?\b.*\b(?:gather|collect|get|find)\b/i,
    names: ['gather_seeds']
  },
  {
    pattern: /\b(?:farm|harvest|replant|collect)\s+(?:everything|all(?:\s+(?:available|mature))?(?:\s+(?:of\s+)?(?:the\s+)?)?(?:wheat|carrots?|potatoes?|beetroots?|crops?))\b/i,
    names: ['farm_all_available']
  }
]

function selectSkillTools(prompt, definitions, options = {}) {
  const maxTools = options.maxTools || 10
  const selectedNames = new Set()

  for (const intent of LOCATION_INTENTS) {
    if (!intent.pattern.test(prompt)) continue
    return definitions
      .filter((definition) => intent.names.includes(definition.name))
      .slice(0, maxTools)
  }

  for (const intent of FURNACE_INTENTS) {
    if (!intent.pattern.test(prompt)) continue
    return definitions
      .filter((definition) => intent.names.includes(definition.name))
      .slice(0, maxTools)
  }

  for (const intent of FARM_INTENTS) {
    if (!intent.pattern.test(prompt)) continue
    return definitions
      .filter((definition) => intent.names.includes(definition.name))
      .slice(0, maxTools)
  }

  for (const group of TOOL_GROUPS) {
    if (!group.pattern.test(prompt)) continue
    for (const name of group.names) selectedNames.add(name)
  }

  return definitions
    .filter((definition) => selectedNames.has(definition.name))
    .slice(0, maxTools)
}

module.exports = selectSkillTools
module.exports.FARM_INTENTS = FARM_INTENTS
module.exports.LOCATION_INTENTS = LOCATION_INTENTS
module.exports.TOOL_GROUPS = TOOL_GROUPS
module.exports.FURNACE_INTENTS = FURNACE_INTENTS
