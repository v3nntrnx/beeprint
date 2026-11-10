import {
  MAX_INVENTORY_COUNT,
  compactNumber,
  createEmptyInventory,
  formatCraftingTime,
  formatNumber,
  goalProgress,
  makePlan,
  normalizeInventory as normalizeInventoryFor,
  parseAmount,
  percentComplete,
  remaining as remainingFor,
  totalCraftingMinutes as totalCraftingMinutesFor,
  validateInventory,
} from "./core.js";

const D = JSON.parse(document.getElementById("app-data").textContent);
document.getElementById("tagline").textContent = D.quotes[Math.floor(Math.random() * D.quotes.length)];
const RAWKEYS = D.rawItems || Object.keys(D.items).filter((k) => !D.recipes[k]);
const STORAGE_KEYS = {
  inventory: "bssPlannerInventory",
  goals: "goals",
  collapsedShops: "bssPlannerCollapsedShops",
  sidebarWidth: "bssPlannerSidebarWidth",
  graphView: "bssPlannerGraphView",
  step: "bssPlannerStep",
  consent: "bssPlannerStorageConsent",
};
const PROGRESS_STORAGE_KEYS = [
  STORAGE_KEYS.inventory,
  STORAGE_KEYS.goals,
  STORAGE_KEYS.collapsedShops,
  STORAGE_KEYS.sidebarWidth,
  STORAGE_KEYS.graphView,
  STORAGE_KEYS.step,
];
const INVENTORY_STORAGE_KEY = STORAGE_KEYS.inventory;
const COLLAPSED_SHOPS_STORAGE_KEY = STORAGE_KEYS.collapsedShops;
const SIDEBAR_WIDTH_STORAGE_KEY = STORAGE_KEYS.sidebarWidth;
const GRAPH_VIEW_STORAGE_KEY = STORAGE_KEYS.graphView;
const STORAGE_CONSENT_KEY = STORAGE_KEYS.consent;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function storageRemove(keys) {
  for (const key of keys) {
    try { localStorage.removeItem(key); } catch {}
  }
}
function removeStoredProgress() {
  storageRemove(PROGRESS_STORAGE_KEYS);
}
function readStoredJson(key, fallback) {
  const saved = storageGet(key);
  if (saved === null) return fallback;
  try { return JSON.parse(saved); } catch { storageRemove([key]); return fallback; }
}

let storageConsent = false;
let storageDeclined = false;
const savedChoice = storageGet(STORAGE_CONSENT_KEY);
storageConsent = savedChoice === "granted";
storageDeclined = savedChoice === "denied";
if (!storageConsent) removeStoredProgress();

let sel = [];
if (storageConsent) {
  const savedGoals = readStoredJson(STORAGE_KEYS.goals, []);
  if (Array.isArray(savedGoals)) sel = savedGoals.filter((g) => D.goals[g]);
}
if (!sel.length) sel = ["canister"];
const collapsedGoalShops = new Set();
if (storageConsent) {
  const savedShops = readStoredJson(COLLAPSED_SHOPS_STORAGE_KEY, []);
  if (Array.isArray(savedShops)) savedShops.filter((shop) => typeof shop === "string").forEach((shop) => collapsedGoalShops.add(shop));
}
let inv = {}, step = 10, busy = false;
const STEP_SIZES = [1, 10, 100, 1000];
if (storageConsent) {
  const savedStep = Number(storageGet(STORAGE_KEYS.step));
  if (STEP_SIZES.includes(savedStep)) step = savedStep;
}
let focusClearTimer = 0, selectedFocusPath = [];

