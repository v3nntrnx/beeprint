import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { build as esbuild, transform as esbuildTransform } from "esbuild";

// Static build for GitHub Pages: inlines the catalog into index.html, bundles
// and minifies the client, and copies assets into dist/. No server is needed.

const root = process.cwd();
const dist = join(root, "dist");
const craftingDir = join(root, "crafting");
const iconDir = join(root, "assets", "img", "icons");

const fail = (message) => {
  throw new Error("Build failed: " + message);
};

const catalog = JSON.parse(readFileSync(join(root, "items.json"), "utf8"));
if (!catalog || typeof catalog !== "object") fail("items.json must contain an object.");
if (!catalog.items || typeof catalog.items !== "object") fail("items.json is missing items.");
if (!catalog.goals || typeof catalog.goals !== "object") fail("items.json is missing goals.");
if (!catalog.goalShops || typeof catalog.goalShops !== "object") fail("items.json is missing goalShops.");

const { items, goals: goalCatalog, goalShops } = catalog;
const itemKeys = Object.keys(items);
const itemKeySet = new Set(itemKeys);

for (const [key, item] of Object.entries(items)) {
  if (!item || typeof item.name !== "string" || !item.name.trim()) fail("item " + key + " needs a name.");
  if (typeof item.icon !== "string") fail("item " + key + " needs an icon fallback.");
}

const quotes = readFileSync(join(root, "quotes.txt"), "utf8")
  .split(/\r?\n/)
  .map((quote) => quote.trim())
  .filter(Boolean);
if (!quotes.length) fail("quotes.txt must contain at least one non-empty quote.");

const recipes = {};
const goals = {};
const validatePrice = (key, price) => {
  if (!price || typeof price !== "object" || Array.isArray(price)) fail(key + " needs a price object.");
  for (const [ingredient, quantity] of Object.entries(price)) {
    if (!itemKeySet.has(ingredient)) fail(key + " uses unknown item " + ingredient + ".");
    if (!Number.isSafeInteger(quantity) || quantity <= 0) fail(key + " has an invalid quantity for " + ingredient + ".");
  }
};

for (const file of readdirSync(craftingDir).filter((name) => name.endsWith(".json")).sort()) {
  const key = file.slice(0, -5);
  const { price } = JSON.parse(readFileSync(join(craftingDir, file), "utf8"));
  validatePrice(file, price);
  if (itemKeySet.has(key)) recipes[key] = price;
  else if (Object.hasOwn(goalCatalog, key)) goals[key] = { ...goalCatalog[key], cost: price };
  else fail(file + " does not match an item or goal.");
}

for (const [key, goal] of Object.entries(goals)) {
  if (!goal || typeof goal.name !== "string" || !goal.name.trim()) fail("goal " + key + " needs a name.");
  if (typeof goal.icon !== "string") fail("goal " + key + " needs an icon fallback.");
}

// Crafted items, parents before ingredients (needed for the net-requirement pass).
const order = [];
{
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const ingredient of Object.keys(recipes[key] ?? {})) visit(ingredient);
    if (recipes[key]) order.push(key);
  };
  Object.keys(recipes).forEach(visit);
  order.reverse();
}

// Resolve icon extensions once at build time. This removes the old
// webp-then-png 404 fallback from the browser.
const iconRank = { webp: 2, png: 1 };
const iconExtensions = {};
for (const file of readdirSync(iconDir)) {
  const extension = extname(file).slice(1).toLowerCase();
  if (!iconRank[extension]) continue;
  const key = file.slice(0, -(extension.length + 1));
  if (!iconExtensions[key] || iconRank[extension] > iconRank[iconExtensions[key]]) {
    iconExtensions[key] = extension;
  }
}

const rawItems = itemKeys.filter((key) => !recipes[key]);
const initialInventory = Object.fromEntries(itemKeys.map((key) => [key, 0]));
const data = {
  items,
  recipes,
  goals,
  goalShops,
  order,
  rawItems,
  initialInventory,
  iconExtensions,
  quotes,
};

const html = readFileSync(join(root, "index.html"), "utf8");
const placeholder = "__DATA__";
if (html.split(placeholder).length !== 2) fail("index.html must contain exactly one __DATA__ placeholder.");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, "assets"), join(dist, "assets"), { recursive: true });
// Sass sources are build inputs, not something the deployed site needs.
rmSync(join(dist, "assets", "css", "styles.scss"), { force: true });

// Bundle app.js and core.js into one minified ES module.
await esbuild({
  entryPoints: [join(root, "assets", "scripts", "app.js")],
  outfile: join(dist, "assets", "scripts", "app.js"),
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  legalComments: "none",
});
rmSync(join(dist, "assets", "scripts", "core.js"));

const cssPath = join(dist, "assets", "css", "styles.css");
const css = readFileSync(cssPath, "utf8");
const minifiedCss = await esbuildTransform(css, {
  loader: "css",
  minify: true,
  legalComments: "none",
});
writeFileSync(cssPath, minifiedCss.code);

const appPath = join(dist, "assets", "scripts", "app.js");
const app = readFileSync(appPath, "utf8");
const version = createHash("sha256").update(app).update(minifiedCss.code).digest("hex").slice(0, 10);
const page = html
  .replace(placeholder, JSON.stringify(data).replace(/</g, "\\u003c"))
  .replace('href="assets/css/styles.css"', 'href="assets/css/styles.css?v=' + version + '"')
  .replace('src="assets/scripts/app.js"', 'src="assets/scripts/app.js?v=' + version + '"');
writeFileSync(join(dist, "index.html"), page);
writeFileSync(join(dist, ".nojekyll"), "");
writeFileSync(join(dist, "robots.txt"), "User-agent: *\nAllow: /\n");

console.log(
  "Built " +
    itemKeys.length +
    " items, " +
    Object.keys(recipes).length +
    " recipes, " +
    Object.keys(goals).length +
    " goals, " +
    Object.keys(iconExtensions).length +
    " icons (v" +
    version +
    ") -> dist/",
);
