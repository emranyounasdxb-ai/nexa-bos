/** Keep the selected tab in its own horizontal scroller without moving the page,
 * changing selection/focus, or overriding a user's subsequent manual scrolling.
 */
export function observeSelectedTabVisibility(workspace: HTMLElement) {
  const lists = new Set<HTMLElement>();
  const reveal = (list: HTMLElement) => {
    if (!list.clientWidth || !["auto", "scroll"].includes(getComputedStyle(list).overflowX)) return;
    const selected = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!selected || selected.closest('[role="tablist"]') !== list) return;
    const strip = list.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < strip.left) list.scrollLeft += tab.left - strip.left;
    else if (tab.right > strip.right) list.scrollLeft += tab.right - strip.right;
  };
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) reveal(entry.target as HTMLElement);
  });
  const register = () => {
    for (const list of lists) {
      if (!workspace.contains(list)) { resize.unobserve(list); lists.delete(list); }
    }
    for (const list of workspace.querySelectorAll<HTMLElement>('[role="tablist"]')) {
      if (lists.has(list)) continue;
      lists.add(list);
      resize.observe(list);
      reveal(list);
    }
  };
  const mutations = new MutationObserver(records => {
    if (records.some(record => record.type === "childList")) register();
    for (const record of records) {
      if (!(record.target instanceof HTMLElement)) continue;
      const list = record.target.closest<HTMLElement>('[role="tablist"]');
      if (list && lists.has(list)) reveal(list);
    }
  });
  register();
  mutations.observe(workspace, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
  return () => { mutations.disconnect(); resize.disconnect(); lists.clear(); };
}