const $ = (id) => document.getElementById(id);
const storageToggle = $("save-storage");
const app = document.querySelector(".app"), sidebar = document.querySelector(".side"), sidebarResizer = $("sidebar-resizer");
const SIDEBAR_MIN_WIDTH = 72, SIDEBAR_COMPACT_THRESHOLD = 132, SIDEBAR_MAX_WIDTH = 440;
function setSidebarWidth(value, persist = false) {
  const width = Number(value);
  if (!Number.isFinite(width)) return;
  const next = Math.round(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width)));
  app.style.setProperty("--sidebar-width", next + "px");
  const compact = next <= SIDEBAR_COMPACT_THRESHOLD && innerWidth > 900;
  const modeChanged = app.classList.contains("compact-sidebar") !== compact;
  app.classList.toggle("compact-sidebar", compact);
  if (modeChanged && $("goals").childElementCount) buildChips();
  sidebarResizer.setAttribute("aria-valuenow", String(next));
  if (persist && storageConsent && storageToggle.checked) {
    storageSet(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
  }
}
if (storageConsent) {
  const savedWidth = storageGet(SIDEBAR_WIDTH_STORAGE_KEY);
  if (savedWidth !== null) setSidebarWidth(savedWidth);
}
setSidebarWidth(parseFloat(getComputedStyle(app).getPropertyValue("--sidebar-width")) || 290);
sidebarResizer.addEventListener("pointerdown", (event) => {
  if (innerWidth <= 900) return;
  event.preventDefault(); sidebarResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("sidebar-resizing");
});
sidebarResizer.addEventListener("pointermove", (event) => {
  if (!sidebarResizer.hasPointerCapture(event.pointerId)) return;
  const gap = parseFloat(getComputedStyle(app).columnGap) || 0;
  setSidebarWidth(event.clientX - sidebar.getBoundingClientRect().left - gap - sidebarResizer.getBoundingClientRect().width / 2);
});
const finishSidebarResize = (event) => {
  if (sidebarResizer.hasPointerCapture(event.pointerId)) sidebarResizer.releasePointerCapture(event.pointerId);
  document.body.classList.remove("sidebar-resizing");
  const width = parseFloat(getComputedStyle(app).getPropertyValue("--sidebar-width"));
  setSidebarWidth(width, true);
};
sidebarResizer.addEventListener("pointerup", finishSidebarResize);
sidebarResizer.addEventListener("pointercancel", finishSidebarResize);
sidebarResizer.addEventListener("keydown", (event) => {
  const width = parseFloat(getComputedStyle(app).getPropertyValue("--sidebar-width")) || 290;
  if (event.key === "ArrowLeft") setSidebarWidth(width - 10, true);
  else if (event.key === "ArrowRight") setSidebarWidth(width + 10, true);
  else if (event.key === "Home") setSidebarWidth(SIDEBAR_MIN_WIDTH, true);
  else if (event.key === "End") setSidebarWidth(SIDEBAR_MAX_WIDTH, true);
  else return;
  event.preventDefault();
});
const graphScroller = document.querySelector(".graph-pan");
const graphViewport = $("graph-viewport");
const GRAPH_PAN_MARGIN = 220;
let graphZoom = 1;
let savedGraphView = null;
if (storageConsent) {
  const savedView = readStoredJson(GRAPH_VIEW_STORAGE_KEY, null);
  if (savedView && Number.isFinite(savedView.zoom) && savedView.zoom >= 0.25 && savedView.zoom <= 1.5
    && Number.isFinite(savedView.left)
    && Number.isFinite(savedView.top)) {
    savedGraphView = savedView;
    graphZoom = savedView.zoom;
  }
}
let graphViewSaveTimer = 0, restoreGraphViewOnRender = !!savedGraphView;
function saveGraphView() {
  if (!storageConsent || !storageToggle.checked) return;
  storageSet(GRAPH_VIEW_STORAGE_KEY, JSON.stringify({
    zoom: graphZoom,
    left: graphScroller.scrollLeft - GRAPH_PAN_MARGIN,
    top: graphScroller.scrollTop - GRAPH_PAN_MARGIN,
  }));
}
function scheduleGraphViewSave() {
  clearTimeout(graphViewSaveTimer);
  graphViewSaveTimer = setTimeout(saveGraphView, 150);
}
function updateGraphZoom() {
  const graph = $("graph");
  graph.style.transform = "translate(" + GRAPH_PAN_MARGIN + "px, " + GRAPH_PAN_MARGIN + "px) scale(" + graphZoom + ")";
  graphViewport.style.width = graph.offsetWidth * graphZoom + GRAPH_PAN_MARGIN * 2 + "px";
  graphViewport.style.height = graph.offsetHeight * graphZoom + GRAPH_PAN_MARGIN * 2 + "px";
  $("zoom-value").textContent = Math.round(graphZoom * 100) + "%";
}
function optimalGraphZoom() {
  const graph = $("graph"), style = getComputedStyle(graphScroller);
  const availableWidth = graphScroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = graphScroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (!graph.offsetWidth || !graph.offsetHeight || availableWidth <= 0 || availableHeight <= 0) return 1;
  const fit = Math.min(1.5, availableWidth / graph.offsetWidth, availableHeight / graph.offsetHeight);
  return Math.max(0.25, Math.round(fit * 100) / 100);
}
function setGraphZoom(value) {
  graphZoom = Math.min(1.5, Math.max(0.25, Math.round(value * 100) / 100));
  updateGraphZoom();
  scheduleDrawEdges();
  scheduleGraphViewSave();
}
function zoomGraphBy(amount, clientX, clientY) {
  const bounds = graphScroller.getBoundingClientRect();
  const localX = (clientX ?? bounds.left + bounds.width / 2) - bounds.left - graphScroller.clientLeft;
  const localY = (clientY ?? bounds.top + bounds.height / 2) - bounds.top - graphScroller.clientTop;
  const oldZoom = graphZoom;
  const nextZoom = Math.min(1.5, Math.max(0.25, Math.round((oldZoom + amount) * 100) / 100));
  if (nextZoom === oldZoom) return;
  const anchorX = (graphScroller.scrollLeft + localX - GRAPH_PAN_MARGIN) / oldZoom;
  const anchorY = (graphScroller.scrollTop + localY - GRAPH_PAN_MARGIN) / oldZoom;
  setGraphZoom(nextZoom);
  graphScroller.scrollLeft = anchorX * nextZoom + GRAPH_PAN_MARGIN - localX;
  graphScroller.scrollTop = anchorY * nextZoom + GRAPH_PAN_MARGIN - localY;
}
$("zoom-in").addEventListener("click", () => setGraphZoom(graphZoom + 0.1));
$("zoom-out").addEventListener("click", () => setGraphZoom(graphZoom - 0.1));
graphScroller.addEventListener("wheel", (event) => {
  if (!event.altKey) return;
  event.preventDefault();
  zoomGraphBy(event.deltaY < 0 ? 0.1 : -0.1, event.clientX, event.clientY);
}, { passive: false });
document.addEventListener("keydown", (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") zoomGraphBy(0.1);
  else if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") zoomGraphBy(-0.1);
  else return;
  event.preventDefault();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !selectedFocusPath.length || document.querySelector("dialog[open], [popover]:popover-open")) return;
  selectedFocusPath = [];
  render(true);
});
let panPointer = null, panStartX = 0, panStartY = 0, panScrollLeft = 0, panScrollTop = 0, panMoved = false;
graphScroller.addEventListener("dragstart", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".graph")) event.preventDefault();
});
graphScroller.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(".graph") || target.closest("button, input, textarea, select, a, [popover]")) return;
  panPointer = event.pointerId;
  panStartX = event.clientX; panStartY = event.clientY;
  panScrollLeft = graphScroller.scrollLeft; panScrollTop = graphScroller.scrollTop;
  panMoved = false;
});
document.addEventListener("pointermove", (event) => {
  if (event.pointerId !== panPointer) return;
  const dx = event.clientX - panStartX, dy = event.clientY - panStartY;
  if (!panMoved && Math.hypot(dx, dy) < 4) return;
  if (!panMoved) {
    panMoved = true;
    document.body.classList.add("graph-panning");
    window.getSelection()?.removeAllRanges();
    if (!graphScroller.hasPointerCapture(event.pointerId)) graphScroller.setPointerCapture(event.pointerId);
  }
  graphScroller.classList.add("panning");
  event.preventDefault();
  graphScroller.scrollLeft = panScrollLeft - dx;
  graphScroller.scrollTop = panScrollTop - dy;
});
const finishGraphPan = (event) => {
  if (event.pointerId !== panPointer) return;
  const dragged = panMoved;
  panPointer = null;
  panMoved = false;
  document.body.classList.remove("graph-panning");
  graphScroller.classList.remove("panning");
  if (graphScroller.hasPointerCapture(event.pointerId)) graphScroller.releasePointerCapture(event.pointerId);
  if (dragged) {
    const suppressClick = (clickEvent) => {
      if (clickEvent.target instanceof Node && graphScroller.contains(clickEvent.target)) {
        clickEvent.preventDefault();
        clickEvent.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", suppressClick, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", suppressClick, true), 0);
  }
};
document.addEventListener("pointerup", finishGraphPan);
document.addEventListener("pointercancel", finishGraphPan);
graphScroller.addEventListener("lostpointercapture", finishGraphPan);
graphScroller.addEventListener("scroll", scheduleGraphViewSave, { passive: true });
window.addEventListener("pagehide", saveGraphView);
window.addEventListener("resize", rafThrottle(() => {
  const width = parseFloat(getComputedStyle(app).getPropertyValue("--sidebar-width")) || 290;
  setSidebarWidth(width);
  scheduleDrawEdges();
}));
const num = formatNumber;
const fmt = compactNumber;
const parse = parseAmount;
const ITEM_KEYS = Object.keys(D.items);

