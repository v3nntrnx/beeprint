import {
  BLENDER_CRAFT_MINUTES,
  MAX_INVENTORY_COUNT,
  compactNumber,
  consumeGoalMaterials,
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
  purchasedGoals: "bssPlannerPurchasedGoals",
  hiddenCraftItems: "bssPlannerHiddenCraftItems",
  collapsedShops: "bssPlannerCollapsedShops",
  sidebarWidth: "bssPlannerSidebarWidth",
  graphView: "bssPlannerGraphView",
  step: "bssPlannerStep",
  consent: "bssPlannerStorageConsent",
};
const PROGRESS_STORAGE_KEYS = [
  STORAGE_KEYS.inventory,
  STORAGE_KEYS.goals,
  STORAGE_KEYS.purchasedGoals,
  STORAGE_KEYS.hiddenCraftItems,
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
let purchasedGoals = new Set();
if (storageConsent) {
  const savedPurchasedGoals = readStoredJson(STORAGE_KEYS.purchasedGoals, []);
  if (Array.isArray(savedPurchasedGoals)) {
    purchasedGoals = new Set(savedPurchasedGoals.filter((goal) =>
      typeof goal === "string" && Object.hasOwn(D.goals, goal)));
  }
}
const collapsedGoalShops = new Set();
if (storageConsent) {
  const savedShops = readStoredJson(COLLAPSED_SHOPS_STORAGE_KEY, []);
  if (Array.isArray(savedShops)) savedShops.filter((shop) => typeof shop === "string").forEach((shop) => collapsedGoalShops.add(shop));
}
let inv = {}, step = 10, busy = false;
const savedHiddenCraftItems = storageConsent ? readStoredJson(STORAGE_KEYS.hiddenCraftItems, []) : [];
let hiddenCraftItems = new Set(
  Array.isArray(savedHiddenCraftItems) ? savedHiddenCraftItems.filter((key) => D.recipes[key]) : [],
);
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
  storageSet(STORAGE_KEYS.purchasedGoals, JSON.stringify([...purchasedGoals]));
  storageSet(STORAGE_KEYS.hiddenCraftItems, JSON.stringify([...hiddenCraftItems]));
  storageSet(STORAGE_KEYS.step, String(step));
  storageSet(SIDEBAR_WIDTH_STORAGE_KEY, getComputedStyle(app).getPropertyValue("--sidebar-width").trim());
  return saved;
}

