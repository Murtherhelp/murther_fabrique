/**
 * Editor.
 *
 * Three regions, deliberately separate:
 *   1. OUTLINE   — what exists (pages, sections). Structure only.
 *   2. PREVIEW   — the real generated page, built by build() exactly as exported.
 *   3. INSPECTOR — the properties of whatever is selected.
 *
 * One funnel: every mutation goes through commit(). It snapshots for undo,
 * re-renders, and schedules the autosave. Nothing else writes to the document,
 * so undo can never miss a change.
 *
 * Language: the interface language (ui.lang) and the site language
 * (doc.meta.lang / meta.bilingual) are different things and never touch each
 * other. Switching the interface re-labels controls via paintLabels() — it
 * rebuilds nothing that holds a value, so the caret never jumps.
 */
import { t, tf, applyLang, applyScale, initLang, setLang, ui, T } from "./i18n.js";
import { esc, slugify, uid, safeHref } from "./safe.js";
import { BLOCKS, BLOCK_ORDER, makeBlock, blockName, blockTypeLabel, bi, T as bT } from "./blocks.js";
import { build, pagePath, docWarnings } from "./build.js";
import { TEMPLATES, TEMPLATE_ORDER, fromTemplate } from "./templates.js";
import { blankDoc, newPage, normalizeDoc, createHistory, storeSaved, loadStored, readAsset, LIMITS } from "./store.js";
import { PALETTES, TONES, paletteOf, contrastChecks, sanitizeCss, resolve } from "./themes.js";
import { zip, toEntries, download, decodeDataUri } from "./zip.js";
import { PREVIEW_GUARD } from "./preview-inline.js";

const $ = (id) => document.getElementById(id);

/**
 * Build an element.
 *
 * Reflected IDL properties (className, value, checked, htmlFor, tabIndex, …)
 * are assigned directly; everything else goes through setAttribute.
 *
 * A plain `Object.assign(node, attrs)` assigns `aria-label` as a JavaScript
 * expando and never writes the attribute — silently, with no error. That one
 * line cost this editor its accessible names on every generated control, its
 * `aria-current` selection highlight, and the whole of paintLabels(), which
 * looks up `[data-lbl]`/`[data-tpl]`/`[data-blk]`: with no such attribute in
 * the DOM it matched nothing, so switching the interface language left the
 * inspector and the template picker in the previous language.
 */
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const k of [].concat(kids)) if (k != null) n.append(k);
  return n;
};
const on = (node, ev, fn, opts) => node.addEventListener(ev, fn, opts);

/* ---------------------------------------------------------------- state */

const S = {
  history: createHistory(blankDoc()),
  pageId: null,
  blockId: null,
  contentLang: "en", // which language the inspector edits when the site is bilingual
  device: 1280,
  previewPage: null,
  previewLang: "en",
  saveTimer: 0
};

const doc = () => S.history.current;
const page = (id = S.pageId) => doc().pages.find((p) => p.id === id) || doc().pages[0];

/** Unique file name among the other pages. */
function uniqueSlug(want, exceptId) {
  const taken = new Set(doc().pages.filter((p) => p.id !== exceptId).map((p) => p.slug));
  let s = slugify(want) || "page";
  if (s === "index" && exceptId !== doc().pages[0]?.id) s = "home";
  let i = 2;
  while (taken.has(s)) s = `${slugify(want) || "page"}-${i++}`;
  return s;
}

/* --------------------------------------------------------------- commit */

/**
 * The only way to change the document. `push:false` records no undo step, used
 * for live typing (debounced separately) and for undo/redo themselves.
 */
function commit(next, { push = true, select } = {}) {
  if (push) S.history.push(next);
  else S.history.reset(next);
  if (select) {
    S.pageId = select.pageId ?? S.pageId;
    S.blockId = select.blockId ?? null;
  }
  scheduleSave();
  renderAll();
}

const edit = (fn) => {
  // structuredClone: the document is plain data, and cloning is how the undo
  // snapshot stays independent of the live object.
  const next = structuredClone(doc());
  fn(next);
  return next;
};

function scheduleSave() {
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    if (!storeSaved(doc())) say(t("storageBlocked"), "ko");
  }, 700);
}

let sayTimer = 0;
function say(msg, kind = "") {
  const n = $("live");
  n.textContent = msg;
  n.className = `status ${kind ? `status--${kind}` : ""}`;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => (n.textContent = ""), 4000);
}

/* ------------------------------------------------------------- rendering */

/**
 * Re-label static copy without rebuilding anything that holds a value.
 *
 * The argument is an optional scope element. It is also wired to the
 * `wgn:lang` event, which passes the Event object — not an element — as its
 * first argument, hence the type check.
 *
* `[data-lbl]` carries an interface-dictionary key. `[data-at]` carries a
 * `type.fieldKey` pointer into the block registry. Inspector controls need the
 * second pass because their labels live in the component registry, not in the
 * interface dictionary, and both have to follow the switch.
 */
function paintLabels(root) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  for (const n of scope.querySelectorAll("[data-lbl]")) n.textContent = t(n.dataset.lbl);
  for (const n of scope.querySelectorAll("[data-at]")) n.textContent = registryLabel(n.dataset.at);
  for (const n of scope.querySelectorAll("[data-tpl]")) {
    const tuple = TEMPLATES[n.dataset.tpl]?.[n.dataset.part];
    if (tuple) n.textContent = tuple[ui.lang === "fr" ? 1 : 0] || tuple[0];
  }
  for (const n of scope.querySelectorAll("[data-blk]")) {
    const type = n.dataset.blk;
    const tuple = BLOCKS[type]?.[n.dataset.part || "label"];
    if (tuple) n.textContent = tuple[ui.lang === "fr" ? 1 : 0] || tuple[0];
  }
}

/** Resolve `type.fieldKey` to its label in the active language. */
function registryLabel(at) {
  const [type, ...rest] = String(at || "").split(".");
  const key = rest.join(".");
  const def = BLOCKS[type];
  if (!def) return at;
  if (key) {
    const f = (def.fields || []).find((x) => x.k === key);
    if (f) return f.lbl[ui.lang === "fr" ? 1 : 0] || f.lbl[0];
    for (const top of def.fields || []) {
      const sub = (top.of || []).find((x) => x.k === key);
      if (sub) return sub.lbl[ui.lang === "fr" ? 1 : 0] || sub.lbl[0];
    }
  }
  return def.label?.[ui.lang === "fr" ? 1 : 0] || def.label?.[0] || at;
}

/* ---------- outline ---------- */

function renderOutline() {
  // Reconcile the selection BEFORE building the tree. Doing it afterwards left
  // a freshly opened project with every page collapsed, because nothing was
  // selected yet at the moment `open` was decided.
  if (!doc().pages.some((p) => p.id === S.pageId)) S.pageId = doc().pages[0]?.id ?? null;

  const tree = $("pageTree");
  tree.replaceChildren();
  $("outlineEmpty").hidden = doc().pages.length > 0;

  doc().pages.forEach((p, i) => {
    const open = p.id === S.pageId;
    const det = el("details", { className: "page", open });
    const sum = el("summary", {}, [
      el("span", { className: "page__name" }, bT(p.title, doc().meta.lang) || p.slug),
      i === 0 ? el("span", { className: "badge", "data-lbl": "homeBadge" }, t("homeBadge")) : null,
      el("span", { className: "page__count" }, String(p.blocks.length))
    ]);
    on(sum, "click", () => {
      // Only re-render when the selection actually moves — the rebuild opens the
      // selected page. This handler used to preventDefault unconditionally,
      // which cancelled the browser's own <details> toggle and left the ▸/▾
      // marker a decoration that could never fold a page away. Once the page is
      // already selected there is nothing to re-render, so the click is left to
      // the browser and the disclosure works.
      if (S.pageId !== p.id || S.blockId !== null) {
        S.pageId = p.id;
        S.blockId = null;
        renderAll();
      }
    });
    det.append(sum);

    const list = el("ul", { className: "blocks" });
    if (!p.blocks.length) list.append(el("li", { className: "empty", "data-lbl": "blockNone" }, t("blockNone")));

    p.blocks.forEach((b, bi2) => {
      const type = BLOCKS[b.type];
      const li = el("li", {
        className: "node",
        draggable: true,
        tabIndex: 0,
        role: "button",
        // The visible text is the block's own title, which is usually empty for
        // a freshly inserted block — so the type name is named explicitly and
        // the row reads as "Hero section" rather than an empty button.
        "aria-label": `${blockTypeLabel(b.type, doc().meta.lang)}: ${blockName(b, doc().meta.lang)}`,
        "aria-current": String(b.id === S.blockId)
      }, [
        el("span", { className: "node__grip", "aria-hidden": true }, "⠿"),
        el("span", { className: "node__label" }, blockName(b, doc().meta.lang)),
        el("span", { className: "node__type" }, blockTypeLabel(b.type, doc().meta.lang))
      ]);

      on(li, "click", () => {
        S.pageId = p.id;
        S.blockId = b.id;
        renderAll();
      });
      on(li, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          S.pageId = p.id;
          S.blockId = b.id;
          renderAll();
        }
      });
      wireDrag(li, () => p.blocks, bi2, (from, to) =>
        commit(edit((d) => moveIn(d, p.id, from, to)), { select: { pageId: p.id, blockId: null } })
      );
      list.append(li);
    });

    det.append(list);
    tree.append(det);
  });
}

