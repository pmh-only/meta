<script>
  import { onMount, onDestroy } from 'svelte';

  /**
   * @type {{
   *   value: string,
   *   schema: Record<string, { name: string; type: string }[]>,
   *   onRun: () => void
   * }}
   */
  let { value = $bindable(''), schema = {}, onRun } = $props();

  /** @type {HTMLDivElement | null} */
  let container = $state(null);
  let editorView = null;

  // Becomes true once the async setup in onMount completes
  let _ready = $state(false);
  // Holds references needed by reactive effects after mount
  let _api = /** @type {{ sql: Function; PostgreSQL: unknown; sqlConf: unknown } | null} */ (null);

  /** @param {Record<string, { name: string; type: string }[]>} s */
  function buildCmSchema(s) {
    return Object.fromEntries(
      Object.entries(s).map(([table, cols]) => [
        table,
        cols.map(c => ({ label: c.name, type: 'property', detail: c.type }))
      ])
    );
  }

  onMount(async () => {
    const [
      { Compartment, EditorState },
      { EditorView, keymap },
      { basicSetup },
      { HighlightStyle, syntaxHighlighting },
      { tags },
      { sql, PostgreSQL },
    ] = await Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('codemirror'),
      import('@codemirror/language'),
      import('@lezer/highlight'),
      import('@codemirror/lang-sql'),
    ]);

    // ── Highlight style ───────────────────────────────────────
    const highlight = HighlightStyle.define([
      { tag: tags.keyword,                      color: '#7c8ff5', fontWeight: '600' },
      { tag: tags.string,                       color: '#57f287' },
      { tag: tags.number,                       color: '#fee75c' },
      { tag: tags.bool,                         color: '#fee75c' },
      { tag: tags.null,                         color: '#3f3f52' },
      { tag: tags.comment,                      color: '#3f3f52', fontStyle: 'italic' },
      { tag: tags.operator,                     color: '#a1a1aa' },
      { tag: tags.punctuation,                  color: '#52525b' },
      { tag: [tags.name, tags.variableName],    color: '#d4d4d8' },
      { tag: tags.function(tags.variableName),  color: '#00b0f4' },
      { tag: tags.typeName,                     color: '#eb459e' },
      { tag: tags.special(tags.string),         color: '#57f287' },
    ]);

    // ── Theme ─────────────────────────────────────────────────
    const theme = EditorView.theme({
      '&': {
        backgroundColor: '#0e0e12',
        color: '#d4d4d8',
        fontFamily: "'Menlo', 'Consolas', 'Fira Code', monospace",
        fontSize: '13px',
        lineHeight: '1.6',
        height: '100%',
      },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
      '.cm-content': { caretColor: '#5865f2', padding: '8px 0' },
      '.cm-line': { padding: '0 12px 0 0' },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#5865f2',
        borderLeftWidth: '2px',
      },
      '.cm-activeLine': { backgroundColor: 'rgba(88,101,242,0.06)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(88,101,242,0.06)' },
      '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
        backgroundColor: 'rgba(88,101,242,0.28) !important',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'rgba(88,101,242,0.2)',
        outline: '1px solid rgba(88,101,242,0.5)',
      },
      '.cm-gutters': {
        backgroundColor: '#0a0a0e',
        color: '#3a3a50',
        border: 'none',
        borderRight: '1px solid #1a1a24',
        userSelect: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 10px 0 6px',
        minWidth: '32px',
        fontSize: '11px',
      },
      '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
      // ── Autocomplete tooltip ─────────────────────────────────
      '.cm-tooltip': {
        backgroundColor: '#1a1a24',
        border: '1px solid #2a2a35',
        borderRadius: '7px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul': {
        fontFamily: "'Menlo', 'Consolas', monospace",
        fontSize: '12px',
        maxHeight: '260px',
      },
      '.cm-tooltip-autocomplete > ul > li': {
        padding: '5px 12px',
        color: '#a1a1aa',
        lineHeight: '1.5',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: '#5865f2',
        color: '#fff',
      },
      '.cm-completionLabel': { color: '#d4d4d8' },
      '.cm-completionDetail': {
        color: '#52525b',
        fontStyle: 'italic',
        fontSize: '11px',
        marginLeft: '10px',
      },
      '.cm-completionIcon': { display: 'none' },
      // ── Search ───────────────────────────────────────────────
      '.cm-searchMatch': { backgroundColor: 'rgba(254,231,92,0.25)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(254,231,92,0.45)' },
      '.cm-panels': { backgroundColor: '#13131a', borderTop: '1px solid #2a2a35' },
      '.cm-panels input, .cm-panels button': {
        backgroundColor: '#1e1e2a',
        border: '1px solid #2a2a35',
        color: '#d4d4d8',
        borderRadius: '4px',
        fontFamily: 'inherit',
      },
    }, { dark: true });

    // ── SQL compartment (allows live schema updates) ───────────
    const sqlConf = new Compartment();

    _api = { sql, PostgreSQL, sqlConf };

    editorView = new EditorView({
      doc: value,
      extensions: [
        basicSetup,
        theme,
        syntaxHighlighting(highlight),
        sqlConf.of(sql({
          dialect: PostgreSQL,
          schema: buildCmSchema(schema),
          upperCaseKeywords: false,
        })),
        // Ctrl+Enter / Cmd+Enter → run query
        keymap.of([{
          key: 'Mod-Enter',
          run: () => { onRun?.(); return true; },
        }]),
        // Push doc changes back to the binding
        EditorView.updateListener.of(update => {
          if (update.docChanged) value = update.state.doc.toString();
        }),
      ],
      parent: container,
    });

    _ready = true;
  });

  onDestroy(() => editorView?.destroy());

  // ── Sync parent → editor (preset / example applied) ─────────
  $effect(() => {
    const v = value; // track BEFORE any early return so this effect
                     // re-runs whenever value changes, even if editorView
                     // wasn't ready on the first run
    if (!editorView) return;
    if (v === editorView.state.doc.toString()) return;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: v },
    });
  });

  // ── Live schema update via Compartment ────────────────────────
  // Runs when schema loads (after onMount sets _ready = true) and
  // whenever schema changes subsequently.
  $effect(() => {
    const s = schema; // track
    if (!_ready || !editorView || !_api || Object.keys(s).length === 0) return;
    const { sql, PostgreSQL, sqlConf } = _api;
    editorView.dispatch({
      // @ts-ignore
      effects: sqlConf.reconfigure(sql({
        dialect: PostgreSQL,
        schema: buildCmSchema(s),
        upperCaseKeywords: false,
      })),
    });
  });
</script>

<div class="editor-root" bind:this={container}></div>

<style>
  .editor-root { height: 100%; }

  /* Give the CM editor full height and remove default focus outline */
  :global(.editor-root .cm-editor) {
    height: 100%;
    outline: none !important;
  }
</style>