inv = loadInventory();
storageToggle.checked = storageConsent;
const ticketBalance = $("ticket-balance");
ticketBalance.value = num(inv.tickets || 0);
ticketBalance.onfocus = () => ticketBalance.select();
ticketBalance.onchange = () => {
  const amount = parse(ticketBalance.value);
  if (amount == null) {
    status("Enter a whole number of tickets.", "error");
    render();
    return;
  }
  send({ item: "tickets", action: "set", amount });
};
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
  const savedPurchasedGoals = readStoredJson(STORAGE_KEYS.purchasedGoals, []);
  if (Array.isArray(savedPurchasedGoals)) {
    purchasedGoals = new Set(savedPurchasedGoals.filter((goal) =>
      typeof goal === "string" && Object.hasOwn(D.goals, goal)));
  }
  const savedHiddenItems = readStoredJson(STORAGE_KEYS.hiddenCraftItems, []);
  if (Array.isArray(savedHiddenItems)) {
    hiddenCraftItems = new Set(savedHiddenItems.filter((key) => D.recipes[key]));
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
const progressionGuideDialog = $("progression-guide-dialog");
const progressionGuideFrame = $("progression-guide-frame");
$("progression-guide-open").addEventListener("click", () => {
  if (!progressionGuideFrame.hasAttribute("src")) {
    progressionGuideFrame.src = progressionGuideFrame.dataset.src;
  }
  progressionGuideDialog.showModal();
});
$("progression-guide-close").addEventListener("click", () => progressionGuideDialog.close());
$("progression-guide-close-footer").addEventListener("click", () => progressionGuideDialog.close());
const itemGuideDialog = $("item-guide-dialog");
$("item-guide-close").addEventListener("click", () => itemGuideDialog.close());
$("item-guide-close-footer").addEventListener("click", () => itemGuideDialog.close());
if (!storageConsent && !storageDeclined) storageDialog.showModal();
function openCraftDialog(item, max) {
  const dialog = $("craft-dialog"), amount = $("craft-amount");
  const decrement = $("craft-sub"), increment = $("craft-add"), confirmButton = $("craft-confirm");
  const timeEstimate = $("craft-time-estimate");
  $("craft-dialog-item").textContent = D.items[item].name;
  const itemIcon = ico(D.items[item].icon, item); itemIcon.id = "craft-item-icon"; itemIcon.classList.add("craft-item-icon");
  $("craft-item-icon").replaceWith(itemIcon);
  $("craft-limit").textContent = "Ready to blend: " + fmt(max);
  $("craft-max").textContent = "Max " + fmt(max);
  $("craft-max").disabled = max <= 0;
  amount.value = "1";
  const updateSteppers = () => {
    const quantity = parse(amount.value);
    const valid = max > 0 && quantity != null && quantity >= 1 && quantity <= max;
    decrement.disabled = quantity == null || quantity <= 1;
    increment.disabled = quantity == null || quantity >= max;
    $("craft-max").disabled = max <= 0;
    confirmButton.disabled = !valid;
    confirmButton.textContent = valid ? "Blend " + fmt(quantity) : "Blend";
    timeEstimate.textContent = valid
      ? "Blender time: " + formatCraftingTime(quantity * BLENDER_CRAFT_MINUTES)
      : "";
    timeEstimate.hidden = !valid;
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
  return makePlan(D, have, goals, { gatherOnly: hiddenCraftItems });
}
function totalCraftingMinutes(P) {
  return totalCraftingMinutesFor(D, P);
}
function gatherKeys() {
  return [...new Set([...RAWKEYS, ...hiddenCraftItems])];
}
let GROSS = plan({}).demand;
let GOAL_GROSS = Object.fromEntries(Object.keys(D.goals).map((goal) => [goal, plan({}, [goal])]));
function refreshGross() {
  GROSS = plan({}).demand;
  GOAL_GROSS = Object.fromEntries(Object.keys(D.goals).map((goal) => [goal, plan({}, [goal])]));
}

function remaining(P, k) {
  return remainingFor(D, P, inv, k);
}
const pctOf = (P, k) => percentComplete(GROSS, D, P, inv, k);
function countedItemName(key, amount) {
  const name = D.items[key].name;
  if (amount === 1 && (key === "tickets" || key === "gumdrops" || key === "stingers")) return name.slice(0, -1);
  return name;
}

const ROYAL_JELLY_HONEY_MAX_PRICE = 1_000_000;
const ROYAL_JELLY_HONEY_START_PRICE = 250_000;
const ROYAL_JELLY_HONEY_PRICE_STEP = 10_000;

async function send(body) {
  if (busy) return;
  busy = true;
  const { item, action } = body ?? {}, amount = body?.amount ?? 1;
  let message = "";
  if (action === "reset") {
    inv = emptyInventory(); purchasedGoals.clear(); message = "Everything reset to 0";
  } else if (action === "import") {
    const incoming = body?.inventory;
    const validation = validateInventory(ITEM_KEYS, incoming);
    if (!validation.ok) {
      status(validation.error, "error"); busy = false; return;
    }
    inv = normalizeInventory(incoming); purchasedGoals.clear(); message = "Inventory imported";
  } else {
    const validItem = typeof item === "string"
      && (action === "purchaseGoal" ? Object.hasOwn(D.goals, item) : Object.hasOwn(D.items, item));
    if (!validItem) {
      status("Invalid item", "error"); busy = false; return;
    }
    if (!["add", "sub", "set", "craft", "buy", "buyHoney", "purchaseGoal"].includes(action)) {
      status("Invalid action", "error"); busy = false; return;
    }
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_INVENTORY_COUNT) {
      status("Invalid amount", "error"); busy = false; return;
    }
    const label = action === "purchaseGoal" ? D.goals[item].name : D.items[item].name;
    if (action === "purchaseGoal") {
      if (amount !== 1) {
        status("A goal can only be purchased one at a time.", "error"); busy = false; return;
      }
      const updatedInventory = consumeGoalMaterials(D, inv, item, { gatherOnly: hiddenCraftItems });
      if (!updatedInventory) {
        status("Gather all required ingredients before purchasing " + label + ".", "error");
        busy = false;
        return;
      }
      inv = updatedInventory;
      purchasedGoals.add(item);
      sel = sel.filter((goal) => goal !== item);
      selectedFocusPath = [];
      refreshGross();
      buildChips();
      message = "Purchased " + label + " with the required ingredients";
    } else if (action === "craft") {
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
    } else if (action === "buy") {
      const purchase = D.purchases?.[item];
      if (!purchase || amount < 1) {
        status("That item can't be bought here.", "error"); busy = false; return;
      }
      const itemAmount = purchase.itemAmount * amount;
      const currencyAmount = purchase.currencyAmount * amount;
      if (!Number.isSafeInteger(itemAmount) || !Number.isSafeInteger(currencyAmount)
        || inv[item] > MAX_INVENTORY_COUNT - itemAmount) {
        status("That purchase exceeds the maximum inventory count.", "error"); busy = false; return;
      }
      if ((inv[purchase.currency] || 0) < currencyAmount) {
        status("Not enough " + D.items[purchase.currency].name + " (need " + fmt(currencyAmount)
          + ", have " + fmt(inv[purchase.currency] || 0) + ").", "error");
        busy = false; return;
      }
      inv[purchase.currency] -= currencyAmount;
      inv[item] += itemAmount;
      selectedFocusPath = [];
      message = "Bought " + fmt(itemAmount) + " " + countedItemName(item, itemAmount) + " for "
        + fmt(currencyAmount) + " " + countedItemName(purchase.currency, currencyAmount);
    } else if (action === "buyHoney") {
      if (item !== "royal_jellies" || amount < 1) {
        status("Honey purchases are only available for Royal Jelly.", "error"); busy = false; return;
      }
      const honeyCost = amount * ROYAL_JELLY_HONEY_MAX_PRICE;
      if (!Number.isSafeInteger(honeyCost) || inv[item] > MAX_INVENTORY_COUNT - amount) {
        status("That purchase exceeds the maximum inventory count.", "error"); busy = false; return;
      }
      if ((inv.honey || 0) < honeyCost) {
        status("Not enough Honey (need " + fmt(honeyCost) + ", have " + fmt(inv.honey || 0) + ").", "error");
        busy = false; return;
      }
      inv.honey -= honeyCost;
      inv[item] += amount;
      selectedFocusPath = [];
      message = "Bought " + fmt(amount) + " Royal Jelly for " + fmt(honeyCost) + " Honey (maximum-price estimate)";
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

function uiIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const paths = {
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a14 14 0 0 1-3.2 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10 10 0 0 0 3-.5"/>',
    buy: '<path d="M3 4h2l2.2 11h10.9l2-8H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  };
  svg.innerHTML = paths[name];
  return svg;
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

const WIKI_ITEM_PAGES = {
  coconuts: "Coconut",
  sunflower_seeds: "Sunflower Seed",
  pineapples: "Pineapple",
  strawberries: "Strawberry",
  blueberries: "Blueberry",
  royal_jellies: "Royal Jelly",
  magic_beans: "Magic Bean",
  honeysuckles: "Honeysuckle",
  neonberries: "Neonberry",
  bitterberries: "Bitterberry",
  stingers: "Stinger",
  spirit_petals: "Spirit Petal",
  refreshing_vials: "Refreshing Vial",
  satisfying_vials: "Satisfying Vial",
  motivating_vials: "Motivating Vial",
  oils: "Oil",
  enzymes: "Enzymes",
  red_extracts: "Red Extract",
  blue_extracts: "Blue Extract",
  tropical_drinks: "Tropical Drink",
  moon_charms: "Moon Charm",
  star_jellies: "Royal Jelly#Star_Jelly",
  soft_waxes: "Soft Wax",
  hard_waxes: "Hard Wax",
  caustic_waxes: "Caustic Wax",
  purple_potions: "Purple Potion",
  super_smoothies: "Super Smoothie",
  turpentines: "Turpentine",
  treats: "Treat",
  gold_eggs: "Egg#Gold_Egg",
  diamond_eggs: "Egg#Diamond_Egg",
  invigorating_vials: "Invigorating Vial",
  comforting_vials: "Comforting Vial",
  swirled_waxes: "Swirled Wax",
  jelly_beans: "Jelly Beans",
  cogs: "Cog",
  red_drives: "Drives#Red_Drive",
  blue_drives: "Drives#Blue_Drive",
  white_drives: "Drives#White_Drive",
  glitched_drives: "Drives#Glitched_Drive",
  cadet_badges: "Badges",
  hotshot_badges: "Badges",
  ace_badges: "Badges",
  master_badges: "Badges",
  grandmaster_badges: "Badges",
  riley_quests: "Riley Bee",
  bucko_quests: "Bucko Bee",
  gold_cog_amulets: "Cog Amulet",
  diamond_cog_amulets: "Cog Amulet",
  tickets: "Ticket",
};

const ITEM_OBTAINMENT_GUIDES = {
  honey: [
    "Convert pollen at your hive; some pollen can also be instantly converted.",
    "Honey also comes from quests, mobs, field tokens, Sparkles, Goo, the Ant Challenge, and Mythic Meteor Showers.",
  ],
  coconuts: [
    "Defeat Coconut Crab, farm Coconut Field, or grow sprouts there; the Coconut Dispenser also grants coconuts.",
    "Other sources include Armored Aphids, Memory Matches, planters, Puffshrooms, and Sticker Stack rewards.",
  ],
  magic_beans: [
    "Buy them for 20 tickets at the Magic Bean Shop, or earn them from Stick Bug Challenge, Wind Shrine, Memory Match, and quests.",
    "They can also drop from mobs, sprouts, planters, leaves, and field pollen.",
  ],
  sunflower_seeds: [
    "Collect them in Sunflower Field; leaves, Sparkles, and sprouts there can also yield seeds.",
    "Other sources include mobs, planters, Memory Matches, quests, and Sticker Stack rewards.",
  ],
  pineapples: [
    "Collect them in Pineapple Patch; using the Treat Dispenser also grants one.",
    "Ant Challenge, Memory Matches, quests, mobs, sprouts, planters, Sparkles, and Puffshrooms can also reward pineapples.",
  ],
  strawberries: [
    "Use the Strawberry Dispenser near Red HQ, or collect them in red fields such as Strawberry, Mushroom, Rose, and Pepper Patch.",
    "They can also drop from Ladybugs, Scorpions, King Beetle, sprouts, planters, Puffshrooms, and Memory Matches.",
  ],
  blueberries: [
    "Use the Blueberry Dispenser inside Blue HQ, or collect them in blue fields.",
    "Other sources include mobs, field leaves, sprouts, planters, Puffshrooms, Memory Matches, and quests.",
  ],
  tropical_drinks: [
    "Brown Bear and Black Bear quests can reward them; Coconut Crab drops them, with amounts based on defeat time.",
    "Other sources include Coconut Field sprouts, Memory Matches, Windy Bee, Armored Aphids, and fully grown planters harvested in Coconut Field.",
  ],
  stingers: [
    "Rogue Vicious Bee drops stingers; rare drops can also come from Aphids, Scorpions, and Spiders.",
    "Other sources include the Ticket Shop, quests, Memory Match, and planters.",
  ],
  oils: [
    "Boss drops include Tunnel Bear, Coconut Crab, Stump Snail, and Stick Bug; some other mobs can drop Oil too.",
    "Also awarded by Stick Bug and Robo Bear Challenges, Wind Shrine donations, Memory Matches, and quests.",
    "Oil can also drop in Sunflower Field and from sprouts or planters.",
  ],
  enzymes: [
    "Drops include Armored Aphid, King Beetle, Tunnel Bear, Coconut Crab, Stick Bug, and Stick Bug Challenge rewards.",
    "Also from Memory Matches, quests, Pineapple Patch, sprouts, and planters.",
  ],
  red_extracts: [
    "Other sources include Wind Shrine rewards, Mega or Extreme Memory Matches, Sticker Stack rewards, and quests.",
    "Rare drops can come from red-field mobs, sprouts, planters, and leaves.",
  ],
  blue_extracts: [
    "Other sources include Wind Shrine rewards, Mega or Extreme Memory Matches, bundles, and Sticker Stack rewards.",
    "Drops can come from blue-field mobs, sprouts, planters, and leaves.",
  ],
  gumdrops: [
    "Buy 3 at a time from the Gumdrop Shop for 1 ticket.",
    "Other sources include quests, Stick Bug Challenge rewards, planters, mobs, Puffshrooms, sprouts, and Memory Matches.",
  ],
  glue: [
    "Claim Glue from the Glue Dispenser in Gummy Bear's Lair; quests, Wind Shrine rewards, Memory Matches, and challenges can also give it.",
    "Drops include Spider, Werewolf, Puffshroom, King Beetle, Coconut Crab, and Stump Snail; planters and some fields can yield it too.",
  ],
  neonberries: [
    "Robo Bear Challenge commonly rewards them; drops can come from mobs, sprouts, planters, and Mythic Meteors.",
    "They can also be found in some fields, from Sparkles, quests, and Sticker Stack rewards.",
  ],
  bitterberries: [
    "Drops include Coconut Crab, Mondo Chick, Commando Chick, and other mobs; they can also come from fields, sprouts, and planters.",
    "Quests, Mythic Meteors, Cub Buddy, and Sticker Stack rewards can provide Bitterberries too.",
  ],
  royal_jellies: [
    "Buy from the Royal Jelly Shop for Honey: it starts at 250,000 and rises by 10,000 per jelly to a 1,000,000 cap.",
    "The Royal Jelly Dispenser also sells them for 6 tickets; quests, tokens, mobs, planters, Memory Matches, and other rewards can provide them too.",
  ],
  diamond_eggs: [
    "A guaranteed Diamond Egg token is past the Bear Gate, beneath Onett's platform.",
    "Buy one from the Ticket Tent for 400 tickets. Quests, Robo Bear Challenge, Extreme Memory Matches, mobs, sprouts, planters, and other rare rewards can also provide Diamond Eggs.",
  ],
  tickets: [
    "Earn them from badges and some bear quests, or buy them with Honey at the Ticket Shop.",
    "Other sources include the Wealth Clock, Memory Matches, planters, mobs, Mythic Meteors, Stockings, stickers, and codes.",
  ],
};

function wikiGuideUrl(itemKey, itemName, goal = false) {
  const [page, fragment] = goal ? [itemName, ""] : (WIKI_ITEM_PAGES[itemKey] || itemName).split("#");
  return "https://bee-swarm-simulator.fandom.com/wiki/"
    + encodeURIComponent(page.replace(/ /g, "_"))
    + (fragment ? "#" + fragment : "");
}

function openItemGuide(itemKey, goal = false) {
  const itemName = goal ? D.goals[itemKey].name : D.items[itemKey].name;
  const recipe = goal ? null : D.recipes[itemKey];
  const title = $("item-guide-title");
  const details = $("item-guide-details");
  const ways = $("item-guide-ways");
  const wikiLink = $("item-guide-wiki");
  title.textContent = itemName + (goal
    ? " — requirements"
    : recipe ? " — recipe and ways to obtain" : " — ways to obtain");
  details.replaceChildren();
  ways.replaceChildren();

  if (goal) {
    details.append(h("h3", "", "Requirements"));
    const costs = h("div", "goal-cost-list");
    for (const [key, quantity] of Object.entries(D.goals[itemKey].cost)) {
      const row = h("div", "goal-cost");
      row.append(ico(D.items[key].icon, key), h("span", "", D.items[key].name),
        h("b", "goal-cost-count", fmt(inv[key] || 0) + " / " + fmt(quantity)));
      costs.append(row);
    }
    details.append(costs);
  } else if (recipe) {
    details.append(h("h3", "", "Blender recipe"));
    const ingredients = h("div", "goal-cost-list");
    for (const [key, quantity] of Object.entries(recipe)) {
      const row = h("div", "goal-cost");
      row.append(ico(D.items[key].icon, key), h("span", "", D.items[key].name),
        h("b", "goal-cost-count", fmt(quantity) + " per craft · " + fmt(inv[key] || 0) + " owned"));
      ingredients.append(row);
    }
    details.append(ingredients);
  } else {
    details.append(h("p", "item-guide-no-recipe", "BeePrint has no Blender recipe listed for this item."));
  }

  const obtainment = goal
    ? (D.goalShops[itemKey] ? ["Purchase it from " + D.goalShops[itemKey] + " using the requirements shown above."] : [])
    : [
      ...(recipe ? ["Craft it at the Blender using the recipe shown above."] : []),
      ...(D.purchases?.[itemKey]
        ? ["Buy it from " + D.purchases[itemKey].shop + " using "
          + countedItemName(D.purchases[itemKey].currency, D.purchases[itemKey].currencyAmount) + "."]
        : []),
      ...(ITEM_OBTAINMENT_GUIDES[itemKey] || []),
    ];
  const guideItems = obtainment.length
    ? obtainment
    : ["See the Wiki guide for the currently listed ways to obtain this item."];
  for (const text of guideItems) ways.append(h("li", "", text));

  wikiLink.href = wikiGuideUrl(itemKey, itemName, goal);
  $("item-guide-dialog").showModal();
}

function openPurchaseDialog(item) {
  const purchase = D.purchases?.[item];
  if (!purchase) {
    status("That item can't be bought here.", "error");
    return;
  }
  const dialog = $("purchase-dialog"), quantityInput = $("purchase-quantity");
  const confirmButton = $("purchase-confirm"), total = $("purchase-summary");
  $("purchase-dialog-item").textContent = D.items[item].name;
  quantityInput.value = "1";
  const honeyOption = $("purchase-honey-option");
  const honeyRadio = $("purchase-payment-honey");
  const ticketRadio = $("purchase-payment-tickets");
  const honeyWarning = $("purchase-honey-warning");
  const honeyPurchaseAvailable = item === "royal_jellies";
  honeyOption.hidden = !honeyPurchaseAvailable;
  $("purchase-quantity-label").textContent = honeyPurchaseAvailable ? "Royal Jellies to buy" : "Shop bundles";
  $("purchase-sub").setAttribute("aria-label", honeyPurchaseAvailable ? "Decrease Royal Jelly amount" : "Decrease bundles");
  $("purchase-add").setAttribute("aria-label", honeyPurchaseAvailable ? "Increase Royal Jelly amount" : "Increase bundles");
  if (honeyPurchaseAvailable) {
    ticketRadio.checked = true;
    honeyRadio.checked = false;
    honeyWarning.textContent = "Warning: the Royal Jelly Shop price starts at "
      + fmt(ROYAL_JELLY_HONEY_START_PRICE) + " Honey and rises by " + fmt(ROYAL_JELLY_HONEY_PRICE_STEP)
      + " per purchase, up to " + fmt(ROYAL_JELLY_HONEY_MAX_PRICE)
      + ". This estimate uses the maximum price for every jelly. Check the current in-game price before buying.";
  }
  const selectedPurchase = () => honeyPurchaseAvailable && honeyRadio.checked
    ? {
      itemAmount: 1,
      currencyAmount: ROYAL_JELLY_HONEY_MAX_PRICE,
      currency: "honey",
      shop: "Royal Jelly Shop",
      action: "buyHoney",
    }
    : { ...purchase, action: "buy" };
  const updatePurchase = () => {
    const bundles = Number(quantityInput.value);
    const option = selectedPurchase();
    const itemAmount = option.itemAmount * bundles;
    const currencyAmount = option.currencyAmount * bundles;
    const valid = Number.isSafeInteger(bundles) && bundles > 0
      && Number.isSafeInteger(itemAmount) && Number.isSafeInteger(currencyAmount)
      && inv[item] <= MAX_INVENTORY_COUNT - itemAmount;
    const canAfford = valid && (inv[option.currency] || 0) >= currencyAmount;
    $("purchase-shop").textContent = "Available at " + option.shop;
    $("purchase-rate").textContent = (honeyPurchaseAvailable ? "Rate: " : "Each bundle: ")
      + fmt(option.itemAmount) + " " + countedItemName(item, option.itemAmount) + " for "
      + fmt(option.currencyAmount) + " " + countedItemName(option.currency, option.currencyAmount);
    total.textContent = "Total: " + (valid ? fmt(itemAmount) + " " + countedItemName(item, itemAmount) : "—")
      + " · Cost: " + (valid ? fmt(currencyAmount) + " " + countedItemName(option.currency, currencyAmount) : "—")
      + " · You have: " + fmt(inv[option.currency] || 0) + " " + D.items[option.currency].name;
    confirmButton.disabled = !canAfford;
    honeyWarning.hidden = !honeyPurchaseAvailable || !honeyRadio.checked;
    $("purchase-sub").disabled = !Number.isSafeInteger(bundles) || bundles <= 1;
  };
  ticketRadio.onchange = updatePurchase;
  honeyRadio.onchange = updatePurchase;
  $("purchase-sub").onclick = () => {
    const bundles = Number(quantityInput.value);
    quantityInput.value = String(Math.max(1, Number.isSafeInteger(bundles) ? bundles - 1 : 1));
    updatePurchase();
  };
  $("purchase-add").onclick = () => {
    const bundles = Number(quantityInput.value);
    quantityInput.value = String((Number.isSafeInteger(bundles) && bundles > 0 ? bundles : 1) + 1);
    updatePurchase();
  };
  quantityInput.oninput = updatePurchase;
  quantityInput.onkeydown = (event) => {
    if (event.key === "Enter" && !confirmButton.disabled) confirmButton.click();
  };
  $("purchase-cancel").onclick = () => dialog.close();
  confirmButton.onclick = () => {
    const bundles = Number(quantityInput.value);
    if (confirmButton.disabled || !Number.isSafeInteger(bundles)) return;
    const option = selectedPurchase();
    dialog.close();
    send({ item, action: option.action, amount: bundles });
  };
  updatePurchase();
  dialog.showModal();
  quantityInput.focus();
  quantityInput.select();
}

function makeNode(k, P) {
  const it = D.items[k], recipe = D.recipes[k];
  const own = inv[k] || 0, need = remaining(P, k), pct = pctOf(P, k);
  const canCraft = recipe ? Math.min(...Object.entries(recipe).map(([i, q]) => Math.floor((inv[i] || 0) / q))) : 0;
  const best = recipe ? Math.min(canCraft, Math.max(0, (P.demand[k] || 0) - own)) : 0;
  const n = h("div", "node" + (k === "red_extracts" ? " red" : k === "blue_extracts" ? " blue" : "") + (need === 0 ? " ok" : "") + (recipe ? " craft-card" : ""));
  n.id = "n-" + k;

  const hd = h("div", "nh"); hd.append(ico(it.icon, k), h("span", "", it.name)); n.append(hd);
  if (recipe) {
    const hideIngredients = hiddenCraftItems.has(k);
    const hideButton = btn("", "recipe-plan-toggle", () => {
      const hide = !hiddenCraftItems.has(k);
      if (hide) hiddenCraftItems.add(k);
      else hiddenCraftItems.delete(k);
      selectedFocusPath = [];
      refreshGross();
      if (storageConsent && storageToggle.checked) {
        storageSet(STORAGE_KEYS.hiddenCraftItems, JSON.stringify([...hiddenCraftItems]));
      }
      render(true);
      status(hide
        ? it.name + " will be planned as gather/buy-only."
        : it.name + " ingredients are included in the plan.", "ok");
    });
    hideButton.append(uiIcon(hideIngredients ? "eye-off" : "eye"));
    hideButton.setAttribute("aria-label", (hideIngredients ? "Show" : "Hide") + " " + it.name + " ingredients");
    hideButton.setAttribute("aria-pressed", String(hideIngredients));
    hideButton.title = hideIngredients ? "Show recipe ingredients" : "Hide recipe ingredients";
    n.append(hideButton);
  }

  const info = h("div", "recipe-info");
  const trigger = btn("?", "recipe-info-button", () => openItemGuide(k));
  trigger.setAttribute("aria-label", "More about " + it.name);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", "item-guide-dialog");
  info.append(trigger);
  n.append(info);

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
    const blend = btn("", "blend-open", () => openCraftDialog(k, best), best <= 0);
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
  const purchase = D.purchases?.[k];
  if (purchase) {
    const buy = btn("", "buy-item",
      () => openPurchaseDialog(k));
    buy.append(uiIcon("buy"));
    buy.setAttribute("aria-label", "Buy " + D.items[k].name);
    buy.title = "Buy " + D.items[k].name;
    own$.append(buy);
  }
  n.append(own$);
  if (purchase) {
    n.append(h("div", "purchase-hint", fmt(purchase.itemAmount) + " " + countedItemName(k, purchase.itemAmount)
      + " for " + fmt(purchase.currencyAmount) + " " + countedItemName(purchase.currency, purchase.currencyAmount)
      + " · " + purchase.shop));
  }

  n.append(h("div", "need " + (need === 0 ? "ok" : "todo"),
    need === 0 ? "✓ Covered" : (recipe && !hiddenCraftItems.has(k) ? "Craft " : "Gather ") + fmt(need) + " more"));
  n.append(h("div", "tiny", "of " + fmt(GROSS[k]) + " needed in total"));
  const bar = h("div", "bar"), fill = h("i"); fill.style.width = pct + "%"; bar.append(fill); n.append(bar);

  return n;
}

function goalPct(g) {
  return purchasedGoals.has(g) ? 0 : goalProgress(D, inv, g, GOAL_GROSS[g], { gatherOnly: hiddenCraftItems });
}

function makeGoal(g) {
  const v = D.goals[g], pct = goalPct(g), craftingMinutes = totalCraftingMinutes(plan(inv, [g]));
  const n = h("div", "node canister"); n.id = "n-goal-" + g;
  const hd = h("div", "nh"); hd.append(ico(v.icon, g), h("span", "", v.name)); n.append(hd);
  const info = btn("?", "goal-info", () => openItemGuide(g, true));
  info.setAttribute("aria-label", "More about " + v.name);
  info.setAttribute("aria-haspopup", "dialog");
  info.setAttribute("aria-controls", "item-guide-dialog");
  n.append(info);
  n.append(h("div", "pct", pct.toFixed(1) + "%"));
  n.append(h("div", "tiny", "Progress if this were your only goal"));
  if (craftingMinutes > 0) n.append(h("div", "goal-crafting-time", "Blender time: " + formatCraftingTime(craftingMinutes)));
  const bar = h("div", "bar"), fill = h("i"); fill.style.width = pct + "%"; bar.append(fill); n.append(bar);
  if (consumeGoalMaterials(D, inv, g, { gatherOnly: hiddenCraftItems })) {
    const purchase = btn("Purchase", "goal-purchase", () => send({ item: g, action: "purchaseGoal" }));
    purchase.setAttribute("aria-label", "Purchase " + v.name + " using the required ingredients");
    n.append(purchase);
  }
  return n;
}

// Column per depth: gather first, shop (goals) last, raw items sit just before their first consumer.
function layout() {
  const vis = Object.keys(GROSS).filter((k) => GROSS[k] > 0);
  const crafted = vis.filter((k) => D.recipes[k] && !hiddenCraftItems.has(k)), lc = {};
  const L = (k) => lc[k] ?? (lc[k] = 1 + Math.max(0, ...Object.keys(D.recipes[k])
    .filter((i) => D.recipes[i] && !hiddenCraftItems.has(i) && GROSS[i] > 0).map(L)));
  crafted.forEach(L);
  const goalL = Math.max(0, ...crafted.map(L)) + 1, lvl = {};
  crafted.forEach((k) => (lvl[k] = lc[k]));
  for (const k of vis.filter((x) => !D.recipes[x] || hiddenCraftItems.has(x))) {
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
    if (hiddenCraftItems.has(key)) continue;
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
    if (!hiddenCraftItems.has(item)) {
      for (const ingredient of Object.keys(D.recipes[item] || {})) addItem(ingredient);
    }
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
        if (allSelected) {
          sel = sel.filter((goal) => !categoryGoals.has(goal));
        } else {
          sel = [...new Set([...sel, ...categoryGoals])];
          for (const goal of categoryGoals) purchasedGoals.delete(goal);
        }
        if (storageConsent && storageToggle.checked) {
          storageSet(STORAGE_KEYS.goals, JSON.stringify(sel));
          storageSet(STORAGE_KEYS.purchasedGoals, JSON.stringify([...purchasedGoals]));
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
        if (!on) purchasedGoals.delete(g);
        if (storageConsent && storageToggle.checked) {
          storageSet(STORAGE_KEYS.goals, JSON.stringify(sel));
          storageSet(STORAGE_KEYS.purchasedGoals, JSON.stringify([...purchasedGoals]));
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
    if (root.startsWith("goal-")
      ? !sel.includes(root.slice(5))
      : !(GROSS[root] > 0)) selectedFocusPath = [];
    for (let index = 1; index < selectedFocusPath.length; index++) {
      const item = selectedFocusPath[index];
      if (!requiredNodeKeys(selectedFocusPath[index - 1]).has(item)
        || (!item.startsWith("goal-") && !(GROSS[item] > 0))) {
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
  if (document.activeElement !== ticketBalance) ticketBalance.value = num(inv.tickets || 0);
  const restoreSavedView = !autoFit && restoreGraphViewOnRender && savedGraphView;
  g.replaceChildren();
  const columns = [];
  for (let c = 0; c < N; c++) {
    const keys = Object.keys(D.items).filter((k) =>
      GROSS[k] > 0 && lvl[k] === c && (!required || required.has(k)));
    const col = h("div", "col");
    const appendSection = (label, nodes) => {
      if (!nodes.length) return;
      const section = h("div", "col-section");
      section.append(h("div", "colh", label), ...nodes);
      col.append(section);
    };
    appendSection("Gather", keys.filter((k) => !D.recipes[k] || hiddenCraftItems.has(k)).map((k) => makeNode(k, P)));
    appendSection("Blender", keys.filter((k) => D.recipes[k] && !hiddenCraftItems.has(k)).map((k) => makeNode(k, P)));
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
  if (!sel.length) {
    const empty = h("section", "empty-plan");
    empty.append(h("h2", "", "Choose an item to start your plan"),
      h("p", "", "Select one or more goals from the sidebar. Their required materials and crafting steps will appear here."));
    g.append(empty);
  }
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
  gatherKeys().filter((k) => GROSS[k] > 0).map((k) => [k, remaining(P, k)]).sort((a, b) => b[1] / GROSS[b[0]] - a[1] / GROSS[a[0]]).forEach(([k, r]) =>
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
  const rawItems = gatherKeys();
  const gatherItems = rawItems
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
    const goalRaw = rawItems.filter((k) => goalPlan.demand[k] > 0);
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
const TUTORIAL_KEY = "beePrintTutorialComplete";
const tutorialLayer = $("tutorial-layer"), tutorialCard = tutorialLayer.querySelector(".tutorial-card");
const tutorialSteps = [
  { selector: "#goal-btn-gummyballer", title: "Choose your goals", copy: "Pick the items you want to make or buy. Select more than one to combine their material requirements." },
  { selector: "#n-gumdrops", title: "Read a plan card", copy: "Cards show what you own, what you still need, and your progress. Select a card to focus on its ingredients." },
  { selector: ".graph-ticket-balance", title: "Track your tickets", copy: "Change your ticket amount here. BeePrint uses this balance when checking shop purchases." },
  { selector: "#n-swirled_waxes .recipe-plan-toggle", title: "Hide ingredients when needed", copy: "The eye button switches an item to gather-or-buy-only, so its recipe ingredients no longer expand into your plan." },
  { selector: "#n-gumdrops .buy-item", title: "Open the shop", copy: "Use the cart button to choose a number of bundles, review the total cost, and confirm a purchase." },
  { selector: ".lists .panel:first-child h2", title: "Track your progress", copy: "These lists summarize what remains to gather and craft across your selected goals." },
  { selector: "#export-requirements", title: "Take your plan with you", copy: "Export a readable inventory and requirements list whenever you need it. You can skip or finish the tour at any time." },
];
let tutorialStarted = false, tutorialIndex = 0, tutorialTarget = null, tutorialOriginalGoals = [];
function hasCompletedTutorial() {
  if (storageConsent && storageGet(TUTORIAL_KEY) === "yes") return true;
  try { return sessionStorage.getItem(TUTORIAL_KEY) === "yes"; } catch { return false; }
}
function rememberTutorialCompletion() {
  if (storageConsent && storageToggle.checked && storageSet(TUTORIAL_KEY, "yes")) return;
  try { sessionStorage.setItem(TUTORIAL_KEY, "yes"); } catch {}
}
function positionTutorial() {
  if (!tutorialTarget || tutorialLayer.hidden) return;
  const rect = tutorialTarget.getBoundingClientRect();
  const panelRect = tutorialCard.getBoundingClientRect();
  tutorialLayer.style.setProperty("--spot-x", rect.left + rect.width / 2 + "px");
  tutorialLayer.style.setProperty("--spot-y", rect.top + rect.height / 2 + "px");
  tutorialLayer.style.setProperty("--spot-width", Math.max(26, rect.width / 2 + 12) + "px");
  tutorialLayer.style.setProperty("--spot-height", Math.max(22, rect.height / 2 + 12) + "px");
  const gap = 14, margin = 16, centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
  const candidates = [
    { left: centerX - panelRect.width / 2, top: rect.bottom + gap },
    { left: centerX - panelRect.width / 2, top: rect.top - panelRect.height - gap },
    { left: rect.right + gap, top: centerY - panelRect.height / 2 },
    { left: rect.left - panelRect.width - gap, top: centerY - panelRect.height / 2 },
  ];
  const fits = candidates.find(({ left, top }) => left >= margin && top >= margin
    && left + panelRect.width <= innerWidth - margin && top + panelRect.height <= innerHeight - margin
    && (left + panelRect.width <= rect.left || left >= rect.right
      || top + panelRect.height <= rect.top || top >= rect.bottom));
  const placement = fits || {
    left: Math.max(margin, Math.min(innerWidth - panelRect.width - margin, centerX - panelRect.width / 2)),
    top: Math.max(margin, Math.min(innerHeight - panelRect.height - margin, rect.top - panelRect.height - gap)),
  };
  tutorialCard.style.left = placement.left + "px";
  tutorialCard.style.top = placement.top + "px";
}
function showTutorialStep() {
  if (tutorialTarget) tutorialTarget.classList.remove("tutorial-target");
  const stepInfo = tutorialSteps[tutorialIndex];
  const target = document.querySelector(stepInfo.selector);
  if (!target) {
    status("The tutorial could not find a page item. You can continue using BeePrint normally.", "error");
    finishTutorial();
    return;
  }
  tutorialTarget = target;
  tutorialTarget.classList.add("tutorial-target");
  $("tutorial-title").textContent = stepInfo.title;
  $("tutorial-copy").textContent = stepInfo.copy;
  $("tutorial-step-count").textContent = "Step " + (tutorialIndex + 1) + " of " + tutorialSteps.length;
  $("tutorial-back").disabled = tutorialIndex === 0;
  $("tutorial-next").textContent = tutorialIndex === tutorialSteps.length - 1 ? "Finish" : "Next";
  tutorialTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
  requestAnimationFrame(positionTutorial);
  setTimeout(positionTutorial, 160);
}
function startTutorial() {
  if (tutorialStarted || hasCompletedTutorial() || storageDialog.open) return;
  tutorialStarted = true;
  tutorialOriginalGoals = [...sel];
  sel = [...new Set([...sel, "gummyballer", "heat_treated_planter", "cobalt_guard"])];
  refreshGross();
  buildChips();
  render(true);
  app.inert = true;
  tutorialLayer.hidden = false;
  tutorialIndex = 0;
  showTutorialStep();
  $("tutorial-next").focus();
}
function finishTutorial() {
  if (!tutorialStarted) return;
  tutorialStarted = false;
  if (tutorialTarget) tutorialTarget.classList.remove("tutorial-target");
  tutorialTarget = null;
  tutorialLayer.hidden = true;
  app.inert = false;
  sel = tutorialOriginalGoals;
  if (storageConsent && storageToggle.checked) storageSet(STORAGE_KEYS.goals, JSON.stringify(sel));
  refreshGross();
  buildChips();
  render(true);
  rememberTutorialCompletion();
}
$("tutorial-skip").onclick = finishTutorial;
$("tutorial-back").onclick = () => {
  if (tutorialIndex > 0) {
    tutorialIndex--;
    showTutorialStep();
    $("tutorial-next").focus();
  }
};
$("tutorial-next").onclick = () => {
  if (tutorialIndex === tutorialSteps.length - 1) {
    finishTutorial();
    return;
  }
  tutorialIndex++;
  showTutorialStep();
  $("tutorial-next").focus();
};
tutorialCard.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    finishTutorial();
  } else if (event.key === "Tab") {
    const buttons = [...tutorialCard.querySelectorAll("button:not(:disabled)")];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
window.addEventListener("resize", positionTutorial);
if (storageDialog.open) {
  storageDialog.addEventListener("close", () => setTimeout(startTutorial, 0), { once: true });
} else {
  setTimeout(startTutorial, 0);
}
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