/** Shared drag-to-reorder for pages and sections. */
function wireDrag(node, getArr, index, onDrop) {
  on(node, "dragstart", (e) => {
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  });
  on(node, "dragend", () => {
    node.classList.remove("dragging");
    for (const n of node.parentElement.children) n.classList.remove("drop-before", "drop-after");
  });
  on(node, "dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = node.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    node.classList.toggle("drop-after", after);
    node.classList.toggle("drop-before", !after);
  });
  on(node, "dragleave", () => node.classList.remove("drop-before", "drop-after"));
  on(node, "drop", (e) => {
    e.preventDefault();
    const after = node.classList.contains("drop-after");
    node.classList.remove("drop-before", "drop-after");
    const from = Number(e.dataTransfer.getData("text/plain"));
    if (!Number.isInteger(from) || from === index) return;
    // Dropping on the later half of the node means "after" it, which shifts
    // the target index once the item is removed from its old slot.
    let to = after ? index + 1 : index;
    if (from < to) to -= 1;
    onDrop(from, to);
  });
}

function moveIn(d, pageId, from, to) {
  const arr = d.pages.find((p) => p.id === pageId)?.blocks;
  if (!arr) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

/* ---------- inspector: fields are generated from the block spec ---------- */

function labelFor(f) {
  return f.lbl[ui.lang === "fr" ? 1 : 0] || f.lbl[0];
}

/**
 * A labelled control.
 *
 * `at` locates the label in the block registry as `type.fieldKey`. Carrying it
 * on the element is what lets paintLabels() re-translate inspector controls on
 * a language switch without rebuilding them — rebuilding would move the caret
 * and discard in-progress edits.
 *
 * Block labels live in the registry as tuples, not in the interface dictionary,
 * so they are resolved through the registry rather than through t().
 */
/**
 * A labelled control.
 *
 * The label is a real <label for>, not a <span>: that is what gives the input
 * its accessible name. A visible <span> sitting next to an input names nothing
 * to a screen reader, so every generated field would be announced bare.
 *
 * `at` locates the label in the block registry as `type.fieldKey`. Carrying it
 * on the element is what lets paintLabels() re-translate inspector controls on
 * a language switch without rebuilding them — rebuilding would move the caret
 * and discard in-progress edits.
 */
function field(labelText, control, hintKey, at, lblKey) {
  let id = control.id;
  if (!id) {
    id = `f${fieldSeq++}`;
    control.id = id;
  }
  const label = el("label", { className: "field__label", htmlFor: id }, labelText);
  if (at) label.dataset.at = at;
  if (lblKey) label.dataset.lbl = lblKey;
  const f = el("div", { className: "field" }, [label, control]);
  if (hintKey) {
    const hintId = `${id}-hint`;
    f.append(el("span", { className: "hint", id: hintId, "data-lbl": hintKey }, t(hintKey)));
    control.setAttribute("aria-describedby", hintId);
  }
  return f;
}
let fieldSeq = 0;

/*
 * `autocomplete="off"` and `autocapitalize="off"` are not cosmetic here. The
 * enclosing form carries autocomplete="off", but browsers ignore that on a
 * small share of fields, and a browser autofilling "Atelier Lumen" into a page
 * title would corrupt the document silently. Set per control.
 */
function textInput(value, onChange, { multiline = false, rows = 4, type = "text" } = {}) {
  const n = multiline ? el("textarea", { spellcheck: false }) : el("input", { type });
  n.setAttribute("autocomplete", "off");
  n.setAttribute("autocapitalize", "off");
  n.setAttribute("autocorrect", "off");
  if (multiline) {
    n.rows = rows;
    n.value = value ?? "";
  } else n.value = value ?? "";
  n.addEventListener("input", () => onChange(n.value));
  return n;
}

function boolInput(checked, onChange) {
  const n = el("input", { type: "checkbox" });
  n.checked = !!checked;
  on(n, "change", () => onChange(n.checked));
  return n;
}

/** A select whose options are [value, [enLabel, frLabel]] tuples from a spec. */
function registryEnum(value, options, onChange) {
  const n = el("select");
  for (const [val, pair] of options) {
    n.append(el("option", { value: val }, pair[ui.lang === "fr" ? 1 : 0] || pair[0]));
  }
  n.value = options.some(([v]) => v === value) ? value : (options[0]?.[0] ?? "");
  on(n, "change", () => onChange(n.value));
  return n;
}

/**
 * A select whose options are dictionary keys.
 *
 * Each <option> carries its key in `data-lbl`, so paintLabels() re-translates
 * it on a language switch without touching the select's value.
 *
 * Pass KEYS, not translated strings: `t()` resolves the key per language, and
 * a pre-translated string would fall through to English in French.
 */
function enumInput(value, options, onChange) {
  const n = el("select");
  for (const [val, key] of options) {
    n.append(el("option", { value: val, "data-lbl": key }, t(key)));
  }
  // A value the option list does not contain leaves selectedIndex at -1, and
  // the control then renders as a blank box. Every enum in the editor funnels
  // through here, so the fallback belongs here rather than at each call site.
  n.value = options.some(([v]) => v === value) ? value : (options[0]?.[0] ?? "");
  on(n, "change", () => onChange(n.value));
  return n;
}

/**
 * Alt text, next to the picker.
 *
 * The picker on its own leaves an image with no way to describe itself: the
 * quality report flags the missing alt, and the inspector offers no field to
 * fix it. It used to exist once, for the hero, so every image added since -
 * gallery items, a logo strip, a testimonial photo - shipped with a warning
 * nobody could act on.
 */
function altField(read, write) {
  const lang = doc().meta.bilingual ? S.contentLang : doc().meta.lang;
  const pair = () => ({ en: "", fr: "", ...(read()?.alt || {}) });
  return field(t("imageAltLabel"), textInput(bT(read()?.alt, lang), (v) =>
    write({ ...(read() || {}), alt: { ...pair(), [lang]: v } })
  ));
}

/** Asset picker: real file input, preview thumb, remove. */
function imageInput(spec) {
  const wrap = el("div", { className: "field__img" });
  const asset = doc().assets.find((a) => a.id === spec.assetId);
  if (asset) wrap.append(el("img", { src: asset.data, alt: "" }));
  const row = el("div", { className: "field__row" });
  /*
   * Hidden and out of the tab order: this input is only ever opened by the
   * labelled button below. Exposing it as its own focus stop would announce
   * "choose file" twice and add a dead keyboard stop, so it is removed from
   * the accessibility tree instead.
   */
  const file = el("input", { type: "file", accept: "image/*" });
  // The input is visually and programmatically hidden rather than attribute-
  // hidden: `hidden` can be overridden by a stylesheet rule, and this keeps the
  // `display:none` that actually removes it from the accessibility tree.
  file.className = "visually-hidden";
  file.tabIndex = -1;
  file.setAttribute("aria-hidden", "true");
  const pick = el("button", { className: "btn btn--sm", type: "button" }, t(asset ? "imageReplace" : "imagePick"));
  on(pick, "click", () => file.click());
  on(file, "change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (doc().assets.length >= LIMITS.images) {
      say(tf("imageTooBig", t("errTooBig"), t("errTooBig")), "ko");
      return;
    }
    try {
      const a = await readAsset(f);
      commit(edit((d) => {
        d.assets = d.assets.filter((x) => x.id !== spec.assetId);
        d.assets.push(a);
        for (const pg of d.pages) for (const b of pg.blocks) applyAsset(b, a.id, spec.assetId);
      }));
    } catch (err) {
      const m = String(err.message || "");
      if (m.startsWith("img-too-big")) {
        const [, got, max] = m.split(":");
        say(tf("imageTooBig", human(got), human(max)), "ko");
      } else say(t("errBadJson"), "ko");
    }
    file.value = "";
  });
  row.append(pick, file);
  if (asset) {
    const rm = el("button", { className: "btn btn--sm btn--danger", type: "button" }, t("imageRemove"));
    on(rm, "click", () =>
      commit(edit((d) => {
        d.assets = d.assets.filter((x) => x.id !== spec.assetId);
        for (const pg of d.pages) for (const b of pg.blocks) clearAsset(b, spec.assetId);
      }))
    );
    row.append(rm);
  }
  wrap.append(row);
  return wrap;
}

