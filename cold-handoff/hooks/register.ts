import type { EngineInterface, Register, SessionMessage } from 'claude-code'

const COMMAND = 'cold-handoff'
// An alias, resolved like `--model haiku`: the newest Haiku this Claude Code version knows.
const MODEL = 'haiku'
// Keeps the transcript sent to Haiku well inside its context window.
const MAX_TRANSCRIPT_CHARS = 500_000
// Shares of MAX_TRANSCRIPT_CHARS reserved for the opening and closing messages; the rest, plus whatever they leave unused, goes to the middle.
const HEAD_SHARE = 0.25
const TAIL_SHARE = 0.35
// One huge message (a pasted log) keeps its start and end so it cannot crowd out the rest.
const MAX_BLOCK_CHARS = 30_000
const MAX_TOOL_INPUT_CHARS = 300
const SEPARATOR = '\n\n'

const SYSTEM = `You write handoff notes so a brand-new Claude Code session can continue work started in another session, with no access to that session.

Summarize the transcript you are given. Cover, in this order, under these markdown headings:
## Goal
What the user is trying to achieve overall.
## Decisions and constraints
Choices made, user preferences stated, approaches ruled out and why.
## Work done
What was changed or learned. Name concrete files, functions, commands, URLs and identifiers exactly.
## Current state
Where things stand right now, including anything broken, half-finished or unverified.
## Next steps
What the next session should do first.

A long transcript has some messages replaced by "[... N messages omitted ...]" markers; do not guess at what they held.

Be specific and dense. Omit pleasantries and anything the next session does not need. Do not invent details that are not in the transcript.`

const OS_CLIPBOARD_COMMANDS: readonly (readonly string[])[] = [
  [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
  ],
  ['pbcopy'],
  ['wl-copy'],
  ['xclip', '-selection', 'clipboard'],
]

const isCommandRow = (message: SessionMessage) =>
  /^\s*(<command-|<local-command-|\/cold-handoff\b)/.test(message.text)

const label = (message: SessionMessage) => (message.role === 'user' ? 'User' : 'Assistant')

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text)

const renderForSummary = (message: SessionMessage) => {
  const lines = [`### ${label(message)}`]
  if (message.text.trim() !== '') lines.push(message.text.trim())
  for (const use of message.toolUses) {
    lines.push(`[tool ${use.tool}${use.isError ? ' (error)' : ''}: ${clip(JSON.stringify(use.input), MAX_TOOL_INPUT_CHARS)}]`)
  }

  return lines.join('\n')
}

const capBlock = (block: string) => {
  if (block.length <= MAX_BLOCK_CHARS) return block
  const half = MAX_BLOCK_CHARS / 2

  return `${block.slice(0, half)}\n[... ${block.length - MAX_BLOCK_CHARS} characters omitted ...]\n${block.slice(-half)}`
}

// Midpoints first, then the midpoints of each half, and so on, so any prefix of the order is spread evenly over [start, end).
const spreadOrder = (start: number, end: number) => {
  const order: number[] = []
  const ranges: [number, number][] = [[start, end]]
  for (let next = ranges.shift(); next !== undefined; next = ranges.shift()) {
    const [lo, hi] = next
    if (lo >= hi) continue
    const mid = Math.floor((lo + hi) / 2)
    order.push(mid)
    ranges.push([lo, mid], [mid + 1, hi])
  }

  return order
}

// Over budget, keeps the opening messages, then the closing ones, then fills what is left with messages spread across the middle.
export const buildTranscript = (messages: readonly SessionMessage[]) => {
  const blocks = messages.map(message => capBlock(renderForSummary(message)))
  const cost = (i: number) => (blocks[i]?.length ?? 0) + SEPARATOR.length
  const total = blocks.reduce((sum, _, i) => sum + cost(i), 0)
  if (total <= MAX_TRANSCRIPT_CHARS) return blocks.join(SEPARATOR)

  const kept = new Set<number>()
  let used = 0
  const take = (i: number) => {
    kept.add(i)
    used += cost(i)
  }

  let head = 0
  while (head < blocks.length && (head === 0 || used + cost(head) <= MAX_TRANSCRIPT_CHARS * HEAD_SHARE)) take(head++)

  const tailLimit = used + MAX_TRANSCRIPT_CHARS * TAIL_SHARE
  let tail = blocks.length - 1
  while (tail >= head && (tail === blocks.length - 1 || used + cost(tail) <= tailLimit)) take(tail--)

  for (const i of spreadOrder(head, tail + 1)) {
    if (used + cost(i) <= MAX_TRANSCRIPT_CHARS) take(i)
  }

  const parts: string[] = []
  let gap = 0
  blocks.forEach((block, i) => {
    if (!kept.has(i)) {
      gap++
      return
    }
    if (gap > 0) parts.push(`[... ${gap} messages omitted ...]`)
    gap = 0
    parts.push(block)
  })

  return parts.join(SEPARATOR)
}

const buildHandoff = (summary: string, lastTwo: readonly SessionMessage[]) =>
  [
    'I am continuing work from a previous Claude Code session. Here is a summary of that session, followed by its last two messages verbatim.',
    '',
    '# Summary of previous session',
    '',
    summary.trim(),
    '',
    '# Last two messages of previous session',
    '',
    ...lastTwo.flatMap(message => [`## ${label(message)}`, '', message.text.trim(), '']),
    'Please pick up from here.',
  ].join('\n')

const copyToClipboard = async ($: EngineInterface, text: string) => {
  try {
    if ((await $.ui.copy({ text })).isCopied) return true
  } catch {
    // Falls through to the OS clipboard tools.
  }

  for (const argv of OS_CLIPBOARD_COMMANDS) {
    try {
      const { exitCode } = await $.process.run(argv, { stdin: text, timeoutMs: 15_000 })
      if (exitCode === 0) return true
    } catch {
      // This tool is not installed here; try the next one.
    }
  }

  return false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Summarize this session with Haiku and copy a handoff prompt to the clipboard',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const messages = (await $.session.messages()).filter(message => !isCommandRow(message))
    const conversational = messages.filter(message => message.text.trim() !== '')
    if (conversational.length === 0) return { text: 'Cold handoff: nothing to hand off yet.' }

    $.ui.status('Cold handoff: summarizing with Haiku...')
    let reply
    try {
      reply = await $.model.complete({
        model: MODEL,
        system: SYSTEM,
        prompt: `<transcript>\n${buildTranscript(messages)}\n</transcript>`,
        maxTokens: 4000,
      })
    } finally {
      $.ui.status(undefined)
    }

    if (!reply.isAnswered) {
      const detail = reply.reason === 'api-error' ? ` (${reply.error}, status ${reply.status ?? 'none'})` : ''

      return { text: `Cold handoff: Haiku did not answer: ${reply.reason}${detail}.` }
    }

    const handoff = buildHandoff(reply.text, conversational.slice(-2))
    if (await copyToClipboard($, handoff)) {
      $.ui.toast('Cold handoff copied. Paste it into a new session.')

      return { text: `Cold handoff copied to the clipboard (${handoff.length} characters).` }
    }

    return { text: `Cold handoff: could not reach a clipboard. Copy it from here:\n\n${handoff}` }
  })
}