function status(msg, type) {
  const element = $("status");
  element.textContent = msg;
  element.className = type || "";
}

function emptyInventory() {
  return createEmptyInventory(ITEM_KEYS);
}

function normalizeInventory(source) {
  return normalizeInventoryFor(ITEM_KEYS, source);
}

function loadInventory() {
  if (!storageConsent) return normalizeInventory(D.initialInventory);
  const saved = readStoredJson(INVENTORY_STORAGE_KEY, null);
  return normalizeInventory(saved ?? D.initialInventory);
}

function saveInventory() {
  if (!storageConsent || !storageToggle.checked) return true;
  const saved = storageSet(INVENTORY_STORAGE_KEY, JSON.stringify(inv));
  storageSet(STORAGE_KEYS.goals, JSON.stringify(sel));
  storageSet(STORAGE_KEYS.step, String(step));
  storageSet(SIDEBAR_WIDTH_STORAGE_KEY, getComputedStyle(app).getPropertyValue("--sidebar-width").trim());
  return saved;
}

inv = loadInventory();
storageToggle.checked = storageConsent;
const storageDialog = $("storage-consent-dialog");
storageToggle.onchange = () => {
  if (storageToggle.checked) {
    if (!storageConsent) {
      storageToggle.checked = false;
      storageDialog.showModal();
      return;
    }
    const saved = saveInventory();
    status(saved ? "Inventory will save in browser storage." : "Could not save in browser storage.", saved ? "ok" : "error");
  } else {
    storageConsent = false; storageDeclined = true;
    storageSet(STORAGE_CONSENT_KEY, "denied");
    removeStoredProgress();
    status("Browser storage saving disabled.", "ok");
  }
};
$("storage-allow").onclick = () => {
  const saved = readStoredJson(INVENTORY_STORAGE_KEY, null);
  if (saved !== null) inv = normalizeInventory(saved);
  const savedGoals = readStoredJson(STORAGE_KEYS.goals, []);
  if (Array.isArray(savedGoals)) {
    const validGoals = savedGoals.filter((goal) => D.goals[goal]);
    if (validGoals.length) sel = validGoals;
  }
  const consentSaved = storageSet(STORAGE_CONSENT_KEY, "granted");
  storageConsent = consentSaved;
  storageDeclined = false;
  storageToggle.checked = consentSaved;
  const stored = storageConsent ? saveInventory() : false;
  status(stored ? "Saved in browser storage." : "Could not save in browser storage.", stored ? "ok" : "error");
  storageDialog.close();
  buildChips();
  refreshGross();
  render(true);
};
$("storage-decline").onclick = () => {
  storageConsent = false; storageDeclined = true; storageToggle.checked = false;
  storageSet(STORAGE_CONSENT_KEY, "denied");
  removeStoredProgress();
  storageDialog.close();
  status("Progress will stay in memory for this page.", "ok");
};
$("storage-settings").onclick = () => storageDialog.showModal();
const creditsDialog = $("credits-dialog");
$("credits-open").addEventListener("click", () => creditsDialog.showModal());
$("credits-close").addEventListener("click", () => creditsDialog.close());
if (!storageConsent && !storageDeclined) storageDialog.showModal();
function openCraftDialog(item, max) {
  const dialog = $("craft-dialog"), amount = $("craft-amount");
  const decrement = $("craft-sub"), increment = $("craft-add"), confirmButton = $("craft-confirm");
  $("craft-dialog-item").textContent = D.items[item].name;
  const itemIcon = ico(D.items[item].icon, item); itemIcon.id = "craft-item-icon"; itemIcon.classList.add("craft-item-icon");
  $("craft-item-icon").replaceWith(itemIcon);
  $("craft-limit").textContent = "Ready to blend: " + fmt(max);
  $("craft-max").textContent = "Max " + fmt(max);
  $("craft-max").disabled = max <= 0;
  amount.value = "1";
  const updateSteppers = () => {
    const quantity = parse(amount.value);
    decrement.disabled = quantity == null || quantity <= 1;
    increment.disabled = quantity == null || quantity >= max;
    $("craft-max").disabled = max <= 0;
    confirmButton.disabled = max <= 0 || quantity == null || quantity < 1 || quantity > max;
  };
  decrement.onclick = () => {
    const quantity = parse(amount.value);
    if (quantity != null) amount.value = String(Math.max(1, quantity - step));
    updateSteppers();
  };
  increment.onclick = () => {
    const quantity = parse(amount.value);
    if (quantity != null) amount.value = String(Math.min(max, quantity + step));
    updateSteppers();
  };
  $("craft-max").onclick = () => { amount.value = String(max); updateSteppers(); amount.focus(); amount.select(); };
  $("craft-cancel").onclick = () => dialog.close();
  const confirm = () => {
    const quantity = parse(amount.value);
    if (!quantity || quantity > max) { status("Choose an amount from 1 to " + fmt(max) + ".", "error"); amount.focus(); return; }
    dialog.close();
    send({ item, action: "craft", amount: quantity });
  };
  $("craft-confirm").onclick = confirm;
  amount.oninput = updateSteppers;
  amount.onkeydown = (event) => { if (event.key === "Enter") confirm(); };
  updateSteppers();
  dialog.showModal();
  amount.focus(); amount.select();
}

function plan(have, goals = sel) {
  return makePlan(D, have, goals);
}
function totalCraftingMinutes(P) {
  return totalCraftingMinutesFor(D, P);
}
let GROSS = plan({}).demand;
const GOAL_GROSS = Object.fromEntries(Object.keys(D.goals).map((goal) => [goal, plan({}, [goal])]));
function refreshGross() {
  GROSS = plan({}).demand;
}

function remaining(P, k) {
  return remainingFor(D, P, inv, k);
}
const pctOf = (P, k) => percentComplete(GROSS, D, P, inv, k);