/** Re-point every block that referenced `oldId` at `newId`. */
function applyAsset(block, newId, oldId) {
  const visit = (v) => {
    if (!v || typeof v !== "object") return;
    if (v.assetId === oldId) v.assetId = newId;
    for (const x of Array.isArray(v) ? v : Object.values(v)) visit(x);
  };
  visit(block);
}
const clearAsset = (block, oldId) => applyAsset(block, "", oldId);

const human = (bytes) => {
  const n = Number(bytes) || 0;
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
};

/** One field from the spec. Bilingual fields follow the content-language toggle. */
function renderField(spec, type, get, set) {
  const label = labelFor(spec);
  const at = `${type}.${spec.k}`;
  switch (spec.t) {
    case "text":
      return field(label, textInput(get(), set), null, at);
    case "long":
      return field(label, textInput(get(), set, { multiline: true, rows: 3 }), null, at);
    case "md":
      return field(label, textInput(get(), set, { multiline: true, rows: 8 }), null, at);
    case "date":
      return field(label, textInput(get(), set, { type: "date" }), null, at);
    case "url": {
      const n = textInput(get(), set);
      n.spellcheck = false;
      return field(label, n, spec.hint ? spec.hint[0] : "urlHint", at);
    }
    case "bool":
      return field(label, boolInput(get(), set), null, at);
    case "enum":
      // Block specs store option labels as [en, fr] tuples, not dictionary
      // keys, so they are resolved through the registry like the field label.
      return field(label, registryEnum(get(), spec.options || [], set), null, at);
    case "img": {
      // Reached for image sub-fields inside a list (gallery items, products).
      const wrap = el("div", { className: "field" });
      wrap.append(specLabel(spec, at));
      wrap.append(imageInput(get() || { assetId: "", alt: bi("", "") }));
      wrap.append(altField(get, set));
      return wrap;
    }
    case "list":
      return listField(label, type, spec, get, set);
    default:
      return el("div");
  }
}

/** A <label> whose text comes from the block registry. */
const specLabel = (spec, at) => {
  const n = el("label", { className: "field__label" }, labelFor(spec));
  n.dataset.at = at;
  return n;
};

function listField(label, type, spec, get, set) {
  const box = el("fieldset", { className: "field field__group" });
  box.append(specLabel(spec, `${type}.${spec.k}`));
  const items = el("div", { className: "field__group" });
  const arr = get() || [];

  arr.forEach((row, i) => {
    const item = el("div", { className: "item" });
    const del = el("button", { className: "btn btn--sm btn--danger", type: "button", "data-lbl": "delItem" }, t("delItem"));
    on(del, "click", () => set(arr.filter((_, j) => j !== i)));
    item.append(el("div", { className: "item__head" }, [
      el("b", {}, `${label} ${i + 1}`),
      moveBtn(t("moveUp"), i > 0, () => swap(i, i - 1)),
      moveBtn(t("moveDown"), i < arr.length - 1, () => swap(i, i + 1)),
      del
    ]));

    for (const sf of spec.of || []) {
      item.append(renderField(sf, type, () => row[sf.k], (v) => {
        const next = structuredClone(doc());
        const target = next.pages.find((p) => p.id === S.pageId)?.blocks.find((b) => b.id === S.blockId);
        getPath(target, spec.k)[i][sf.k] = v;
        commit(next);
      }));
    }
    items.append(item);
  });

  if (!arr.length) items.append(el("p", { className: "hint", "data-lbl": "itemsEmpty" }, t("itemsEmpty")));
  const add = el("button", { className: "btn btn--sm", type: "button", "data-lbl": "addItem" }, t("addItem"));
  on(add, "click", () => set([...arr, blankRow(spec.of)]));
  box.append(items, add);

  function swap(a, b) {
    const next = [...arr];
    [next[a], next[b]] = [next[b], next[a]];
    set(next);
  }
  function moveBtn(label, enabled, fn) {
    const b = el("button", { className: "btn btn--sm btn--icon", type: "button", disabled: !enabled }, label);
    on(b, "click", fn);
    return b;
  }
  return box;
}

function blankRow(of = []) {
  const row = {};
  for (const f of of) row[f.k] = f.i18n ? bi("", "") : f.t === "bool" ? false : f.t === "img" ? { assetId: "", alt: bi("", "") } : f.t === "list" ? [] : "";
  return row;
}

