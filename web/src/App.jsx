import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_BRIDGE = 'http://127.0.0.1:3210';
const CUSTOM_KEYS_STORAGE = 'microdex.web.custom-keys.v1';

const KEYCAPS = [
  { id: 'fast', label: 'FAST', symbol: 'ϟ', description: 'Toggle Fast Mode' },
  { id: 'approve', label: 'APPR', symbol: '✓', description: 'Approve request' },
  { id: 'reject', label: 'REJ', symbol: '×', description: 'Reject request' },
  { id: 'fork', label: 'FORK', symbol: '⑂', description: 'Fork selected task' },
  { id: 'codex', label: 'CODEX', symbol: '◌', description: 'Focus remote composer' },
  { id: 'bug', label: 'BUG', symbol: '♛', description: 'Find and prove a bug', prompt: 'Find the most likely bug in this project, reproduce it with a focused test, and report the evidence before changing code.' },
  { id: 'oai', label: 'OAI', symbol: '◎', description: 'Use official OpenAI docs', prompt: 'Use the official OpenAI documentation to verify the relevant Codex behavior for this project and recommend the correct implementation.' },
  { id: 'term', label: 'TERM', symbol: '>_', description: 'Inspect the terminal', prompt: 'Inspect the current terminal and project state, then tell me the next concrete action.' },
  { id: 'download', label: 'DWN', symbol: '⇩', description: 'Download controller snapshot' },
  { id: 'delete', label: 'DEL', symbol: '⌫', description: 'Archive selected task', confirm: true },
  { id: 'new', label: 'NEW', symbol: '◩', description: 'Create a new Codex task' },
  { id: 'nav', label: 'NAV', symbol: '➤', description: 'Open selected task in Codex' },
  { id: 'magic', label: 'MAGIC', symbol: '☆', description: 'Polish the implementation', prompt: 'Polish the current implementation: fix the most visible UX problems, preserve behavior, and verify the result.' },
  { id: 'diff', label: 'DIFF', symbol: '▣', description: 'Review current changes', prompt: 'Review the current code changes as a strict code reviewer. Identify only concrete, actionable regressions.' },
  { id: 'play', label: 'PLAY', symbol: '▷', description: 'Run relevant tests', prompt: 'Run the most relevant tests for the current changes, fix any failures caused by them, and summarize the result.' },
  { id: 'git', label: 'GIT', symbol: '◆', description: 'Inspect Git status', prompt: 'Inspect Git status and the current diff. Summarize what changed and flag anything accidental.' },
  { id: 'branch', label: 'BRCH', symbol: '⑂', description: 'Prepare a branch', prompt: 'Prepare a clean Git branch plan for the current work. Do not publish anything without asking.' },
  { id: 'merge', label: 'MRG', symbol: '⑃', description: 'Check merge readiness', prompt: 'Check whether the current work is ready to merge. Run relevant verification and report blockers; do not merge automatically.' },
  { id: 'pr', label: 'PR', symbol: '⑂+', description: 'Prepare a pull request', prompt: 'Prepare this work for a pull request: verify it, draft the title and summary, but do not publish without confirmation.' },
  { id: 'paint', label: 'PAINT', symbol: '♢', description: 'Polish visual design', prompt: 'Audit and improve the visual design of the current interface while preserving its product identity and functionality.' },
  { id: 'lab', label: 'LAB', symbol: '⚗', description: 'Explore an experiment', prompt: 'Propose and implement one small, reversible experiment that materially improves this project, then verify it.' },
  { id: 'party', label: 'PARTY', symbol: '※', description: 'Celebrate locally' },
  { id: 'time', label: 'TIME', symbol: '◷', description: 'Show local time' },
  { id: 'mind-plus', label: 'MIND+', symbol: '◉', description: 'Increase reasoning' },
  { id: 'mind-minus', label: 'MIND−', symbol: '◍', description: 'Decrease reasoning' },
  { id: 'setup', label: 'SETUP', symbol: '⚙', description: 'Open connection setup' },
  { id: 'folder', label: 'FOLD', symbol: '□+', description: 'Focus project task', prompt: 'Inspect the current project folder and give me a concise orientation: stack, entry points, commands, and current risks.' },
  { id: 'upload', label: 'UPL', symbol: '⇧', description: 'Focus composer for attachment instructions' },
  { id: 'apps', label: 'APPS', symbol: '⌘', description: 'List useful integrations', prompt: 'List the installed Codex plugins, apps, and skills that are most useful for this project. Do not install anything.' },
  { id: 'yolo', label: 'YOLO', symbol: ':yolo:', description: 'Run autonomously with safeguards', prompt: 'Continue autonomously toward the current goal. Keep changes scoped, reversible, and verified; stop before external publishing or destructive actions.' },
  { id: 'yeet', label: 'YEET', symbol: ':yeet:', description: 'Prepare publication', prompt: 'Prepare the current changes for publication: verify, summarize, and show the exact commit/PR scope. Do not push or publish without confirmation.' },
];