async function send(body) {
  if (busy) return;
  busy = true;
  const { item, action } = body ?? {}, amount = body?.amount ?? 1;
  let message = "";
  if (action === "reset") {
    inv = emptyInventory(); message = "Everything reset to 0";
  } else if (action === "import") {
    const incoming = body?.inventory;
    const validation = validateInventory(ITEM_KEYS, incoming);
    if (!validation.ok) {
      status(validation.error, "error"); busy = false; return;
    }
    inv = normalizeInventory(incoming); message = "Inventory imported";
  } else {
    if (typeof item !== "string" || !Object.hasOwn(D.items, item)) {
      status("Invalid item", "error"); busy = false; return;
    }
    if (!["add", "sub", "set", "craft"].includes(action)) {
      status("Invalid action", "error"); busy = false; return;
    }
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_INVENTORY_COUNT) {
      status("Invalid amount", "error"); busy = false; return;
    }
    const label = D.items[item].name;
    if (action === "craft") {
      const recipe = D.recipes[item];
      if (!recipe) { status(label + " can't be crafted", "error"); busy = false; return; }
      if (inv[item] > MAX_INVENTORY_COUNT - amount) {
        status("That would exceed the maximum inventory count of " + fmt(MAX_INVENTORY_COUNT) + ".", "error");
        busy = false; return;
      }
      const missing = Object.entries(recipe).filter(([ingredient, quantity]) => inv[ingredient] < quantity * amount);
      if (missing.length) {
        status("Not enough " + missing.map(([ingredient, quantity]) =>
          D.items[ingredient].name + " (need " + fmt(quantity * amount) + ", have " + fmt(inv[ingredient]) + ")").join(", "), "error");
        busy = false; return;
      }
      for (const [ingredient, quantity] of Object.entries(recipe)) inv[ingredient] -= quantity * amount;
      inv[item] += amount; message = "Crafted " + fmt(amount) + " " + label;
    } else if (action === "set") {
      inv[item] = amount; message = label + " set to " + fmt(amount);
    } else if (action === "add") {
      if (inv[item] > MAX_INVENTORY_COUNT - amount) {
        status("That would exceed the maximum inventory count of " + fmt(MAX_INVENTORY_COUNT) + ".", "error");
        busy = false; return;
      }
      inv[item] += amount; message = "Added " + fmt(amount) + " " + label;
    } else {
      inv[item] = Math.max(0, inv[item] - amount); message = "Removed " + fmt(amount) + " " + label;
    }
  }
  const saved = saveInventory();
  status(saved ? message : "Could not save in browser storage.", saved ? "ok" : "error");
  busy = false;
  render();
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, cls, fn, disabled) {
  const b = h("button", cls, label); b.disabled = !!disabled; b.onclick = fn; return b;
}

// Icons are resolved from a build-time extension map, so browsers never request
// a format that does not exist. Emoji remain the fallback for missing images.
const iconState = {};
const iconExtensions = D.iconExtensions || {};
function iconUrl(key) {
  const extension = iconExtensions[key];
  return extension ? "assets/img/icons/" + key + "." + extension : null;
}
function ico(emoji, key) {
  const span = h("span", "ic", emoji);
  const source = iconUrl(key);
  if (!source || iconState[key] === false) return span;
  const image = new Image();
  image.alt = "";
  image.decoding = "async";
  image.onload = () => { iconState[key] = true; span.textContent = ""; span.append(image); };
  image.onerror = () => { iconState[key] = false; };
  image.src = source;
  return span;
}

function positionTooltip(anchor, tooltip) {
  if (!tooltip.matches(":popover-open")) tooltip.showPopover();
  const anchorRect = anchor.getBoundingClientRect(), popup = tooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchorRect.right - popup.width, innerWidth - popup.width - 8));
  const top = anchorRect.bottom + popup.height + 8 <= innerHeight
    ? anchorRect.bottom + 6
    : Math.max(8, anchorRect.top - popup.height - 6);
  tooltip.style.left = left + "px";
  tooltip.style.top = top + "px";
}

function wireHoverTooltip(trigger, tooltip) {
  let closeTimer = 0;
  const open = () => {
    clearTimeout(closeTimer);
    positionTooltip(trigger, tooltip);
  };
  const scheduleClose = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!trigger.matches(":hover") && !tooltip.matches(":hover") && !trigger.matches(":focus")) tooltip.hidePopover();
    }, 140);
  };
  trigger.addEventListener("pointerenter", open);
  trigger.addEventListener("pointerleave", scheduleClose);
  trigger.addEventListener("focus", open);
  trigger.addEventListener("blur", scheduleClose);
  tooltip.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  tooltip.addEventListener("pointerleave", scheduleClose);
}

function makeNode(k, P) {
  const it = D.items[k], recipe = D.recipes[k];
  const own = inv[k] || 0, need = remaining(P, k), pct = pctOf(P, k);
  const canCraft = recipe ? Math.min(...Object.entries(recipe).map(([i, q]) => Math.floor((inv[i] || 0) / q))) : 0;
  const best = recipe ? Math.min(canCraft, P.craft[k]) : 0;
  const n = h("div", "node" + (k === "red_extracts" ? " red" : k === "blue_extracts" ? " blue" : "") + (need === 0 ? " ok" : "") + (recipe ? " craft-card" : ""));
  n.id = "n-" + k;

  const hd = h("div", "nh"); hd.append(ico(it.icon, k), h("span", "", it.name)); n.append(hd);
  if (recipe) {
    const info = h("div", "recipe-info");
    const trigger = h("span", "recipe-info-trigger", "?");
    trigger.tabIndex = 0;
    trigger.setAttribute("aria-label", "Show " + it.name + " recipe");
    const mobileTrigger = btn("?", "recipe-info-button", () => {});
    mobileTrigger.setAttribute("aria-label", "Show " + it.name + " recipe");
    const tooltip = h("div", "goal-tooltip");
    tooltip.id = "recipe-tip-" + k;
    tooltip.setAttribute("popover", "auto");
    tooltip.setAttribute("role", "tooltip");
    tooltip.append(h("strong", "goal-tooltip-title", "Recipe for " + it.name));
    const ingredients = h("div", "goal-cost-list");
    for (const [ingredient, quantity] of Object.entries(recipe)) {
      const row = h("div", "goal-cost");
      row.append(
        ico(D.items[ingredient].icon, ingredient),
        h("span", "", D.items[ingredient].name),
        h("b", "goal-cost-count", fmt(quantity) + " per craft · " + fmt(inv[ingredient] || 0) + " owned"),
      );
      ingredients.append(row);
    }
    tooltip.append(ingredients);
    trigger.setAttribute("aria-describedby", tooltip.id);
    mobileTrigger.setAttribute("aria-describedby", tooltip.id);
    mobileTrigger.setAttribute("aria-expanded", "false");
    mobileTrigger.onclick = () => {
      if (tooltip.matches(":popover-open")) tooltip.hidePopover();
      else positionTooltip(mobileTrigger, tooltip);
    };
    tooltip.addEventListener("toggle", () => mobileTrigger.setAttribute("aria-expanded", String(tooltip.matches(":popover-open"))));
    info.append(trigger, mobileTrigger);
    n.append(info, tooltip);
    wireHoverTooltip(trigger, tooltip);
  }

  const own$ = h("div", "own"), input = h("input"); input.value = k === "honey" ? fmt(own) : num(own);
  input.setAttribute("aria-label", it.name + " owned");
  input.onfocus = () => input.select();
  input.onchange = () => {
    const v = parse(input.value);
    if (v == null) { status("Type a whole number. 25b, 1.5m and 300k work too.", "error"); render(); return; }
    send({ item: k, action: "set", amount: v });
  };
  const unit = k === "honey" ? 1e9 : 1, amt = step * unit, lab = k === "honey" ? "B" : "";
  const plus = btn("+", "count-step", () => send({ item: k, action: "add", amount: amt }));
  const minus = btn("−", "count-step", () => send({ item: k, action: "sub", amount: amt }), own <= 0);
  minus.setAttribute("aria-label", "Subtract " + step + lab + " " + it.name);
  plus.setAttribute("aria-label", "Add " + step + lab + " " + it.name);
  minus.title = "Subtract " + step + lab;
  plus.title = "Add " + step + lab;
  own$.append(input, plus, minus);
  if (recipe) {
    const blend = btn("", "blend-open", () => openCraftDialog(k, best));
    blend.setAttribute("aria-label", "Blend " + it.name);
    blend.title = "Blend " + it.name;
    const blendIconUrl = iconUrl("blender_2d");
    if (blendIconUrl) {
      const icon = new Image();
      icon.alt = "";
      icon.src = blendIconUrl;
      blend.append(icon);
    }
    own$.append(blend);
  }
  n.append(own$);

  n.append(h("div", "need " + (need === 0 ? "ok" : "todo"),
    need === 0 ? "✓ Covered" : (recipe ? "Craft " : "Gather ") + fmt(need) + " more"));
  n.append(h("div", "tiny", "of " + fmt(GROSS[k]) + " needed in total"));
  const bar = h("div", "bar"), fill = h("i"); fill.style.width = pct + "%"; bar.append(fill); n.append(bar);

  return n;
}

