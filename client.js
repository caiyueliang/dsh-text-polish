/**
 * Browser half of the text-polish bundle.
 *
 * One pill button in the composer tool row. Clicking it sends the current
 * draft to the `/polish` command over the shipped `commands/execute` Remote
 * and replaces the draft with the returned rewrite.
 */
window.__ModuleLoader__.load({
  id: 'dsh-text-polish',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace for this plugin's copy. */
    const NS = 'text-polish'

    /** Inline sheet; rendered with the component so unmounting removes it. */
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

    /** Render one thrown value without trusting its string coercion. */
    function messageOf(error) {
      if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
      try {
        return String(error)
      } catch {
        return 'unrenderable error'
      }
    }

    /** Original two-sparkle mark drawn at the button's text size. */
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
     * The composer tool-row control.
     * @param props - slot seats: session identity, input state, actions, locale, and polish.
     * @returns the pill button plus its inline notice.
     */
    function PolishButton(props) {
      const t = props.t
      const sessionId = props.sessionId
      const polish = props.polish
      const setDraft = props.inputActions.setDraft
      const draft = props.useInput(state => state.draft)
      const phase = props.useInput(state => state.phase)
      const [running, setRunning] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const latestDraft = React.useRef(draft)
      latestDraft.current = draft
      const inFlight = React.useRef(null)
      React.useEffect(() => () => {
        if (inFlight.current !== null) inFlight.current.abort()
        inFlight.current = null
      }, [])
      const text = typeof draft === 'string' ? draft.trim() : ''
      const disabled = running || phase !== 'plain'
      const onClick = () => {
        if (disabled) return
        if (text === '') {
          setNotice({ kind: 'error', text: t('empty') })
          return
        }
        const expected = latestDraft.current
        const controller = new AbortController()
        inFlight.current = controller
        setRunning(true)
        setNotice(null)
        Promise.resolve()
          .then(() => polish(sessionId, expected.trim(), controller.signal))
          .then((result) => {
            if (controller.signal.aborted) return
            if (result === undefined || result === null || result.ok !== true) {
              const failure = result === undefined || result === null ? undefined : result.error
              const reason = failure === undefined
                ? t('unknown')
                : (typeof failure.message === 'string' && failure.message !== '' ? failure.message : failure.code)
              setNotice({ kind: 'error', text: t('failed', { reason }) })
              return
            }
            const execution = result.value
            const outcome = execution === undefined ? undefined : execution.result
            if (outcome === undefined) {
              setNotice({ kind: 'error', text: t('unknown') })
              return
            }
            if (outcome.kind !== 'success') {
              setNotice({ kind: 'error', text: typeof outcome.text === 'string' && outcome.text !== '' ? outcome.text : t('unknown') })
              return
            }
            const polished = typeof outcome.text === 'string' ? outcome.text.trim() : ''
            if (polished === '') {
              setNotice({ kind: 'error', text: t('noText') })
              return
            }
            if (latestDraft.current !== expected) {
              setNotice({ kind: 'error', text: t('changed') })
              return
            }
            setDraft(polished)
            setNotice(null)
          })
          .catch((error) => {
            if (controller.signal.aborted) return
            setNotice({ kind: 'error', text: t('failed', { reason: messageOf(error) }) })
          })
          .then(() => {
            if (inFlight.current === controller) inFlight.current = null
            setRunning(false)
          })
      }
      return h(React.Fragment, null,
        h('style', { key: 'sheet' }, CSS),
        h('div', { className: 'dsh-text-polish', key: 'root' },
          h('button', {
            type: 'button',
            className: 'dsh-text-polish__button',
            disabled,
            'aria-label': t('label'),
            'aria-busy': running ? 'true' : undefined,
            title: text === '' ? t('hintEmpty') : t('hint'),
            onMouseDown: (event) => { event.preventDefault() },
            onClick,
          }, SparkleMark(), h('span', null, running ? t('running') : t('label'))),
          notice === null ? null : h('span', {
            className: 'dsh-text-polish__notice',
            'data-kind': notice.kind,
            title: notice.text,
            role: 'status',
            'aria-live': 'polite',
          }, notice.text)))
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
        ctx.effect(() => ctx.locale.register(NS, 'en', en))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'text-polish',
          order: 20,
          locale: NS,
          inject: () => ({
            polish: (sessionId, text, signal) =>
              ctx.remote.commands.execute(sessionId, `/polish\n${text}`, [], signal),
          }),
        }, PolishButton))
      },
    }
  },
})
