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

/** 系统提示词：区分普通文本润色和任务需求扩写，并规定改写边界与输出格式。 */
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

/** 用户消息前缀：明确后续内容是待改写草稿，避免模型把草稿当成待执行指令。 */
const USER_PREFIX = '把下面 <text> 里的草稿改写后返回，只输出改写后的文本，不要输出 <text> 标签。'

/** 单次允许提交给模型改写的最大输入字符数。 */
const MAX_INPUT_CHARS = 8000

/** 模型单次改写允许生成的最大 token 数。 */
const MAX_OUTPUT_TOKENS = 4096

/** 输入框按钮通过 DSH 命令注册表调用的命令名称。 */
const COMMAND_NAME = 'polish'

/** 命令定义的稳定标识，用于 DSH 识别该命令及其运行事件。 */
const DEFINITION_ID = 'dsh-text-polish'

/** 插件注入依赖：注册命令所需的 commands 服务和发起模型请求所需的 llm 服务。 */
export const inject = ['commands', 'llm']

/**
 * 注册 `/polish` 命令，并将调用交给统一的处理函数。
 * @param ctx - 承载插件注册操作的 DSH Host 上下文。
 */
export function apply(ctx) {
  // 将注册清理函数交给 ctx.effect 管理，插件卸载时可同步撤销命令注册。
  ctx.effect(() => ctx.commands.register({
    definitionId: DEFINITION_ID,
    name: COMMAND_NAME,
    description: 'Polish the supplied draft, or expand it into a detailed task, and return the rewrite',
    input: { hint: 'text' },
    // 不把原始草稿作为命令输入写入会话日志。
    recordInput: false,
    // 把每次命令调用交给下面的异步处理流程。
    handler: invocation => handlePolish(ctx, invocation),
  }))
}

/**
 * 处理一次 `/polish` 命令调用：校验输入、选择模型、执行改写并整理结果。
 * @param ctx - 提供模型服务和其他 Host 能力的上下文。
 * @param invocation - 命令调用对象，包含原始输入文本及取消信号。
 * @returns 改写成功时返回文本，失败时返回可显示的错误结果。
 */
async function handlePolish(ctx, invocation) {
  // 去掉首尾空白后再校验，避免空白输入触发无意义的模型请求。
  const text = invocation.rawInput.trim()
  if (text === '') return { kind: 'error', text: 'Nothing to polish.' }
  // 在联系模型之前限制输入长度，控制请求规模并提供明确反馈。
  if (text.length > MAX_INPUT_CHARS) {
    return { kind: 'error', text: `This draft is longer than ${MAX_INPUT_CHARS} characters.` }
  }
  try {
    // 优先使用用户当前选中的模型；若无法取得可用模型则返回错误。
    const route = await resolveRoute(ctx)
    if (route === undefined) return { kind: 'error', text: 'No model is available for polishing.' }
    // 发起单次流式改写，并透传命令取消信号。
    const polished = await rewrite(ctx, route, text, invocation.signal)
    if (polished === undefined) return { kind: 'error', text: 'The model returned no text.' }
    return { kind: 'success', text: polished }
  } catch (error) {
    return { kind: 'error', text: `Polish failed: ${messageOf(error)}` }
  }
}

/**
 * 确定模型路由：先取默认模型选择；不可用时依次查找有模型的服务商。
 * @param ctx - 提供默认模型状态和 LLM 服务的 Host 上下文。
 * @returns 可调用的服务商与模型信息；没有可用路由时返回 undefined。
 */
async function resolveRoute(ctx) {
  // agentDefaultModel 在部分环境可能没有注册，因此先检查服务是否存在。
  const defaults = ctx.get('agentDefaultModel')
  if (defaults !== undefined) {
    // 只有服务商和模型标识都有效时，才使用当前选择。
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
  // 默认模型不可用时，按注册顺序寻找第一个至少包含一个模型的服务商。
  for (const provider of ctx.llm.listProviders()) {
    const models = await ctx.llm.listModels(provider.id)
    if (models.length > 0) return { provider: provider.id, model: models[0].id }
  }
  return undefined
}

/**
 * 执行一次辅助模型调用，并收集流式响应中的文本内容。
 * @param ctx - 提供 LLM 流式调用能力的 Host 上下文。
 * @param route - 服务商、模型及可选的推理强度设置。
 * @param text - 需要改写的草稿文本。
 * @param signal - 命令取消信号，用于中止模型调用。
 * @returns 去除首尾空白的改写结果；模型没有文本时返回 undefined。
 * @throws 模型服务报告不可继续的终止错误时抛出异常。
 */
async function rewrite(ctx, route, text, signal) {
  // 累积文本增量，并暂存模型报告的终止错误。
  let output = ''
  let failure
  // 以异步迭代方式消费模型事件，直到响应流结束。
  for await (const chunk of ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: frameDraft(text) }] }],
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
  })) {
    // 常规文本增量事件：按接收顺序拼接输出。
    if (chunk.type === 'text-delta') output += chunk.text
    // 某些实现只在文本块结束事件提供完整内容，且之前尚未收到增量。
    else if (chunk.type === 'block-end' && chunk.block.type === 'text' && output === '') output = chunk.block.text
    // 记录非正常结束原因；最终在流结束后统一转成异常处理。
    else if (chunk.type === 'finish' && chunk.reason.kind !== 'stop' && chunk.reason.kind !== 'tool-calls') {
      failure = chunk.reason.failure
    }
  }
  // 若流以错误原因结束，保留服务端错误码并交给上层展示。
  if (failure !== undefined) {
    const code = typeof failure.code === 'string' ? ` (${failure.code})` : ''
    throw new Error(`${failure.message}${code}`)
  }
  // 清理模型输出；空输出用 undefined 表示，让调用方生成对应提示。
  const polished = output.trim()
  return polished === '' ? undefined : polished
}

/**
 * 为草稿添加边界标记，提示模型改写其中的文本而不是执行其内容。
 * @param text - 原始草稿文本。
 * @returns 发送给模型的完整用户消息。
 */
function frameDraft(text) {
  // 使用明确的 <text> 边界，将操作指令与用户提供的草稿区分开。
  return [USER_PREFIX, '', '<text>', text, '</text>'].join('\n')
}

/** 安全地将任意抛出值转为可显示文本，避免不可靠的字符串转换再次抛错。 */
function messageOf(error) {
  // 优先使用标准 Error.message，避免输出对象的内部结构。
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  try {
    // 兼容抛出字符串或其他原始值的情况。
    return String(error)
  } catch {
    // 某些对象自定义了会抛错的 toString，使用固定兜底信息。
    return 'unrenderable error'
  }
}