function goalPct(g) {
  return goalProgress(D, inv, g, GOAL_GROSS[g]);
}

function makeGoal(g) {
  const v = D.goals[g], pct = goalPct(g), craftingMinutes = totalCraftingMinutes(plan(inv, [g]));
  const n = h("div", "node canister"); n.id = "n-goal-" + g;
  const hd = h("div", "nh"); hd.append(ico(v.icon, g), h("span", "", v.name)); n.append(hd);
  const info = btn("?", "goal-info", () => {});
  info.setAttribute("aria-label", "Show " + v.name + " item requirements");
  info.setAttribute("aria-expanded", "false");
  const tip = h("div", "goal-tooltip"); tip.id = "goal-tip-" + g; tip.setAttribute("popover", "auto");
  tip.setAttribute("role", "tooltip"); tip.append(h("strong", "goal-tooltip-title", v.name + " requirements"));
  const costs = h("div", "goal-cost-list");
  for (const [k, q] of Object.entries(v.cost)) {
    const row = h("div", "goal-cost");
    row.append(ico(D.items[k].icon, k), h("span", "", D.items[k].name), h("b", "goal-cost-count", fmt(inv[k] || 0) + " / " + fmt(q)));
    costs.append(row);
  }
  tip.append(costs); info.setAttribute("aria-describedby", tip.id);
  info.onclick = () => {
    if (tip.matches(":popover-open")) { tip.hidePopover(); return; }
    positionTooltip(info, tip);
  };
  tip.addEventListener("toggle", () => info.setAttribute("aria-expanded", String(tip.matches(":popover-open"))));
  n.append(info, tip);
  n.append(h("div", "pct", pct.toFixed(1) + "%"));
  n.append(h("div", "tiny", "Progress if this were your only goal"));
  if (craftingMinutes > 0) n.append(h("div", "goal-crafting-time", "Blender time: " + formatCraftingTime(craftingMinutes)));
  const bar = h("div", "bar"), fill = h("i"); fill.style.width = pct + "%"; bar.append(fill); n.append(bar);
  return n;
}

// Column per depth: gather first, shop (goals) last, raw items sit just before their first consumer.
function layout() {
  const vis = Object.keys(GROSS).filter((k) => GROSS[k] > 0), crafted = vis.filter((k) => D.recipes[k]), lc = {};
  const L = (k) => lc[k] ?? (lc[k] = 1 + Math.max(0, ...Object.keys(D.recipes[k]).filter((i) => D.recipes[i] && GROSS[i] > 0).map(L)));
  crafted.forEach(L);
  const goalL = Math.max(0, ...crafted.map(L)) + 1, lvl = {};
  crafted.forEach((k) => (lvl[k] = lc[k]));
  for (const k of vis.filter((x) => !D.recipes[x])) {
    let m = sel.some((g) => D.goals[g].cost[k]) ? goalL : 99;
    for (const c of crafted) if (D.recipes[c][k]) m = Math.min(m, lc[c]);
    lvl[k] = m - 1;
  }
  return { lvl, goalL };
}

function drawEdges() {
  const graph = $("graph");
  const old = graph.querySelector("svg.edges");
  if (old) old.remove();
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "edges");

  const marker = (id, color) => {
    const element = document.createElementNS(NS, "marker");
    element.id = id;
    for (const [name, value] of Object.entries({
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "7",
      markerHeight: "7",
      orient: "auto",
    })) element.setAttribute(name, value);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M0 0L10 5L0 10z");
    path.setAttribute("fill", color);
    element.append(path);
    return element;
  };
  const defs = document.createElementNS(NS, "defs");
  defs.append(marker("a", "#2a7f8f"), marker("ah", "#e58f00"));
  svg.append(defs);

  const graphRect = graph.getBoundingClientRect();
  const edges = [];
  for (const [key, recipe] of Object.entries(D.recipes)) {
    for (const [ingredient, quantity] of Object.entries(recipe)) {
      edges.push({ from: ingredient, to: key, quantity });
    }
  }
  for (const goal of sel) {
    for (const [ingredient, quantity] of Object.entries(D.goals[goal].cost)) {
      edges.push({ from: ingredient, to: "goal-" + goal, quantity });
    }
  }

  // Read every rect before building any SVG nodes, avoiding repeated layout
  // recalculations for each edge.
  const nodeKeys = new Set();
  for (const edge of edges) {
    nodeKeys.add(edge.from);
    nodeKeys.add(edge.to);
  }
  const rects = new Map();
  for (const key of nodeKeys) {
    const node = $("n-" + key);
    if (node) rects.set(key, node.getBoundingClientRect());
  }

  const fragment = document.createDocumentFragment();
  const labelT = 0.7, labelU = 1 - labelT;
  for (const edge of edges) {
    const fromRect = rects.get(edge.from);
    const toRect = rects.get(edge.to);
    if (!fromRect || !toRect) continue;
    const x1 = (fromRect.right - graphRect.left) / graphZoom;
    const y1 = (fromRect.top + fromRect.height / 2 - graphRect.top) / graphZoom;
    const x2 = (toRect.left - graphRect.left - 3) / graphZoom;
    const y2 = (toRect.top + toRect.height / 2 - graphRect.top) / graphZoom;
    const dx = (x2 - x1) * 0.5;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M" + x1 + " " + y1 + " C" + (x1 + dx) + " " + y1 + "," + (x2 - dx) + " " + y2 + "," + x2 + " " + y2);
    path.setAttribute("class", "edge");
    path.setAttribute("marker-end", "url(#a)");
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;
    fragment.append(path);

    // Label sits at t = 0.7 on the curve, close to the arrow's target.
    const lx = labelU * labelU * labelU * x1 + 3 * labelU * labelU * labelT * (x1 + dx)
      + 3 * labelU * labelT * labelT * (x2 - dx) + labelT * labelT * labelT * x2;
    const ly = labelU * labelU * labelU * y1 + 3 * labelU * labelU * labelT * y1
      + 3 * labelU * labelT * labelT * y2 + labelT * labelT * labelT * y2;
    const group = document.createElementNS(NS, "g");
    group.setAttribute("class", "edge-label");
    group.dataset.from = edge.from;
    group.dataset.to = edge.to;
    const text = document.createElementNS(NS, "text");
    text.setAttribute("class", "elab");
    text.setAttribute("x", lx);
    text.setAttribute("y", ly + 4);
    text.setAttribute("text-anchor", "middle");
    text.textContent = "×" + fmt(edge.quantity);
    const width = text.textContent.length * 7 + 10;
    const background = document.createElementNS(NS, "rect");
    background.setAttribute("class", "elabbg");
    background.setAttribute("x", lx - width / 2);
    background.setAttribute("y", ly - 9);
    background.setAttribute("width", width);
    background.setAttribute("height", 18);
    background.setAttribute("rx", 9);
    group.append(background, text);
    fragment.append(group);
  }
  svg.append(fragment);
  graph.prepend(svg);
}