/** Walk a dotted path on a block object. */
function getPath(obj, key) {
  const parts = String(key).split(".");
  let cur = obj;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

/* ---------- the block form ---------- */

/** Page title, menu label, description, file name and navigation visibility. */
function renderPageFields(p) {
  const lang = doc().meta.lang;
  const put = (fn) => (v) => commit(edit((d) => fn(d.pages.find((x) => x.id === p.id), v)), { push: false });

  const out = el("div", { className: "insp" }, [
    el("span", { className: "field__label", "data-lbl": "lblPage" }, t("lblPage"))
  ]);
  out.append(field(t("titleLabel"), textInput(bT(p.title, lang), put((pg, v) => {
    const before = bT(pg.title, lang);
    pg.title[lang] = v;
    // A menu label that was never edited from the title should follow it,
    // rather than leaving the old word in the navigation.
    if (bT(pg.menu, lang) === before) pg.menu[lang] = v;
  })), null, null, "titleLabel"));
  out.append(field(t("menuLabel"), textInput(bT(p.menu, lang), put((pg, v) => (pg.menu[lang] = v))), null, null, "menuLabel"));
  out.append(field(t("descLabel"), textInput(bT(p.desc, lang), put((pg, v) => (pg.desc[lang] = v)), { multiline: true, rows: 2 }), null, null, "descLabel"));
  out.append(field(t("slugLabel"), slugControl(p), null, null, "slugLabel"));

  const isHome = p.id === doc().pages[0]?.id;
  out.append(checkField(t("inMenuLabel"), p.inMenu !== false, put((pg, v) => (pg.inMenu = v)), "inMenuLabel"));
  if (isHome) out.append(el("p", { className: "hint", "data-lbl": "homePageHint" }, t("homePageHint")));
  $("blockForm").append(out);
}

/** File-name field with a live "how this will be named" hint. */
function slugControl(p) {
  const isHome = p.id === doc().pages[0]?.id;
  const input = textInput(p.slug, (v) => commit(edit((d) => {
    d.pages.find((x) => x.id === p.id).slug = slugify(v);
  }), { push: false }));
  input.setAttribute("spellcheck", "false");
  if (isHome) input.disabled = true;
  const wrap = field(t("slugLabel"), input);
  if (isHome) {
    // Show what will actually be produced, not the internal "index".
    input.value = "index.html";
    wrap.append(el("span", { className: "hint", "data-lbl": "homeSlugHint" }, t("homeSlugHint")));
  } else {
    wrap.append(el("span", { className: "hint", "data-lbl": "slugHint" }, t("slugHint")));
  }
  return wrap;
}

function renderInspector() {
  const host = $("blockForm");
  host.replaceChildren();
  const p = page();
  const b = p?.blocks.find((x) => x.id === S.blockId);

  /* Page properties are always editable: no section may be selected, but the
     user still needs to rename the page, change its menu label, or drop it from
     the navigation. */
  if (p) renderPageFields(p);

  if (!b) {
    $("blockKind").textContent = "";
    host.append(el("p", { className: "hint", "data-lbl": "pickSection" }, t("pickSection")));
    return;
  }
  const def = BLOCKS[b.type];
  $("blockKind").textContent = blockTypeLabel(b.type, ui.lang);

  if (b) host.append(el("hr", { className: "sep" }));

  /* structure: move / duplicate / delete */
  const bar = el("div", { className: "langbar" });
  const i = p.blocks.indexOf(b);
  const mk = (label, enabled, fn, cls = "btn btn--sm") => {
    const btn = el("button", { className: cls, type: "button", disabled: !enabled }, label);
    on(btn, "click", fn);
    return btn;
  };
  bar.append(
    mk(t("moveUp"), i > 0, () => commit(edit((d) => moveIn(d, p.id, i, i - 1)))),
    mk(t("moveDown"), i < p.blocks.length - 1, () => commit(edit((d) => moveIn(d, p.id, i, i + 1)))),
    mk(t("dupBlock"), true, () => commit(edit((d) => {
      const arr = d.pages.find((x) => x.id === p.id).blocks;
      arr.splice(i + 1, 0, { ...structuredClone(b), id: uid("b") });
    }))),
    mk(t("delBlock"), true, () => commit(edit((d) => {
      d.pages.find((x) => x.id === p.id).blocks.splice(i, 1);
    }), { select: { blockId: null } }), "btn btn--sm btn--danger")
  );
  host.append(bar);

  /* content language toggle — only when the site is bilingual */
  const bilingual = doc().meta.bilingual;
  S.contentLang = doc().meta.lang === "fr" && !bilingual ? "fr" : S.contentLang;
  if (bilingual) {
    const langbar = el("div", { className: "langbar" });
    for (const code of ["en", "fr"]) {
      const btn = el("button", { className: "btn btn--sm", type: "button", "aria-pressed": String(S.contentLang === code) }, t(code === "en" ? "contentLangEn" : "contentLangFr"));
      on(btn, "click", () => {
        S.contentLang = code;
        renderInspector();
      });
      langbar.append(btn);
    }
    const copy = el("button", { className: "btn btn--sm btn--ghost", type: "button", "data-i18n": "copyToOther" }, t("copyToOther"));
    on(copy, "click", () => {
      const other = S.contentLang === "en" ? "fr" : "en";
      commit(edit((d) => {
        const t2 = d.pages.find((x) => x.id === p.id).blocks.find((x) => x.id === b.id);
        for (const f of def.fields) {
          if (f.i18n) t2[f.k][other] = t2[f.k][S.contentLang];
          if (f.t === "list") for (const row of t2[f.k] || []) for (const sf of f.of || []) if (sf.i18n) row[sf.k][other] = row[sf.k][S.contentLang];
        }
      }));
      say(t("copiedToOther"), "ok");
    });
    langbar.append(copy);
    host.append(langbar);
  }

  /* one control per spec field */
  for (const f of def.fields) {
    if (f.t === "img") {
      host.append(renderImageField(f, b, p));
      continue;
    }
    // eslint-disable-next-line no-loop-func -- each field needs its own closure
    const read = () => (f.i18n ? bT(b[f.k], bilingual ? S.contentLang : doc().meta.lang) : b[f.k]);
    const write = (v) => {
      const next = structuredClone(doc());
      const target = next.pages.find((x) => x.id === p.id).blocks.find((x) => x.id === b.id);
      if (f.i18n) target[f.k][bilingual ? S.contentLang : doc().meta.lang] = v;
      else target[f.k] = v;
      commit(next);
    };
    host.append(renderField(f, b.type, read, write));
  }
}

function renderImageField(f, b, p) {
  const spec = b[f.k] || { assetId: "", alt: bi("", "") };
  const picker = imageInput(spec);
  // The picker is a group of buttons, not a single input, so the label is
  // associated with the group via aria-labelledby.
  const wrap = el("div", { className: "field" }, [specLabel(f, `${b.type}.${f.k}`), picker]);
  const lid = `grp${fieldSeq++}`;
  wrap.querySelector(".field__label").id = lid;
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-labelledby", lid);
  wrap.append(altField(() => spec, (v) => {
    commit(edit((d) => {
      const target = d.pages.find((x) => x.id === p.id).blocks.find((x) => x.id === b.id);
      target[f.k] = v;
    }));
  }));
  return wrap;
}

/* ---------- design, SEO, audit, export panels ---------- */

/**
 * Live WCAG readout, right under the colour pickers.
 *
 * The quality report lists the same measurement, and the export says so at the
 * moment it happens. It does not block: holding someone's files hostage until
 * a colour is acceptable is not this tool's business - but going quiet while
 * shipping an unreadable theme is. It is a nested <details> so fifteen rows do
 * not bury the Design form, but it opens itself whenever something fails.
 */
function contrastPanel(theme) {
  const rows = contrastChecks(theme);
  const bad = rows.filter((r) => !r.ok);
  const det = el("details", { className: "insp__section contrast", open: bad.length > 0 });
  det.append(el("summary", { "data-i18n": "contrastTitle" }, t("contrastTitle")));

  const list = el("div", { className: "contrast__list" });
  for (const r of rows) {
    const row = el("div", { className: `cr ${r.ok ? "cr--ok" : "cr--ko"}` }, [
      // The actual pair, drawn: what the numbers describe.
      el("span", { className: "cr__swatch", "aria-hidden": true }, [
        el("span", { className: "cr__fg", style: `background:${r.bg};color:${r.fg}` }, "Aa"),
        el("span", { className: "cr__bg", style: `background:${r.bg}` })
      ]),
      el("span", { className: "cr__what" }, r.what),
      el("span", { className: "cr__ratio" }, `${r.ratio.toFixed(2)}:1`),
      el("span", { className: "cr__mark", "aria-hidden": true }, r.ok ? "✓" : "✕")
    ]);
    list.append(row);
  }
  det.append(list);
  det.append(el("p", {
    className: `summary ${bad.length ? "summary--ko" : ""}`,
    textContent: bad.length
      ? tf("contrastBad", bad.length)
      : t("contrastGood")
  }));
  return det;
}

function renderDesign() {
  const host = $("designFields");
  host.replaceChildren();
  const th = doc().theme;

  const paletteOptions = [
    ...Object.keys(PALETTES).map((k) => [
      k,
      t({ ink: "palInk", forest: "palForest", plum: "palPlum", clay: "palClay", slate: "palSlate" }[k])
    ]),
    ["custom", t("palCustom")]
  ];

  const applyPalette = (v) =>
    commit(edit((d) => {
      d.theme.palette = v;
      // Picking a named set clears any manual override; picking "custom"
      // snapshots the current colours so the swatches start from where the
      // user was looking.
      if (v !== "custom") d.theme.colors = {};
      else {
        const r = resolve(d.theme);
        d.theme.colors = { bg: r.bg, surface: r.surface, ink: r.ink, accent: r.accent, alt: r.alt };
      }
    }));

  host.append(field(t("paletteLabel"), enumInput(paletteOf(th), paletteOptions, applyPalette)));

  const sw = el("div", { className: "swatches" });
  const r = resolve(th);
  for (const [k, key] of [["bg", "colBg"], ["surface", "colSurface"], ["ink", "colInk"], ["accent", "colAccent"], ["alt", "colAlt"]]) {
    const inp = el("input", { type: "color", value: r[k] });
    on(inp, "input", () => commit(edit((d) => {
      d.theme.colors[k] = inp.value;
      d.theme.palette = "custom";
    }), { push: false }));
    on(inp, "change", () => scheduleSave());
    sw.append(el("label", { className: "swatch" }, [inp, el("span", {}, t(key)), el("code", {}, r[k].toUpperCase())]));
  }
  host.append(field(t("colorsLabel"), sw));
  host.append(el("p", { className: "hint", "data-i18n": "hintAccent" }, t("hintAccent")));

  host.append(contrastPanel(th));

  host.append(field(t("radiusLabel"), range(th.radius, 0, 24, 1, (v) => commit(edit((d) => (d.theme.radius = v))))));
/*
   * These three pass `t(...)` values, which are already-translated STRINGS, not
   * dictionary keys. enumInput resolves its options through `t()` because the
   * block registry stores keys; feeding it a translated string makes `t()`
   * return that string unchanged for English and the raw key for French. Pass
   * the key and let enumInput translate.
   */
  host.append(field(t("scaleLabel"), enumInput(th.scale, [
    ["compact", "scaleCompact"], ["normal", "scaleDefault"], ["large", "scaleLarge"], ["huge", "scaleHuge"]
  ], (v) => commit(edit((d) => (d.theme.scale = v))))));
  host.append(el("p", { className: "hint", "data-lbl": "hintScale" }, t("hintScale")));
  host.append(field(t("toneLabel"), enumInput(th.tone, [
    ["sans", "toneSans"], ["serif", "toneSerif"], ["mono", "toneMono"]
  ], (v) => commit(edit((d) => (d.theme.tone = v))))));
  host.append(field(t("schemeLabel"), enumInput(th.scheme, [
    ["auto", "schemeAuto"], ["light", "schemeLight"], ["dark", "schemeDark"]
], (v) => commit(edit((d) => (d.theme.scheme = v))))));
  host.append(field(t("motionLabel"), enumInput(th.motion || "none", [
    ["none", "motionNone"], ["subtle", "motionSubtle"], ["expressive", "motionExpressive"]
  ], (v) => commit(edit((d) => (d.theme.motion = v))))));
  host.append(el("p", { className: "hint", "data-lbl": "hintMotion" }, t("hintMotion")));
  host.append(field(t("customCss"), textInput(th.customCss, (v) => commit(edit((d) => (d.theme.customCss = v)), { push: false }), { multiline: true, rows: 5 })));
  host.append(el("p", { className: "hint", "data-i18n": "hintCss" }, t("hintCss")));
}

function range(value, min, max, step, fn) {
  const n = el("input", { type: "range", min, max, step, value, className: "range" });
  on(n, "input", () => fn(Number(n.value)));
  return n;
}

function renderSeo() {
  const host = $("seoFields");
  host.replaceChildren();
  const d = doc();

  host.append(field(t("siteNameLabel"), textInput(d.name[d.meta.lang], (v) => commit(edit((n) => (n.name[d.meta.lang] = v)), { push: false }))));
  host.append(field(t("taglineLabel"), textInput(d.tagline?.[d.meta.lang] ?? "", (v) => commit(edit((n) => (n.tagline = { ...(n.tagline || bi("", "")), [d.meta.lang]: v }), { push: false })))));
  host.append(field(t("descLabel"), textInput(d.description[d.meta.lang], (v) => commit(edit((n) => (n.description[d.meta.lang] = v)), { push: false }), { multiline: true, rows: 3 })));
  host.append(field(t("baseUrlLabel"), textInput(d.baseUrl, (v) => commit(edit((n) => (n.baseUrl = v)), { push: false }))));

  host.append(field(t("companyLabel"), textInput(d.company, (v) => commit(edit((n) => (n.company = v)), { push: false }))));
  host.append(field(t("addressLabel"), textInput(d.address, (v) => commit(edit((n) => (n.address = v)), { push: false }))));
  host.append(field(t("formEmail"), textInput(d.email, (v) => commit(edit((n) => (n.email = v)), { push: false }))));
  host.append(field(t("host"), textInput(d.host, (v) => commit(edit((n) => (n.host = v)), { push: false }))));
  host.append(el("p", { className: "hint", "data-i18n": "legalNote" }, t("legalNote")));

  host.append(field(t("siteLangLabel"), enumInput(d.meta.lang, [["en", "contentLangEn"], ["fr", "contentLangFr"]],
    (v) => commit(edit((n) => (n.meta.lang = v))))));

  host.append(checkField(t("bilingualLabel"), d.meta.bilingual, (v) => commit(edit((n) => (n.meta.bilingual = v)))));
  host.append(el("p", { className: "hint", "data-i18n": "hintBilingual" }, t("hintBilingual")));
  host.append(checkField(t("noindexLabel"), d.meta.noindex, (v) => commit(edit((n) => (n.meta.noindex = v)))));
  host.append(el("p", { className: "hint", "data-i18n": "noteNoindex" }, t("noteNoindex")));
}

function checkField(label, checked, fn, lblKey) {
  const box = el("input", { type: "checkbox" });
  box.checked = !!checked;
  on(box, "change", () => fn(box.checked));
  const id = `c${fieldSeq++}`;
  box.id = id;
  const text = el("span", {}, label);
  if (lblKey) text.dataset.lbl = lblKey;
  return el("label", { className: "field field--check", htmlFor: id }, [box, text]);
}

/* ---------- preview ---------- */

/**
 * The preview shows the real page. Stylesheet, script and images are inlined
 * so it works inside a sandboxed iframe with no origin and no network, but the
 * markup and the CSS are byte-for-byte what build() produced.
 */
function previewHtml(built, path) {
  let html = built.files[path];
  if (!html) return `<!doctype html><meta charset="utf-8"><p>${esc(path)}</p>`;

  html = html
    .replace(/<link rel="stylesheet" href="css\/style\.css">/, `<style>${built.files["css/style.css"]}</style>`)
    // The favicon is real SVG markup, so it has to travel as a data URI, not as
    // raw text inside an href.
    .replace(/<link rel="icon" href="favicon\.svg"[^>]*>/,
      `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(built.files["favicon.svg"])}">`)
    .replace(/<script src="js\/site\.js" defer><\/script>/,
      // No whitespace between the tag and the code: the Content-Security-Policy
      // hashes the inline body byte for byte, and a newline here is a newline
      // the digest does not cover.
      `<script>${built.files["js/site.js"]}</script><script>${PREVIEW_GUARD}</script>`);

  // Images: replace the exported path with the same bytes as a data URI.
  html = html.replace(/(src=")assets\/([^"]+)(")/g, (whole, a, name, c) =>
    built.files[`assets/${name}`] ? `${a}${built.files[`assets/${name}`]}${c}` : whole);
  return html;
}

function renderPreview() {
  const built = build(doc());
  S.previewPage = doc().pages.some((p) => p.id === S.previewPage) ? S.previewPage : doc().pages[0]?.id;
  const p = page(S.previewPage);
  if (!p) return;
  if (!doc().meta.bilingual) S.previewLang = doc().meta.lang;

  const sel = $("previewPage");
  sel.replaceChildren(...doc().pages.map((x) => {
    const o = el("option", { value: x.id }, bT(x.title, doc().meta.lang) || x.slug);
    return o;
  }));
  sel.value = p.id;

  // The site language in the preview is NOT the interface language — that one
  // lives in the top bar. It only has anything to say for a bilingual site, so
  // on a single-language project it is hidden rather than left sitting there
  // greyed out looking like a second, broken language switch.
  const lsel = $("previewLang");
  lsel.replaceChildren(...(doc().meta.bilingual ? ["en", "fr"] : [doc().meta.lang]).map((code) =>
    el("option", { value: code }, t(code === "en" ? "contentLangEn" : "contentLangFr"))
  ));
  lsel.value = S.previewLang;
  lsel.hidden = !doc().meta.bilingual;
  $("previewLangLabel").hidden = !doc().meta.bilingual;

  const path = pagePath(doc(), p, S.previewLang);
  $("frame").srcdoc = previewHtml(built, path);
  const shell = $("frameShell");
  // Honour the width the user picked. Clamping it to the pane made Desktop and
  // Tablet render identically in a three-column window, so half the device
  // buttons did nothing visible; .stage scrolls, as a device frame should.
  shell.style.width = `${S.device}px`;
  $("previewNote").textContent = `${path} · ${Object.keys(built.files).length} files · ${S.device}px`;
}

on(window, "message", (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "wgn:nav") return;
  const href = String(msg.href || "").split("#")[0];
  const target = doc().pages.find((p) => pagePath(doc(), p, S.previewLang) === href);
  if (target) {
    S.previewPage = target.id;
    renderPreview();
  }
});

