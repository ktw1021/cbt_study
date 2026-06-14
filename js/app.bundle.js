"use strict";
(() => {
  // js/core/store.js
  var store = {
    data: null,
    authenticatedUserId: null,
    authTab: "login",
    pendingPinSetupUserId: null,
    currentSection: "manage",
    studyQueue: [],
    studyIndex: 0,
    currentBlankStatuses: [],
    currentBlankFocus: null,
    studyAttemptRecorded: false,
    activeManageId: null,
    activeFolderId: null,
    autoBlankEditorId: "explanationTemplate"
  };
  function getState() {
    return store.data;
  }
  function setState(next) {
    store.data = next;
  }

  // js/config.js
  var DB_NAME = "cbt_blank_study_v1";
  var DB_STORE = "appState";
  var STATE_KEY = "main";
  var MAX_UNDO = 60;
  var STOPWORDS = /* @__PURE__ */ new Set([
    "\uADF8\uB9AC\uACE0",
    "\uADF8\uB7EC\uB098",
    "\uB610\uD55C",
    "\uC989",
    "\uB2E4\uB9CC",
    "\uD55C\uB2E4",
    "\uC788\uB294",
    "\uC5C6\uB294",
    "\uC788\uB2E4",
    "\uB300\uD55C",
    "\uC704\uD55C",
    "\uACBD\uC6B0",
    "\uD310\uB840",
    "\uBC95\uC6D0",
    "\uBC0F",
    "\uAC83",
    "\uC218",
    "\uB4F1"
  ]);

  // js/core/storage.js
  var db = null;
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function loadState() {
    db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(STATE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async function persist() {
    if (!db) db = await openDB();
    const state = getState();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(state, STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function saveState(next) {
    if (next) setState(next);
    await persist();
  }

  // js/utils/text.js
  function uid(prefix = "id") {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function escapeHtml(text) {
    return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  function shorten(text, len = 56) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    return s.length > len ? s.slice(0, len) + "\u2026" : s;
  }
  function normalize(text) {
    return String(text || "").normalize("NFC").replace(/[""''']/g, "").replace(/[.,/#!$%^&*;:{}=_`~()\[\]?]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function normalizeTight(text) {
    return normalize(text).replace(/\s+/g, "");
  }
  function stripBlankMarkers(text) {
    return String(text || "").replace(/\[\[BLANK\d+\]\]/g, "");
  }
  function splitAnswers(answer) {
    return String(answer || "").split(/\n|\|\|/).map((v) => v.trim()).filter(Boolean);
  }
  function blankShapeHint(answer) {
    const raw = splitAnswers(answer)[0] ?? String(answer || "");
    if (!raw) return "000";
    let out = "";
    for (const ch of raw) {
      out += /\s/.test(ch) ? ch : "0";
    }
    return out || "000";
  }
  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // js/utils/dom.js
  function selectionRange(el) {
    return {
      start: el.selectionStart,
      end: el.selectionEnd,
      text: el.value.slice(el.selectionStart, el.selectionEnd)
    };
  }
  function captureTextareaView(el) {
    return {
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      start: el.selectionStart,
      end: el.selectionEnd
    };
  }
  function writeTextarea(el, value, caret = null, scroll = null) {
    const scrollTop = scroll?.scrollTop ?? scroll?.top ?? el.scrollTop;
    const scrollLeft = scroll?.scrollLeft ?? scroll?.left ?? el.scrollLeft;
    const start = caret?.start ?? el.selectionStart;
    const end = caret?.end ?? el.selectionEnd;
    el.value = value;
    const safeStart = Math.max(0, Math.min(start, value.length));
    const safeEnd = Math.max(safeStart, Math.min(end, value.length));
    el.setSelectionRange(safeStart, safeEnd);
    el.scrollTop = scrollTop;
    el.scrollLeft = scrollLeft;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }

  // js/domain/blank.js
  function syncTemplateAndBlanks(template, currentBlanks = []) {
    const oldMap = new Map(currentBlanks.map((b) => [Number(b.order || b.key), b]));
    const found = [];
    let temp = String(template || "").replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
      found.push(Number(n));
      return `\xA7\xA7T${found.length - 1}\xA7\xA7`;
    });
    temp = temp.replace(/§§T(\d+)§§/g, (_, i) => `[[BLANK${Number(i) + 1}]]`);
    const blanks = found.map((oldNum, idx) => {
      const prev = oldMap.get(oldNum) || {};
      return {
        id: prev.id || uid("b"),
        cardId: prev.cardId || "",
        order: idx + 1,
        placeholder: `\uBE48\uCE78${idx + 1}`,
        answer: String(prev.answer || ""),
        aliases: prev.aliases || [],
        lastInput: prev.lastInput || "",
        lastResult: prev.lastResult ?? null,
        manualResult: prev.manualResult ?? null
      };
    });
    return { template: temp, blanks };
  }
  function isAutoBlankExcluded(token, fullText) {
    if (!token || token.length < 2) return true;
    if (/\d/.test(token)) return true;
    if (STOPWORDS.has(token)) return true;
    if (/^\[.*\d.*\]$/.test(token)) return true;
    if (/^\d{4}[가-힣]+\d+$/.test(token)) return true;
    if (/^제\d+조$/.test(token)) return true;
    if (/^\d+항$/.test(token)) return true;
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\[\\d{4}${esc}\\]|\\d{4}${esc}`).test(fullText)) return true;
    return false;
  }
  function findAutoCandidates(text, existingBlanks) {
    const occupied = new Set(existingBlanks.map((b) => normalizeTight(b.answer)));
    const re = /[A-Za-z가-힣][A-Za-z가-힣·\-]{1,}/g;
    const seen = /* @__PURE__ */ new Map();
    let match;
    while ((match = re.exec(text)) !== null) {
      const token = match[0];
      if (isAutoBlankExcluded(token, text)) continue;
      if (occupied.has(normalizeTight(token))) continue;
      if (!seen.has(token)) seen.set(token, match.index);
    }
    return [...seen.entries()].sort((a, b) => b[0].length - a[0].length).slice(0, 20);
  }
  function findBlankTokenAtCursor(text, pos) {
    const re = /\[\[BLANK(\d+)\]\]/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (pos >= start && pos <= end) {
        return { start, end, order: Number(match[1]) };
      }
    }
    return null;
  }
  function removeBlankAtOrder(template, blanks, order) {
    const re = new RegExp(`\\[\\[BLANK${order}\\]\\]`);
    const idx = template.search(re);
    if (idx < 0) {
      return syncTemplateAndBlanks(template, blanks.filter((b) => b.order !== order));
    }
    const blank = blanks.find((b) => b.order === order);
    const token = `[[BLANK${order}]]`;
    const next = template.slice(0, idx) + (blank?.answer || "") + template.slice(idx + token.length);
    const norm = syncTemplateAndBlanks(next, blanks.filter((b) => b.order !== order));
    const pos = idx + (blank?.answer || "").length;
    return { ...norm, caret: { start: pos, end: pos } };
  }
  function selectBlankToken(el, order) {
    const re = new RegExp(`\\[\\[BLANK${order}\\]\\]`);
    const match = re.exec(el.value);
    if (!match) return false;
    const scroll = { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
    const start = match.index;
    const end = start + match[0].length;
    writeTextarea(el, el.value, { start, end }, scroll);
    return true;
  }
  function blankCaretAfter(text, nearIndex) {
    const re = /\[\[BLANK(\d+)\]\]/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index >= nearIndex) {
        const end = match.index + match[0].length;
        return { start: end, end };
      }
    }
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      const end = match.index + match[0].length;
      if (match.index <= nearIndex && end >= nearIndex) {
        return { start: end, end };
      }
    }
    return { start: nearIndex, end: nearIndex };
  }
  function makeBlankInText(template, blanks, start, end, selectedText) {
    const nextOrder = blanks.length + 1;
    const token = `[[BLANK${nextOrder}]]`;
    const next = String(template || "").slice(0, start) + token + String(template || "").slice(end);
    const norm = syncTemplateAndBlanks(next, [
      ...blanks,
      { order: nextOrder, answer: selectedText.trim() }
    ]);
    return { ...norm, caret: blankCaretAfter(norm.template, start) };
  }
  function removeBlankFromText(template, blanks, start, end, order) {
    const blank = blanks.find((b) => b.order === order);
    const answer = blank?.answer || "";
    const next = String(template || "").slice(0, start) + answer + String(template || "").slice(end);
    const norm = syncTemplateAndBlanks(next, blanks.filter((b) => b.order !== order));
    const pos = start + answer.length;
    return { ...norm, caret: { start: pos, end: pos } };
  }
  function applyAutoBlankTokens(template, blanks, tokens) {
    let nextTemplate = template;
    let nextBlanks = blanks.slice();
    const sorted = tokens.slice().sort((a, b) => b.length - a.length);
    sorted.forEach((token) => {
      const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(?<![A-Za-z\uAC00-\uD7A30-9])(${esc})(?![A-Za-z\uAC00-\uD7A30-9])`);
      const m = nextTemplate.match(regex);
      if (!m) return;
      const idx = m.index;
      const nextOrder = nextBlanks.length + 1;
      nextTemplate = nextTemplate.slice(0, idx) + `[[BLANK${nextOrder}]]` + nextTemplate.slice(idx + token.length);
      nextBlanks.push({ order: nextOrder, answer: token });
    });
    return syncTemplateAndBlanks(nextTemplate, nextBlanks);
  }

  // js/domain/migrate.js
  function createDefaultState() {
    return {
      version: 2,
      users: [],
      activeUserId: null,
      folders: [],
      cards: [],
      selectedIds: [],
      settings: { gradingThreshold: 80 },
      ui: { treeExpanded: {}, section: "manage", sidebarCollapsed: false }
    };
  }
  function migrateUser(raw) {
    const name = String(raw.name || "").trim().normalize("NFC") || "\uC774\uB984 \uC5C6\uC74C";
    return {
      id: raw.id || uid("u"),
      name,
      pin: raw.pin || null,
      createdAt: raw.createdAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function migrateCard(raw) {
    let displayText = raw.displayText || raw.promptTemplate || raw.originalText || "";
    let explanationText = raw.explanationText || "";
    let blanks = Array.isArray(raw.blanks) ? raw.blanks : [];
    if (blanks.length && !blanks[0].id) {
      blanks = blanks.map((b, i) => ({
        id: b.id || uid("b"),
        cardId: raw.id,
        order: b.order || b.key || i + 1,
        placeholder: b.placeholder || `\uBE48\uCE78${b.order || b.key || i + 1}`,
        answer: String(b.answer || ""),
        aliases: b.aliases || [],
        lastInput: "",
        lastResult: null,
        manualResult: null
      }));
    }
    if (/\[\[BLANK\d+\]\]/.test(displayText)) {
      if (!explanationText.trim()) {
        explanationText = displayText;
        displayText = stripBlankMarkers(raw.originalText || displayText);
      } else {
        displayText = stripBlankMarkers(displayText);
      }
    }
    const synced = syncTemplateAndBlanks(explanationText, blanks);
    explanationText = synced.template;
    blanks = synced.blanks;
    displayText = stripBlankMarkers(displayText);
    return {
      id: raw.id || uid("c"),
      userId: raw.userId || "",
      folderId: raw.folderId || null,
      title: raw.title || shorten(stripBlankMarkers(explanationText || displayText), 40) || "\uC81C\uBAA9 \uC5C6\uC74C",
      originalText: stripBlankMarkers(raw.originalText || displayText),
      displayText,
      explanationText,
      blanks,
      memo: raw.memo || raw.note || "",
      flagColor: Number(raw.flagColor ?? raw.flag ?? 0),
      rounds: Math.max(0, Number(raw.rounds || 0)),
      wrongCount: Number(raw.wrongCount || 0),
      lastResult: raw.lastResult || null,
      isSample: !!raw.isSample,
      createdAt: raw.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: raw.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function migrateState(raw) {
    if (!raw) return createDefaultState();
    const merged = {
      ...createDefaultState(),
      ...raw,
      version: 2
    };
    merged.users = (raw.users || []).map(migrateUser);
    merged.folders = raw.folders || [];
    merged.cards = (raw.cards || []).map(migrateCard);
    merged.selectedIds = [...new Set(raw.selectedIds || [])];
    merged.settings = { gradingThreshold: 80, ...raw.settings || {} };
    merged.ui = { treeExpanded: {}, section: "manage", sidebarCollapsed: false, ...raw.ui || {} };
    const validActive = merged.users.some((u) => u.id === merged.activeUserId);
    merged.activeUserId = validActive ? merged.activeUserId : null;
    return merged;
  }

  // js/core/hash-router.js
  function parseRoute() {
    const raw = (location.hash.slice(1) || "/manage").replace(/^\//, "");
    const parts = raw.split("/").filter(Boolean);
    const root = parts[0] || "manage";
    if (root === "manage") return { page: "manage" };
    if (root === "create") return { page: "create", cardId: parts[1] || null };
    if (root === "study") {
      if (parts[1] === "play") return { page: "study-play", index: Number(parts[2] || 0) };
      return { page: "study" };
    }
    return { page: "manage" };
  }
  function navigate(path, { replace = false } = {}) {
    const hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
    const current = location.hash || "#/manage";
    if (current === hash) return;
    if (replace) history.replaceState({ route: hash }, "", hash);
    else history.pushState({ route: hash }, "", hash);
  }
  function routeToPath(page, extra = {}) {
    if (page === "manage") return "/manage";
    if (page === "create") return extra.cardId ? `/create/${extra.cardId}` : "/create";
    if (page === "study") return "/study";
    if (page === "study-play") return `/study/play/${extra.index ?? store.studyIndex ?? 0}`;
    return "/manage";
  }
  function syncUrl(page, extra = {}, replace = false) {
    navigate(routeToPath(page, extra), { replace });
  }

  // js/domain/queries.js
  function normalizeUserName(name) {
    return String(name || "").trim().normalize("NFC");
  }
  function findUserByName(name) {
    const n = normalizeUserName(name);
    if (!n) return null;
    return getState().users.find((u) => normalizeUserName(u.name) === n) || null;
  }
  function getActiveUser() {
    const state = getState();
    if (!state) return null;
    const id = store.authenticatedUserId;
    if (!id) return null;
    return state.users.find((u) => u.id === id) || null;
  }
  function getUserFolders(userId) {
    return getState().folders.filter((f) => f.userId === userId);
  }
  function getUserCards(userId) {
    return getState().cards.filter((c) => c.userId === userId);
  }
  function getCard(id) {
    return getState().cards.find((c) => c.id === id);
  }
  function getFolder(id) {
    return getState().folders.find((f) => f.id === id);
  }
  function folderPathNames(folderId) {
    const parts = [];
    let cur = getFolder(folderId);
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parentId ? getFolder(cur.parentId) : null;
    }
    return parts.join(" > ") || "(\uBBF8\uBD84\uB958)";
  }
  function getDescendantFolderIds(folderId, userId) {
    const kids = getUserFolders(userId).filter((f) => f.parentId === folderId);
    return kids.flatMap((k) => [k.id, ...getDescendantFolderIds(k.id, userId)]);
  }
  function countCardsInFolder(folderId, userId) {
    const ids = [folderId, ...getDescendantFolderIds(folderId, userId)];
    return getUserCards(userId).filter((c) => ids.includes(c.folderId)).length;
  }
  function buildFolderOptions(userId, parentId = null, depth = 0) {
    const folders = getUserFolders(userId).filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return folders.flatMap((f) => {
      const pad = "\u3000".repeat(depth);
      return [
        `<option value="${f.id}">${pad}${escapeHtml(f.name)}</option>`,
        buildFolderOptions(userId, f.id, depth + 1)
      ];
    }).join("");
  }
  function getCardsFiltered(filters, activeFolderId) {
    const user = getActiveUser();
    if (!user) return [];
    const userId = user.id;
    let cards = getUserCards(userId);
    if (activeFolderId) {
      const ids = [activeFolderId, ...getDescendantFolderIds(activeFolderId, userId)];
      cards = cards.filter((c) => ids.includes(c.folderId));
    }
    const q = filters.search.trim().toLowerCase();
    return cards.filter((c) => {
      const hay = [c.title, c.displayText, c.explanationText, c.memo, ...(c.blanks || []).map((b) => b.answer)].join(" ").toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (filters.flag !== "all" && String(c.flagColor) !== filters.flag) return false;
      if (filters.wrong === "wrong" && c.lastResult !== "wrong") return false;
      if (filters.wrong === "correct" && c.lastResult !== "correct") return false;
      return true;
    });
  }
  function buildStudyQueue(mode, activeFolderId, selectedIds) {
    const user = getActiveUser();
    if (!user) return [];
    const userId = user.id;
    let cards = getUserCards(userId);
    if (mode.startsWith("folder") && activeFolderId) {
      const ids = [activeFolderId, ...getDescendantFolderIds(activeFolderId, userId)];
      cards = cards.filter((c) => ids.includes(c.folderId));
    }
    if (mode.startsWith("selected")) cards = cards.filter((c) => selectedIds.includes(c.id));
    if (mode === "wrong-only") cards = cards.filter((c) => c.lastResult === "wrong");
    if (mode === "flag-only") cards = cards.filter((c) => c.flagColor > 0);
    if (mode === "low-rounds") {
      cards = cards.slice().sort((a, b) => a.rounds - b.rounds || a.wrongCount - b.wrongCount);
    }
    return cards;
  }

  // js/ui/prompt.js
  function formatProblemHtml(text) {
    const plain = stripBlankMarkers(text);
    if (!plain.trim()) return '<span class="empty">\uBB38\uC81C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</span>';
    return escapeHtml(plain).replace(/\n/g, "<br>");
  }
  function blankInputHtml(order, card, st = {}) {
    const blank = (card?.blanks || []).find((b) => b.order === order);
    const answer = splitAnswers(blank?.answer)[0] || "";
    const userVal = st.user ?? "";
    const checked = st.checked;
    const correct = st.correct;
    const revealed = st.revealed;
    let cls = "blank-field";
    if (checked) cls += correct ? " ok" : " bad";
    if (store.currentBlankFocus === order) cls += " focus";
    if (revealed && correct) cls += " revealed";
    const placeholder = blankShapeHint(answer);
    const widthCh = Math.max(placeholder.length, 3);
    if (revealed && !correct) {
      return `<span class="blank-wrap" id="blankWrap${order}">
      <input type="text" class="${cls} blank-field-shape" data-blank-order="${order}" data-action="blank-input"
        value="${escapeHtml(userVal)}" placeholder="${escapeHtml(placeholder)}" style="min-width:${widthCh}ch" />
      <span class="blank-hint bad-hint">\u2192 ${escapeHtml(answer)}</span>
    </span>`;
    }
    if (revealed && correct) {
      return `<span class="blank-wrap" id="blankWrap${order}">
      <input type="text" class="${cls} blank-field-shape" data-blank-order="${order}" data-action="blank-input"
        value="${escapeHtml(userVal || answer)}" readonly style="min-width:${widthCh}ch" />
    </span>`;
    }
    return `<span class="blank-wrap" id="blankWrap${order}">
    <input type="text" class="${cls} blank-field-shape" data-blank-order="${order}" data-action="blank-input"
      value="${escapeHtml(userVal)}" placeholder="${escapeHtml(placeholder)}" style="min-width:${widthCh}ch" autocomplete="off" />
  </span>`;
  }
  function formatExplanationHtml(template, card, statuses = []) {
    const statusMap = new Map(statuses.map((s) => [s.order, s]));
    const html = escapeHtml(template || "").replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
      const order = Number(n);
      return blankInputHtml(order, card, statusMap.get(order) || {});
    });
    return html || '<span class="empty">\uD574\uC124\uC744 \uC785\uB825\uD558\uC138\uC694. (\uCE74\uB4DC\uC81C\uC791 \u2192 \uD574\uC124)</span>';
  }
  function getExplanationText(card) {
    return String(card?.explanationText ?? "").trim();
  }
  function formatStudyExplanationHtml(card, statuses = []) {
    return formatExplanationHtml(getExplanationText(card), card, statuses);
  }
  function formatPromptHtml(template, blanks = []) {
    const blankMap = new Map((blanks || []).map((b) => [Number(b.order), b]));
    const html = escapeHtml(template || "").replace(/\[\[BLANK(\d+)\]\]/g, (_, n) => {
      const order = Number(n);
      const hint = blankShapeHint(blankMap.get(order)?.answer || "");
      return `<span class="blank-inline blank-shape" title="\uBE48\uCE78 ${order}">${escapeHtml(hint)}</span>`;
    });
    return html || '<span class="empty">\uB0B4\uC6A9 \uC5C6\uC74C</span>';
  }

  // js/ui/create.js
  function renderCreateForm(card) {
    document.getElementById("cardId").value = card?.id || "";
    document.getElementById("cardTitle").value = card?.title || "";
    document.getElementById("cardFolder").value = card?.folderId || "";
    document.getElementById("cardFlag").value = String(card?.flagColor ?? 0);
    document.getElementById("promptTemplate").value = stripBlankMarkers(card?.displayText || "");
    document.getElementById("explanationTemplate").value = card?.explanationText || "";
    document.getElementById("cardMemo").value = card?.memo || "";
    renderCreatePreview(card || { displayText: "", explanationText: "", blanks: [] });
  }
  function renderCreatePreview(card) {
    document.getElementById("promptPreview").innerHTML = formatProblemHtml(card.displayText || "");
    const synced = syncTemplateAndBlanks(card.explanationText || "", card.blanks || []);
    document.getElementById("explanationPreview").innerHTML = formatPromptHtml(synced.template, synced.blanks);
    document.getElementById("blankSummary").innerHTML = synced.blanks.length ? synced.blanks.map((b) => `
      <span class="blank-chip-wrap">
        <button type="button" class="blank-chip" data-action="jump-blank" data-editor="explanationTemplate" data-order="${b.order}" title="\uD574\uC124\uC5D0\uC11C \uC704\uCE58 \uCC3E\uAE30">\uBE48\uCE78 ${b.order}</button>
        <button type="button" class="blank-chip-remove" data-action="remove-blank-order" data-editor="explanationTemplate" data-order="${b.order}" title="\uBE48\uCE78 \uD574\uC81C">\xD7</button>
      </span>`).join("") : '<span class="empty">\uBE48\uCE78 \uC5C6\uC74C \u2014 \uD574\uC124\uC5D0\uC11C \uB2E8\uC5B4 \uB4DC\uB798\uADF8 \uD6C4 Ctrl+B</span>';
    document.getElementById("answerSlots").innerHTML = synced.blanks.length ? synced.blanks.map((b) => `
      <div class="slot blank-slot">
        <div class="between" style="margin-bottom:4px">
          <label>\uBE48\uCE78 ${b.order}</label>
          <button type="button" class="ghost small" data-action="remove-blank-order" data-editor="explanationTemplate" data-order="${b.order}">\uD574\uC81C</button>
        </div>
      <textarea data-answer-key="${b.order}" class="sm" placeholder="\uB3D9\uC758\uC5B4: \uC904\uBC14\uAFC8 \uB610\uB294 ||">${escapeHtml(b.answer)}</textarea></div>`).join("") : '<div class="caption">\uD574\uC124\uC5D0\uC11C \uBE48\uCE78\uC744 \uB9CC\uB4E4\uBA74 \uC815\uB2F5 \uC785\uB825\uCE78\uC774 \uB098\uD0C0\uB0A9\uB2C8\uB2E4.</div>';
  }
  function readCreateForm(existingBlanks = []) {
    const problem = stripBlankMarkers(document.getElementById("promptTemplate").value);
    const explRaw = document.getElementById("explanationTemplate").value;
    const src = [...document.querySelectorAll("[data-answer-key]")].map((el) => {
      const order = Number(el.dataset.answerKey);
      const prev = existingBlanks.find((b) => b.order === order) || {};
      return { ...prev, order, answer: el.value || "" };
    });
    const synced = syncTemplateAndBlanks(explRaw, src);
    return {
      id: document.getElementById("cardId").value,
      folderId: document.getElementById("cardFolder").value || null,
      title: document.getElementById("cardTitle").value.trim() || "\uC81C\uBAA9 \uC5C6\uC74C",
      displayText: problem,
      explanationText: synced.template,
      blanks: synced.blanks.map((b) => ({
        ...b,
        answer: document.querySelector(`[data-answer-key="${b.order}"]`)?.value || b.answer
      })),
      memo: document.getElementById("cardMemo").value,
      flagColor: Number(document.getElementById("cardFlag").value)
    };
  }
  function readBlanksFromEditor(editorId, cardId, existingBlanks = []) {
    const template = document.getElementById(editorId).value;
    const sel = editorId === "studyEditExplanation" ? "[data-study-answer-key]" : "[data-answer-key]";
    const src = [...document.querySelectorAll(sel)].map((el) => {
      const order = Number(el.dataset.answerKey || el.dataset.studyAnswerKey);
      const prev = existingBlanks.find((b) => b.order === order) || {};
      return { ...prev, order, answer: el.value || "" };
    });
    return syncTemplateAndBlanks(template, src);
  }
  function refreshEditorUI(editorId, synced, caret = null) {
    const el = document.getElementById(editorId);
    if (!el) return;
    const view = captureTextareaView(el);
    const finalCaret = caret ?? synced.caret ?? { start: view.start, end: view.end };
    if (editorId === "explanationTemplate") {
      const problem = document.getElementById("promptTemplate").value;
      renderCreatePreview({ displayText: problem, explanationText: synced.template, blanks: synced.blanks });
    } else if (editorId === "studyEditExplanation") {
      renderStudyEditForm(null, synced);
    }
    writeTextarea(el, synced.template, finalCaret, view);
  }
  function renderStudyEditForm(card, syncedOverride = null) {
    if (!card && !syncedOverride) return;
    if (card) {
      document.getElementById("studyEditTitle").value = card.title;
      document.getElementById("studyEditFolder").value = card.folderId || "";
      document.getElementById("studyEditPrompt").value = stripBlankMarkers(card.displayText || "");
      document.getElementById("studyEditExplanation").value = card.explanationText || "";
      document.getElementById("studyEditMemo").value = card.memo || "";
    }
    const synced = syncedOverride || syncTemplateAndBlanks(
      card?.explanationText || document.getElementById("studyEditExplanation")?.value || "",
      card?.blanks || []
    );
    document.getElementById("studyEditExplanationPreview").innerHTML = formatPromptHtml(synced.template, synced.blanks);
    document.getElementById("studyEditSlots").innerHTML = synced.blanks.map((b) => `
    <div class="slot blank-slot">
      <div class="between" style="margin-bottom:4px">
        <label>\uBE48\uCE78 ${b.order}</label>
        <button type="button" class="ghost small" data-action="remove-blank-order" data-editor="studyEditExplanation" data-order="${b.order}">\uD574\uC81C</button>
      </div>
    <textarea data-study-answer-key="${b.order}" class="sm">${escapeHtml(b.answer)}</textarea></div>`).join("");
  }
  function renderStudyEditPreview() {
    const template = document.getElementById("studyEditExplanation").value;
    const src = [...document.querySelectorAll("[data-study-answer-key]")].map((el) => ({
      order: Number(el.dataset.studyAnswerKey),
      answer: el.value
    }));
    const synced = syncTemplateAndBlanks(template, src);
    document.getElementById("studyEditExplanationPreview").innerHTML = formatPromptHtml(synced.template, synced.blanks);
  }

  // js/ui/study.js
  function renderStudyMeta() {
    const threshold = Number(document.getElementById("gradingThreshold")?.value || getState().settings.gradingThreshold);
    getState().settings.gradingThreshold = threshold;
    document.getElementById("thresholdLabel").textContent = `${threshold}% \uC774\uC0C1`;
    const c = store.studyQueue[store.studyIndex];
    const box = document.getElementById("studyMeta");
    if (!c) {
      box.innerHTML = '<span class="pill">\uB300\uAE30</span>';
      document.getElementById("roundBadge").textContent = "\uD68C\uB3C5 0";
      return;
    }
    box.innerHTML = `
    <span class="pill">${store.studyIndex + 1}/${store.studyQueue.length}</span>
    <span class="pill">${escapeHtml(c.title)}</span>
    <span class="pill"><span class="flag flag-${c.flagColor}"></span></span>
    <span class="pill">${escapeHtml(folderPathNames(c.folderId))}</span>`;
    document.getElementById("roundBadge").textContent = `\uD68C\uB3C5 ${c.rounds}`;
  }
  function renderStudyCard() {
    renderStudyMeta();
    const c = store.studyQueue[store.studyIndex];
    const prompt2 = document.getElementById("studyPrompt");
    const explanation = document.getElementById("studyExplanation");
    if (!c) {
      prompt2.innerHTML = '<span class="empty">\uD559\uC2B5\uC744 \uC2DC\uC791\uD558\uC138\uC694.</span>';
      if (explanation) explanation.innerHTML = '<span class="empty">\uD574\uC124 \uC601\uC5ED</span>';
      document.getElementById("gradeResult").textContent = "\uBE48\uCE78 \uC785\uB825 \uD6C4 Enter\uB85C \uCC44\uC810";
      document.getElementById("studyNavigator").innerHTML = "";
      return;
    }
    if (!store.currentBlankStatuses.length || store._studyCardId !== c.id) {
      store.currentBlankStatuses = c.blanks.map((b) => ({
        order: b.order,
        checked: false,
        correct: false,
        score: 0,
        user: "",
        revealed: false
      }));
      store.studyAttemptRecorded = false;
      store.currentBlankFocus = null;
      store._studyCardId = c.id;
    }
    prompt2.innerHTML = formatProblemHtml(c.displayText);
    explanation.innerHTML = formatStudyExplanationHtml(c, store.currentBlankStatuses);
    document.getElementById("studyNavigator").innerHTML = c.blanks.map((b) => `<button class="small ghost" data-action="focus-blank" data-order="${b.order}">\uBE48\uCE78${b.order}</button>`).join("");
    document.getElementById("studyMemo").value = c.memo || "";
    const checked = store.currentBlankStatuses.filter((s) => s.checked).length;
    const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
    document.getElementById("gradeResult").textContent = checked ? `\uCC44\uC810 ${ok}/${c.blanks.length} \xB7 Enter\uB85C \uBE48\uCE78\uBCC4 \uCC44\uC810` : "\uD574\uC124\uC5D0\uC11C \uBE48\uCE78 \uC785\uB825 \u2192 Enter\uB85C \uCC44\uC810";
    renderStudyEditForm(c);
  }
  function paintInlineBlanks(statuses) {
    statuses.forEach((s) => {
      const input = document.querySelector(`[data-blank-order="${s.order}"]`);
      if (!input) return;
      input.classList.toggle("ok", s.correct);
      input.classList.toggle("bad", s.checked && !s.correct);
      input.classList.toggle("focus", store.currentBlankFocus === s.order);
      if (s.revealed && s.correct) input.readOnly = true;
    });
  }
  function refreshStudyViews() {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    document.getElementById("studyPrompt").innerHTML = formatProblemHtml(c.displayText);
    document.getElementById("studyExplanation").innerHTML = formatStudyExplanationHtml(c, store.currentBlankStatuses);
    paintInlineBlanks(store.currentBlankStatuses);
  }
  function focusBlankUI(order) {
    store.currentBlankFocus = order;
    const input = document.querySelector(`[data-blank-order="${order}"]`);
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    refreshStudyViews();
  }
  function getBlankInputValue(order) {
    return document.querySelector(`[data-blank-order="${order}"]`)?.value?.trim() || "";
  }

  // js/ui/router.js
  var MOBILE_BP = 900;
  function isMobileLayout() {
    return window.matchMedia(`(max-width: ${MOBILE_BP}px)`).matches;
  }
  function showSection(name, { urlExtra = {}, replaceUrl = false, fromHash = false } = {}) {
    store.currentSection = name;
    store.data.ui.section = name.startsWith("study") ? "study" : name;
    const isManage = name === "manage";
    const isCreate = name === "create";
    const isStudy = name === "study" || name === "study-play";
    document.getElementById("manageSection").classList.toggle("hidden", !isManage);
    document.getElementById("createSection").classList.toggle("hidden", !isCreate);
    document.getElementById("studySection").classList.toggle("hidden", !isStudy);
    const studyEl = document.getElementById("studySection");
    studyEl.style.display = isStudy ? "flex" : "";
    syncNavActive(name);
    if (isStudy) renderStudyMeta();
    if (isMobileLayout()) closeMobileMenu();
    if (!fromHash) {
      const page = name === "study-play" ? "study-play" : name;
      syncUrl(page, urlExtra, replaceUrl);
    }
    persist();
  }
  function syncNavActive(name) {
    const isManage = name === "manage";
    const isCreate = name === "create";
    const isStudy = name === "study" || name === "study-play";
    document.querySelectorAll("#navManage, #navCreate, #navStudy, .topbar-nav .nav-btn").forEach((el) => {
      el.classList.remove("active");
    });
    const add = (id) => document.getElementById(id)?.classList.add("active");
    if (isManage) add("navManage");
    if (isCreate) add("navCreate");
    if (isStudy) add("navStudy");
    document.querySelectorAll(".topbar-nav .nav-btn").forEach((btn) => {
      const action = btn.dataset.action;
      if (isManage && action === "nav-manage") btn.classList.add("active");
      if (isCreate && action === "nav-create") btn.classList.add("active");
      if (isStudy && action === "nav-study") btn.classList.add("active");
    });
  }
  function toggleSidebar() {
    if (isMobileLayout()) return;
    const collapsed = !store.data.ui.sidebarCollapsed;
    store.data.ui.sidebarCollapsed = collapsed;
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    updateSidebarToggleBtn();
    persist();
  }
  function toggleMobileMenu() {
    if (!isMobileLayout()) return;
    const open = !document.body.classList.contains("mobile-menu-open");
    document.body.classList.toggle("mobile-menu-open", open);
    const btn = document.getElementById("hamburgerBtn");
    if (btn) {
      btn.textContent = open ? "\u2715" : "\u2630";
      btn.setAttribute("aria-label", open ? "\uBA54\uB274 \uB2EB\uAE30" : "\uBA54\uB274");
    }
  }
  function closeMobileMenu() {
    document.body.classList.remove("mobile-menu-open");
    const btn = document.getElementById("hamburgerBtn");
    if (btn) {
      btn.textContent = "\u2630";
      btn.setAttribute("aria-label", "\uBA54\uB274");
    }
  }
  function updateSidebarToggleBtn() {
    const btn = document.getElementById("sidebarToggle");
    if (!btn) return;
    const collapsed = !!store.data.ui.sidebarCollapsed;
    btn.textContent = collapsed ? "\u25B6" : "\u25C0";
    btn.title = collapsed ? "\uC0AC\uC774\uB4DC\uBC14 \uD3BC\uCE58\uAE30" : "\uC0AC\uC774\uB4DC\uBC14 \uC811\uAE30";
  }
  function applySidebarState() {
    if (isMobileLayout()) {
      document.body.classList.remove("sidebar-collapsed");
      closeMobileMenu();
      return;
    }
    document.body.classList.toggle("sidebar-collapsed", !!store.data.ui.sidebarCollapsed);
    updateSidebarToggleBtn();
  }
  function handleViewportChange() {
    if (isMobileLayout()) {
      document.body.classList.remove("sidebar-collapsed");
      closeMobileMenu();
    } else {
      document.body.classList.remove("mobile-menu-open");
      document.body.classList.toggle("sidebar-collapsed", !!store.data.ui.sidebarCollapsed);
      updateSidebarToggleBtn();
    }
  }

  // js/ui/sidebar.js
  function renderSidebar() {
    const state = getState();
    const user = getActiveUser();
    const loggedInEl = document.getElementById("loggedInUser");
    const guestEl = document.getElementById("guestUserPanel");
    if (loggedInEl) loggedInEl.classList.toggle("hidden", !user);
    if (guestEl) guestEl.classList.toggle("hidden", !!user);
    if (!user) {
      return;
    }
    if (loggedInEl) {
      document.getElementById("currentUserName").textContent = user.name;
    }
    const cards = getUserCards(user.id);
    document.getElementById("userSummary").textContent = `\uCE74\uB4DC ${cards.length}\uAC1C \xB7 \uD3F4\uB354 ${getUserFolders(user.id).length}\uAC1C`;
    const filters = readFilters();
    const filtered = getCardsFiltered(filters, store.activeFolderId);
    document.getElementById("selectionList").innerHTML = filtered.length ? filtered.map((c) => `
      <label class="list-item" style="cursor:default">
        <input type="checkbox" data-action="toggle-select" data-id="${c.id}" ${state.selectedIds.includes(c.id) ? "checked" : ""} />
        <span>${escapeHtml(shorten(c.title || c.displayText, 30))}</span>
      </label>`).join("") : '<div class="list-item"><span class="item-sub">\uC5C6\uC74C</span></div>';
    document.getElementById("statTotal").textContent = cards.length;
    document.getElementById("statSelected").textContent = state.selectedIds.filter((id) => cards.some((c) => c.id === id)).length;
    document.getElementById("statRounds").textContent = cards.reduce((a, c) => a + c.rounds, 0);
  }
  function readFilters() {
    return {
      search: document.getElementById("searchInput").value,
      flag: document.getElementById("flagFilter").value,
      wrong: document.getElementById("wrongFilter").value
    };
  }

  // js/ui/manage.js
  function renderFolderTree() {
    const wrap = document.getElementById("folderTree");
    const user = getActiveUser();
    if (!user) {
      wrap.innerHTML = '<div class="caption">\uB85C\uADF8\uC778\uD558\uC138\uC694.</div>';
      return;
    }
    const userId = user.id;
    const folders = getUserFolders(userId);
    const roots = folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (!roots.length) {
      wrap.innerHTML = '<div class="caption">\uD3F4\uB354\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uB8E8\uD2B8 \uD3F4\uB354\uB97C \uB9CC\uB4DC\uC138\uC694.</div>';
      return;
    }
    wrap.innerHTML = roots.map((f) => folderNodeHtml(f, folders, userId)).join("");
  }
  function folderNodeHtml(folder, all, userId) {
    const kids = all.filter((f) => f.parentId === folder.id).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const cnt = countCardsInFolder(folder.id, userId);
    const expanded = store.data.ui.treeExpanded[folder.id] !== false;
    const active = store.activeFolderId === folder.id;
    return `<div class="tree-node ${active ? "active" : ""}" data-folder-id="${folder.id}">
    <div class="tree-row">
      <div class="tree-left">
        <button class="tree-toggle" data-action="toggle-tree" data-id="${folder.id}">${kids.length ? expanded ? "\u25BE" : "\u25B8" : "\xB7"}</button>
        <div data-action="select-folder" data-id="${folder.id}" style="min-width:0;cursor:pointer">
          <div class="tree-title">${escapeHtml(folder.name)}</div>
          <div class="tree-meta">\uCE74\uB4DC ${cnt}\uAC1C</div>
        </div>
      </div>
      <div class="toolbar">
        <button class="small ghost" data-action="create-folder" data-parent="${folder.id}">+</button>
        <button class="small ghost" data-action="rename-folder" data-id="${folder.id}">\u270E</button>
        <button class="small danger" data-action="delete-folder" data-id="${folder.id}">\xD7</button>
      </div>
    </div>
    ${expanded && kids.length ? `<div class="tree-children">${kids.map((k) => folderNodeHtml(k, all, userId)).join("")}</div>` : ""}
  </div>`;
  }
  function renderCardList() {
    const list = document.getElementById("cardList");
    const cards = getCardsFiltered(readFilters(), store.activeFolderId);
    if (!cards.length) {
      list.innerHTML = '<div class="list-item"><span class="item-sub">\uCE74\uB4DC \uC5C6\uC74C</span></div>';
      return;
    }
    list.innerHTML = cards.map((c) => `
    <div class="list-item ${store.activeManageId === c.id ? "active" : ""}" draggable="true"
      data-action="select-card" data-id="${c.id}" data-drag-card="${c.id}">
      <span class="flag flag-${c.flagColor}"></span>
      <div style="flex:1;min-width:0">
        <div class="item-title">${escapeHtml(c.title || shorten(c.displayText))}</div>
        <div class="item-sub">${escapeHtml(folderPathNames(c.folderId))} \xB7 \uBE48\uCE78 ${c.blanks.length} \xB7 \uD68C\uB3C5 ${c.rounds}${c.isSample ? " \xB7 \uC0D8\uD50C" : ""}</div>
      </div>
    </div>`).join("");
  }
  function renderManageDetail(id) {
    store.activeManageId = id;
    renderCardList();
    const box = document.getElementById("manageDetail");
    if (!id) {
      box.textContent = "\uCE74\uB4DC\uB97C \uC120\uD0DD\uD558\uC138\uC694.";
      return;
    }
    const c = getCard(id);
    if (!c) {
      box.textContent = "\uCE74\uB4DC\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
      return;
    }
    const opts = buildFolderOptions(getActiveUser().id);
    box.innerHTML = `<div class="col">
    <div><strong>${escapeHtml(c.title)}</strong> <span class="flag flag-${c.flagColor}"></span></div>
    <div class="caption">${escapeHtml(folderPathNames(c.folderId))} \xB7 \uD68C\uB3C5 ${c.rounds} \xB7 \uC624\uB2F5 ${c.wrongCount}</div>
    <div><strong>\uBB38\uC81C</strong><br>${formatProblemHtml(c.displayText)}</div>
    <div><strong>\uD574\uC124</strong><br>${formatPromptHtml(c.explanationText || "", c.blanks || [])}</div>
    <div><strong>\uC815\uB2F5</strong><br>${c.blanks.map((b) => `\uBE48\uCE78${b.order}: ${escapeHtml(b.answer)}`).join("<br>") || "\uC5C6\uC74C"}</div>
    <div><strong>\uBA54\uBAA8</strong><br>${escapeHtml(c.memo || "(\uC5C6\uC74C)")}</div>
    <label>\uD3F4\uB354 \uC774\uB3D9</label>
    <select data-action="move-card-folder" data-card-id="${c.id}">
      <option value="">(\uBBF8\uBD84\uB958)</option>${opts}
    </select>
    <div class="toolbar">
      <button class="primary" data-action="edit-card" data-id="${c.id}">\uC218\uC815\uD558\uAE30</button>
      <button class="pink" data-action="study-one" data-id="${c.id}">\uBC14\uB85C \uD559\uC2B5</button>
      <button class="danger" data-action="delete-card" data-id="${c.id}">\uC0AD\uC81C</button>
    </div>
  </div>`;
    const sel = box.querySelector('[data-action="move-card-folder"]');
    if (sel) sel.value = c.folderId || "";
  }
  function renderFolderSelects() {
    const user = getActiveUser();
    const opts = user ? buildFolderOptions(user.id) : "";
    ["cardFolder", "studyEditFolder"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const cur = el.value;
      el.innerHTML = `<option value="">(\uBBF8\uBD84\uB958)</option>${opts}`;
      if ([...el.options].some((o) => o.value === cur)) el.value = cur;
    });
  }

  // js/ui/render.js
  function renderAll() {
    renderSidebar();
    renderFolderTree();
    renderFolderSelects();
    renderCardList();
    if (store.currentSection === "create") {
      try {
        const cardId = document.getElementById("cardId").value;
        if (cardId && getCard(cardId)) {
          renderCreatePreview(getCard(cardId));
        } else {
          const draft = readCreateForm([]);
          renderCreatePreview({ displayText: draft.displayText, blanks: draft.blanks });
        }
      } catch {
        renderCreatePreview({ displayText: "", blanks: [] });
      }
    }
    renderStudyMeta();
  }

  // js/ui/auth.js
  function readAuthName() {
    return document.getElementById("authName")?.value?.trim().normalize("NFC") || "";
  }
  function showAuthOverlay(mode = "login") {
    const overlay = document.getElementById("authOverlay");
    overlay?.classList.remove("hidden");
    document.body.classList.add("auth-locked");
    setAuthTab(mode);
    renderAuthUserLists();
    document.getElementById("authName")?.focus();
    overlay?.scrollIntoView({ block: "center" });
  }
  function hideAuthOverlay() {
    document.getElementById("authOverlay")?.classList.add("hidden");
    document.body.classList.remove("auth-locked");
  }
  function setAuthTab(tab) {
    store.authTab = tab;
    document.getElementById("authLoginPanel")?.classList.toggle("hidden", tab !== "login");
    document.getElementById("authRegisterPanel")?.classList.toggle("hidden", tab !== "register");
    document.getElementById("authSetupPanel")?.classList.toggle("hidden", tab !== "setup");
    document.getElementById("authTabBar")?.classList.toggle("hidden", tab === "setup");
    document.querySelector(".auth-name-block")?.classList.toggle("hidden", tab === "setup");
    document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.authTab === tab);
    });
  }
  function renderAuthUserLists() {
    const users = getState()?.users || [];
    const el = document.getElementById("authSavedAccounts");
    if (el) {
      el.textContent = users.length ? `\uC774 \uBE0C\uB77C\uC6B0\uC800\uC5D0 \uC800\uC7A5\uB41C \uACC4\uC815: ${users.map((u) => u.name).join(", ")}` : "\uC800\uC7A5\uB41C \uACC4\uC815 \uC5C6\uC74C \u2014 \uD68C\uC6D0\uAC00\uC785 \uD0ED\uC5D0\uC11C \uC0C8\uB85C \uB9CC\uB4DC\uC138\uC694.";
    }
  }
  function showPinSetup(userId, userName) {
    store.pendingPinSetupUserId = userId;
    document.getElementById("setupUserName").textContent = userName;
    const nameInput = document.getElementById("authName");
    if (nameInput) nameInput.value = userName;
    setAuthTab("setup");
    showAuthOverlay("setup");
  }
  function readLoginForm() {
    return {
      name: readAuthName(),
      pin: document.getElementById("loginPin")?.value || ""
    };
  }
  function readRegisterForm() {
    return {
      name: readAuthName(),
      pin: document.getElementById("registerPin")?.value || "",
      pinConfirm: document.getElementById("registerPinConfirm")?.value || ""
    };
  }
  function readSetupForm() {
    return {
      pin: document.getElementById("setupPin")?.value || "",
      pinConfirm: document.getElementById("setupPinConfirm")?.value || ""
    };
  }
  function clearAuthInputs() {
    ["authName", "loginPin", "registerPin", "registerPinConfirm", "setupPin", "setupPinConfirm"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
  }
  function showAuthMessage(msg, type = "error") {
    const el = document.getElementById("authFeedback");
    if (!el) return;
    el.textContent = msg || "";
    el.className = msg ? `auth-feedback auth-feedback-${type}` : "auth-feedback hidden";
    if (msg) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function setAuthSubmitting(busy) {
    document.querySelectorAll("[data-auth-submit]").forEach((btn) => {
      btn.disabled = busy;
      const label = btn.dataset.label || btn.textContent;
      if (busy) btn.textContent = btn.dataset.busyLabel || "\uCC98\uB9AC \uC911\u2026";
      else btn.textContent = label;
    });
  }

  // js/services/undo.js
  var undoStack = [];
  var applyingUndo = false;
  function pushUndo() {
    if (applyingUndo) return;
    undoStack.push(deepCopy(getState()));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }
  async function undo() {
    if (!undoStack.length) {
      alert("\uB418\uB3CC\uB9B4 \uC0C1\uD0DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
      return false;
    }
    applyingUndo = true;
    setState(migrateState(undoStack.pop()));
    applyingUndo = false;
    await persist();
    return true;
  }

  // js/services/grading.js
  function similarity(a, b) {
    const A = normalizeTight(a);
    const B = normalizeTight(b);
    if (!A || !B) return 0;
    if (A === B) return 100;
    const dp = Array.from({ length: A.length + 1 }, () => Array(B.length + 1).fill(0));
    for (let i = 0; i <= A.length; i++) dp[i][0] = i;
    for (let j = 0; j <= B.length; j++) dp[0][j] = j;
    for (let i = 1; i <= A.length; i++) {
      for (let j = 1; j <= B.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1)
        );
      }
    }
    const dist = dp[A.length][B.length];
    return Math.max(0, Math.round((1 - dist / Math.max(A.length, B.length)) * 100));
  }
  function checkAnswer(user, accepted, threshold) {
    if (accepted.some((a) => normalizeTight(user) === normalizeTight(a))) {
      return { correct: true, score: 100 };
    }
    const scores = accepted.map((a) => similarity(user, a));
    const best = scores.length ? Math.max(...scores) : 0;
    return { correct: best >= threshold, score: best };
  }

  // js/services/import-export.js
  function exportData(scope, activeFolderId) {
    const state = getState();
    const uid2 = getActiveUser().id;
    let payload;
    if (scope === "user") {
      payload = {
        version: 1,
        users: [getActiveUser()],
        folders: getUserFolders(uid2),
        cards: getUserCards(uid2),
        exportedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } else if (scope === "folder") {
      if (!activeFolderId) {
        alert("\uD3F4\uB354\uB97C \uBA3C\uC800 \uC120\uD0DD\uD558\uC138\uC694.");
        return;
      }
      const fids = [activeFolderId, ...getDescendantFolderIds(activeFolderId, uid2)];
      payload = {
        version: 1,
        folders: state.folders.filter((f) => fids.includes(f.id)),
        cards: getUserCards(uid2).filter((c) => fids.includes(c.folderId)),
        exportedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } else {
      payload = { ...state, exportedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cbt_backup_${scope}_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    a.click();
  }
  function mergeImport(data) {
    const state = getState();
    (data.users || []).forEach((u) => {
      if (!state.users.some((x) => x.id === u.id)) state.users.push(u);
    });
    (data.folders || []).forEach((f) => {
      const i = state.folders.findIndex((x) => x.id === f.id);
      if (i >= 0) state.folders[i] = f;
      else state.folders.push(f);
    });
    (data.cards || []).forEach((c) => {
      const card = migrateCard(c);
      const i = state.cards.findIndex((x) => x.id === card.id);
      if (i >= 0) state.cards[i] = card;
      else state.cards.push(card);
    });
  }
  async function importFromFile(file, mode) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (mode === "overwrite") {
      return migrateState(parsed.users ? parsed : { ...parsed, users: getState().users });
    }
    mergeImport(parsed);
    return getState();
  }

  // js/ui/modal.js
  function openAutoBlankModal(candidates, onApply) {
    const root = document.getElementById("modalRoot");
    root.innerHTML = `<div class="modal-backdrop" data-action="close-modal">
    <div class="modal">
      <h3>\uC790\uB3D9 \uBE48\uCE78 \uD6C4\uBCF4 (${candidates.length}\uAC1C)</h3>
      <div class="caption">\uC801\uC6A9\uD560 \uD56D\uBAA9\uC744 \uC120\uD0DD\uD558\uC138\uC694. \uC22B\uC790\xB7\uD310\uB840\uBC88\uD638\xB7\uC870\uD56D\uC740 \uC81C\uC678\uB429\uB2C8\uB2E4.</div>
      <div class="candidate-list">${candidates.map(([token]) => `<label class="candidate-row"><input type="checkbox" checked data-auto-token="${escapeHtml(token)}" /> ${escapeHtml(token)}</label>`).join("")}
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="primary" data-action="apply-auto-blank">\uC120\uD0DD \uC801\uC6A9</button>
        <button class="ghost" data-action="close-modal">\uCDE8\uC18C</button>
      </div>
    </div>
  </div>`;
    root._onApplyAutoBlank = onApply;
  }
  function closeModal() {
    const root = document.getElementById("modalRoot");
    root.innerHTML = "";
    delete root._onApplyAutoBlank;
  }
  function getSelectedAutoTokens() {
    return [...document.querySelectorAll("#modalRoot [data-auto-token]")].filter((el) => el.checked).map((el) => el.dataset.autoToken);
  }

  // js/services/auth.js
  function validatePin(pin) {
    return /^\d{4}$/.test(String(pin || ""));
  }
  function verifyPin(pin, user) {
    return !!user?.pin && user.pin === pin;
  }
  function userNeedsPinSetup(user) {
    return user && !user.pin;
  }

  // js/app/actions.js
  async function completeLogin(userId) {
    const state = getState();
    const user = state.users.find((u) => u.id === userId);
    if (!user) return false;
    store.authenticatedUserId = userId;
    state.activeUserId = userId;
    store.activeFolderId = null;
    store.activeManageId = null;
    clearAuthInputs();
    showAuthMessage("");
    await saveState();
    hideAuthOverlay();
    renderCreateForm(null);
    renderManageDetail(null);
    renderAll();
    return true;
  }
  function restoreSession() {
    const state = getState();
    const userId = state.activeUserId;
    if (!userId) return false;
    const user = state.users.find((u) => u.id === userId);
    if (!user) {
      state.activeUserId = null;
      return false;
    }
    if (userNeedsPinSetup(user)) {
      showPinSetup(user.id, user.name);
      return false;
    }
    store.authenticatedUserId = userId;
    hideAuthOverlay();
    return true;
  }
  async function loginUser() {
    showAuthMessage("");
    setAuthSubmitting(true);
    try {
      const { name, pin } = readLoginForm();
      if (!name) return showAuthMessage("\uB9E8 \uC704 \u300C\uC774\uB984\u300D \uCE78\uC5D0 \uAC00\uC785\uD560 \uB54C \uC4F4 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694.", "error");
      if (!validatePin(pin)) return showAuthMessage("4\uC790\uB9AC \uC22B\uC790 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.", "error");
      const user = findUserByName(name);
      if (!user) {
        const saved = getState().users.map((u) => u.name).join(", ");
        return showAuthMessage(
          saved ? `"${name}" \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC800\uC7A5\uB41C \uACC4\uC815: ${saved}` : `"${name}" \uACC4\uC815\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uD68C\uC6D0\uAC00\uC785 \uD0ED\uC5D0\uC11C \uBA3C\uC800 \uB9CC\uB4DC\uC138\uC694.`,
          "error"
        );
      }
      if (userNeedsPinSetup(user)) {
        showPinSetup(user.id, user.name);
        return;
      }
      const ok = verifyPin(pin, user);
      if (!ok) return showAuthMessage("\uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC785\uB825\uD574 \uC8FC\uC138\uC694.", "error");
      await completeLogin(user.id);
    } catch (err) {
      console.error(err);
      showAuthMessage(err.message || "\uB85C\uADF8\uC778 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.", "error");
    } finally {
      setAuthSubmitting(false);
    }
  }
  async function registerUser() {
    showAuthMessage("");
    setAuthSubmitting(true);
    try {
      const { name, pin, pinConfirm } = readRegisterForm();
      if (!name) return showAuthMessage("\uB9E8 \uC704 \u300C\uC774\uB984\u300D \uCE78\uC5D0 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694.", "error");
      if (name.length < 2) return showAuthMessage("\uC774\uB984\uC740 2\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uC138\uC694.", "error");
      if (findUserByName(name)) {
        return showAuthMessage(`"${name}" \uACC4\uC815\uC774 \uC774\uBBF8 \uC788\uC2B5\uB2C8\uB2E4. \uB85C\uADF8\uC778 \uD0ED\uC5D0\uC11C \uAC19\uC740 \uC774\uB984\xB7\uBE44\uBC00\uBC88\uD638\uB85C \uB4E4\uC5B4\uAC00\uC138\uC694.`, "error");
      }
      if (!validatePin(pin)) return showAuthMessage("\uBE44\uBC00\uBC88\uD638\uB294 4\uC790\uB9AC \uC22B\uC790(0000~9999)\uC5EC\uC57C \uD569\uB2C8\uB2E4.", "error");
      if (pin !== pinConfirm) return showAuthMessage("\uBE44\uBC00\uBC88\uD638 \uD655\uC778\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", "error");
      pushUndo();
      const u = {
        id: uid("u"),
        name: normalizeUserName(name),
        pin,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      getState().users.push(u);
      await saveState();
      showAuthMessage(`"${name}" \uACC4\uC815\uC744 \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4. \uB4E4\uC5B4\uAC11\uB2C8\uB2E4\u2026`, "success");
      await completeLogin(u.id);
      showSection("manage");
    } catch (err) {
      console.error(err);
      showAuthMessage(err.message || "\uACC4\uC815 \uC0DD\uC131\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.", "error");
    } finally {
      setAuthSubmitting(false);
    }
  }
  async function setupUserPin() {
    showAuthMessage("");
    setAuthSubmitting(true);
    try {
      const userId = store.pendingPinSetupUserId;
      const { pin, pinConfirm } = readSetupForm();
      const user = getState().users.find((u) => u.id === userId);
      if (!user) return showAuthMessage("\uC0AC\uC6A9\uC790\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", "error");
      if (!validatePin(pin)) return showAuthMessage("\uBE44\uBC00\uBC88\uD638\uB294 4\uC790\uB9AC \uC22B\uC790\uC5EC\uC57C \uD569\uB2C8\uB2E4.", "error");
      if (pin !== pinConfirm) return showAuthMessage("\uBE44\uBC00\uBC88\uD638 \uD655\uC778\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", "error");
      pushUndo();
      user.pin = pin;
      store.pendingPinSetupUserId = null;
      await saveState();
      await completeLogin(userId);
    } catch (err) {
      console.error(err);
      showAuthMessage(err.message || "\uBE44\uBC00\uBC88\uD638 \uC124\uC815\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.", "error");
    } finally {
      setAuthSubmitting(false);
    }
  }
  async function logoutUser() {
    const prevName = getActiveUser()?.name || "";
    store.authenticatedUserId = null;
    getState().activeUserId = null;
    store.activeFolderId = null;
    store.activeManageId = null;
    clearAuthInputs();
    if (prevName) {
      const el = document.getElementById("authName");
      if (el) el.value = prevName;
    }
    showAuthMessage("");
    await saveState();
    showAuthOverlay("login");
    renderAuthUserLists();
    renderAll();
  }
  async function renameUser() {
    const u = getActiveUser();
    if (!u) return;
    const name = prompt("\uC0C8 \uC774\uB984", u.name);
    if (!name?.trim()) return;
    if (getState().users.some((x) => x.id !== u.id && x.name === name.trim())) {
      return alert("\uAC19\uC740 \uC774\uB984\uC774 \uC788\uC2B5\uB2C8\uB2E4.");
    }
    pushUndo();
    u.name = name.trim();
    await saveState();
    renderAll();
  }
  async function deleteUser() {
    const u = getActiveUser();
    if (!u) return;
    const pin = prompt(`"${u.name}" \uACC4\uC815 \uC0AD\uC81C \u2014 4\uC790\uB9AC \uBE44\uBC00\uBC88\uD638 \uC785\uB825`);
    if (!pin) return;
    if (!validatePin(pin)) return alert("4\uC790\uB9AC \uC22B\uC790 \uBE44\uBC00\uBC88\uD638\uB97C \uC785\uB825\uD558\uC138\uC694.");
    if (userNeedsPinSetup(u) || !verifyPin(pin, u)) {
      return alert("\uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    }
    if (!confirm(`"${u.name}" \uACC4\uC815\uACFC \uBAA8\uB4E0 \uCE74\uB4DC\xB7\uD3F4\uB354\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?`)) return;
    pushUndo();
    const state = getState();
    state.cards = state.cards.filter((c) => c.userId !== u.id);
    state.folders = state.folders.filter((f) => f.userId !== u.id);
    state.users = state.users.filter((x) => x.id !== u.id);
    state.selectedIds = state.selectedIds.filter((id) => !state.cards.some((c) => c.id === id));
    store.authenticatedUserId = null;
    state.activeUserId = null;
    await saveState();
    if (state.users.length) {
      showAuthOverlay("login");
      renderAuthUserLists();
    } else {
      showAuthOverlay("register");
    }
    renderAll();
  }
  function selectFolder(id) {
    store.activeFolderId = id;
    renderAll();
  }
  function toggleTree(id) {
    getState().ui.treeExpanded[id] = getState().ui.treeExpanded[id] === false;
    persist();
    renderAll();
  }
  function expandAllTree(expand) {
    getUserFolders(getActiveUser().id).forEach((f) => {
      getState().ui.treeExpanded[f.id] = expand;
    });
    persist();
    renderAll();
  }
  async function createFolder(parentId) {
    const name = prompt("\uD3F4\uB354 \uC774\uB984");
    if (!name?.trim()) return;
    pushUndo();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const f = {
      id: uid("f"),
      userId: getActiveUser().id,
      name: name.trim(),
      parentId: parentId || null,
      createdAt: now,
      updatedAt: now
    };
    getState().folders.push(f);
    getState().ui.treeExpanded[f.id] = true;
    if (parentId) getState().ui.treeExpanded[parentId] = true;
    await saveState();
    renderAll();
  }
  async function renameFolder(id) {
    const f = getFolder(id);
    if (!f) return;
    const name = prompt("\uC0C8 \uD3F4\uB354 \uC774\uB984", f.name);
    if (!name?.trim()) return;
    pushUndo();
    f.name = name.trim();
    f.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveState();
    renderAll();
  }
  async function deleteFolder(id) {
    const f = getFolder(id);
    if (!f) return;
    const cnt = countCardsInFolder(id, f.userId);
    if (!confirm(`"${f.name}" \uD3F4\uB354(\uD558\uC704 \uD3EC\uD568 \uCE74\uB4DC ${cnt}\uAC1C)\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?`)) return;
    pushUndo();
    const desc = getDescendantFolderIds(id, f.userId);
    desc.push(id);
    getState().folders = getState().folders.filter((x) => !desc.includes(x.id));
    getUserCards(f.userId).filter((c) => desc.includes(c.folderId)).forEach((c) => {
      c.folderId = null;
    });
    if (store.activeFolderId === id) store.activeFolderId = null;
    await saveState();
    renderAll();
  }
  async function dropCardOnFolder(cardId, folderId) {
    const card = getCard(cardId);
    if (!card) return;
    pushUndo();
    card.folderId = folderId;
    card.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveState();
    renderAll();
  }
  function startNewCard() {
    renderCreateForm(null);
    showSection("create", { urlExtra: {} });
    document.getElementById("cardTitle").focus();
  }
  function editCard(id) {
    const c = getCard(id);
    if (!c) return;
    renderCreateForm(c);
    showSection("create", { urlExtra: { cardId: id } });
  }
  async function saveCard() {
    const draft = readCreateForm(getCard(document.getElementById("cardId").value)?.blanks || []);
    if (!draft.displayText.trim()) return alert("\uBB38\uC81C\uB97C \uC785\uB825\uD558\uC138\uC694.");
    if (!draft.explanationText.trim()) return alert("\uD574\uC124\uC744 \uC785\uB825\uD558\uC138\uC694.");
    pushUndo();
    const state = getState();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = getCard(draft.id);
    if (existing) {
      Object.assign(existing, draft, { userId: getActiveUser().id, updatedAt: now, isSample: false });
      existing.originalText = draft.displayText;
      existing.blanks = draft.blanks.map((b) => ({ ...b, cardId: existing.id }));
    } else {
      const newId = uid("c");
      const card = migrateCard({
        ...draft,
        id: newId,
        userId: getActiveUser().id,
        createdAt: now,
        updatedAt: now,
        rounds: 0,
        wrongCount: 0,
        isSample: false
      });
      card.originalText = card.displayText;
      card.blanks = card.blanks.map((b) => ({ ...b, cardId: card.id }));
      state.cards.unshift(card);
      store.activeManageId = card.id;
      document.getElementById("cardId").value = card.id;
    }
    await saveState();
    alert("\uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.");
    showSection("create", { urlExtra: { cardId: store.activeManageId }, replaceUrl: true });
    renderManageDetail(store.activeManageId);
    renderAll();
  }
  async function deleteCurrentCard() {
    const id = document.getElementById("cardId").value;
    if (!id) return alert("\uC0AD\uC81C\uD560 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    if (!confirm("\uC774 \uCE74\uB4DC\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?")) return;
    await deleteCardById(id);
    renderCreateForm(null);
  }
  async function deleteCardById(id) {
    if (!confirm("\uC0AD\uC81C\uD560\uAE4C\uC694?")) return;
    pushUndo();
    const state = getState();
    state.cards = state.cards.filter((c) => c.id !== id);
    state.selectedIds = state.selectedIds.filter((x) => x !== id);
    if (store.activeManageId === id) renderManageDetail(null);
    await saveState();
    renderAll();
  }
  async function moveCardFolder(cardId, folderId) {
    const c = getCard(cardId);
    if (!c) return;
    pushUndo();
    c.folderId = folderId || null;
    c.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveState();
    renderAll();
  }
  async function toggleSelected(id, checked) {
    pushUndo();
    const state = getState();
    if (checked) state.selectedIds = [.../* @__PURE__ */ new Set([...state.selectedIds, id])];
    else state.selectedIds = state.selectedIds.filter((x) => x !== id);
    await saveState();
    renderAll();
  }
  async function selectFiltered(all) {
    const ids = getCardsFiltered(readFilters(), store.activeFolderId).map((c) => c.id);
    pushUndo();
    const state = getState();
    if (all) state.selectedIds = [.../* @__PURE__ */ new Set([...state.selectedIds, ...ids])];
    else state.selectedIds = state.selectedIds.filter((x) => !ids.includes(x));
    await saveState();
    renderAll();
  }
  async function deleteSampleData() {
    const samples = getState().cards.filter((c) => c.isSample && c.userId === getActiveUser().id);
    if (!samples.length) return alert("\uC0AD\uC81C\uD560 \uC0D8\uD50C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    if (!confirm(`\uC0D8\uD50C \uCE74\uB4DC ${samples.length}\uAC1C\uB97C \uC0AD\uC81C\uD560\uAE4C\uC694?`)) return;
    pushUndo();
    const ids = samples.map((c) => c.id);
    getState().cards = getState().cards.filter((c) => !ids.includes(c.id));
    getState().selectedIds = getState().selectedIds.filter((x) => !ids.includes(x));
    await saveState();
    renderAll();
  }
  function makeBlankFromSelection(editorId) {
    const el = document.getElementById(editorId);
    const { start, end, text } = selectionRange(el);
    if (!text.trim()) return alert("\uBE48\uCE78\uC73C\uB85C \uB9CC\uB4E4 \uB2E8\uC5B4\xB7\uAD6C\uC808\uC744 \uB4DC\uB798\uADF8\uB85C \uC120\uD0DD\uD558\uC138\uC694.");
    pushUndo();
    const cardId = document.getElementById("cardId").value || store.studyQueue[store.studyIndex]?.id || "";
    const synced = readBlanksFromEditor(editorId, cardId, getCard(cardId)?.blanks || []);
    const norm = makeBlankInText(synced.template, synced.blanks, start, end, text);
    refreshEditorUI(editorId, norm, norm.caret);
  }
  function removeBlankFromSelection(editorId) {
    const el = document.getElementById(editorId);
    const { start, end, text } = selectionRange(el);
    let order = null;
    let rangeStart = start;
    let rangeEnd = end;
    const tokenMatch = String(text).match(/\[\[BLANK(\d+)\]\]/);
    if (tokenMatch) {
      order = Number(tokenMatch[1]);
    } else {
      const atCursor = findBlankTokenAtCursor(el.value, start);
      if (atCursor) {
        order = atCursor.order;
        rangeStart = atCursor.start;
        rangeEnd = atCursor.end;
      }
    }
    if (!order) {
      return alert("\uD574\uC81C\uD560 \uBE48\uCE78\uC744 \uC120\uD0DD\uD558\uAC70\uB098, \uCEE4\uC11C\uB97C [[BLANK1]] \uD1A0\uD070 \uC548\uC5D0 \uB450\uC138\uC694. \uBAA9\uB85D\uC758 \xD7 \uBC84\uD2BC\uB3C4 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    }
    pushUndo();
    const cardId = document.getElementById("cardId").value || store.studyQueue[store.studyIndex]?.id || "";
    const synced = readBlanksFromEditor(editorId, cardId, getCard(cardId)?.blanks || []);
    const norm = removeBlankFromText(synced.template, synced.blanks, rangeStart, rangeEnd, order);
    refreshEditorUI(editorId, norm, norm.caret);
  }
  function removeBlankByOrder(editorId, order) {
    const el = document.getElementById(editorId);
    if (!order) return;
    pushUndo();
    const cardId = document.getElementById("cardId").value || store.studyQueue[store.studyIndex]?.id || "";
    const synced = readBlanksFromEditor(editorId, cardId, getCard(cardId)?.blanks || []);
    const norm = removeBlankAtOrder(synced.template, synced.blanks, order);
    refreshEditorUI(editorId, norm, norm.caret);
  }
  function jumpToBlank(editorId, order) {
    const el = document.getElementById(editorId);
    if (!selectBlankToken(el, order)) {
      alert(`\uBE48\uCE78 ${order} \uD1A0\uD070\uC744 \uD574\uC124\uC5D0\uC11C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.`);
    }
  }
  function openAutoBlank(editorId) {
    store.autoBlankEditorId = editorId;
    const el = document.getElementById(editorId);
    if (!el.value.trim()) return alert("\uC6D0\uBB38\uC744 \uBA3C\uC800 \uC785\uB825\uD558\uC138\uC694.");
    const cardId = document.getElementById("cardId").value || store.studyQueue[store.studyIndex]?.id || "";
    const synced = readBlanksFromEditor(editorId, cardId, getCard(cardId)?.blanks || []);
    const candidates = findAutoCandidates(el.value, synced.blanks);
    if (!candidates.length) return alert("\uC790\uB3D9 \uBE48\uCE78 \uD6C4\uBCF4\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    openAutoBlankModal(candidates, applyAutoBlank);
  }
  function applyAutoBlank() {
    const editorId = store.autoBlankEditorId;
    const tokens = getSelectedAutoTokens();
    if (!tokens.length) return alert("\uC120\uD0DD\uB41C \uD6C4\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    pushUndo();
    const el = document.getElementById(editorId);
    const view = captureTextareaView(el);
    const cardId = document.getElementById("cardId").value || store.studyQueue[store.studyIndex]?.id || "";
    const synced = readBlanksFromEditor(editorId, cardId, getCard(cardId)?.blanks || []);
    const norm = applyAutoBlankTokens(synced.template, synced.blanks, tokens);
    refreshEditorUI(editorId, norm, { start: view.start, end: view.end });
    closeModal();
    alert(`${tokens.length}\uAC1C \uBE48\uCE78\uC744 \uC801\uC6A9\uD588\uC2B5\uB2C8\uB2E4.`);
  }
  function applyQuickAutoBlank(editorId, limit = 5) {
    const el = document.getElementById(editorId);
    if (!el?.value.trim()) return alert("\uD574\uC124\uC744 \uBA3C\uC800 \uC785\uB825\uD558\uC138\uC694.");
    const view = captureTextareaView(el);
    const cardId = document.getElementById("cardId").value || store.studyQueue[store.studyIndex]?.id || "";
    const synced = readBlanksFromEditor(editorId, cardId, getCard(cardId)?.blanks || []);
    const candidates = findAutoCandidates(el.value, synced.blanks);
    if (!candidates.length) return alert("\uC790\uB3D9 \uBE48\uCE78 \uD6C4\uBCF4\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. (2\uC790 \uBBF8\uB9CC\xB7\uC22B\uC790\xB7\uC870\uD56D\xB7\uBD88\uC6A9\uC5B4 \uC81C\uC678)");
    const tokens = candidates.slice(0, limit).map(([t]) => t);
    pushUndo();
    const norm = applyAutoBlankTokens(synced.template, synced.blanks, tokens);
    refreshEditorUI(editorId, norm, { start: view.start, end: view.end });
    alert(`\uCD94\uCC9C ${tokens.length}\uAC1C\uB97C \uBE48\uCE78\uC73C\uB85C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4: ${tokens.join(", ")}`);
  }
  function startStudy() {
    const mode = document.getElementById("studyMode").value;
    let cards = buildStudyQueue(mode, store.activeFolderId, getState().selectedIds);
    if (mode.includes("random")) cards = shuffle(cards);
    if (!cards.length) return alert("\uD559\uC2B5\uD560 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
    store.studyQueue = cards;
    store.studyIndex = 0;
    store._studyCardId = null;
    renderStudyCard();
    showSection("study-play", { urlExtra: { index: 0 } });
  }
  function studyOne(id) {
    const c = getCard(id);
    if (!c) return;
    store.studyQueue = [c];
    store.studyIndex = 0;
    store._studyCardId = null;
    renderStudyCard();
    showSection("study-play", { urlExtra: { index: 0 } });
  }
  async function gradeBlankOnEnter(order) {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    const user = getBlankInputValue(order);
    if (!user) return;
    const threshold = Number(document.getElementById("gradingThreshold").value);
    const blank = c.blanks.find((b) => b.order === order);
    const { correct, score } = checkAnswer(user, splitAnswers(blank?.answer || ""), threshold);
    let st = store.currentBlankStatuses.find((s) => s.order === order);
    if (!st) return;
    st.checked = true;
    st.correct = correct;
    st.score = score;
    st.user = user;
    st.revealed = true;
    if (blank) {
      blank.lastInput = user;
      blank.lastResult = correct ? "correct" : "wrong";
    }
    if (store.currentBlankStatuses.every((s) => s.checked)) {
      applyCardResult(c, store.currentBlankStatuses);
    }
    refreshStudyViews();
    const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
    const total = c.blanks.length;
    document.getElementById("gradeResult").textContent = correct ? `\uBE48\uCE78${order} \uC815\uB2F5! (${ok}/${total})` : `\uBE48\uCE78${order} \uC624\uB2F5 \xB7 ${score}% (${ok}/${total})`;
    await persist();
  }
  async function gradeCurrent() {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    pushUndo();
    const threshold = Number(document.getElementById("gradingThreshold").value);
    getState().settings.gradingThreshold = threshold;
    store.currentBlankStatuses = c.blanks.map((b) => {
      const user = getBlankInputValue(b.order);
      const { correct, score } = checkAnswer(user, splitAnswers(b.answer), threshold);
      b.lastInput = user;
      b.lastResult = correct ? "correct" : "wrong";
      return { order: b.order, checked: true, correct, score, user, revealed: true };
    });
    applyCardResult(c, store.currentBlankStatuses);
    refreshStudyViews();
    const ok = store.currentBlankStatuses.filter((s) => s.correct).length;
    document.getElementById("gradeResult").textContent = `\uC804\uCCB4 \uCC44\uC810 ${ok}/${store.currentBlankStatuses.length}`;
    await persist();
    renderAll();
  }
  function applyCardResult(c, statuses) {
    const allCorrect = statuses.every((s) => s.correct);
    c.lastResult = allCorrect ? "correct" : "wrong";
    if (!allCorrect) c.wrongCount = (c.wrongCount || 0) + 1;
    store.studyAttemptRecorded = true;
  }
  function hideAnswers() {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    store.currentBlankStatuses = c.blanks.map((b) => ({
      order: b.order,
      checked: false,
      correct: false,
      score: 0,
      user: "",
      revealed: false
    }));
    store._studyCardId = null;
    renderStudyCard();
    document.getElementById("gradeResult").textContent = "\uB2E4\uC2DC \uD480 \uC900\uBE44\uB410\uC2B5\uB2C8\uB2E4.";
  }
  async function adjustRounds(delta) {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    pushUndo();
    c.rounds = Math.max(0, c.rounds + delta);
    c.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persist();
    renderAll();
    renderStudyCard();
  }
  async function saveStudyMemo() {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    pushUndo();
    c.memo = document.getElementById("studyMemo").value;
    c.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveState();
    renderAll();
  }
  async function saveStudyEdits() {
    const c = store.studyQueue[store.studyIndex];
    if (!c) return;
    pushUndo();
    const synced = readBlanksFromEditor("studyEditExplanation", c.id, c.blanks);
    c.title = document.getElementById("studyEditTitle").value.trim() || c.title;
    c.folderId = document.getElementById("studyEditFolder").value || null;
    c.displayText = stripBlankMarkers(document.getElementById("studyEditPrompt").value);
    c.originalText = c.displayText;
    c.explanationText = synced.template;
    c.blanks = synced.blanks.map((b) => ({
      ...b,
      cardId: c.id,
      answer: document.querySelector(`[data-study-answer-key="${b.order}"]`)?.value || b.answer
    }));
    c.memo = document.getElementById("studyEditMemo").value;
    c.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persist();
    if (document.getElementById("cardId").value === c.id) renderCreateForm(c);
    if (store.activeManageId === c.id) renderManageDetail(c.id);
    renderAll();
    renderStudyCard();
    alert("\uC6D0\uBCF8 \uCE74\uB4DC\uC5D0 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.");
  }
  function prevCard() {
    if (store.studyIndex > 0) {
      store.studyIndex--;
      store._studyCardId = null;
      renderStudyCard();
      showSection("study-play", { urlExtra: { index: store.studyIndex }, replaceUrl: true });
    }
  }
  function nextCard() {
    if (store.studyIndex < store.studyQueue.length - 1) {
      store.studyIndex++;
      store._studyCardId = null;
      renderStudyCard();
      showSection("study-play", { urlExtra: { index: store.studyIndex }, replaceUrl: true });
    }
  }
  async function applyFlag(n) {
    const c = store.studyQueue[store.studyIndex] || getCard(document.getElementById("cardId").value);
    if (!c) return;
    pushUndo();
    c.flagColor = n;
    await persist();
    renderAll();
    renderStudyCard();
  }
  async function undoAppState() {
    const ok = await undo();
    if (ok) {
      renderAll();
      renderStudyCard();
      alert("\uB418\uB3CC\uB9AC\uAE30 \uC644\uB8CC");
    }
  }
  function handleExport(scope) {
    exportData(scope, store.activeFolderId);
  }
  async function handleImport(file) {
    if (!file) return;
    try {
      const mode = confirm("\uD655\uC778=\uBCD1\uD569 / \uCDE8\uC18C=\uB36E\uC5B4\uC4F0\uAE30") ? "merge" : "overwrite";
      pushUndo();
      const next = await importFromFile(file, mode);
      if (mode === "overwrite") setState(next);
      await saveState();
      renderStudyCard();
      renderAll();
      alert("\uAC00\uC838\uC624\uAE30 \uC644\uB8CC");
    } catch {
      alert("JSON \uD30C\uC2F1 \uC2E4\uD328");
    }
  }
  function onCreateInput() {
    const cardId = document.getElementById("cardId").value;
    const blanks = getCard(cardId)?.blanks || [];
    renderCreatePreview(readCreateForm(blanks));
  }

  // js/main.js
  function handleHashRoute(fromInit = false) {
    const route = parseRoute();
    if (route.page === "manage") {
      showSection("manage", { fromHash: true });
      if (!fromInit) renderAll();
      return;
    }
    if (route.page === "create") {
      showSection("create", { fromHash: true, urlExtra: { cardId: route.cardId } });
      if (route.cardId) {
        const c = getCard(route.cardId);
        if (c) renderCreateForm(c);
        else renderCreateForm(null);
      } else if (!fromInit) {
        renderCreateForm(null);
      }
      if (!fromInit) renderAll();
      return;
    }
    if (route.page === "study") {
      showSection("study", { fromHash: true });
      if (!fromInit) renderAll();
      return;
    }
    if (route.page === "study-play") {
      showSection("study-play", { fromHash: true, urlExtra: { index: route.index } });
      if (store.studyQueue.length) {
        const idx = Math.min(Math.max(0, route.index), store.studyQueue.length - 1);
        store.studyIndex = idx;
        store._studyCardId = null;
        renderStudyCard();
      }
      if (!fromInit) renderAll();
    }
  }
  async function init() {
    bindEvents();
    try {
      const saved = await loadState();
      setState(migrateState(saved));
    } catch {
      setState(migrateState(null));
    }
    document.getElementById("gradingThreshold").value = store.data.settings.gradingThreshold;
    applySidebarState();
    const sessionRestored = restoreSession();
    if (!sessionRestored) {
      const users = store.data.users;
      showAuthOverlay(users.length ? "login" : "register");
      renderAuthUserLists();
    }
    if (!location.hash) {
      navigate("/manage", { replace: true });
    }
    handleHashRoute(true);
    try {
      renderAll();
      renderManageDetail(null);
      if (!store.studyQueue.length) renderStudyCard();
    } catch (err) {
      console.error(err);
      if (!store.authenticatedUserId) {
        showAuthOverlay(store.data.users.length ? "login" : "register");
      }
      showAuthMessage(`\uD654\uBA74 \uCD08\uAE30\uD654 \uC624\uB958: ${err.message}`, "error");
    }
    window.addEventListener("resize", handleViewportChange);
  }
  function bindEvents() {
    window.addEventListener("hashchange", () => handleHashRoute(false));
    window.addEventListener("popstate", () => handleHashRoute(false));
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown);
    document.getElementById("folderTree").addEventListener("dragover", (e) => {
      const node = e.target.closest("[data-folder-id]");
      if (node) {
        e.preventDefault();
        node.classList.add("drop-target");
      }
    });
    document.getElementById("folderTree").addEventListener("dragleave", (e) => {
      const node = e.target.closest("[data-folder-id]");
      if (node) node.classList.remove("drop-target");
    });
    document.getElementById("folderTree").addEventListener("drop", (e) => {
      const node = e.target.closest("[data-folder-id]");
      if (!node) return;
      e.preventDefault();
      node.classList.remove("drop-target");
      const cardId = e.dataTransfer.getData("text/card-id");
      if (cardId) dropCardOnFolder(cardId, node.dataset.folderId);
    });
    document.getElementById("cardList").addEventListener("dragstart", (e) => {
      const item = e.target.closest("[data-drag-card]");
      if (!item) return;
      e.dataTransfer.setData("text/card-id", item.dataset.dragCard);
      item.classList.add("dragging");
    });
    document.getElementById("cardList").addEventListener("dragend", (e) => {
      e.target.closest("[data-drag-card]")?.classList.remove("dragging");
    });
  }
  function runAuthAction(fn) {
    const result = fn();
    if (result?.catch) {
      result.catch((err) => {
        console.error(err);
        showAuthMessage(err?.message || "\uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.", "error");
      });
    }
  }
  function onClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const map = {
      "toggle-sidebar": () => toggleSidebar(),
      "toggle-mobile-menu": () => toggleMobileMenu(),
      "close-mobile-menu": () => closeMobileMenu(),
      "nav-manage": () => showSection("manage"),
      "nav-create": () => startNewCard(),
      "nav-study": () => showSection("study"),
      "export-all": () => handleExport("all"),
      "export-user": () => handleExport("user"),
      "export-folder": () => handleExport("folder"),
      "undo": () => undoAppState(),
      "auth-login": () => runAuthAction(loginUser),
      "auth-register": () => runAuthAction(registerUser),
      "auth-setup": () => runAuthAction(setupUserPin),
      "auth-tab-login": () => {
        setAuthTab("login");
        showAuthMessage("");
      },
      "auth-tab-register": () => {
        setAuthTab("register");
        showAuthMessage("");
      },
      "logout": () => runAuthAction(logoutUser),
      "rename-user": () => renameUser(),
      "delete-user": () => deleteUser(),
      "select-all": () => selectFiltered(true),
      "deselect-all": () => selectFiltered(false),
      "delete-sample": () => deleteSampleData(),
      "new-card": () => startNewCard(),
      "save-card": () => saveCard(),
      "delete-card-form": () => deleteCurrentCard(),
      "make-blank": () => makeBlankFromSelection(btn.dataset.editor),
      "remove-blank": () => removeBlankFromSelection(btn.dataset.editor),
      "remove-blank-order": () => removeBlankByOrder(btn.dataset.editor, Number(btn.dataset.order)),
      "jump-blank": () => jumpToBlank(btn.dataset.editor, Number(btn.dataset.order)),
      "auto-blank": () => openAutoBlank(btn.dataset.editor),
      "quick-auto-blank": () => applyQuickAutoBlank(btn.dataset.editor, Number(btn.dataset.limit || 5)),
      "start-study": () => startStudy(),
      "grade": () => gradeCurrent(),
      "hide-answers": () => hideAnswers(),
      "save-memo": () => saveStudyMemo(),
      "save-study-edit": () => saveStudyEdits(),
      "round-minus": () => adjustRounds(-1),
      "round-plus": () => adjustRounds(1),
      "prev-card": () => prevCard(),
      "next-card": () => nextCard(),
      "toggle-tree": () => toggleTree(btn.dataset.id),
      "select-folder": () => selectFolder(btn.dataset.id),
      "create-folder": () => createFolder(btn.dataset.parent || null),
      "rename-folder": () => renameFolder(btn.dataset.id),
      "delete-folder": () => deleteFolder(btn.dataset.id),
      "select-card": () => renderManageDetail(btn.dataset.id),
      "edit-card": () => editCard(btn.dataset.id),
      "study-one": () => studyOne(btn.dataset.id),
      "delete-card": () => deleteCardById(btn.dataset.id),
      "focus-blank": () => focusBlankUI(Number(btn.dataset.order)),
      "expand-tree": () => expandAllTree(true),
      "collapse-tree": () => expandAllTree(false),
      "create-root-folder": () => createFolder(null),
      "close-modal": () => closeModal(),
      "apply-auto-blank": () => applyAutoBlank()
    };
    if (action === "close-modal" && e.target === btn && btn.classList.contains("modal-backdrop")) {
      closeModal();
      return;
    }
    if (map[action]) {
      e.preventDefault();
      map[action]();
    }
  }
  function onChange(e) {
    if (e.target.id === "importFile") handleImport(e.target.files?.[0]).then(() => {
      e.target.value = "";
    });
    if (e.target.dataset.action === "toggle-select") toggleSelected(e.target.dataset.id, e.target.checked);
    if (e.target.dataset.action === "move-card-folder") moveCardFolder(e.target.dataset.cardId, e.target.value);
    if (["searchInput", "flagFilter", "wrongFilter"].includes(e.target.id)) renderAll();
    if (e.target.id === "gradingThreshold") {
      store.data.settings.gradingThreshold = Number(e.target.value);
      persist();
      renderAll();
    }
  }
  function onInput(e) {
    if (e.target.id === "promptTemplate") {
      document.getElementById("promptPreview").innerHTML = formatProblemHtml(e.target.value);
      return;
    }
    if (e.target.id === "explanationTemplate" || e.target.matches("[data-answer-key]")) onCreateInput();
    if (e.target.id === "studyEditExplanation" || e.target.matches("[data-study-answer-key]")) renderStudyEditPreview();
    if (["searchInput"].includes(e.target.id)) renderAll();
  }
  function onKeydown(e) {
    const active = document.activeElement;
    const isText = active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" && active.type === "text");
    const isBlankField = active?.matches?.("[data-blank-order]");
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoAppState();
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b" && isText && active.selectionStart !== active.selectionEnd) {
      if (active.id === "explanationTemplate" || active.id === "studyEditExplanation") {
        e.preventDefault();
        makeBlankFromSelection(active.id);
      }
      return;
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[0-7]$/.test(e.key)) {
      e.preventDefault();
      applyFlag(Number(e.key));
      return;
    }
    if (isBlankField && e.key === "Enter") {
      e.preventDefault();
      gradeBlankOnEnter(Number(active.dataset.blankOrder));
      return;
    }
    if (document.getElementById("authOverlay") && !document.getElementById("authOverlay").classList.contains("hidden")) {
      if (e.isComposing) return;
      if (e.key === "Enter" && active?.matches?.("#authName, #loginPin, #registerPinConfirm, #setupPinConfirm, #registerPin, #setupPin")) {
        e.preventDefault();
        const tab = store.authTab;
        if (tab === "login") loginUser();
        else if (tab === "register") registerUser();
        else if (tab === "setup") setupUserPin();
        return;
      }
    }
    if (store.currentSection.startsWith("study") && e.key === "Enter" && !e.shiftKey && active?.tagName === "TEXTAREA") {
      e.preventDefault();
      gradeCurrent();
    }
  }
  init();
})();