function rafThrottle(callback) {
  let frame = 0;
  return () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      callback();
    });
  };
}
const scheduleDrawEdges = rafThrottle(drawEdges);

function focusNode(key) {
  clearTimeout(focusClearTimer);
  focusClearTimer = 0;
  const g = $("graph");
  const selectedFocusKey = selectedFocusPath[selectedFocusPath.length - 1] || null;
  const focusKey = selectedFocusKey || key;
  const required = selectedFocusKey ? requiredNodeKeys(selectedFocusKey) : null;
  g.classList.toggle("focus", !!focusKey);
  g.classList.toggle("focus-view", selectedFocusPath.length > 0);
  const connected = required || new Set(focusKey ? [focusKey] : []);
  g.querySelectorAll("path.edge").forEach((p) => {
    const hot = required
      ? connected.has(p.dataset.from) && connected.has(p.dataset.to)
      : focusKey && (p.dataset.from === focusKey || p.dataset.to === focusKey);
    p.classList.toggle("hot", !!hot);
    p.setAttribute("marker-end", hot ? "url(#ah)" : "url(#a)");
    if (hot) { connected.add(p.dataset.from); connected.add(p.dataset.to); }
  });
  g.querySelectorAll(".edge-label").forEach((label) => {
    const relevant = required
      ? connected.has(label.dataset.from) && connected.has(label.dataset.to)
      : label.dataset.from === focusKey || label.dataset.to === focusKey;
    label.classList.toggle("dim", !!focusKey && !relevant);
  });
  g.querySelectorAll(".node").forEach((n) =>
    n.classList.toggle("dim", !!focusKey && !connected.has(n.id.slice(2))));
}

function requiredNodeKeys(key) {
  const required = new Set();
  const addItem = (item) => {
    if (required.has(item)) return;
    required.add(item);
    for (const ingredient of Object.keys(D.recipes[item] || {})) addItem(ingredient);
  };
  if (key.startsWith("goal-")) {
    required.add(key);
    const goal = D.goals[key.slice(5)];
    if (goal) Object.keys(goal.cost).forEach(addItem);
  } else {
    addItem(key);
  }
  return required;
}

