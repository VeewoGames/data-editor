export const sidebarCollapsedStorageKey = "data-editor:sidebar-collapsed";

export function readSidebarCollapsed(localStorage) {
  return localStorage?.getItem(sidebarCollapsedStorageKey) === "1";
}

export function writeSidebarCollapsed(localStorage, collapsed) {
  if (!localStorage) return;
  localStorage.setItem(sidebarCollapsedStorageKey, collapsed ? "1" : "0");
}
