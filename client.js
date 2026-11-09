/**
 * Browser half of the text-polish bundle.
 *
 * One pill button in the composer tool row. Clicking it sends the current
 * draft to the `/polish` command over the shipped `commands/execute` Remote
 * and replaces the draft with the returned rewrite.
 */
// 通过 DSH 浏览器端模块加载器注册插件 UI，避免直接污染全局模块空间。
window.__ModuleLoader__.load({
  // 此 ID 与插件包及 Host 端命令归属保持一致。
  id: 'dsh-text-polish',
  // factory 在 DSH 提供的模块环境中运行，可获取 React 等宿主依赖。
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 插件界面文案使用的 locale 命名空间。 */
    const NS = 'text-polish'

    /** 按钮和状态提示的内联样式；随组件挂载和卸载，避免遗留全局样式。 */
    const CSS = `
.dsh-text-polish { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-text-polish__button {
  display: inline-flex; align-items: center; gap: 4px;
  height: 28px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 1;
  white-space: nowrap; cursor: pointer;
  transition: background-color .12s ease, border-color .12s ease, color .12s ease;
}
.dsh-text-polish__button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-text-polish__button:disabled { opacity: .55; cursor: default; }
.dsh-text-polish__notice {
  max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.dsh-text-polish__notice[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
`

    // 中文界面文案：按钮标签、提示、空输入、失败原因和并发修改提示。
    const zh = {
      label: '润色',
      running: '润色中',
      hint: '用当前模型改写输入框内容',
      hintEmpty: '请先输入要润色的文本',
      empty: '请先输入要润色的文本',
      failed: '润色失败：{reason}',
      unknown: '未知错误',
      noText: '模型没有返回文本',
      changed: '输入框内容已变化，未替换',
    }

    // 英文界面文案，字段与中文词典保持一致以供 locale 按键读取。
    const en = {
      label: 'Polish',
      running: 'Polishing',
      hint: 'Rewrite the draft with the current model',
      hintEmpty: 'Type the text to polish first',
      empty: 'Type the text to polish first',
      failed: 'Polish failed: {reason}',
      unknown: 'unknown error',
      noText: 'The model returned no text',
      changed: 'The draft changed; nothing was replaced',
    }

    /** 安全地把异常或任意抛出值转换成界面可显示的文本。 */
    function messageOf(error) {
      // Error 对象优先读取 message，避免把整个对象结构暴露到 UI。
      if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
      try {
        // 兼容异常以字符串、数字等非 Error 值抛出的情况。
        return String(error)
      } catch {
        // 自定义字符串转换也失败时，返回稳定的兜底文案。
        return 'unrenderable error'
      }
    }

    /** 绘制按钮使用的双闪光 SVG 图标，颜色继承当前文字颜色。 */
    function SparkleMark() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: false,
      },
      h('path', {
        d: 'M6.3 1.2 L7.6 5.2 L11.6 6.5 L7.6 7.8 L6.3 11.8 L5 7.8 L1 6.5 L5 5.2 Z',
        fill: 'currentColor',
      }),
      h('path', {
        d: 'M12 8.6 L12.85 11.15 L15.4 12 L12.85 12.85 L12 15.4 L11.15 12.85 L8.6 12 L11.15 11.15 Z',
        fill: 'currentColor', opacity: 0.7,
      }))
    }

    /**
     * 输入框工具栏中的润色按钮组件，负责发起改写并安全地更新草稿。
     * @param props - 插槽传入的会话标识、输入状态、草稿操作、文案函数和调用函数。
     * @returns 润色按钮及其旁边的状态或错误提示。
     */
    function PolishButton(props) {
      // 从插槽属性中提取界面文案、会话和命令调用能力。
      const t = props.t
      const sessionId = props.sessionId
      const polish = props.polish
      const setDraft = props.inputActions.setDraft
      // 订阅草稿和输入阶段状态，以便按钮显示及禁用状态及时更新。
      const draft = props.useInput(state => state.draft)
      const phase = props.useInput(state => state.phase)
      // running 防止重复提交；notice 用于向用户显示错误或运行结果状态。
      const [running, setRunning] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      // ref 始终保存最新草稿，异步返回时可检测用户是否在等待期间编辑过。
      const latestDraft = React.useRef(draft)
      latestDraft.current = draft
      // 保留当前请求的 AbortController，组件卸载时可取消未完成的调用。
      const inFlight = React.useRef(null)
      React.useEffect(() => () => {
        // 页面切换或组件卸载时取消请求，防止过期响应继续更新界面。
        if (inFlight.current !== null) inFlight.current.abort()
        inFlight.current = null
      }, [])
      // 仅在普通文本输入阶段允许操作，其他阶段或请求中禁用按钮。
      const text = typeof draft === 'string' ? draft.trim() : ''
      const disabled = running || phase !== 'plain'
      const onClick = () => {
        // 再次检查禁用条件，避免状态更新间隙中重复触发。
        if (disabled) return
        if (text === '') {
          // 空草稿不调用 Host 命令，直接显示输入提示。
          setNotice({ kind: 'error', text: t('empty') })
          return
        }
        // 记住本次提交的原始草稿，成功返回时用于并发编辑保护。
        const expected = latestDraft.current
        // 为本次命令创建独立取消信号，并切换到运行状态。
        const controller = new AbortController()
        inFlight.current = controller
        setRunning(true)
        setNotice(null)
        // 通过插槽提供的 polish 函数调用 Host 命令，再逐层校验返回结构。
        Promise.resolve()
          .then(() => polish(sessionId, expected.trim(), controller.signal))
          .then((result) => {
            // 已取消的请求不再更新提示或草稿。
            if (controller.signal.aborted) return
            if (result === undefined || result === null || result.ok !== true) {
              // Remote 层调用失败时优先显示服务端错误，否则使用通用提示。
              const failure = result === undefined || result === null ? undefined : result.error
              const reason = failure === undefined
                ? t('unknown')
                : (typeof failure.message === 'string' && failure.message !== '' ? failure.message : failure.code)
              setNotice({ kind: 'error', text: t('failed', { reason }) })
              return
            }
            // Remote 成功后，命令执行结果位于 value.result 中。
            const execution = result.value
            const outcome = execution === undefined ? undefined : execution.result
            if (outcome === undefined) {
              setNotice({ kind: 'error', text: t('unknown') })
              return
            }
            if (outcome.kind !== 'success') {
              // 命令自身返回业务错误时直接展示其错误文本。
              setNotice({ kind: 'error', text: typeof outcome.text === 'string' && outcome.text !== '' ? outcome.text : t('unknown') })
              return
            }
            // 确认成功结果包含非空文本，避免用空字符串覆盖当前草稿。
            const polished = typeof outcome.text === 'string' ? outcome.text.trim() : ''
            if (polished === '') {
              setNotice({ kind: 'error', text: t('noText') })
              return
            }
            // 请求期间若草稿发生变化，保留用户的新内容而不应用旧响应。
            if (latestDraft.current !== expected) {
              setNotice({ kind: 'error', text: t('changed') })
              return
            }
            // 仅在原稿仍未变化时写回模型改写结果。
            setDraft(polished)
            setNotice(null)
          })
          .catch((error) => {
            // 取消请求不应显示失败提示；其他异常转换为本地化错误文案。
            if (controller.signal.aborted) return
            setNotice({ kind: 'error', text: t('failed', { reason: messageOf(error) }) })
          })
          .then(() => {
            // 只清理本次仍然有效的请求引用，并结束加载状态。
            if (inFlight.current === controller) inFlight.current = null
            setRunning(false)
          })
      }
      // Fragment 同时返回局部样式和工具栏按钮，不额外增加 DOM 包裹层。
      return h(React.Fragment, null,
        h('style', { key: 'sheet' }, CSS),
        h('div', { className: 'dsh-text-polish', key: 'root' },
          h('button', {
            // 使用原生 button 获得键盘语义；忙碌和禁用状态也暴露给辅助技术。
            type: 'button',
            className: 'dsh-text-polish__button',
            disabled,
            'aria-label': t('label'),
            'aria-busy': running ? 'true' : undefined,
            title: text === '' ? t('hintEmpty') : t('hint'),
            // 阻止鼠标按下时输入框失焦，便于替换当前编辑内容。
            onMouseDown: (event) => { event.preventDefault() },
            onClick,
          }, SparkleMark(), h('span', null, running ? t('running') : t('label'))),
          // 仅在有提示时渲染状态文本，并提供屏幕阅读器实时播报。
          notice === null ? null : h('span', {
            className: 'dsh-text-polish__notice',
            'data-kind': notice.kind,
            title: notice.text,
            role: 'status',
            'aria-live': 'polite',
          }, notice.text)))
    }

    // 声明该浏览器插件使用的 DSH 服务和模块依赖。
    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        // 注册中英文文案，并将清理函数纳入插件生命周期管理。
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
        ctx.effect(() => ctx.locale.register(NS, 'en', en))
        // 向输入框左侧工具栏插入插件槽位，供 DSH 挂载 PolishButton。
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'text-polish',
          order: 20,
          locale: NS,
          // 为按钮注入 polish 调用：将文本组装为 /polish 命令并通过 Remote 执行。
          inject: () => ({
            polish: (sessionId, text, signal) =>
              ctx.remote.commands.execute(sessionId, `/polish\n${text}`, [], signal),
          }),
        }, PolishButton))
      },
    }
  },
})
