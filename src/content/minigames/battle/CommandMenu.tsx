import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { type RefObject, useEffect, useState } from 'react'
import type { Action, Battle, Fighter, Outcome } from '@/core/battle/engine'
import type { BattleTarget, SkillConfig } from '@/core/define'
import { game } from '@/core/game'
import { useLang } from '@/core/lang'
import type { BattleParams } from '@/core/managers/battles'
import { type ItemId, type SkillId, skills } from '@/core/registry'
import { StatusIcon } from './StatusIcons'

/**
 * Which command list is showing. "target" waits for the player to pick a fighter for an action;
 * "check" waits for any fighter to look at; "info" shows that fighter.
 */
export type Menu =
  | { kind: 'main' }
  | { kind: 'skills' }
  | { kind: 'items' }
  | {
      kind: 'target'
      target: BattleTarget
      make: (target: string) => Action
      delay?: number
      /** What the chosen skill or item does: shown while picking the target. */
      note?: string
    }
  | { kind: 'check' }
  | { kind: 'info'; key: string }

/** What Check shows: HP / MP, every status with its turns and what it does, and weak spots. */
function Info({ battle, fighter }: { battle: Battle; fighter: Fighter }) {
  const t = useLang()
  const maxMp = battle.maxMp(fighter)
  // Enemies keep their weak spots secret: find them by trying.
  const rates = fighter.side === 'party' ? Object.entries(fighter.elements) : []
  const named = (list: [string, number][]) =>
    list.map(([id]) => t(game.battles.elementInfo(id)?.name ?? id)).join(', ')
  const weak = rates.filter(([, rate]) => rate > 1)
  const strong = rates.filter(([, rate]) => rate < 1)
  return (
    <Stack spacing={0.5} sx={{ maxWidth: 260 }}>
      <Typography variant="subtitle2">{fighter.name}</Typography>
      <Typography variant="body2">
        HP {fighter.hp}/{battle.maxHp(fighter)}
        {maxMp > 0 ? ` · MP ${fighter.mp}/${maxMp}` : ''}
      </Typography>
      {fighter.defending && <Typography variant="body2">🛡 {t('Defending')}</Typography>}
      {fighter.statuses.length === 0 && !fighter.defending && (
        <Typography variant="body2" color="text.secondary">
          {t('No statuses.')}
        </Typography>
      )}
      {fighter.statuses.map((s) => {
        const info = battle.statusInfo(s.id)
        return (
          <Box key={s.id}>
            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <StatusIcon battle={battle} id={s.id} />
              {t(info?.name ?? s.id)} ({t('{n} turns', { n: s.turns })})
            </Typography>
            {info?.description && (
              <Typography variant="caption" color="text.secondary">
                {t(info.description)}
              </Typography>
            )}
          </Box>
        )
      })}
      {weak.length > 0 && (
        <Typography variant="body2">{t('Weak to: {list}', { list: named(weak) })}</Typography>
      )}
      {strong.length > 0 && (
        <Typography variant="body2">{t('Resists: {list}', { list: named(strong) })}</Typography>
      )}
    </Stack>
  )
}