/* ---------- audit ---------- */

function runAudit() {
  const d = doc();
  const built = build(d);
  const out = [];
  const add = (ok, key, args = [], jump = null) => out.push({ ok, key, args, jump });

  const contrastBad = contrastChecks(d.theme).filter((c) => !c.ok);
  add(contrastBad.length === 0, contrastBad.length ? "auContrastKo" : "auContrastOk",
      contrastBad.length ? [contrastBad[0].ratio.toFixed(2)] : [], "designPanel");

  const pages = built.langs.flatMap((l) => d.pages.map((p) => ({ p, l })));
  /* Counted over every page x every language, from the built HTML — the same
     bytes the export writes, so the report cannot drift from the result. */
  let imgTotal = 0;
  let imgNoAlt = 0;
  for (const { p, l } of pages) {
    for (const tag of imgsWithoutAlt(built, d, p, l)) {
      imgTotal++;
      if (!/\balt="[^"]+"/.test(tag)) imgNoAlt++;
    }
  }
  add(imgNoAlt === 0, imgNoAlt ? "auAltKo" : "auAltOk", imgNoAlt ? [imgNoAlt] : [], "blockForm");

  const noDesc = [];
  for (const { p, l } of pages) {
    const f = built.files[pagePath(d, p, l)] || "";
    if (!/<meta name="description" content="[^"]{20,}"/.test(f)) noDesc.push(p.slug);
  }
  add(noDesc.length === 0, noDesc.length ? "auDescKo" : "auDescOk", noDesc.length ? [noDesc.join(", ")] : [], "seoPanel");

/* Uniqueness is checked across the WHOLE file set, including the generated
     privacy, legal and 404 pages. Those three have fixed titles, so a page a
     user names "Privacy" would otherwise collide with them. Only duplicates
     are possible here: build() substitutes the site name for an empty page
     title, so a title can never actually come out blank. */
  const allTitles = [];
  for (const [name, content] of Object.entries(built.files)) {
    if (!name.endsWith(".html")) continue;
    allTitles.push((/<title>([^<]*)<\/title>/.exec(content) || [, ""])[1].trim());
  }
  const dupTitles = allTitles.filter((t, i) => allTitles.indexOf(t) !== i);
  add(dupTitles.length === 0, dupTitles.length ? "auTitleKo" : "auTitleOk",
      dupTitles.length ? [dupTitles[0]] : [], "seoPanel");

  const warn = docWarnings(d);
  add(warn.length === 0, warn.length ? "errSlugDup" : "auSlugOk", warn.length ? [warn[0].args?.[0] || ""] : [], "outline");

  if (d.meta.bilingual) {
    let n = 0;
    for (const p of d.pages) for (const b of p.blocks) n += untranslated(b, "fr");
    add(n === 0, n ? "auTransKo" : "auTransOk", n ? [n, "FR"] : [], "blockForm");
  } else add(true, "auTransOk", [], "blockForm");

  const empty = d.pages.filter((p) => !p.blocks.length).map((p) => p.slug);
  add(empty.length === 0, empty.length ? "auEmptyKo" : "auEmptyOk", empty.length ? [empty.join(", ")] : [], "outline");

  add(!!built.files["robots.txt"] && !!built.files["sitemap.xml"], "auSeoOk", [], "seoPanel");
  add(!!built.files["404.html"] && !!built.files["favicon.svg"], "auFilesOk", [], "exportPanel");

  const own = d.baseUrl.replace(/\/+$/, "");
  const rogue = [];
  for (const [name, content] of Object.entries(built.files)) {
    if (!/\.(html|css|js)$/.test(name)) continue;
    for (const m of String(content).replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").matchAll(/(?:href|src)="(https?:[^"]+)"/g)) {
      if (!m[1].startsWith(own) && !/schema\.org|sitemaps\.org/.test(m[1])) rogue.push(m[1]);
    }
  }
  add(rogue.length === 0, rogue.length ? "auRemoteKo" : "auRemoteOk", rogue.length ? [rogue[0].slice(0, 60)] : []);

  const css = sanitizeCss(d.theme.customCss);
  add(css.removed === 0, css.removed ? "auCssKo" : "auCssOk", css.removed ? [css.removed] : [], "designPanel");

  let jump = null;
  let hOk = true;
  for (const { p, l } of pages) {
    const order = [...(built.files[pagePath(d, p, l)] || "").matchAll(/<h([1-4])\b/g)].map((m) => Number(m[1]));
    for (let i = 1; i < order.length; i++) {
      if (order[i] - order[i - 1] > 1) { hOk = false; jump = "outline"; break; }
    }
  }
  add(hOk, hOk ? "auHeadOk" : "auHeadKo", [], jump);

  const forms = d.pages.flatMap((p) => p.blocks.filter((b) => b.type === "contact"));
  const badForm = forms.filter((b) => !safeHref(b.action));
  add(badForm.length === 0, badForm.length ? "auFormKo" : "auFormOk", [], badForm.length ? "blockForm" : null);

  return out;
}

/** Images in one page that still have no alt text. Reads the built output, so
 * it never rebuilds the tree once per page. */
function imgsWithoutAlt(built, d, pageRef, lang) {
  const html = built.files[pagePath(d, pageRef, lang)] || "";
  return [...html.matchAll(/<img\b[^>]*>/g)].filter((m) => !/\balt="[^"]+"/.test(m[0]));
}

/** Count translatable strings with nothing in `lang`. */
function untranslated(v, lang) {
  let n = 0;
  const visit = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(visit);
    if (typeof x.en === "string" || typeof x.fr === "string") {
      const primary = x.en?.trim() || "";
      if (primary && !String(x[lang] || "").trim()) n += 1;
      return;
    }
    Object.values(x).forEach(visit);
  };
  visit(v);
  return n;
}

