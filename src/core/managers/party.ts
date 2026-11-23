// game.party: who travels with the player, their levels, stats, HP/MP and equipment (saved).
// Stats, slots and the XP curve: src/content/stats.ts. Each member's numbers: defineCharacter({ battle }).
import statsConfig from '@/content/stats'
import statusDefs from '@/content/statuses'
import type { BattleStats, SkillConfig, StatsConfig } from '../define'
import { t } from '../lang'
import {
  type CharacterId,
  characters,
  type ItemId,
  type SkillId,
  type SlotId,
  type StatId,
  type StatusId,
  skills as skillDefs,
} from '../registry'
import { type MemberState, useGameStore } from '../stores/game'
import { toast } from '../ui/toast'
import { itemInfo, items } from './items'

const config = statsConfig as StatsConfig<StatId, SlotId>
export const STAT_IDS = Object.keys(config.stats) as StatId[]
export const SLOT_IDS = Object.keys(config.slots) as SlotId[]
const POOLS = STAT_IDS.filter((s) => config.stats[s].pool)

type Stats = Record<StatId, number>

const info = (id: CharacterId) =>
  characters[id] as unknown as { name: string; battle?: BattleStats } | undefined

const state = (id: CharacterId): MemberState | undefined => useGameStore.getState().party.data[id]

/** XP total needed for a level, clamped to the level range. */
export const xpForLevel = (level: number) =>
  config.xpForLevel(Math.max(1, Math.min(config.maxLevel, level)))

/** The level a total XP amount reaches. */
export function levelForXp(xp: number): number {
  let level = 1
  while (level < config.maxLevel && xp >= xpForLevel(level + 1)) level++
  return level
}

/** Base + growth for the level + equipment (rounded down, never below 0). */
function computeStats(id: CharacterId, member: MemberState): Stats {
  const battle = info(id)?.battle
  const result = {} as Stats
  for (const stat of STAT_IDS) {
    let value = (battle?.base[stat] ?? 0) + (battle?.growth?.[stat] ?? 0) * (member.level - 1)
    for (const item of Object.values(member.equipment))
      value += itemInfo(item).equip?.stats[stat] ?? 0
    result[stat] = Math.max(0, Math.floor(value))
  }
  return result
}

/** Keeps current pool values within 0..max (after level ups or equipment changes). */
function clampPools(id: CharacterId) {
  const member = state(id)
  if (!member) return
  const max = computeStats(id, member)
  useGameStore.setState((s) => {
    const m = s.party.data[id]
    if (!m) return
    for (const pool of POOLS) m.current[pool] = Math.min(max[pool], m.current[pool] ?? max[pool])
  })
}

/** "Anna learned Fire!" */
function announce(id: CharacterId, skill: SkillId) {
  toast(
    t('{name} learned {skill}!', {
      name: t(info(id)?.name ?? id),
      skill: t((skillDefs?.[skill] as SkillConfig | undefined)?.name ?? skill),
    }),
    { kind: 'skillLearned', params: { character: id, skill } },
  )
}

export interface MemberView {
  id: CharacterId
  name: string
  level: number
  xp: number
  /** XP total needed for the next level (null at the max level). */
  nextLevelXp: number | null
  stats: Stats
  /** Current values of pool stats (hp, mp). */
  current: Partial<Stats>
  equipment: Partial<Record<SlotId, ItemId>>
}

