import { expect, test } from 'claude-code/testing'

import { HELP, WORDS, parseCommand, suggest } from '../hooks/commands'

test('only a bare command, on and off switch Clawd; everything unknown is a hint, never a toggle', () => {
  expect(parseCommand('')).toEqual({ kind: 'toggle' })
  expect(parseCommand('  ')).toEqual({ kind: 'toggle' })
  expect(parseCommand('on')).toEqual({ kind: 'enable', on: true })
  expect(parseCommand('OFF')).toEqual({ kind: 'enable', on: false })

  // help and its usual spellings do not switch anything
  for (const word of ['help', '-h', '--help', '?']) expect(parseCommand(word)).toEqual({ kind: 'help' })
  // a typo is not a toggle
  const typo = parseCommand('stauts')
  expect(typo.kind).toBe('unknown')
  expect(typo).toEqual({ kind: 'unknown', word: 'stauts', suggestion: 'status' })
  expect(parseCommand('banana')).toEqual({ kind: 'unknown', word: 'banana', suggestion: undefined })
})

test('each command takes the words it is meant to take, and says so when it gets others', () => {
  expect(parseCommand('dots')).toEqual({ kind: 'style', value: 'dots' })
  expect(parseCommand('pixels')).toEqual({ kind: 'style', value: 'pixels' })
  expect(parseCommand('village')).toEqual({ kind: 'village', value: 'toggle' })
  expect(parseCommand('village off')).toEqual({ kind: 'village', value: 'off' })
  expect(parseCommand('village maybe').kind).toBe('invalid')
  expect(parseCommand('break 30')).toEqual({ kind: 'break', minutes: 30 })
  expect(parseCommand('break 12.5')).toEqual({ kind: 'break', minutes: 12.5 })
  expect(parseCommand('break off')).toEqual({ kind: 'break', minutes: 0 })
  expect(parseCommand('break')).toEqual({ kind: 'break', minutes: undefined })
  expect(parseCommand('break soon').kind).toBe('invalid')
  expect(parseCommand('break -5').kind).toBe('invalid')
  expect(parseCommand('fit 1.035')).toEqual({ kind: 'fit', value: 1.035 })
  expect(parseCommand('fit wide').kind).toBe('invalid')
  expect(parseCommand('renderer blocks')).toEqual({ kind: 'renderer', value: 'blocks' })
  expect(parseCommand('renderer')).toEqual({ kind: 'renderer', value: undefined })
  expect(parseCommand('renderer pictures').kind).toBe('invalid')
  // a word that merely starts like a command is not that command
  expect(parseCommand('villagefoo').kind).toBe('unknown')
  expect(parseCommand('breakfast').kind).toBe('unknown')
})

test('suggestions only come for near misses, and the help lists every command', () => {
  expect(suggest('vilage')).toBe('village')
  expect(suggest('render')).toBe('renderer')
  expect(suggest('pixles')).toBe('pixels')
  expect(suggest('zzzzzz')).toBe(undefined)
  // `style` is a hidden shortcut that flips between dots and pixels; every other word is in the help
  for (const word of WORDS.filter(w => w !== 'style')) expect(HELP.includes(word)).toBe(true)
})