function renderAudit() {
  const host = $("auditList");
  host.replaceChildren();
  const res = runAudit();
  const bad = res.filter((r) => !r.ok);
  // No data-lbl here on purpose: this text is interpolated with the failure
  // count, and paintLabels() would overwrite it with the bare key.
  host.append(el("p", { className: `summary ${bad.length ? "summary--ko" : ""}` },
    bad.length ? tf("auditFail", bad.length) : t("auditPass")));
  for (const r of res) {
    const row = el("div", { className: `check check--${r.ok ? "ok" : "ko"}` }, [
      el("span", { className: "check__mark", "aria-hidden": true }, r.ok ? "✓" : "✕"),
      el("span", {}, r.args.length ? tf(r.key, ...r.args) : t(r.key))
    ]);
    if (!r.ok && r.jump) {
      const go = el("button", { className: "btn btn--sm check__go", type: "button", "data-i18n": "auditGo" }, t("auditGo"));
      on(go, "click", () => {
        const target = $(r.jump);
        if (target) {
          target.open = true;
          target.scrollIntoView({ block: "center", behavior: "smooth" });
          target.querySelector("summary, input, button")?.focus?.();
        }
      });
      row.append(go);
    }
    host.append(row);
  }
}

/* ---------- export ---------- */

function renderExport() {
  const host = $("exportFields");
  host.replaceChildren();
  host.append(el("p", { className: "hint", "data-i18n": "exportIntro" }, t("exportIntro")));

  const built = build(doc());
  const mk = (label, fn, cls = "btn btn--sm") => {
    const b = el("button", { className: cls, type: "button" }, label);
    on(b, "click", fn);
    return b;
  };

  host.append(mk(t("dlSite"), async () => {
    const files = await exportFiles(doc());
    // Report the archive's real size. This used to say `human(0)` — a literal
    // zero passed as the byte count — so a 30 KB download was announced as
    // "Site exported (0 KB, 13 files)".
    const blob = await zip(toEntries(files));
    download(blob, `${uniqueSlug(doc().name.en) || "site"}.zip`);
    say(tf("exported", human(blob.size), Object.keys(files).length), "ok");
    // The files are the user's, so they are never held back. But shipping an
    // unreadable theme silently is worse: say it, naming the count.
    sayContrast();
  }, "btn btn--primary"));

  if (typeof window.showDirectoryPicker === "function") {
    host.append(mk(t("saveFolder"), async () => {
      try {
        const dir = await window.showDirectoryPicker({ mode: "readwrite" });
        const files = await exportFiles(doc());
        for (const [path, content] of Object.entries(files)) {
          const handle = await dir.getFileHandle(path, { create: true });
          const w = await handle.createWritable();
          // Data URIs are stored as text in the document; write real bytes.
          const bytes = typeof content === "string" && content.startsWith("data:") ? decodeDataUri(content) : content;
          await w.write(bytes ?? new TextEncoder().encode(String(content)));
          await w.close();
        }
        say(tf("exported", t("exportedFolder"), Object.keys(files).length), "ok");
        sayContrast();
      } catch (e) {
        if (e.name !== "AbortError") say(t("noFolderApi"), "ko");
      }
    }));
  } else {
    host.append(el("p", { className: "hint", "data-i18n": "noFolderApi" }, t("noFolderApi")));
  }

  host.append(el("p", { className: "hint", "data-i18n": "needsServer" }, t("needsServer")));
}

/** The exact file set an export produces, preview included. */
/**
 * One line after an export, if the theme still has unreadable pairs.
 *
 * The export is never blocked - the files belong to the user - but a palette
 * that fails the audit used to ship in silence, with the red rows still sitting
 * in another panel. This says it at the moment it matters, and says nothing at
 * all when everything passes.
 */
function sayContrast() {
  const bad = contrastChecks(doc().theme).filter((c) => !c.ok);
  if (bad.length) say(tf("contrastBad", bad.length), "ko");
}

async function exportFiles(d) {
  const files = { ...build(d).files };
  const og = await ogPng(d);
  if (og) files["og.png"] = og;
  files["DEPLOY.txt"] = deployNote(d);
  return files;
}