/** The command box: Attack/Skills/Items/..., their sub-lists, Check, and the result at the end. */
export function CommandMenu({
  battle,
  rewards,
  menu,
  setMenu,
  run,
  choose,
  preview,
  finish,
  menuRef,
  small,
}: {
  battle: Battle
  rewards: BattleParams['rewards']
  menu: Menu
  setMenu: (menu: Menu) => void
  run: (action: Action) => void
  choose: (
    target: BattleTarget,
    make: (target: string) => Action,
    delay?: number,
    note?: string,
  ) => void
  /** Shows the turn order after an action this slow (undefined = the order as it is). */
  preview: (delay: number | undefined) => void
  finish: (outcome: Outcome) => void
  menuRef: RefObject<HTMLDivElement | null>
  /** A short screen (phone held sideways): more columns, smaller buttons. */
  small: boolean
}) {
  const t = useLang()
  const current = battle.current()
  const playerTurn = current?.side === 'party' && !battle.forced()
  const battleItems = game.items.list().filter((e) => e.item.battle)
  const looked = menu.kind === 'info' ? battle.get(menu.key) : undefined
  const size = small ? 'small' : 'medium'
  // What the focused skill or item does. Focus (keys, gamepad) fills it; on touch a tap goes
  // straight to picking a target, and the same text shows there until the target is tapped.
  const [hint, setHint] = useState('')
  const listKind = menu.kind
  // A new list starts with no hint (the listKind dependency is the trigger).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => setHint(''), [listKind])
  const hintLine = (text: string) =>
    text ? (
      <Typography
        variant="caption"
        color="text.secondary"
        aria-live="polite"
        sx={{ gridColumn: '1 / -1', maxWidth: 280, display: 'block' }}
      >
        {text}
      </Typography>
    ) : null
  const back = (
    <Button size={size} onClick={() => setMenu({ kind: 'main' })}>
      {t('Back')}
    </Button>
  )
  // Lists of commands: a column, or a grid on short screens so the box stays low.
  const list = (columns: number) =>
    ({ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 0.75 }) as const

  return (
    <Paper ref={menuRef} sx={{ p: small ? 1 : 1.5, minWidth: small ? 0 : 220 }}>
      {battle.outcome ? (
        <Stack spacing={1}>
          <Typography variant="h6">
            {battle.outcome === 'win'
              ? t('Victory!')
              : battle.outcome === 'lose'
                ? t('Defeated…')
                : t('Got away!')}
          </Typography>
          {battle.outcome === 'win' && (
            <Typography variant="body2">
              {t('+{xp} XP, {money}', {
                xp: rewards.xp,
                money: game.money.format(rewards.money),
              })}
              {rewards.drops.map((d) => `, ${t(game.items.info(d).name)}`).join('')}
            </Typography>
          )}
          <Button
            size={size}
            variant="contained"
            data-continue
            onClick={() => finish(battle.outcome as Outcome)}
          >
            {t('Continue')}
          </Button>
        </Stack>
      ) : !playerTurn || !current ? (
        <Typography color="text.secondary">{t('…')}</Typography>
      ) : menu.kind === 'main' ? (
        <Box sx={list(small ? 3 : 2)}>
          <Typography variant="subtitle2" sx={{ gridColumn: '1 / -1' }}>
            {t("{name}'s turn", { name: t(current.name) })}
          </Typography>
          <Button
            size={size}
            variant="contained"
            onClick={() => choose('enemy', (target) => ({ kind: 'attack', target }))}
          >
            {t('Attack')}
          </Button>
          <Button
            size={size}
            variant="outlined"
            disabled={current.skills.length === 0 || !battle.canUseSkills(current)}
            onClick={() => setMenu({ kind: 'skills' })}
          >
            {t('Skills')}
          </Button>
          <Button
            size={size}
            variant="outlined"
            disabled={battleItems.length === 0}
            onClick={() => setMenu({ kind: 'items' })}
          >
            {t('Items')}
          </Button>
          <Button size={size} variant="outlined" onClick={() => run({ kind: 'defend' })}>
            {t('Defend')}
          </Button>
          <Button size={size} variant="outlined" onClick={() => setMenu({ kind: 'check' })}>
            {t('Check')}
          </Button>
          {battle.canFlee && (
            <Button size={size} variant="outlined" onClick={() => run({ kind: 'flee' })}>
              {t('Run')}
            </Button>
          )}
        </Box>
      ) : menu.kind === 'skills' ? (
        <Box sx={list(small ? 2 : 1)}>
          {current.skills.map((id) => {
            const skill = skills[id as SkillId] as SkillConfig | undefined
            if (!skill) return null
            const cost = skill.mp ?? 0
            const delay = skill.delay ?? 1
            return (
              <Button
                key={id}
                variant="outlined"
                disabled={current.mp < cost || battle.targets(current, skill.target).length === 0}
                // Focus (keyboard, gamepad) shows the order after this skill and what it does.
                onFocus={() => {
                  preview(delay)
                  setHint(skill.description ? t(skill.description) : '')
                }}
                onBlur={() => preview(undefined)}
                onClick={() =>
                  choose(
                    skill.target,
                    (target) => ({ kind: 'skill', skill: id, target }),
                    delay,
                    skill.description ? t(skill.description) : undefined,
                  )
                }
              >
                {t(skill.name)} {cost ? `(${cost} MP)` : ''}
                {delay > 1 ? ' ⏳' : delay < 1 ? ' »' : ''}
              </Button>
            )
          })}
          {hintLine(hint)}
          {back}
        </Box>
      ) : menu.kind === 'items' ? (
        <Box sx={list(small ? 2 : 1)}>
          {battleItems.map(({ id, count, item }) => {
            const target = item.battle?.target ?? 'ally'
            return (
              <Button
                key={id}
                variant="outlined"
                disabled={battle.targets(current, target).length === 0}
                onFocus={() => setHint(item.description ? t(item.description) : '')}
                onClick={() =>
                  choose(
                    target,
                    (to) => ({ kind: 'item', item: id as ItemId, target: to }),
                    undefined,
                    item.description ? t(item.description) : undefined,
                  )
                }
              >
                {t(item.name)} ×{count}
              </Button>
            )
          })}
          {hintLine(hint)}
          {back}
        </Box>
      ) : menu.kind === 'info' && looked ? (
        <Stack spacing={1}>
          <Info battle={battle} fighter={looked} />
          <Box sx={list(small ? 2 : 1)}>
            <Button size={size} variant="outlined" onClick={() => setMenu({ kind: 'check' })}>
              {t('Check another')}
            </Button>
            {back}
          </Box>
        </Stack>
      ) : (
        <Stack spacing={0.75}>
          <Typography variant="body2">
            {menu.kind === 'check' ? t('Pick who to look at.') : t('Pick a target.')}
          </Typography>
          {menu.kind === 'target' && hintLine(menu.note ?? '')}
          {back}
        </Stack>
      )}
    </Paper>
  )
}
