import { actions } from "./actions.js";
import { state } from "./state.js";
import { isTypingTarget } from "./util.js";

export function initShortcuts() {
  document.addEventListener("keydown", (event) => {
    const dialogOpen = [...document.querySelectorAll("dialog")].some((dialog) => dialog.open);
    if (event.key === "Escape") {
      if (dialogOpen) return;
      if (state.sidebarOpen) {
        actions.closeSidebar();
        event.preventDefault();
        return;
      }
      if (state.mobileReading && state.open) {
        actions.closeReading();
        event.preventDefault();
      }
      return;
    }
    if (event.key === "?" && !isTypingTarget(event.target)) {
      actions.openHelp();
      event.preventDefault();
      return;
    }
    if (dialogOpen || state.view !== "mail") return;
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "j" || event.key === "ArrowDown") {
      actions.moveSelection(1);
      event.preventDefault();
    } else if (event.key === "k" || event.key === "ArrowUp") {
      actions.moveSelection(-1);
      event.preventDefault();
    } else if (event.key === "Enter") {
      if (event.target.closest("button, a")) return;
      actions.openSelected();
      event.preventDefault();
    } else if (event.key === "e") {
      actions.archiveSelected();
      event.preventDefault();
    } else if (event.key === "r") {
      actions.replySelected();
      event.preventDefault();
    } else if (event.key === "c") {
      actions.compose();
      event.preventDefault();
    } else if (event.key === "/") {
      const search = document.getElementById("search");
      search.focus();
      search.select();
      event.preventDefault();
    }
  });
}
