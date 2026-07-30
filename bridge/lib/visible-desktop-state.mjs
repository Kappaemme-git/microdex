export function mergeVisibleDesktopState(state, desktop) {
  if (
    !state?.selected ||
    !desktop?.available ||
    !desktop?.trusted ||
    !desktop?.running ||
    !desktop?.working ||
    state.selected.status === 'thinking'
  ) {
    return state;
  }

  const selected = {
    ...state.selected,
    status: 'thinking',
  };

  return {
    ...state,
    selected,
    threads: (state.threads ?? []).map((thread) =>
      thread.id === selected.id ? { ...thread, status: 'thinking' } : thread
    ),
  };
}