export const party = {
  stats: STAT_IDS,
  slots: SLOT_IDS,
  /** Display names from src/content/stats.ts. */
  statName: (stat: StatId) => config.stats[stat].name,
  slotName: (slot: SlotId) => config.slots[slot],
  isPool: (stat: StatId) => POOLS.includes(stat),

  /** Members in order. */
  members(): CharacterId[] {
    return useGameStore.getState().party.members as CharacterId[]
  },

  has(id: CharacterId): boolean {
    return party.members().includes(id)
  },

  /**
   * Adds a character (needs `battle` in its definition). They keep their level and equipment if
   * they were in the party before. Returns false if the party is full or they can't join.
   */
  add(id: CharacterId, options: { level?: number; notify?: boolean } = {}): boolean {
    if (party.has(id)) return true
    if (!info(id)?.battle) {
      console.warn(`[party] "${id}" has no battle stats (defineCharacter({ battle }))`)
      return false
    }
    if (party.members().length >= config.maxMembers) return false
    useGameStore.setState((s) => {
      s.party.members.push(id)
      if (!s.party.data[id]) {
        const level = Math.max(1, Math.min(config.maxLevel, options.level ?? 1))
        s.party.data[id] = { level, xp: xpForLevel(level), current: {}, equipment: {} }
      }
    })
    // New members start with full pools.
    const member = state(id) as MemberState
    if (Object.keys(member.current).length === 0) party.restore(id)
    if (options.notify)
      toast(t('{name} joined the party', { name: t(info(id)?.name ?? id) }), {
        kind: 'partyJoin',
        params: { character: id },
      })
    return true
  },

  /** Takes a member out (their level and equipment are remembered). */
  remove(id: CharacterId): void {
    useGameStore.setState((s) => {
      s.party.members = s.party.members.filter((m) => m !== id)
    })
  },

  /** Everything about a member, or null if they never joined. */
  member(id: CharacterId): MemberView | null {
    const member = state(id)
    if (!member) return null
    return {
      id,
      name: info(id)?.name ?? id,
      level: member.level,
      xp: member.xp,
      nextLevelXp: member.level >= config.maxLevel ? null : xpForLevel(member.level + 1),
      stats: computeStats(id, member),
      current: { ...member.current } as Partial<Stats>,
      equipment: { ...member.equipment } as Partial<Record<SlotId, ItemId>>,
    }
  },

  /**
   * The battle skills a character can use right now: their own (defineCharacter({ battle: { skills } }),
   * those with a `level` / `quest` condition only once it is met), the ones taught with learn(), and
   * the ones their equipment gives (gone again when it is taken off).
   */
  skills(id: CharacterId): SkillId[] {
    const state = useGameStore.getState()
    const member = state.party.data[id]
    const level = member?.level ?? 1
    const own: SkillId[] = []
    for (const entry of info(id)?.battle?.skills ?? []) {
      if (typeof entry === 'string') own.push(entry)
      else if (
        level >= (entry.level ?? 1) &&
        (!entry.quest || state.quests[entry.quest]?.status === 'done')
      )
        own.push(entry.skill)
    }
    const worn = Object.values(member?.equipment ?? {}).flatMap(
      (item) => itemInfo(item).equip?.skills ?? [],
    )
    const learned = (state.party.learned?.[id] ?? []) as SkillId[]
    return [...new Set([...own, ...learned, ...worn])]
  },

  /**
   * Teaches a skill for good (saved), e.g. from an event or a quest's onComplete. Works for anyone
   * who can be in the party, also before they join or after they left. False if they knew it already.
   */
  learn(id: CharacterId, skill: SkillId, options: { notify?: boolean } = {}): boolean {
    if (!info(id)?.battle) {
      console.warn(`[party] "" has no battle stats (defineCharacter({ battle }))`)
      return false
    }
    if (party.skills(id).includes(skill)) return false
    useGameStore.setState((s) => {
      s.party.learned ??= {}
      const list = s.party.learned[id] ?? []
      s.party.learned[id] = list
      list.push(skill)
    })
    if (options.notify) announce(id, skill)
    return true
  },

  /** Takes back a skill taught with learn(). (Skills from the character file or equipment stay.) */
  forget(id: CharacterId, skill: SkillId): void {
    useGameStore.setState((s) => {
      const list = s.party.learned?.[id]
      if (list) s.party.learned = { ...s.party.learned, [id]: list.filter((x) => x !== skill) }
    })
  },

  /** Can they use this skill right now? */
  knows(id: CharacterId, skill: SkillId): boolean {
    return party.skills(id).includes(skill)
  },

  /** Max value of a stat (pools: their maximum). */
  stat(id: CharacterId, stat: StatId): number {
    const member = state(id)
    return member ? computeStats(id, member)[stat] : 0
  },

  /** Current value of a pool stat (hp 12 of 30). */
  current(id: CharacterId, stat: StatId): number {
    return state(id)?.current[stat] ?? 0
  },

  /** Changes a pool stat by `amount` (negative = damage), within 0..max. Returns the new value. */
  change(id: CharacterId, stat: StatId, amount: number): number {
    if (!state(id)) return 0
    const max = party.stat(id, stat)
    useGameStore.setState((s) => {
      const m = s.party.data[id]
      if (m)
        m.current[stat] = Math.max(0, Math.min(max, Math.round((m.current[stat] ?? 0) + amount)))
    })
    return party.current(id, stat)
  },

  /**
   * Lasting statuses a character carries between fights (src/content/statuses.ts `lasting`):
   * status id -> turns left. Empty for most.
   */
  statuses(id: CharacterId): Record<string, number> {
    return useGameStore.getState().party.statuses?.[id] ?? {}
  },

  /** Replaces what a character carries (the battle manager calls this after a fight). */
  setStatuses(id: CharacterId, statuses: Record<string, number>): void {
    useGameStore.setState((s) => {
      const all = { ...s.party.statuses }
      if (Object.keys(statuses).length > 0) all[id] = statuses
      else delete all[id]
      s.party.statuses = all
    })
  },

  /**
   * Removes carried statuses outside battle (an inn, an antidote used from the bag): one status,
   * 'bad' = every harmful one, or all of them when left out. No `id` = the whole party.
   */
  cure(id?: CharacterId, status?: StatusId | 'bad'): void {
    const ids = id
      ? [id]
      : (Object.keys(useGameStore.getState().party.statuses ?? {}) as CharacterId[])
    for (const member of ids) {
      const left: Record<string, number> = {}
      for (const [key, turns] of Object.entries(party.statuses(member))) {
        const bad = (statusDefs as Record<string, { bad?: boolean }>)[key]?.bad
        const gone = status === undefined || status === key || (status === 'bad' && bad)
        if (!gone) left[key] = turns
      }
      party.setStatuses(member, left)
    }
  },

  /** Fills every pool (hp, mp) of one member, or of the whole party, and cures what they carry. */
  restore(id?: CharacterId): void {
    const ids = id ? [id] : party.members()
    for (const member of ids) {
      party.cure(member)
      const m = state(member)
      if (!m) continue
      const max = computeStats(member, m)
      useGameStore.setState((s) => {
        const target = s.party.data[member]
        if (target) for (const pool of POOLS) target.current[pool] = max[pool]
      })
    }
  },

  /** True when the first pool stat (hp) is 0. */
  isDown(id: CharacterId): boolean {
    const hp = POOLS[0]
    return hp ? party.current(id, hp) <= 0 : false
  },

  /**
   * Gives XP to one member or every member ('party'). Level ups raise stats (and pools by the
   * same amount); `notify` shows "Anna reached level 3". Returns the levels gained per member.
   */
  giveXp(
    who: CharacterId | 'party',
    amount: number,
    options: { notify?: boolean } = {},
  ): Partial<Record<CharacterId, number>> {
    const gained: Partial<Record<CharacterId, number>> = {}
    for (const id of who === 'party' ? party.members() : [who]) {
      const before = state(id)
      if (!before) continue
      const oldStats = computeStats(id, before)
      const oldSkills = party.skills(id)
      const xp = before.xp + Math.max(0, Math.round(amount))
      const level = levelForXp(xp)
      useGameStore.setState((s) => {
        const m = s.party.data[id]
        if (m) {
          m.xp = xp
          m.level = level
        }
      })
      if (level > before.level) {
        gained[id] = level - before.level
        // Pools grow with their maximum (a level up doesn't heal fully, but adds the new points).
        const newStats = computeStats(id, state(id) as MemberState)
        for (const pool of POOLS) party.change(id, pool, newStats[pool] - oldStats[pool])
        if (options.notify)
          toast(t('{name} reached level {level}!', { name: t(info(id)?.name ?? id), level }), {
            kind: 'levelUp',
            params: { character: id, level },
          })
        // Skills that come with the new level.
        if (options.notify)
          for (const skill of party.skills(id)) if (!oldSkills.includes(skill)) announce(id, skill)
      }
    }
    return gained
  },

  /**
   * Puts an item from the inventory on a member (its slot comes from the item). What was in that
   * slot goes back to the inventory. False if they don't have it or it isn't wearable.
   */
  equip(id: CharacterId, item: ItemId): boolean {
    const slot = itemInfo(item).equip?.slot
    if (!slot || !state(id) || !items.has(item)) return false
    party.unequip(id, slot)
    items.remove(item)
    useGameStore.setState((s) => {
      const m = s.party.data[id]
      if (m) m.equipment[slot] = item
    })
    clampPools(id)
    return true
  },

  /** Takes off what is in a slot (back into the inventory). */
  unequip(id: CharacterId, slot: SlotId): void {
    const current = state(id)?.equipment[slot] as ItemId | undefined
    if (!current) return
    useGameStore.setState((s) => {
      const m = s.party.data[id]
      if (m) delete m.equipment[slot]
    })
    items.add(current)
    clampPools(id)
  },

  /** Items in the inventory that fit a slot. */
  equippable(slot: SlotId): ItemId[] {
    return items
      .list()
      .filter((e) => e.item.equip?.slot === slot)
      .map((e) => e.id)
  },
}

/** React: a member's view (re-renders when the party or inventory changes). */
export function useMember(id: CharacterId): MemberView | null {
  useGameStore((s) => s.party.data[id])
  return party.member(id)
}

/** React: the lasting statuses a character carries (status id -> turns left). */
export function usePartyStatuses(id: CharacterId): Record<string, number> {
  useGameStore((s) => s.party.statuses?.[id])
  return party.statuses(id)
}

/** React: the party member ids. */
export function usePartyMembers(): CharacterId[] {
  return useGameStore((s) => s.party.members) as CharacterId[]
}