/** 1200x630 social card, drawn with the site's own colours. Returns bytes. */
async function ogPng(d) {
  try {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 630;
    const g = c.getContext("2d");
    const r = resolve(d.theme);
    g.fillStyle = r.bg;
    g.fillRect(0, 0, 1200, 630);
    g.fillStyle = r.accent;
    g.fillRect(0, 0, 1200, 18);
    g.textAlign = "center";
    g.fillStyle = r.ink;
    g.font = "700 82px system-ui, sans-serif";
    wrapText(g, d.name[d.meta.lang] || "Site", 600, 300, 1000, 96);
    g.fillStyle = r.muted;
    g.font = "400 36px system-ui, sans-serif";
    wrapText(g, d.tagline?.[d.meta.lang] || "", 600, 380, 900, 48);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}
function wrapText(g, text, x, y, max, lh) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      g.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, yy);
}

/**
 * What a host needs to know, shipped inside the archive.
 *
 * Written in the SITE's language, like the privacy and legal pages: a French
 * project should not receive English deployment notes in its own ZIP.
 */
function deployNote(doc) {
  const fr = doc.meta.lang === "fr";
  return fr
    ? `MURTHER FABRIQUE - notes de deploiement
============================================

Ces fichiers sont statiques. Aucune compilation, aucune base de donnees, aucun framework.

Deposez tout le contenu de ce dossier sur n'importe quel hebergeur statique :
  - Netlify / Cloudflare Pages : glissez le dossier sur le tableau de bord.
    "_headers" est lu par les deux et applique les en-tetes CSP et HSTS.
  - GitHub Pages               : poussez le dossier a la racine de "main".
  - Tout serveur web           : copiez le dossier dans la racine du site.
  - "file://"                  : ouvrir index.html directement fonctionne pour
                                lire, mais ni les URL absolues ni les en-tetes
                                CSP ne seront appliques.

AVANT DE METTRE EN LIGNE
  - Renseignez l'URL canonique dans les reglages. sitemap.xml et robots.txt en
    sont tires, et elle est laissee vide expr tant que vous ne l'avez pas faite.
  - Remplissez les champs societe, adresse et e-mail : ils sont substitues dans
    les pages de confidentialite et de mentions legales generees.
  - Remplacez les images : chaque <img> porte une largeur et une hauteur, donc la
    mise en page ne bougera pas, et chacune a besoin d'un vrai texte alternatif.

CE QUE CE SITE NE PEUT PAS FAIRE (il est statique, par conception)
  - Formulaire de contact vers une boite mail : fonctionne, via un lien mailto:
    que le client de messagerie du visiteur ouvre. Pointez-le vers un service de
    formulaire si vous avez besoin d'un serveur.
  - Comptes, commentaires, publication dans un forum, paiements, tableaux de bord
    a donnees vives : ils demandent un serveur, une base de donnees et de
    l'authentification. Ce generateur n'en fournit aucun et ne pretend pas le
    contraire.
`
    : `MURTHER FABRIQUE - deployment notes
=========================================

These are static files. No build step, no database, no framework.

Upload everything in this folder to any static host:
  - Netlify / Cloudflare Pages : drag the folder onto the dashboard.
    "_headers" is read by both and applies the CSP and HSTS headers.
  - GitHub Pages               : push the folder to the root of "main".
  - Any web server             : copy the folder into the document root.
  - "file://"                  : opening index.html directly works for reading,
                                but absolute URLs and CSP headers will not.

BEFORE GOING LIVE
  - Set the canonical URL in Settings. sitemap.xml and robots.txt are built
    from it, and it is left empty on purpose until you do.
  - Fill in the company, address and email fields: they are substituted into
    the generated privacy and legal pages.
  - Replace the images: every <img> carries a width and height, so the layout
    will not shift, and every one needs real alternative text.

WHAT THIS SITE CANNOT DO (it is static, by design)
  - Contact form to a mailbox : works, via a mailto: link your visitor's mail
    client opens. Point it at a form service if you need a server.
  - Accounts, comments, forum posting, payments, dashboards with live data:
    these need a server, a database and authentication. This generator ships
    none of that and does not pretend to.
`;
}

/* ------------------------------------------------------------- rendering */

function renderAll() {
  renderOutline();
  renderInspector();
  renderDesign();
  renderSeo();
  renderPreview();
  renderAudit();
  renderExport();
  $("undoBtn").disabled = !S.history.canUndo;
  $("redoBtn").disabled = !S.history.canRedo;
}

/* ---------------------------------------------------------------- wiring */

function wire() {
  $("uiLang").value = ui.lang;
  $("uiScale").value = ui.scale;

  on($("uiLang"), "change", (e) => {
    setLang(e.target.value);
    paintLabels();
    // While the select itself is focused there is no caret anywhere in the
    // inspector to protect, and renderAll() never rebuilds the select, so a
    // full repaint here is free. Waiting for `blur` left the inspector, the
    // section picker and the design panel showing the previous language for as
    // long as the control kept focus — a half-translated interface.
    if (document.activeElement === $("uiLang")) renderAll();
  });
  // Still needed: a switch made while an inspector field holds the caret, where
  // a rebuild would destroy the field being typed in. paintLabels() alone.
  on($("uiLang"), "blur", () => renderAll());
  on($("uiScale"), "change", (e) => applyScale(e.target.value));

  on($("undoBtn"), "click", () => {
    const d = S.history.undo();
    if (d) {
      S.pageId = null;
      S.blockId = null;
      scheduleSave();
      renderAll();
    } else say(t("undoUnavailable"));
  });
  on($("redoBtn"), "click", () => {
    if (S.history.redo()) {
      S.pageId = null;
      S.blockId = null;
      scheduleSave();
      renderAll();
    } else say(t("redoUnavailable"));
  });

  on($("addPageBtn"), "click", () => {
    if (doc().pages.length >= LIMITS.pages) return say(t("errTooBig"), "ko");
    const p = newPage();
    p.slug = uniqueSlug(p.slug);
    commit(edit((d) => d.pages.push(p)), { select: { pageId: p.id, blockId: null } });
  });

  /* Adding a section needs a type, so the picker is a dialog of real choices
     rather than a select whose value a stray click could clear. */
  on($("addBlockBtn"), "click", () => openBlockPicker());
  on($("blockPickClose"), "click", () => $("blockPickDlg").close());

  on($("saveProjBtn"), "click", () => {
    download(new Blob([JSON.stringify(doc(), null, 2)], { type: "application/json" }), `${uniqueSlug(doc().name.en)}.wgn.json`);
    say(t("projectSaved"), "ok");
  });

  on($("openProjBtn"), "click", () => $("projFile").click());
  on($("projFile"), "change", async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > LIMITS.fileBytes) return say(tf("errTooBig", human(f.size), human(LIMITS.fileBytes)), "ko");
    try {
      const { doc: next, warnings } = normalizeDoc(JSON.parse(await f.text()));
      S.pageId = null;
      S.blockId = null;
      commit(next, { select: { pageId: null } });
      say(warnings.length ? warnings.join(" · ") : t("projectLoaded"), warnings.length ? "" : "ok");
    } catch {
      say(t("errBadJson"), "ko");
    }
  });

  /* templates */
  on($("tplBtn"), "click", () => $("tplDlg").showModal());
  on($("tplClose"), "click", () => $("tplDlg").close());
  on($("tplDlg"), "click", (e) => {
    if (e.target === $("tplDlg")) $("tplDlg").close();
  });
  const grid = $("tplGrid");
  for (const key of TEMPLATE_ORDER) {
    const tpl = TEMPLATES[key];
    // Carries the key so paintLabels() re-translates it; the dialog is built
    // once at boot but must follow a language switch.
    const card = el("button", { className: "tpl", type: "button" }, [
      el("b", { "data-tpl": key, "data-part": "label" }, tpl.label[ui.lang === "fr" ? 1 : 0] || tpl.label[0]),
      el("span", { "data-tpl": key, "data-part": "desc" }, tpl.desc[ui.lang === "fr" ? 1 : 0] || tpl.desc[0])
    ]);
    on(card, "click", () => {
      if (!confirm(t("resetConfirm"))) return;
      S.pageId = null;
      S.blockId = null;
      commit(fromTemplate(key), { select: { pageId: null } });
      $("tplDlg").close();
      say(t("tplUsed"), "ok");
    });
    grid.append(card);
  }

  on($("blockPickDlg"), "click", (e) => {
    if (e.target === $("blockPickDlg")) $("blockPickDlg").close();
  });

  /* Escape closes whichever dialog is open, which the native dialog already
     does; this only stops it from also reaching the keyboard shortcuts. */
  on(document, "keydown", (e) => {
    if (e.key === "Escape") e.stopPropagation();
  }, true);

  /* preview controls */
  for (const b of document.querySelectorAll("[data-w]")) {
    on(b, "click", () => {
      S.device = Number(b.dataset.w);
      for (const o of document.querySelectorAll("[data-w]")) o.setAttribute("aria-pressed", String(o === b));
      renderPreview();
    });
  }
  on($("previewPage"), "change", (e) => {
    S.previewPage = e.target.value;
    renderPreview();
  });
  on($("previewLang"), "change", (e) => {
    S.previewLang = e.target.value;
    renderPreview();
  });
  on($("reloadBtn"), "click", renderPreview);
  /* Belt and braces for the same failure. The script inside the frame already
     refuses to navigate it, but anything the browser does on its own — a form
     post, a stray script, a restored session — would still replace the preview
     and leave it there. A frame that lost its srcdoc gets it put back. */
  on($("frame"), "load", () => {
    if (!$("frame").getAttribute("srcdoc")) renderPreview();
  });
  on($("openTabBtn"), "click", () => {
    const built = build(doc());
    const html = previewHtml(built, pagePath(doc(), page(S.previewPage), S.previewLang));
    const w = window.open("", "_blank");
    // window.open() returns null for two different reasons — a popup blocker
    // in a normal tab, always inside the Windows shell — and reporting the
    // folder-permission message for both sent people hunting for a dialog that
    // had nothing to do with folders.
    if (!w) return say(t("openTabBlocked"), "ko");
    w.document.open();
    w.document.write(html);
    w.document.close();
  });

  /* narrow-screen pane switcher */
  for (const b of document.querySelectorAll("[data-pane]")) {
    on(b, "click", () => {
      for (const o of document.querySelectorAll("[data-pane]")) o.setAttribute("aria-pressed", String(o === b));
      for (const p of document.querySelectorAll(".pane")) p.classList.toggle("is-active", p.id === b.dataset.pane);
    });
  }

  on(document, "keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      $("undoBtn").click();
    } else if ((k === "z" && e.shiftKey) || k === "y") {
      e.preventDefault();
      $("redoBtn").click();
    }
  });

  // Any label that arrives from a dictionary is re-read on language change.
  on(document, "wgn:lang", paintLabels);
}