function updateFocusBreadcrumb() {
  const bar = $("graph-focus-bar");
  bar.hidden = !selectedFocusPath.length;
  bar.replaceChildren();
  if (!selectedFocusPath.length) return;
  bar.append(h("strong", "", "Focusing on:"));
  selectedFocusPath.forEach((key, index) => {
    if (index) {
      const arrow = h("span", "focus-crumb-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      bar.append(arrow);
    }
    const goal = key.startsWith("goal-");
    const name = goal ? D.goals[key.slice(5)]?.name : D.items[key]?.name;
    if (index < selectedFocusPath.length - 1) {
      const back = h("button", "focus-crumb", name || key);
      back.type = "button";
      back.setAttribute("aria-label", "Go back to focus on " + (name || key));
      back.onclick = () => {
        selectedFocusPath = selectedFocusPath.slice(0, index + 1);
        render(true);
      };
      bar.append(back);
    } else {
      const current = h("span", "focus-crumb-current", name || key);
      current.setAttribute("aria-current", "location");
      bar.append(current);
    }
  });
}

function toggleFocusView(key) {
  const current = selectedFocusPath[selectedFocusPath.length - 1];
  if (current === key) {
    selectedFocusPath = [];
  } else if (!current) {
    selectedFocusPath = [key];
  } else if (requiredNodeKeys(current).has(key)) {
    selectedFocusPath.push(key);
  } else {
    selectedFocusPath = [key];
  }
  clearTimeout(focusClearTimer);
  render(true);
}

function updateFocusFromRelatedNode(event) {
  const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest(".node") : null;
  if (!related) return false;
  focusNode(related.id.slice(2));
  return true;
}

function scheduleFocusClear() {
  clearTimeout(focusClearTimer);
  focusClearTimer = setTimeout(() => focusNode(null), 100);
}

function listRow(k, value, pct, done) {
  const r = h("div", "row"), b = h("b", done ? "done" : "");
  b.append(ico(D.items[k].icon, k), h("span", "", D.items[k].name));
  r.append(b, h("span", "v" + (done ? " done" : ""), value));
  const bar = h("div", "bar"), fill = h("i"); fill.style.width = pct + "%"; bar.append(fill); r.append(bar);
  return r;
}

function buildChips() {
  const c = $("goals"); c.replaceChildren();
  const groups = new Map();
  for (const [g, v] of Object.entries(D.goals)) {
    const shop = D.goalShops[g] || "Other Items";
    if (!groups.has(shop)) groups.set(shop, []);
    groups.get(shop).push([g, v]);
  }
  const appendGoalGroup = (shop, goals, collapsed, collapsible, showLabel = true) => {
    const group = h("section", "goal-group"), items = h("div", "goal-group-items");
    items.id = "goal-group-" + shop.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (collapsible) {
      const header = h("div", "goal-group-header");
      const heading = btn("", "goal-group-toggle", () => {
        if (collapsedGoalShops.has(shop)) collapsedGoalShops.delete(shop);
        else collapsedGoalShops.add(shop);
        if (storageConsent && storageToggle.checked) {
          storageSet(COLLAPSED_SHOPS_STORAGE_KEY, JSON.stringify([...collapsedGoalShops]));
        }
        buildChips();
      });
      heading.setAttribute("aria-expanded", String(!collapsed));
      heading.setAttribute("aria-controls", items.id);
      heading.append(h("span", "", shop), h("span", "goal-group-chevron", collapsed ? "+" : "−"));
      const selectedCount = goals.filter(([goal]) => sel.includes(goal)).length;
      const selectAll = h("input", "goal-group-select");
      selectAll.type = "checkbox";
      selectAll.checked = selectedCount === goals.length;
      selectAll.indeterminate = false;
      selectAll.setAttribute("aria-label", (selectedCount === goals.length ? "Deselect" : "Select") + " all goals in " + shop);
      selectAll.title = selectedCount === goals.length ? "Deselect all in " + shop : "Select all in " + shop;
      selectAll.onchange = () => {
        const allSelected = goals.every(([goal]) => sel.includes(goal));
        const categoryGoals = new Set(goals.map(([goal]) => goal));
        sel = allSelected
          ? sel.filter((goal) => !categoryGoals.has(goal))
          : [...new Set([...sel, ...categoryGoals])];
        if (storageConsent && storageToggle.checked) {
          storageSet(STORAGE_KEYS.goals, JSON.stringify(sel));
        }
        refreshGross(); buildChips(); render(true);
      };
      header.append(heading, selectAll);
      group.append(header);
    } else if (showLabel) {
      group.append(h("div", "goal-group-label", shop));
    }
    for (const [g, v] of goals) {
      const on = sel.includes(g), b = h("button", "goal" + (on ? " on" : ""));
      b.id = "goal-btn-" + g;
      b.setAttribute("aria-pressed", on);
      b.title = v.name;
      b.hidden = collapsed && !app.classList.contains("compact-sidebar") && !on;
      const gp = h("span", "gp"); gp.id = "gp-" + g;
      b.append(ico(v.icon, g), h("span", "", v.name), gp);
      b.onclick = () => {
        sel = on ? sel.filter((x) => x !== g) : [...sel, g];
        if (storageConsent && storageToggle.checked) {
          storageSet(STORAGE_KEYS.goals, JSON.stringify(sel));
        }
        refreshGross(); buildChips(); render(true);
      };
      items.append(b);
    }
    group.append(items); c.append(group);
  };
  if (app.classList.contains("compact-sidebar")) {
    const selectedGoals = Object.entries(D.goals).filter(([g]) => sel.includes(g));
    if (selectedGoals.length) appendGoalGroup("", selectedGoals, false, false, false);
  }
  for (const [shop, goals] of groups) {
    const visibleGoals = app.classList.contains("compact-sidebar") ? goals.filter(([g]) => !sel.includes(g)) : goals;
    if (visibleGoals.length) appendGoalGroup(shop, visibleGoals, collapsedGoalShops.has(shop), true);
  }
}

function render(autoFit = false) {
  const P = plan(inv), g = $("graph"), { lvl, goalL } = layout(), N = goalL + 1;
  if (selectedFocusPath.length) {
    const root = selectedFocusPath[0];
    if (root.startsWith("goal-") ? !sel.includes(root.slice(5)) : !(GROSS[root] > 0)) selectedFocusPath = [];
    for (let index = 1; index < selectedFocusPath.length; index++) {
      if (!requiredNodeKeys(selectedFocusPath[index - 1]).has(selectedFocusPath[index])) {
        selectedFocusPath = selectedFocusPath.slice(0, index);
        break;
      }
    }
  }
  const selectedFocusKey = selectedFocusPath[selectedFocusPath.length - 1] || null;
  const required = selectedFocusKey ? requiredNodeKeys(selectedFocusKey) : null;
  const totalMinutes = totalCraftingMinutes(P);
  const totalCraftTime = $("craft-time-total");
  totalCraftTime.hidden = totalMinutes === 0;
  totalCraftTime.textContent = "Blender time: " + formatCraftingTime(totalMinutes);
  const restoreSavedView = !autoFit && restoreGraphViewOnRender && savedGraphView;
  g.replaceChildren();
  const columns = [];
  for (let c = 0; c < N; c++) {
    const keys = Object.keys(D.items).filter((k) => GROSS[k] > 0 && lvl[k] === c && (!required || required.has(k)));
    const col = h("div", "col");
    const appendSection = (label, nodes) => {
      if (!nodes.length) return;
      const section = h("div", "col-section");
      section.append(h("div", "colh", label), ...nodes);
      col.append(section);
    };
    appendSection("Gather", keys.filter((k) => !D.recipes[k]).map((k) => makeNode(k, P)));
    appendSection("Blender", keys.filter((k) => D.recipes[k]).map((k) => makeNode(k, P)));
    if (c === goalL) appendSection("Buy in the shop", sel.filter((x) => !required || required.has("goal-" + x)).map((x) => makeGoal(x)));
    if (col.childElementCount) columns.push(col);
  }
  const columnCount = Math.max(1, columns.length);
  updateFocusBreadcrumb();
  const graphWidth = Math.max(1040, columnCount * 240 + (columnCount - 1) * 42 + 36);
  g.style.gridTemplateColumns = "repeat(" + columnCount + ",minmax(240px,1fr))";
  g.style.width = graphWidth + "px";
  g.style.minWidth = graphWidth + "px";
  g.append(...columns);
  g.querySelectorAll(".node").forEach((n) => {
    const key = n.id.slice(2);
    n.tabIndex = 0;
    n.setAttribute("role", "group");
    const itemName = D.items[key]?.name || (key.startsWith("goal-") ? D.goals[key.slice(5)]?.name : null) || key;
    n.setAttribute("aria-label", "Click or press Enter to focus on " + itemName + " and its ingredients");
    n.title = "Click to show this item and its ingredients. Click again or press Escape to show all cards.";
    n.classList.toggle("focus-selected", key === selectedFocusKey);
    n.onmouseenter = () => focusNode(key);
    n.onmouseleave = (event) => { if (!updateFocusFromRelatedNode(event)) scheduleFocusClear(); };
    n.addEventListener("focusin", () => focusNode(key));
    n.addEventListener("focusout", (event) => { if (!updateFocusFromRelatedNode(event)) scheduleFocusClear(); });
    n.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button, input, textarea, select, a, [popover], .recipe-info")) return;
      toggleFocusView(key);
    });
    n.addEventListener("keydown", (event) => {
      if (event.target !== n || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      toggleFocusView(key);
    });
  });
  if (autoFit) {
    graphZoom = optimalGraphZoom();
    graphScroller.scrollLeft = GRAPH_PAN_MARGIN;
    graphScroller.scrollTop = GRAPH_PAN_MARGIN;
  }
  updateGraphZoom();
  if (restoreSavedView) {
    graphScroller.scrollLeft = GRAPH_PAN_MARGIN + savedGraphView.left;
    graphScroller.scrollTop = GRAPH_PAN_MARGIN + savedGraphView.top;
    restoreGraphViewOnRender = false;
  }
  drawEdges();
  focusNode(null);
  if (autoFit) scheduleGraphViewSave();
  for (const g of Object.keys(D.goals)) {
    const label = goalPct(g).toFixed(0) + "%";
    const progress = $("gp-" + g);
    if (progress) progress.textContent = label;
  }

  const gather = $("gather"), todo = $("todo");
  gather.replaceChildren(); todo.replaceChildren();
  RAWKEYS.filter((k) => GROSS[k] > 0).map((k) => [k, remaining(P, k)]).sort((a, b) => b[1] / GROSS[b[0]] - a[1] / GROSS[a[0]]).forEach(([k, r]) =>
    gather.append(listRow(k,
      r === 0 ? "✓ done" : fmt(r) + " left of " + fmt(GROSS[k]), pctOf(P, k), r === 0)));
  [...D.order].reverse().filter((k) => GROSS[k] > 0).forEach((k) =>
    todo.append(listRow(k,
      P.craft[k] === 0 ? "✓ done" : num(P.craft[k]) + " to craft", pctOf(P, k), P.craft[k] === 0)));
}

