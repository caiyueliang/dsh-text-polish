/**
 * Host half of the text-polish bundle.
 *
 * The browser half cannot reach a model directly, so this half registers one
 * `/polish` command whose handler performs a single auxiliary model call and
 * returns the rewritten text as the command result. The composer button calls
 * it through the shipped `commands/execute` Remote and writes the returned
 * text back into the draft.
 *
 * The command declares `recordInput: false`, so the text being polished never
 * enters the session log.
 */

/** Instruction that polishes ordinary drafts and expands task-like ones. */
const SYSTEM_PROMPT = [
  '你是聊天输入框的「润色 + 扩写」引擎。用户把草稿交给你，你要把它改写成一段更清楚、更完整、可以直接发给 AI 助手的文本。',
  '',
  '先判断草稿类型，再决定改写力度：',
  '1. 任务、指令或需求（例如「帮我看看这个报错」「写个脚本处理这些文件」）：在保持原意的前提下扩写、细化。补全目标与背景，明确交付物与格式，列出关键约束与边界，给出验收标准，必要时拆成有顺序的步骤，让接手的人不必再追问就能开工。',
  '2. 普通叙述、提问、闲聊，或本身已经完整的内容：只做润色——修正错别字、病句、标点误用与中英文空格，删掉口水话和重复表述，理顺语序。不要为了凑长度而扩写。',
  '',
  '通用要求：',
  '- 语言与原文一致，保留原文的语气与身份，不要变得比原文更客气或更强势。',
  '- 不改变原文的意图与结论；不添加与原文矛盾、或原文从未提及的具体事实（人名、路径、数字、时间、金额、版本号等）。常识性且不引起歧义的要求可以补。',
  '- 原文里的代码、命令、路径、URL、专有名词和 Markdown 结构原样保留。',
  '- 不要替用户执行任务，不要回答问题，不要输出解释、标题、前言或收尾说明。',
  '- 只输出改写后的文本本身：不要引号、前缀、代码围栏，也不要输出 <text> 标签。',
  '- 长度以把话说明白为准：任务类通常明显长于原文，但不要堆砌套话。',
  '',
  '示例一（任务类，需要扩写）：',
  '草稿：帮我看看这个报错',
  '输出：请帮我排查下面这个报错。先说明报错出现的场景、触发它的操作步骤，以及我已经尝试过的排查方式；然后按可能性从高到低列出最可能的原因，每个原因给出具体的验证方法和修复方案；最后列出需要我补充的信息（日志、代码片段、配置等）。',
  '',
  '示例二（非任务，只需要润色）：',
  '草稿：今天开会说到下个季度的目标 大概就是提升转化',
  '输出：今天开会谈到了下个季度的目标，大概就是提升转化率。',
].join('\n')

/** Task statement that frames one draft as text to rewrite, never as a request to run. */
const USER_PREFIX = '把下面 <text> 里的草稿改写后返回，只输出改写后的文本，不要输出 <text> 标签。'

/** Longest accepted draft, in characters. */
const MAX_INPUT_CHARS = 8000

/** Output ceiling for the rewrite. */
const MAX_OUTPUT_TOKENS = 4096

/** Command name the composer button invokes. */
const COMMAND_NAME = 'polish'

/** Command identity recorded with each `command/run` event. */
const DEFINITION_ID = 'dsh-text-polish'

/** Hard dependencies: a registry to contribute to and a model to call. */
export const inject = ['commands', 'llm']

/**
 * Register the `/polish` command.
 * @param ctx - Host context owning the registration.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    definitionId: DEFINITION_ID,
    name: COMMAND_NAME,
    description: 'Polish the supplied draft, or expand it into a detailed task, and return the rewrite',
    input: { hint: 'text' },
    recordInput: false,
    handler: invocation => handlePolish(ctx, invocation),
  }))
}

/**
 * Settle one `/polish` invocation.
 * @param ctx - Host context exposing the model service.
 * @param invocation - command invocation carrying the verbatim text and cancellation.
 * @returns the polished text, or an explicit error result.
 */
async function handlePolish(ctx, invocation) {
  const text = invocation.rawInput.trim()
  if (text === '') return { kind: 'error', text: 'Nothing to polish.' }
  if (text.length > MAX_INPUT_CHARS) {
    return { kind: 'error', text: `This draft is longer than ${MAX_INPUT_CHARS} characters.` }
  }
  try {
    const route = await resolveRoute(ctx)
    if (route === undefined) return { kind: 'error', text: 'No model is available for polishing.' }
    const polished = await rewrite(ctx, route, text, invocation.signal)
    if (polished === undefined) return { kind: 'error', text: 'The model returned no text.' }
    return { kind: 'success', text: polished }
  } catch (error) {
    return { kind: 'error', text: `Polish failed: ${messageOf(error)}` }
  }
}

/**
 * Resolve the model route to call: the configured default, else any routed provider.
 * @param ctx - Host context exposing the model services.
 * @returns the route, or undefined when nothing is routable.
 */
async function resolveRoute(ctx) {
  const defaults = ctx.get('agentDefaultModel')
  if (defaults !== undefined) {
    const selection = defaults.currentSelection()
    if (selection !== undefined && selection !== null
      && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return {
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
      }
    }
  }
  for (const provider of ctx.llm.listProviders()) {
    const models = await ctx.llm.listModels(provider.id)
    if (models.length > 0) return { provider: provider.id, model: models[0].id }
  }
  return undefined
}

/**
 * Run the single auxiliary model call.
 * @param ctx - Host context exposing the model service.
 * @param route - provider, model, and optional reasoning effort.
 * @param text - text to rewrite.
 * @param signal - command cancellation.
 * @returns the trimmed rewrite, or undefined when the model produced no text.
 * @throws when the provider reports a terminal failure.
 */
async function rewrite(ctx, route, text, signal) {
  let output = ''
  let failure
  for await (const chunk of ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: frameDraft(text) }] }],
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
  })) {
    if (chunk.type === 'text-delta') output += chunk.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'text' && output === '') output = chunk.block.text
    else if (chunk.type === 'finish' && chunk.reason.kind !== 'stop' && chunk.reason.kind !== 'tool-calls') {
      failure = chunk.reason.failure
    }
  }
  if (failure !== undefined) {
    const code = typeof failure.code === 'string' ? ` (${failure.code})` : ''
    throw new Error(`${failure.message}${code}`)
  }
  const polished = output.trim()
  return polished === '' ? undefined : polished
}

/**
 * Wrap one draft so the model rewrites it instead of executing it.
 * @param text - verbatim draft.
 * @returns the framed user message.
 */
function frameDraft(text) {
  return [USER_PREFIX, '', '<text>', text, '</text>'].join('\n')
}

/** Render one thrown value without trusting its string coercion. */
function messageOf(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  try {
    return String(error)
  } catch {
    return 'unrenderable error'
  }
}