/* ------------------------------------------------------------------ boot */

/**
 * Section picker. One card per block type, with the type's own description.
 *
 * Rebuilt on every open rather than cached: the card text comes from the
 * registry's tuples, and reading it through the wrong path (a dictionary key
 * that does not exist) silently falls back to the English string — which is
 * exactly the mixed-language bug the language tests exist to catch.
 */
function openBlockPicker() {
  const grid = $("blockPickGrid");
  grid.replaceChildren();
  for (const type of BLOCK_ORDER) {
    const def = BLOCKS[type];
    const card = el("button", { className: "tpl", type: "button" }, [
      el("b", { "data-blk": type, "data-part": "label" }, blockTypeLabel(type, ui.lang)),
      el("span", { "data-blk": type, "data-part": "hint" }, def.hint?.[ui.lang === "fr" ? 1 : 0] || "")
    ]);
    on(card, "click", () => {
      const p = page();
      if (!p) return;
      if (p.blocks.length >= LIMITS.blocksPerPage) return say(t("errTooBig"), "ko");
      const b = makeBlock(type);
      commit(edit((d) => d.pages.find((x) => x.id === p.id).blocks.push(b)), {
        select: { pageId: p.id, blockId: b.id }
      });
      $("blockPickDlg").close();
    });
    grid.append(card);
  }
  $("blockPickDlg").showModal();
}

function boot() {
  const stored = loadStored();
  const start = stored || fromTemplate("business");
  S.history.reset(start);
  S.pageId = start.pages[0]?.id ?? null;
  initLang();
  paintLabels();
  wire();
  renderAll();
  selfCheck();
}

/**
 * Runtime self-check. Cheap, and it fails loudly in the console rather than
 * letting a broken build look fine.
 */
const selfCheckErrors = [];

function selfCheck() {
  const checks = [];
  const bad = Object.entries(T).filter(([, v]) => !Array.isArray(v) || !v[0] || !v[1]);
  checks.push(["every interface key carries both languages", bad.length === 0]);

  const L0 = ui.lang;
  const a = t("dlSite");
  setLang(L0 === "fr" ? "en" : "fr");
  const b = t("dlSite");
  setLang(L0);
  checks.push(["t() follows the active language", a !== b]);

  // The inspector must never inject markup: a block label is dictionary text,
  // but an asset id or a field key comes from the project file.
  checks.push(["block names are escaped", esc("<img src=x>") === "&lt;img src=x&gt;"]);

  // Reuse the audit rather than inventing a second, weaker rule here.
  const rogue = runAudit().find((r) => r.key === "auRemoteKo");
  checks.push(["no generated file calls a third party", !rogue]);

  // Every block type the "Add a section" menu offers must actually render.
  const probe = normalizeDoc(fromTemplate("blank")).doc;
  probe.pages[0].blocks = BLOCK_ORDER.map((k, i) => ({ ...makeBlock(k), id: `p${i}` }));
  let threw = null;
  try {
    build(probe);
  } catch (e) {
    threw = e.message;
  }
  checks.push([`all ${BLOCK_ORDER.length} block types render`, threw === null]);

  const failed = checks.filter(([, ok]) => !ok);
  selfCheckErrors.length = 0;
  selfCheckErrors.push(...failed.map(([name]) => name));
  for (const [name] of failed) console.error("MURTHER FABRIQUE — SELF-CHECK FAILED: " + name);
  if (!failed.length) console.info(`MURTHER FABRIQUE — self-check: ${checks.length}/${checks.length} passed`);
}

boot();

/**
 * Browser probe, attached only when the URL carries ?probe=1.
 *
 * Lets an automated run drive the real UI — switch language, open a template,
 * select a section — and assert on what a user would actually see, instead of
 * only testing the pure core in Node.
 */
if (new URLSearchParams(location.search).has("probe")) {
  window.wgn = {
    doc,
    state: S,
    t,
    build: () => build(doc()),
    audit: runAudit,
    blockOrder: () => BLOCK_ORDER.slice(),
    templates: () => TEMPLATE_ORDER.slice(),
    /* Mirrors what the <select> does: repaint labels now, rebuild once focus has
       left. Used by the browser probes, which cannot open a real <select>. */
    setLang: (c) => {
      // Mirror the <select> handler exactly, including repainting the select
      // itself. A probe that skipped this left the control reading "English"
      // while the rest of the interface was French — the interface did switch,
      // but the control that reports it did not.
      $("uiLang").value = c === "fr" ? "fr" : "en";
      const active = document.activeElement;
      setLang(c);
      paintLabels();
      if (!active || active === document.body || !S.blockId) renderAll();
      return t("dlSite");
    },
    applyTemplate: (key) => {
      S.pageId = null;
      S.blockId = null;
      commit(fromTemplate(key), { select: { pageId: null } });
    },
    select: (pageIdx, blockIdx) => {
      const p = doc().pages[pageIdx];
      if (!p) return false;
      S.pageId = p.id;
      S.blockId = p.blocks[blockIdx ?? 0]?.id ?? null;
      renderAll();
      return true;
    },
    setBilingual: (v) => commit(edit((d) => (d.meta.bilingual = !!v))),
    setSiteLang: (l) => commit(edit((d) => (d.meta.lang = l))),
    openPicker: () => openBlockPicker(),
    sayContrast: () => sayContrast(),
  addBlock: (type, pageIdx = 0) => {
      const p = doc().pages[pageIdx];
      if (!p) return false;
      const b = makeBlock(type);
      commit(edit((d) => d.pages[pageIdx].blocks.push(b)), { select: { pageId: p.id, blockId: b.id } });
      return true;
    },
    undo: () => $("undoBtn").click(),
    redo: () => $("redoBtn").click(),
    /** The file tree the export would produce, with assets decoded. */
    files: () => exportFiles(doc()),
    /** Labels currently rendered, for asserting the interface is fully translated. */
    visibleText: () => document.body.innerText,
    errors: () => selfCheckErrors
  };
}