$("steps").append(...STEP_SIZES.map((s) => {
  const b = btn(String(s), s === step ? "on" : "", () => {
    step = s;
    if (storageConsent && storageToggle.checked) storageSet(STORAGE_KEYS.step, String(s));
    [...$("steps").children].forEach((c) => c.classList.toggle("on", c === b));
    render();
  }); return b;
}));
$("reset").onclick = () => { if (confirm("Reset every count to 0?")) send({ action: "reset" }); };

function downloadBlob(content, type, filename) {
  const file = new Blob([content], { type });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export-json").onclick = () => {
  downloadBlob(JSON.stringify(inv, null, 2), "application/json", "beeprint-inventory.json");
  status("Inventory exported.", "ok");
};
const requirementsDialog = $("requirements-dialog");
const requirementsPreview = $("requirements-text");
const requirementsNumberFormat = $("requirements-number-format");
function buildRequirementsText() {
  const formatCount = (value) => {
    if (requirementsNumberFormat.value === "exact") return num(value);
    const units = [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
    for (const [size, label] of units) {
      if (value >= size) {
        const amount = (value / size).toFixed(2).replace(/\.?0+$/, "");
        return amount + " " + label;
      }
    }
    return num(value);
  };
  const ownedItems = Object.keys(D.items).filter((k) => inv[k] > 0);
  const P = plan(inv);
  const gatherItems = RAWKEYS
    .filter((k) => GROSS[k] > 0 && remaining(P, k) > 0)
    .sort((a, b) => remaining(P, b) / GROSS[b] - remaining(P, a) / GROSS[a]);
  const craftItems = [...D.order].reverse().filter((k) => GROSS[k] > 0 && P.craft[k] > 0);
  const lines = [
    "BeePrint - Inventory & Requirements",
    "Goals: " + sel.map((g) => D.goals[g].name).join(", "),
    "",
    "OWNED INVENTORY",
    ...(ownedItems.length ? ownedItems.map((k) => "- " + D.items[k].name + ": " + formatCount(inv[k])) : ["- No items recorded"]),
    "",
    "REQUIREMENTS BY GOAL (before counting owned inventory)",
  ];
  for (const g of sel) {
    const goalPlan = plan({}, [g]);
    const goalRaw = RAWKEYS.filter((k) => goalPlan.demand[k] > 0);
    const goalCraft = [...D.order].reverse().filter((k) => goalPlan.craft[k] > 0);
    lines.push("", D.goals[g].name + ":");
    lines.push("  Gather:");
    lines.push(...(goalRaw.length ? goalRaw.map((k) => "  - " + D.items[k].name + ": " + formatCount(goalPlan.demand[k])) : ["  - None"]));
    lines.push("  Craft:");
    lines.push(...(goalCraft.length ? goalCraft.map((k) => "  - " + D.items[k].name + ": " + formatCount(goalPlan.craft[k])) : ["  - None"]));
  }
  lines.push(
    "",
    "REMAINING TOTALS (shared inventory counted across all selected goals)",
    "Still to gather:",
    ...(gatherItems.length ? gatherItems.map((k) => "- " + D.items[k].name + ": " + formatCount(remaining(P, k))) : ["- None"]),
    "Still to craft:",
    ...(craftItems.length ? craftItems.map((k) => "- " + D.items[k].name + ": " + formatCount(P.craft[k])) : ["- None"]),
  );
  return lines.join("\n") + "\n";
}
$("export-requirements").onclick = () => {
  requirementsPreview.textContent = buildRequirementsText();
  requirementsDialog.showModal();
};
requirementsNumberFormat.addEventListener("change", () => {
  requirementsPreview.textContent = buildRequirementsText();
});
$("requirements-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(requirementsPreview.textContent);
    status("Inventory and requirements copied.", "ok");
  } catch {
    status("Could not copy the text. Your browser may require a secure connection.", "error");
  }
};
$("requirements-download").onclick = () => {
  downloadBlob(requirementsPreview.textContent, "text/plain;charset=utf-8", "beeprint-inventory-and-requirements.txt");
  status("Inventory and requirements downloaded.", "ok");
};
$("requirements-close").onclick = () => requirementsDialog.close();
const importFile = $("import-file");
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
$("import-json").onclick = () => importFile.click();
importFile.onchange = async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    status("That JSON file is too large. Choose a file under 2 MB.", "error");
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const inventory = parsed?.inventory ?? parsed;
    const validation = validateInventory(ITEM_KEYS, inventory);
    if (!validation.ok) {
      status(validation.error, "error");
      return;
    }
    if (!confirm("Replace all counts with the selected JSON inventory?")) return;
    await send({ action: "import", inventory });
  } catch {
    status("Could not read that inventory JSON file.", "error");
  }
};
if (typeof ResizeObserver === "function") {
  new ResizeObserver(scheduleDrawEdges).observe($("graph"));
}
buildChips();

render(!savedGraphView);
status(storageToggle.checked ? "Saved in browser storage" : "Browser storage saving is off", "ok");