function readCustomKeys() {
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_KEYS_STORAGE) || '[]');
    return Array.from({ length: 7 }, (_, index) => stored[index] || null);
  } catch {
    return Array(7).fill(null);
  }
}

const Icons = {
  bolt: 'M13 2 4.5 14H11l-1 8L19.5 10H13l0-8Z',
  check: 'M5 12.5 10 17l9-10',
  close: 'm6 6 12 12M18 6 6 18',
  fork: 'M7 4v4a4 4 0 0 0 4 4h6M14 9l3 3-3 3M7 20v-4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3',
  send: 'm3 3 18 9-18 9 4-9-4-9Zm4 9h14',
  refresh: 'M20 6v5h-5M4 18v-5h5M18.5 10a7 7 0 0 0-12-3L4 11m16 2-2.5 4a7 7 0 0 1-12 0',
};

function Icon({ name, size = 27 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={Icons[name]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function shortTask(task) {
  if (!task) return 'No task description';
  const normalized = task.replace(/^https?:\/\/\S+\s*/i, '').trim() || task;
  return normalized.length > 220 ? `${normalized.slice(0, 217)}…` : normalized;
}

async function request(bridge, token, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${bridge.replace(/\/$/, '')}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Microdex-Token': token.trim(),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Bridge error ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Bridge timeout. Check that it is running.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function Key({ label, icon, active, disabled, agent, status, onClick, children, wide }) {
  return (
    <button
      className={`key ${agent ? 'agent-key' : 'command-key'} ${active ? 'is-active' : ''} ${wide ? 'wide-key' : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="key-cap">
        {status ? <span className={`status-orb status-${status}`} /> : null}
        {icon ? <Icon name={icon} size={wide ? 31 : 27} /> : children}
      </span>
    </button>
  );
}

function App() {
  const [bridge, setBridge] = useState(() => localStorage.getItem('microdex.web.bridge') || DEFAULT_BRIDGE);
  const [token, setToken] = useState(() => localStorage.getItem('microdex.web.token') || '');
  const [remote, setRemote] = useState(null);
  const [connected, setConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ message: 'Connect the bridge to load your Codex tasks.', error: false });
  const [draft, setDraft] = useState('');
  const [listOpen, setListOpen] = useState(true);
  const [customKeys, setCustomKeys] = useState(readCustomKeys);
  const [editorSlot, setEditorSlot] = useState(null);
  const [editorSelection, setEditorSelection] = useState(null);
  const [keycapSearch, setKeycapSearch] = useState('');
  const [party, setParty] = useState(false);
  const composerRef = useRef(null);

  const selected = remote?.selected || null;
  const threads = remote?.threads || [];
  const selectedIndex = Math.max(0, threads.findIndex((thread) => thread.id === remote?.selectedThreadId));
  const effortIndex = Math.max(0, EFFORTS.indexOf(selected?.reasoningEffort || 'medium'));

  const announce = useCallback((message, error = false) => setNotice({ message, error }), []);

  const refresh = useCallback(async (quiet = false) => {
    if (!token.trim()) return;
    try {
      const state = await request(bridge, token, '/api/remote/state');
      setRemote(state);
      setConnected(true);
      if (!quiet) announce(`Live: ${state.threads.length} Codex tasks loaded.`);
    } catch (error) {
      setConnected(false);
      if (!quiet) announce(error.message, true);
    }
  }, [announce, bridge, token]);

  useEffect(() => {
    if (!connected) return undefined;
    const timer = setInterval(() => void refresh(true), 900);
    return () => clearInterval(timer);
  }, [connected, refresh]);

  const connect = async (event) => {
    event?.preventDefault();
    setBusy('connect');
    try {
      const state = await request(bridge, token, '/api/remote/state');
      setRemote(state);
      setConnected(true);
      announce(`Live: ${state.threads.length} Codex tasks loaded.`);
      localStorage.setItem('microdex.web.bridge', bridge.trim());
      localStorage.setItem('microdex.web.token', token.trim());
      setSettingsOpen(false);
    } catch (error) {
      setConnected(false);
      announce(error.message, true);
    } finally {
      setBusy('');
    }
  };

  const action = useCallback(async (name, path, body, success) => {
    if (!connected) return setSettingsOpen(true);
    setBusy(name);
    try {
      const state = await request(bridge, token, path, { method: 'POST', body });
      setRemote(state);
      announce(success);
      return state;
    } catch (error) {
      announce(error.message, true);
      return null;
    } finally {
      setBusy('');
    }
  }, [announce, bridge, connected, token]);

  const selectThread = (thread) => action('select', '/api/remote/select', { threadId: thread.id }, `Opened “${thread.name}” in Codex.`);

  const moveSelection = (step) => {
    if (!threads.length) return;
    const next = threads[(selectedIndex + step + threads.length) % threads.length];
    void selectThread(next);
  };

  const setEffort = (index) => {
    if (!selected) return announce('Select a task first.', true);
    const bounded = Math.max(0, Math.min(EFFORTS.length - 1, index));
    void action('reasoning', '/api/remote/settings', {
      threadId: selected.id,
      reasoningEffort: EFFORTS[bounded],
    }, `Reasoning set to ${EFFORTS[bounded]}.`);
  };

  const toggleFast = () => {
    if (!selected) return announce('Select a task first.', true);
    const next = !selected.fastMode;
    void action('fast', '/api/remote/settings', { threadId: selected.id, fastMode: next }, `Fast Mode ${next ? 'enabled' : 'disabled'} for this task.`);
  };

  const startDictation = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    composerRef.current?.focus();
    if (!SpeechRecognition) return announce('Browser dictation is unavailable. The composer is ready for typing.', true);
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join('');
      setDraft(transcript);
    };
    recognition.onerror = () => announce('Microphone permission was denied or unavailable.', true);
    recognition.onend = () => announce('Dictation ready. Press the Codex key to send.');
    recognition.start();
    announce('Listening…');
  };

  const send = () => {
    if (!draft.trim()) {
      composerRef.current?.focus();
      return announce('Write or dictate a message first.', true);
    }
    void action('send', '/api/remote/send', { threadId: selected?.id, text: draft }, 'Message sent directly to Codex.').then((state) => {
      if (state) setDraft('');
    });
  };

  const taskKeys = useMemo(() => Array.from({ length: 6 }, (_, index) => threads[index] || null), [threads]);

  const filteredKeycaps = useMemo(() => {
    const query = keycapSearch.trim().toLowerCase();
    if (!query) return KEYCAPS;
    return KEYCAPS.filter((keycap) => `${keycap.label} ${keycap.description}`.toLowerCase().includes(query));
  }, [keycapSearch]);

  const openKeyEditor = (slot) => {
    setEditorSlot(slot);
    setEditorSelection(customKeys[slot]);
    setKeycapSearch('');
  };

  const saveKeyEditor = () => {
    const next = customKeys.map((value, index) => index === editorSlot ? editorSelection : value);
    setCustomKeys(next);
    localStorage.setItem(CUSTOM_KEYS_STORAGE, JSON.stringify(next));
    const assigned = KEYCAPS.find((keycap) => keycap.id === editorSelection);
    announce(assigned ? `${assigned.label} assigned to custom key ${editorSlot + 1}.` : `Custom key ${editorSlot + 1} left empty.`);
    setEditorSlot(null);
  };

  const downloadSnapshot = () => {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), selected, threads, customKeys }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'microdex-snapshot.json';
    anchor.click();
    URL.revokeObjectURL(url);
    announce('Controller snapshot downloaded.');
  };

  const executeCustomKey = async (keycapId) => {
    const keycap = KEYCAPS.find((entry) => entry.id === keycapId);
    if (!keycap) return;
    if (!connected && !['setup', 'time', 'party', 'download', 'codex', 'upload'].includes(keycap.id)) {
      setSettingsOpen(true);
      return announce('Connect the bridge before running this key.', true);
    }
    if (keycap.confirm && !window.confirm(`${keycap.description}?`)) return;

    switch (keycap.id) {
      case 'fast': return toggleFast();
      case 'approve': return action('approve', '/api/remote/approval', { decision: 'approve' }, 'Request approved.');
      case 'reject': return action('decline', '/api/remote/approval', { decision: 'decline' }, 'Request declined.');
      case 'fork': return action('fork', '/api/remote/fork', { threadId: selected?.id }, 'Forked into a new Codex task.');
      case 'delete': return action('archive', '/api/remote/archive', { threadId: selected?.id }, 'Selected task archived.');
      case 'new': return action('new', '/api/remote/new', {}, 'New Codex task created.');
      case 'nav': return selected ? selectThread(selected) : announce('Select a task first.', true);
      case 'codex':
      case 'upload': composerRef.current?.focus(); return announce('Remote composer ready.');
      case 'download': return downloadSnapshot();
      case 'setup': setSettingsOpen(true); return;
      case 'time': return announce(new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' }).format(new Date()));
      case 'mind-plus': return setEffort(effortIndex + 1);
      case 'mind-minus': return setEffort(effortIndex - 1);
      case 'party':
        setParty(true);
        setTimeout(() => setParty(false), 1500);
        return announce('Build complete. Ship energy activated.');
      default:
        if (keycap.prompt) {
          if (!selected) return announce('Select a task first.', true);
          return action(keycap.id, '/api/remote/send', { threadId: selected.id, text: keycap.prompt }, `${keycap.label} script sent to Codex.`);
        }
        return announce(`${keycap.label} is ready.`, false);
    }
  };

  return (
    <div className="app-shell">
      <div className="grain" />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-index">M/01</span>
          <div>
            <p>INDEPENDENT CODEX SURFACE</p>
            <h1>MICRODEX<span>WEB</span></h1>
          </div>
        </div>
        <button className={`connection ${connected ? 'online' : ''}`} type="button" onClick={() => setSettingsOpen(true)}>
          <span />{connected ? 'APP SERVER LIVE' : 'CONNECT BRIDGE'}
        </button>
      </header>

      <main id="controller" className="workspace">
        <section className="device-wrap" aria-label="Microdex controller">
          <div className="device-aura" />
          <div className="device">
            <i className="screw screw-tl" /><i className="screw screw-tr" />
            <i className="screw screw-bl" /><i className="screw screw-br" />
            <span className="edge-label edge-left">MICRODEX · OPEN CLIENT · 2026</span>
            <span className="edge-label edge-right">YOU CAN JUST BUILD THINGS</span>

            <div className="control-grid">
              <div className="dial" aria-label={`Reasoning ${selected?.reasoningEffort || 'medium'}`}>
                <button type="button" aria-label="Decrease reasoning" onClick={() => setEffort(effortIndex - 1)}>−</button>
                <div className="dial-face"><span /><b>{effortIndex + 1}</b></div>
                <button type="button" aria-label="Increase reasoning" onClick={() => setEffort(effortIndex + 1)}>+</button>
                <small>{(selected?.reasoningEffort || 'medium').toUpperCase()}</small>
              </div>
              <Key label={taskKeys[0] ? `Open ${taskKeys[0].name}` : 'Empty task'} agent status={taskKeys[0]?.status} active={taskKeys[0]?.id === selected?.id} disabled={!taskKeys[0]} onClick={() => taskKeys[0] && selectThread(taskKeys[0])} />
              <Key label={taskKeys[1] ? `Open ${taskKeys[1].name}` : 'Empty task'} agent status={taskKeys[1]?.status} active={taskKeys[1]?.id === selected?.id} disabled={!taskKeys[1]} onClick={() => taskKeys[1] && selectThread(taskKeys[1])} />
              <div className="joystick" aria-label="Task navigation">
                <button className="joy-up" type="button" aria-label="Refresh tasks" onClick={() => void refresh()} />
                <button className="joy-right" type="button" aria-label="Next task" onClick={() => moveSelection(1)} />
                <button className="joy-down" type="button" aria-label="Toggle task list" onClick={() => setListOpen((value) => !value)} />
                <button className="joy-left" type="button" aria-label="Previous task" onClick={() => moveSelection(-1)} />
                <span />
              </div>

              {taskKeys.slice(2).map((thread, index) => (
                <Key key={thread?.id || `empty-${index}`} label={thread ? `Open ${thread.name}` : 'Empty task'} agent status={thread?.status} active={thread?.id === selected?.id} disabled={!thread} onClick={() => thread && selectThread(thread)} />
              ))}

              <Key label="Toggle Fast Mode" icon="bolt" active={Boolean(selected?.fastMode)} disabled={!selected || busy === 'fast'} onClick={toggleFast} />
              <Key label="Approve current request" icon="check" active={Boolean(remote?.pendingApproval)} disabled={!remote?.pendingApproval || busy === 'approve'} onClick={() => action('approve', '/api/remote/approval', { decision: 'approve' }, 'Request approved.')} />
              <Key label="Decline current request" icon="close" disabled={!remote?.pendingApproval || busy === 'decline'} onClick={() => action('decline', '/api/remote/approval', { decision: 'decline' }, 'Request declined.')} />
              <Key label="Continue in a new task" icon="fork" disabled={!selected || busy === 'fork'} onClick={() => action('fork', '/api/remote/fork', { threadId: selected.id }, 'Forked into a new Codex task.')} />

              <button className="sensor" type="button" aria-label="Open connection settings" onClick={() => setSettingsOpen(true)}>
                <span className="led led-white" /><span className={`led ${connected ? 'led-green' : 'led-amber'}`} /><span className={`led ${notice.error ? 'led-red' : 'led-dim'}`} />
                <i />
              </button>
              <Key label="Start browser dictation" icon="mic" wide onClick={startDictation} />
              <Key label="Send message to Codex" icon="send" disabled={!selected || busy === 'send'} onClick={send} />
            </div>
            <p className="build-mark">LET’S BUILD.</p>
          </div>
        </section>

        <aside className={`command-panel ${listOpen ? '' : 'is-collapsed'}`}>
          <div className="panel-head">
            <div><span>LIVE CONTROL / {String(selectedIndex + 1).padStart(2, '0')}</span><h2>{selected?.name || 'NO TASK SELECTED'}</h2></div>
            <button type="button" aria-label="Refresh state" onClick={() => void refresh()}><Icon name="refresh" size={20} /></button>
          </div>
          <p className="task-preview">{shortTask(selected?.task)}</p>
          <div className="metrics">
            <span><i className={`metric-dot ${selected?.status || 'idle'}`} />{selected?.status || 'offline'}</span>
            <span>{selected?.fastMode ? 'FAST' : 'STANDARD'}</span>
            <span>{selected?.reasoningEffort || '—'}</span>
          </div>
          <label className="composer-label" htmlFor="composer">REMOTE COMPOSER</label>
          <textarea ref={composerRef} id="composer" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a command or use the microphone key…" />
          <button className="send-bar" type="button" disabled={!selected || busy === 'send'} onClick={send}>SEND TO CODEX <span>↗</span></button>
          <div className={`notice ${notice.error ? 'error' : ''}`} role="status" aria-live="polite"><span>{notice.error ? '!' : '›'}</span>{notice.message}</div>
        </aside>
      </main>

      <section className="programmable-bank" aria-labelledby="programmable-title">
        <div className="bank-heading">
          <div>
            <span>ACT01—ACT07 / USER LAYER</span>
            <h2 id="programmable-title">PROGRAMMABLE KEYS</h2>
          </div>
          <p>Click an empty key to assign it. Assigned keys run immediately; use EDIT to change or clear them.</p>
        </div>
        <div className="custom-key-grid">
          {customKeys.map((keycapId, index) => {
            const keycap = KEYCAPS.find((entry) => entry.id === keycapId);
            return (
              <div className={`custom-slot ${keycap ? 'assigned' : 'empty'}`} key={`custom-${index}`}>
                <button
                  className="custom-key"
                  type="button"
                  aria-label={keycap ? `Run ${keycap.description}` : `Assign custom key ${index + 1}`}
                  onClick={() => keycap ? void executeCustomKey(keycap.id) : openKeyEditor(index)}>
                  <span className="custom-cap">
                    <b>{keycap?.symbol || '○'}</b>
                    <small>{keycap?.label || `EMPTY${index + 1}`}</small>
                  </span>
                </button>
                <button className="edit-key" type="button" onClick={() => openKeyEditor(index)}>
                  {keycap ? 'EDIT' : 'ADD'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <footer><span>CODEX APP SERVER</span><span>900MS LIVE SYNC</span><span>LOCAL AUTH BRIDGE</span></footer>

      {party ? (
        <div className="party-burst" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ '--i': index }} />)}
        </div>
      ) : null}

      {editorSlot !== null ? (
        <div className="modal-backdrop keycap-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditorSlot(null)}>
          <section className="keycap-editor" role="dialog" aria-modal="true" aria-labelledby="keycap-editor-title">
            <header>
              <div>
                <h2 id="keycap-editor-title">Edit keycap</h2>
                <p>Choose what appears on ACT{String(editorSlot + 1).padStart(2, '0')}</p>
              </div>
              <button type="button" aria-label="Close keycap editor" onClick={() => setEditorSlot(null)}>×</button>
            </header>
            <label className="keycap-search">
              <span aria-hidden="true">⌕</span>
              <input autoFocus value={keycapSearch} onChange={(event) => setKeycapSearch(event.target.value)} placeholder="Search keycaps" />
            </label>
            <div className="keycap-options" role="listbox" aria-label="Available keycaps">
              {filteredKeycaps.map((keycap) => (
                <button
                  key={keycap.id}
                  type="button"
                  role="option"
                  aria-selected={editorSelection === keycap.id}
                  className={editorSelection === keycap.id ? 'selected' : ''}
                  onClick={() => setEditorSelection(keycap.id)}>
                  <b>{keycap.symbol}</b>
                  <span>{keycap.label}</span>
                  <small>{keycap.description}</small>
                </button>
              ))}
            </div>
            <div className="assigned-shortcut">
              <div>
                <strong>Assigned shortcut</strong>
                <span>{KEYCAPS.find((keycap) => keycap.id === editorSelection)?.description || 'No action — key remains empty'}</span>
              </div>
              <button type="button" onClick={() => setEditorSelection(null)}>LEAVE EMPTY</button>
            </div>
            <div className="editor-actions">
              <button type="button" onClick={() => setEditorSlot(null)}>Cancel</button>
              <button type="button" onClick={saveKeyEditor}>Save</button>
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <form className="connection-modal" onSubmit={connect} aria-label="Bridge connection">
            <div className="modal-index">CONNECTION / 01</div>
            <h2>LINK THE<br />CODEX HOST.</h2>
            <p>The bridge stays local. Enter the address and access code printed when it starts.</p>
            <label htmlFor="bridge">BRIDGE ADDRESS</label>
            <input id="bridge" value={bridge} onChange={(event) => setBridge(event.target.value)} spellCheck="false" />
            <label htmlFor="token">ACCESS CODE</label>
            <input id="token" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck="false" />
            <button type="submit" disabled={busy === 'connect'}>{busy === 'connect' ? 'CONNECTING…' : 'CONNECT + LOAD TASKS'}</button>
            {connected ? <button className="text-button" type="button" onClick={() => setSettingsOpen(false)}>CANCEL</button> : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default App;
