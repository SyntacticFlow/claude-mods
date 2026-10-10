import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { buildTranscript } from './register'

const row = (role: SessionMessage['role'], text: string): SessionMessage => ({ role, text, toolUses: [] })

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = {
  command: 'cold-handoff',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const MESSAGES: SessionMessage[] = [
  row('user', 'Add a login page'),
  row('assistant', 'Added src/login.tsx'),
  row('user', 'Now wire it to the router'),
  row('assistant', 'Wired it in src/routes.ts'),
  row('user', '<command-name>/cold-handoff</command-name>'),
]

test('summarizes with Haiku and copies summary plus last two messages', async ($, on) => {
  let prompt = ''
  let model = ''
  let copied = ''
  on('session.messages', () => ({ value: MESSAGES }))
  on('model.complete', (_, e) => {
    prompt = e.prompt
    model = e.model
    return { value: { isAnswered: true, text: 'SUMMARY TEXT', usage: USAGE } }
  })
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } }
  })

  const result = await $.command.run(RUN)

  expect(model).toBe('haiku')
  expect(prompt).toContain('Add a login page')
  expect(prompt).not.toContain('<command-name>')
  expect(copied).toContain('SUMMARY TEXT')
  expect(copied).toContain('## User\n\nNow wire it to the router')
  expect(copied).toContain('## Assistant\n\nWired it in src/routes.ts')
  expect(copied).not.toContain('Added src/login.tsx')
  expect(result.text).toContain('copied to the clipboard')
})

test('falls back to the OS clipboard when the surface cannot copy', async ($, on) => {
  let stdin = ''
  on('session.messages', () => ({ value: MESSAGES }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'SUMMARY TEXT', usage: USAGE },
  }))
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  on('process.run', (_, e) => {
    stdin = e.init?.stdin ?? ''
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const result = await $.command.run(RUN)

  expect(stdin).toContain('SUMMARY TEXT')
  expect(result.text).toContain('copied to the clipboard')
})

test('an over-budget transcript keeps the opening, the closing and a spread of the middle', () => {
  const filler = 'x'.repeat(10_000)
  const long = Array.from({ length: 100 }, (_, i) => row(i % 2 === 0 ? 'user' : 'assistant', `<<MSG-${i}>> ${filler}`))

  const transcript = buildTranscript(long)
  const kept = [...transcript.matchAll(/<<MSG-(\d+)>>/g)].map(match => Number(match[1]))

  expect(transcript.length).toBeLessThan(510_000)
  expect(kept.slice(0, 3)).toEqual([0, 1, 2])
  expect(kept.slice(-3)).toEqual([97, 98, 99])
  expect(kept.some(i => i >= 35 && i <= 65)).toBe(true)
  expect(kept.length).toBeLessThan(100)
  expect(transcript).toContain('messages omitted ...]')
})

test('a transcript under budget is kept whole', () => {
  const transcript = buildTranscript(MESSAGES.slice(0, 4))

  expect(transcript).toContain('Add a login page')
  expect(transcript).toContain('Wired it in src/routes.ts')
  expect(transcript).not.toContain('omitted')
})
