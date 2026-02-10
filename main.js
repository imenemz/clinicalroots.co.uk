// --------------------------
// BASIC API HELPER
// --------------------------
alert("main.js is running");

const API_BASE = "https://imeneee.pythonanywhere.com";

function apiUrl(path) {
    if (path.startsWith("http")) return path;
    return `${API_BASE}${path}`;
}

function apiHeaders() {
    const token = sessionStorage.getItem("jwt");
    return token
        ? {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
          }
        : { "Content-Type": "application/json" };
}

async function api(endpoint, opts = {}) {
    const url = apiUrl(endpoint);
    const options = { headers: apiHeaders(), ...opts };

    let res;
    try {
        res = await fetch(url, options);
    } catch (err) {
        console.error("Fetch failed:", { url, err });
        throw new Error(
            "Backend unreachable (PythonAnywhere app may be paused) or CORS/network error."
        );
    }

    // --- Handle 401 properly ---
    if (res.status === 401) {
        const hasToken = !!sessionStorage.getItem("jwt");

        // If the user was trying to LOGIN and got 401 => wrong credentials
        if (endpoint === "/api/login") {
            const text = await res.text();
            // backend sends {"message":"Invalid credentials"} but text() is fine
            throw new Error(text || "Invalid credentials");
        }

        // If we had a token and got 401 => session expired
        if (hasToken) {
            alert("Session expired. Please log in again.");
            handleLogout(false);
            openLogin();
            throw new Error("Unauthorized");
        }

        // No token + 401 => just unauthorized access attempt
        const text = await res.text();
        throw new Error(text || "Unauthorized");
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
    }

    if (res.status === 204) return {};
    return res.json();
}


function qs(id) {
    return document.getElementById(id);
}

// --------------------------
// GLOBAL STATE
// --------------------------
const elements = {
    pages: {
        home: qs("homePage"),
        library: qs("libraryPage"),
        category: qs("categoryPage"),
        subcategory: qs("subcategoryPage"),
        noteView: qs("notePage"),
        admin: qs("adminDashboard"),
        adminNotes: qs("adminNotesPage"),
        addNote: qs("addNotePage"),
        tools: qs("Guide"),
        ia: qs("iaPage"),
        about: qs("aboutPage"),
    },
    subcategoriesGrid: qs("subcategoriesGrid"),
    notesContainer: qs("notesContainer"),
    adminNotesContainer: qs("adminNotesContainer"),
    noteTitle: qs("noteTitle"),
    noteBody: qs("noteBody"),
    noteMeta: qs("noteMeta"),
    loginForm: qs("loginForm"),
    loginModal: qs("loginModal"),
    loginBtn: qs("loginBtn"),
    userMenu: qs("userMenu"),
    noteForm: qs("noteForm"),
    noteFormTitle: qs("noteFormTitle"),
    noteFormCategory: qs("noteFormCategory"),
    noteFormSubcategory: qs("noteFormSubcategory"),
    noteFormContent: qs("noteFormContent"),
    publishedCount: qs("publishedCount"),
    draftsCount: qs("draftsCount"),
    deletedCount: qs("deletedCount"),
    totalViews: qs("totalViews"),
};

let currentUser = null;
let currentCategoryId = null;
let categoriesTree = [];
let flatCategories = [];   // {id, name, parent_id, path}
let adminNoteCache = {};   // id -> note
let editingNoteId = null;  // null = create mode

// --------------------------
// THEME
// --------------------------
function toggleTheme() {
    const body = document.body;
    const current = body.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    body.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
}

function initTheme() {
    const saved = localStorage.getItem("theme");
    if (saved) {
        document.body.setAttribute("data-theme", saved);
    } else if (window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.body.setAttribute("data-theme", "dark");
    } else {
        document.body.setAttribute("data-theme", "light");
    }
}

// --------------------------
// AUTH
// --------------------------
async function handleLogin(e) {
    e.preventDefault();
    const email = qs("loginEmail").value;
    const password = qs("loginPassword").value;

    try {
        const data = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });

        if (!data.token) {
            alert(data.message || "Login failed");
            return;
        }

        sessionStorage.setItem("jwt", data.token);
        sessionStorage.setItem("user", JSON.stringify(data.user));
        currentUser = data.user;
        updateLoginUI();
        closeLogin();
        showAdminDashboard();
    } catch (err) {
        alert("Login error: " + err.message);
    }
}

function updateLoginUI() {
    const stored = sessionStorage.getItem("user");
    currentUser = stored ? JSON.parse(stored) : null;

    const authButtons = qs("authButtons");
    if (!authButtons || !elements.userMenu) return;

    if (!currentUser) {
        authButtons.classList.remove("hidden");
        elements.userMenu.classList.add("hidden");
        document.body.classList.remove("admin-logged-in");
    } else {
        authButtons.classList.add("hidden");
        elements.userMenu.classList.remove("hidden");
        document.body.classList.add("admin-logged-in");
    }
}

function handleLogout(showAlert = true) {
    sessionStorage.removeItem("jwt");
    sessionStorage.removeItem("user");
    currentUser = null;
    updateLoginUI();
    hideUserMenu();
    showHome();
    if (showAlert) alert("Logged out.");
}

function openLogin() {
    if (elements.loginModal) {
        elements.loginModal.style.display = "flex";
    }
}

function closeLogin() {
    if (elements.loginModal) {
        elements.loginModal.style.display = "none";
    }
}

function toggleUserMenu() {
    const dd = qs("userDropdownContent");
    if (!dd) return;
    dd.style.display = dd.style.display === "block" ? "none" : "block";
}

function hideUserMenu() {
    const dd = qs("userDropdownContent");
    if (dd) dd.style.display = "none";
}

// --------------------------
// CATEGORY FETCH & HELPERS
// --------------------------
async function fetchCategoriesTree() {
    const tree = await api("/api/categories/tree");
    categoriesTree = tree;

    flatCategories = [];
    function walk(nodes, parentPath = "") {
        for (const n of nodes) {
            const path = parentPath ? `${parentPath} :: ${n.name}` : n.name;
            flatCategories.push({
                id: n.id,
                name: n.name,
                parent_id: n.parent_id,
                path,
            });
            if (n.children && n.children.length) {
                walk(n.children, path);
            }
        }
    }
    walk(tree);

    return tree;
}

function getCategoryById(id) {
    return flatCategories.find((c) => c.id === id);
}

function getRootForCategory(catId) {
    let current = getCategoryById(catId);
    if (!current) return null;
    while (current.parent_id) {
        current = getCategoryById(current.parent_id);
    }
    return current;
}

function getDescendantsOf(rootId) {
    const root = getCategoryById(rootId);
    if (!root) return [];
    const prefix = root.path + " :: ";
    return flatCategories.filter(
        (c) => c.id !== rootId && c.path.startsWith(prefix)
    );
}

// --------------------------
// PUBLIC CATEGORY / NOTES VIEW
// --------------------------

// ONLY renders into Library page (#subcategoriesGrid)
// does NOT touch the big 3 boxes on the Home page anymore
async function fetchAndRenderTopCategories() {
    if (!flatCategories.length) {
        await fetchCategoriesTree();
    }

    const grid = document.getElementById("subcategoriesGrid");
    if (!grid) return;

    grid.innerHTML = "";

    const tops = flatCategories.filter((c) => !c.parent_id);
    tops.forEach((c) => {
        const div = document.createElement("div");
        div.className = "subcategory-card category-card";
        div.style.cursor = "pointer";
        div.onclick = () => openCategoryById(c.id);
        div.innerHTML = `<h4>${c.name}</h4>`;
        grid.appendChild(div);
    });
}

async function openCategoryById(catId) {
    if (!flatCategories.length) {
        await fetchCategoriesTree();
    }
    currentCategoryId = catId;

    const cat = getCategoryById(catId);
    const children = flatCategories.filter((c) => c.parent_id === catId);

    // Decide which page to show
    if (children.length > 0) {
        // Parent category => show subcategories
        switchView("category");

        const header = qs("categoryTitle");
        const desc = qs("categoryDescription");
        if (header) header.textContent = cat ? cat.name : "Category";
        if (desc) desc.textContent = cat ? cat.path : "";

        const subcontainer = qs("subcategoriesContainer");
        if (subcontainer) subcontainer.innerHTML = "";

        // Admin button to add subcategory under this category
        if (currentUser && currentUser.role === "admin" && cat && subcontainer) {
            const btnWrap = document.createElement("div");
            btnWrap.style.marginBottom = "1rem";

            const btn = document.createElement("button");
            btn.className = "btn btn-success";
            btn.textContent = `+ Add subcategory under "${cat.name}"`;
            btn.onclick = () => promptAddSubcategory(catId);

            btnWrap.appendChild(btn);
            subcontainer.appendChild(btnWrap);
        }

        // Render child categories
        if (subcontainer) {
            children.forEach((ch) => {
                const card = document.createElement("div");
                card.className = "subcategory-card";
                card.onclick = () => openCategoryById(ch.id);

                let adminControlsHtml = "";
                if (currentUser && currentUser.role === "admin") {
                    const isRoot = !ch.parent_id;
                    if (!isRoot) {
                        adminControlsHtml = `
                            <div class="admin-controls">
                                <button class="admin-btn edit" title="Rename"
                                    onclick="event.stopPropagation(); promptRenameCategory(${ch.id})">
                                    <i class="fas fa-pen"></i>
                                </button>
                                <button class="admin-btn delete" title="Delete"
                                    onclick="event.stopPropagation(); promptDeleteCategory(${ch.id})">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        `;
                    }
                }

                card.innerHTML = `
                    ${adminControlsHtml}
                    <h4>${ch.name}</h4>
                `;
                subcontainer.appendChild(card);
            });
        }

        // IMPORTANT:
        // Don’t render notes on the category page (because your notes list is on subcategoryPage)
        return;
    }

    // Leaf category => show notes list (subcategory page)
    switchView("subcategory");

    const subTitle = qs("subcategoryTitle");
    const subDesc = qs("subcategoryDescription");
    if (subTitle) subTitle.textContent = cat ? cat.name : "Subcategory";
    if (subDesc) subDesc.textContent = cat ? cat.path : "";

    // Fetch notes for this leaf
    const notes = await api(`/api/notes?category=${catId}`);
    const notesContainer = qs("notesContainer");
    if (notesContainer) notesContainer.innerHTML = "";

    // Admin "add note" button for this subcategory
    if (currentUser && currentUser.role === "admin" && cat && notesContainer) {
        const btnWrap = document.createElement("div");
        btnWrap.style.marginBottom = "1rem";

        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = `+ Add note in "${cat.name}"`;
        btn.onclick = () => showAddNote(catId);

        btnWrap.appendChild(btn);
        notesContainer.appendChild(btnWrap);
    }

    if (notesContainer) {
        notes.forEach((n) => {
            const card = document.createElement("div");
            card.className = "note-item";
            card.onclick = () => showNoteView(n.id);
            card.innerHTML = `
                <div class="note-info">
                    <h4>${n.title}</h4>
                    <div class="note-meta">${n.views} views</div>
                </div>
            `;
            notesContainer.appendChild(card);
        });

        if (!notes.length) {
            notesContainer.innerHTML += `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <p>No notes in this subcategory yet.</p>
                </div>
            `;
        }
    }
}

let searchIndex = {
  categories: [], // {id, name, path}
  notes: [],      // {id, title, category_id}
  ready: false,
};

async function buildSearchIndex() {
  if (!flatCategories.length) await fetchCategoriesTree();

  // Categories
  searchIndex.categories = flatCategories.map(c => ({
    id: c.id,
    name: c.name,
    path: c.path,
  }));

  // Notes (needs category_id from backend — see app.py patch below)
  try {
    const notes = await api("/api/notes");
    searchIndex.notes = notes.map(n => ({
      id: n.id,
      title: n.title,
      category_id: n.category_id,
    }));
  } catch (e) {
    console.warn("Search notes fetch failed:", e);
    searchIndex.notes = [];
  }

  searchIndex.ready = true;
}

function highlightMatch(text, q) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    text.slice(0, idx) +
    `<span class="suggestion-highlight">${text.slice(idx, idx + q.length)}</span>` +
    text.slice(idx + q.length)
  );
}

function setupSearch(inputEl, suggEl) {
  if (!inputEl || !suggEl) return;

  let selectedIndex = -1;
  let lastItems = [];

  function close() {
    suggEl.classList.add("hidden");
    suggEl.innerHTML = "";
    selectedIndex = -1;
    lastItems = [];
  }

  function open(items) {
    lastItems = items;
    suggEl.classList.toggle("hidden", items.length === 0);

    suggEl.innerHTML = items
      .map((it, i) => `
        <div class="suggestion-item" data-idx="${i}">
          <div class="suggestion-title">${it.titleHtml}</div>
          <div class="suggestion-meta">${it.meta}</div>
        </div>
      `)
      .join("");

    suggEl.querySelectorAll(".suggestion-item").forEach((row) => {
      row.addEventListener("mouseenter", () => {
        selectedIndex = parseInt(row.dataset.idx, 10);
        renderSelected();
      });
      row.addEventListener("click", () => {
        const it = lastItems[parseInt(row.dataset.idx, 10)];
        if (it) it.onPick();
        close();
        inputEl.value = "";
      });
    });
  }

  function renderSelected() {
    suggEl.querySelectorAll(".suggestion-item").forEach((row) => {
      row.classList.toggle(
        "selected",
        parseInt(row.dataset.idx, 10) === selectedIndex
      );
    });
  }

  async function search(q) {
    if (!q || q.trim().length < 2) return open([]);
    if (!searchIndex.ready) await buildSearchIndex();

    const query = q.trim().toLowerCase();
    const out = [];

    // Notes first
    for (const n of searchIndex.notes) {
      if (n.title.toLowerCase().includes(query)) {
        const cat = getCategoryById(n.category_id);
        const meta = cat ? cat.path.replaceAll(" :: ", " | ") : "Note";
        out.push({
          titleHtml: highlightMatch(n.title, query),
          meta,
          onPick: () => showNoteView(n.id),
        });
      }
      if (out.length >= 6) break;
    }

    // Then categories
    for (const c of searchIndex.categories) {
      if (c.name.toLowerCase().includes(query)) {
        out.push({
          titleHtml: highlightMatch(c.name, query),
          meta: c.path.replaceAll(" :: ", " | "),
          onPick: () => openCategoryById(c.id),
        });
      }
      if (out.length >= 10) break;
    }

    open(out);
  }

  let t = null;
  inputEl.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => search(inputEl.value), 150);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (suggEl.classList.contains("hidden")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, lastItems.length - 1);
      renderSelected();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderSelected();
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0 && lastItems[selectedIndex]) {
        e.preventDefault();
        lastItems[selectedIndex].onPick();
        close();
        inputEl.value = "";
      }
    } else if (e.key === "Escape") {
      close();
    }
  });

  document.addEventListener("click", (e) => {
    if (!inputEl.contains(e.target) && !suggEl.contains(e.target)) close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupSearch(qs("searchInput"), qs("searchSuggestions"));
  setupSearch(qs("navSearchInput"), qs("navSearchSuggestions"));

  // Build index early (so first search feels instant)
  buildSearchIndex().catch(() => {});
});


function initCollapsibleHeadings(container) {
  if (!container) return;

  const headings = Array.from(container.querySelectorAll(".heading-block"));

  headings.forEach((hb, i) => {
    const title = hb.querySelector(".main-heading");
    if (!title) return;

    title.style.cursor = "pointer";

    // everything after this heading until the next heading-block
    const contentNodes = [];
    let node = hb.nextElementSibling;
    while (node && !node.classList.contains("heading-block")) {
      contentNodes.push(node);
      node = node.nextElementSibling;
    }

    // start collapsed by default (auto collapsing)
    contentNodes.forEach((n) => n.classList.add("collapsed-section"));

    title.addEventListener("click", () => {
      const isCollapsed = contentNodes.length
        ? contentNodes[0].classList.contains("collapsed-section")
        : false;
      contentNodes.forEach((n) =>
        n.classList.toggle("collapsed-section", !isCollapsed)
      );
      hb.classList.toggle("heading-collapsed", isCollapsed);
    });
  });
}



async function showNoteView(noteId) {
  switchView("noteView");
  const note = await api(`/api/note/${noteId}`);

  elements.noteTitle.textContent = note.title;
  elements.noteBody.innerHTML = note.content;

  const cat = getCategoryById(note.category_id);
  const path = cat ? cat.path.replaceAll(" :: ", " | ") : "";
  elements.noteMeta.textContent = path;

  initCollapsibleHeadings(elements.noteBody);
}

// --------------------------
// ADMIN – CATEGORIES
// --------------------------
async function promptAddSubcategory(parentId) {
    if (!currentUser || currentUser.role !== "admin") return;
    const parent = getCategoryById(parentId);
    const name = prompt(
        `Add new subcategory under "${parent ? parent.name : "category"}":`
    );
    if (!name) return;

    try {
        await api("/api/category", {
            method: "POST",
            body: JSON.stringify({ name, parent_id: parentId }),
        });
        await fetchCategoriesTree();
        openCategoryById(parentId);
    } catch (err) {
        alert("Error creating subcategory: " + err.message);
    }
}

async function promptRenameCategory(catId) {
    if (!currentUser || currentUser.role !== "admin") return;
    const cat = getCategoryById(catId);
    const name = prompt("New name:", cat ? cat.name : "");
    if (!name) return;

    try {
        await api(`/api/category/${catId}`, {
            method: "PUT",
            body: JSON.stringify({ name }),
        });
        await fetchCategoriesTree();
        const parentId = cat.parent_id || catId;
        if (parentId) openCategoryById(parentId);
    } catch (err) {
        alert("Error renaming category: " + err.message);
    }
}

async function promptDeleteCategory(catId) {
    if (!currentUser || currentUser.role !== "admin") return;
    const cat = getCategoryById(catId);
    if (!cat) return;

    if (
        !confirm(
            `Delete category "${cat.name}"? You must move/delete its content first.`
        )
    )
        return;

    try {
        const res = await api(`/api/category/${catId}`, { method: "DELETE" });
        if (res.message) alert(res.message);
        await fetchCategoriesTree();
        if (cat.parent_id) openCategoryById(cat.parent_id);
        else showManageCategories();
    } catch (err) {
        alert("Error deleting category: " + err.message);
    }
}

// stubs for the admin buttons on the 3 big home cards
async function addSubcategory(rootName) {
    if (!currentUser || currentUser.role !== "admin") return;
    if (!flatCategories.length) {
        await fetchCategoriesTree();
    }
    const root = flatCategories.find(
        (c) => !c.parent_id && c.name === rootName
    );
    if (!root) {
        alert("Root category not found yet, try reloading page.");
        return;
    }
    promptAddSubcategory(root.id);
}

function editCategory(rootName) {
    alert(
        "Editing the 3 main root categories is disabled. You can only edit their subcategories."
    );
}

// --------------------------
// ADMIN – NOTES
// --------------------------
function fillNoteFormSelects(preselectedCategoryId = null) {
    const rootSelect = elements.noteFormCategory;
    const subSelect = elements.noteFormSubcategory;
    if (!rootSelect || !subSelect) return;

    rootSelect.innerHTML = `<option value="">Select Category</option>`;
    subSelect.innerHTML = `<option value="">Select Subcategory</option>`;

    const roots = flatCategories.filter((c) => !c.parent_id);
    roots.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name;
        rootSelect.appendChild(opt);
    });

    function populateSubs(rootId, selectedLeafId = null) {
        subSelect.innerHTML = `<option value="">Select Subcategory</option>`;
        if (!rootId) return;
        const descendants = getDescendantsOf(parseInt(rootId, 10));
        descendants.forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = c.path.replace(/^.+ :: /, "");
            subSelect.appendChild(opt);
        });
        if (selectedLeafId) {
            subSelect.value = selectedLeafId;
        }
    }

    rootSelect.onchange = () => {
        populateSubs(rootSelect.value);
    };

    if (preselectedCategoryId) {
        const root = getRootForCategory(preselectedCategoryId);
        if (root) {
            rootSelect.value = root.id;
            populateSubs(root.id, preselectedCategoryId);
        }
    }
}

function showAddNote(categoryId = null) {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only");
        return;
    }
    switchView("addNote");
    editingNoteId = null;

    qs("addNoteTitle").textContent = "Add New Note";

    elements.noteFormTitle.value = "";
    elements.noteFormContent.innerHTML = "";
    const sources = qs("noteFormSources");
    const tags = qs("noteFormTags");
    if (sources) sources.value = "";
    if (tags) tags.value = "";

    fillNoteFormSelects(categoryId);
}

function formatText(cmd) {
    document.execCommand(cmd, false, null);
    elements.noteFormContent.focus();
}

function insertHeading() {
  const editor = elements.noteFormContent;
  if (!editor) return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);

  // If selection is outside editor, focus editor and insert at end
  if (!editor.contains(range.commonAncestorContainer)) {
    editor.focus();
  }

  const selectedText = sel.toString().trim();

  // If user selected text -> wrap it as a heading block
  if (selectedText) {
    document.execCommand(
      "insertHTML",
      false,
      `<div class="heading-block"><div class="main-heading">${escapeHtml(selectedText)}</div></div><p><br></p>`
    );
  } else {
    // No selection -> create an empty heading that user can type into
    document.execCommand(
      "insertHTML",
      false,
      `<div class="heading-block"><div class="main-heading" contenteditable="true">Heading</div></div><p><br></p>`
    );
  }

  editor.focus();
}

// helper (safe for headings)
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}


function insertSubHeading() {
  const text = prompt("Sub-heading text:");
  if (!text) return;

  const editor = elements.noteFormContent;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  // Find nearest heading-block before cursor
  const range = sel.getRangeAt(0);
  let node = range.startContainer;

  // walk up to element
  if (node.nodeType === 3) node = node.parentElement;

  // Search for previous heading-block in DOM order
  let headingBlock = node.closest(".heading-block");

  // If not inside a heading-block, find the last heading-block before cursor
  if (!headingBlock) {
    const all = Array.from(editor.querySelectorAll(".heading-block"));
    headingBlock = all.reverse().find(hb => {
      try {
        return hb.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
      } catch(e){ return false; }
    });
  }

  // If still none, create a heading first
  if (!headingBlock) {
    document.execCommand("insertHTML", false, `<div class="heading-block"><div class="main-heading">Heading</div></div>`);
    headingBlock = editor.querySelector(".heading-block:last-of-type");
  }

  const block = document.createElement("div");
  block.className = "subheading-block";
  block.innerHTML = `
    <div class="subheading-title">${text}</div>
    <div class="subheading-body"><p><br></p></div>
  `;

  headingBlock.appendChild(block);

  // Move caret inside the subheading body
  const body = block.querySelector(".subheading-body");
  placeCaretAtStart(body);

  editor.focus();
}

function placeCaretAtStart(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function isInsideSubheadingBody() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === 3) node = node.parentElement;
  return node ? node.closest(".subheading-body") : null;
}

function moveCaretAfter(element) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.setStartAfter(element);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function isEffectivelyEmpty(el) {
  // empty if only <br> or whitespace
  const text = el.textContent.replace(/\u00A0/g, " ").trim();
  const hasNonEmptyText = text.length > 0;
  const hasMedia = el.querySelector("img, table");
  return !hasNonEmptyText && !hasMedia;
}

function initSubheadingLineBehavior() {
  const editor = elements.noteFormContent;
  if (!editor) return;

  editor.addEventListener("keydown", (e) => {
    const body = isInsideSubheadingBody();
    if (!body) return;

    // SHIFT+ENTER => end the subheading (stop line)
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      const subBlock = body.closest(".subheading-block");
      if (!subBlock) return;

      // insert a clean paragraph after the subheading block and move caret there
      subBlock.insertAdjacentHTML("afterend", `<p><br></p>`);
      moveCaretAfter(subBlock);
      document.execCommand("insertHTML", false, `<br>`); // ensures visible caret line
      return;
    }

    // ENTER twice on empty line => end the subheading
    if (e.key === "Enter" && !e.shiftKey) {
      // If current body looks empty-ish, and user presses Enter again, end block
      // We detect: caret is in an empty paragraph inside subheading body
      const currentP = (window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).startContainer : null);
      let pEl = currentP && currentP.nodeType === 3 ? currentP.parentElement : currentP;
      if (pEl && pEl.nodeType === 1) pEl = pEl.closest("p");

      if (pEl && pEl.closest(".subheading-body") && isEffectivelyEmpty(pEl)) {
        // If the previous sibling paragraph is also empty => that's "double enter"
        const prev = pEl.previousElementSibling;
        if (prev && prev.tagName === "P" && isEffectivelyEmpty(prev)) {
          e.preventDefault();
          const subBlock = body.closest(".subheading-block");
          if (!subBlock) return;

          subBlock.insertAdjacentHTML("afterend", `<p><br></p>`);
          moveCaretAfter(subBlock);
        }
      }
    }
  });
}

function initTabBulletBehavior() {
  const editor = elements.noteFormContent;
  if (!editor) return;

  editor.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    // Only affect the editor
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    e.preventDefault();

    const li = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer)
      .closest("li");

    if (li) {
      // already in a list -> indent/outdent like Word
      document.execCommand(e.shiftKey ? "outdent" : "indent", false, null);
      return;
    }

    // not in list -> create bullet list (Tab makes first bullet)
    document.execCommand("insertUnorderedList", false, null);

    // If Shift+Tab on a fresh bullet, outdent immediately
    if (e.shiftKey) document.execCommand("outdent", false, null);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initSubheadingLineBehavior();
  initTabBulletBehavior();
});

document.addEventListener("DOMContentLoaded", () => {
  // ...your existing code...
  initSubheadingLineBehavior();
});



function insertList() {
    document.execCommand("insertUnorderedList", false, null);
}

function insertLink() {
    const url = prompt("URL:");
    if (!url) return;
    const text = prompt("Link text:") || url;
    document.execCommand(
        "insertHTML",
        false,
        `<a href="${url}" target="_blank">${text}</a>`
    );
}

function changeTextColor() {
    const color = prompt(
        "Choose color: red, yellow, blue, green, darkblue, black, white"
    );

    const map = {
        red: "red",
        yellow: "#FACC15",
        blue: "#2563EB",
        darkblue: "#1E3A8A",
        green: "#16A34A",
        black: "#000000",
        white: "#ffffff",
    };

    if (!map[color]) return alert("Invalid color");

    document.execCommand("foreColor", false, map[color]);
}


function insertArrow() {
    const arrow = prompt("add arrow: ⟶ , ⮕ ", "⮕ , ⟶");
    if (!arrow) return;
    document.execCommand("insertText", false, arrow + " ");
}

let currentFontMode = "default"; // "default" | "times"

function toggleFont() {
    currentFontMode = currentFontMode === "default" ? "times" : "default";

    // execCommand uses limited font names, Times New Roman usually works as "Times New Roman"
    const font = currentFontMode === "times" ? "Times New Roman" : "Arial";

    // Apply to selected text (or affects typing at caret)
    document.execCommand("fontName", false, font);
    elements.noteFormContent.focus();
}

function insertImage() {
    const url = prompt("Image URL:");
    if (!url) return;
    const alt = prompt("Description:") || "";
    document.execCommand(
        "insertHTML",
        false,
        `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;">`
    );
}

async function saveNote(isDraft) {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only");
        return;
    }

    const title = elements.noteFormTitle.value.trim();
    const content = elements.noteFormContent.innerHTML.trim();
    const rootId = elements.noteFormCategory.value;
    const leafId = elements.noteFormSubcategory.value;

    const categoryId = leafId || null;

    if (!title || !content || !categoryId) {
        alert("Title, content and subcategory are required.");
        return;
    }

    const payload = {
        title,
        content,
        category: parseInt(categoryId, 10),
        is_draft: !!isDraft,
    };

    try {
        if (editingNoteId) {
            await api(`/api/note/${editingNoteId}`, {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            alert("Note updated.");
        } else {
            await api("/api/note", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            alert(isDraft ? "Draft saved." : "Note published.");
        }

        await fetchCategoriesTree();
        showAdminDashboard();
    } catch (err) {
        alert("Error saving note: " + err.message);
    }
}

async function showAdminNotes(status) {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only");
        return;
    }

    switchView("adminNotes");

    const titleEl = qs("adminNotesTitle");
    const descEl = qs("adminNotesDescription");
    if (status === "published") {
        titleEl.textContent = "Published Notes";
        descEl.textContent = "View and edit published content.";
    } else if (status === "drafts") {
        titleEl.textContent = "Draft Notes";
        descEl.textContent = "Notes saved as draft (not visible to users).";
    } else {
        titleEl.textContent = "Recycle Bin";
        descEl.textContent =
            "Recently deleted notes. You can restore or permanently delete them.";
    }

    try {
        const notes = await api(`/api/admin/notes?status=${status}`);
        adminNoteCache = {};
        notes.forEach((n) => {
            adminNoteCache[n.id] = n;
        });

        const container = elements.adminNotesContainer;
        container.innerHTML = "";

        if (!notes.length) {
            container.innerHTML =
                '<div class="empty-state"><div class="empty-state-icon">📝</div><p>No notes in this section yet.</p></div>';
            return;
        }

        notes.forEach((n) => {
            const cat = getCategoryById(n.category_id);
            const catPath = cat ? cat.path : "(no category)";

            const card = document.createElement("div");
            card.className = "note-item";

            let actionsHtml = "";

            if (status === "bin") {
                actionsHtml = `
                    <div>
                        <button class="btn btn-secondary" onclick="event.stopPropagation(); restoreNote(${n.id})">Restore</button>
                        <button class="btn btn-danger" onclick="event.stopPropagation(); hardDeleteNote(${n.id})">Delete forever</button>
                    </div>
                `;
            } else {
                actionsHtml = `
                    <div>
                        <button class="btn btn-primary" onclick="event.stopPropagation(); editNote(${n.id})">Edit</button>
                        <button class="btn btn-danger" onclick="event.stopPropagation(); softDeleteNote(${n.id})">Delete</button>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="note-info">
                    <h4>${n.title}</h4>
                    <div class="note-meta">${catPath}</div>
                    <div class="note-views">${n.views} views · ${
                n.is_published ? "Published" : "Draft"
            }</div>
                </div>
                ${actionsHtml}
            `;

            container.appendChild(card);
        });
    } catch (err) {
        alert("Error loading admin notes: " + err.message);
    }
}

function editNote(id) {
    const note = adminNoteCache[id];
    if (!note) return;

    editingNoteId = id;
    switchView("addNote");
    qs("addNoteTitle").textContent = "Edit Note";

    elements.noteFormTitle.value = note.title;
    elements.noteFormContent.innerHTML = note.content || "";

    fillNoteFormSelects(note.category_id);
}

async function softDeleteNote(id) {
    const note = adminNoteCache[id];
    if (!note) return;
    if (
        !confirm(
            `Send "${note.title}" to the bin? You can restore it later from Recycle Bin.`
        )
    )
        return;

    try {
        await api(`/api/note/${id}`, { method: "DELETE" });
        alert("Note moved to bin.");
        showAdminNotes("published");
    } catch (err) {
        alert("Error deleting note: " + err.message);
    }
}

async function restoreNote(id) {
    const note = adminNoteCache[id];
    if (!note) return;
    if (!confirm(`Restore "${note.title}"?`)) return;

    try {
        await api(`/api/note/${id}/restore`, { method: "POST" });
        alert("Note restored.");
        showAdminNotes("bin");
    } catch (err) {
        alert("Error restoring note: " + err.message);
    }
}

async function hardDeleteNote(id) {
    const note = adminNoteCache[id];
    if (!note) return;

    if (
        !confirm(
            `Permanently delete "${note.title}"? This cannot be undone.`
        )
    )
        return;
    if (!confirm("Really sure? This is the final confirmation.")) return;

    try {
        await api(`/api/note/${id}/hard_delete`, { method: "DELETE" });
        alert("Note permanently deleted.");
        showAdminNotes("bin");
    } catch (err) {
        alert("Error permanently deleting note: " + err.message);
    }
}

// --------------------------
// ADMIN – STATS & DASHBOARD
// --------------------------
async function fetchAdminStats() {
    try {
        const stats = await api("/api/admin_stats");
        elements.publishedCount.textContent = stats.total_notes;
        elements.draftsCount.textContent = stats.draft_notes;
        elements.deletedCount.textContent = stats.deleted_notes;
        elements.totalViews.textContent = stats.total_views;
    } catch (err) {
        console.error("Admin stats error:", err);
    }
}

async function fetchTopNotes() {
    try {
        await api("/api/note_views");
    } catch (err) {
        console.error("Top notes error:", err);
    }
}

async function showAdminDashboard() {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only.");
        return;
    }
    switchView("admin");
    await fetchCategoriesTree();
    await fetchAdminStats();
}

// change-password endpoint (you still need to add it in Flask)
async function changeAdminPassword() {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only.");
        return;
    }
    const oldPw = prompt("Enter current password:");
    if (!oldPw) return;
    const newPw = prompt("Enter new password:");
    if (!newPw) return;

    try {
        const res = await api("/api/admin/change_password", {
            method: "POST",
            body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
        });
        alert(res.message || "Password changed.");
    } catch (err) {
        alert("Error changing password: " + err.message);
    }
}

// --------------------------
// ABOUT / TOOLS (client-side editing only)
// --------------------------
function editAboutContent() {
    if (!currentUser || currentUser.role !== "admin") return;
    const modal = qs("aboutEditorModal");
    const editor = qs("aboutEditor");
    const aboutContent = qs("aboutContent");
    editor.innerHTML = aboutContent.innerHTML;
    modal.style.display = "block";
}

function closeAboutEditor() {
    const modal = qs("aboutEditorModal");
    if (modal) modal.style.display = "none";
}

function formatAboutText(cmd) {
    document.execCommand(cmd, false, null);
    qs("aboutEditor").focus();
}

function insertAboutHeading() {
    const text = prompt("Heading text:");
    if (!text) return;
    document.execCommand("insertHTML", false, `<h3>${text}</h3>`);
}

function insertAboutList() {
    document.execCommand("insertUnorderedList", false, null);
}

function insertAboutLink() {
    const url = prompt("URL:");
    if (!url) return;
    const text = prompt("Link text:") || url;
    document.execCommand(
        "insertHTML",
        false,
        `<a href="${url}" target="_blank">${text}</a>`
    );
}

function saveAboutContent() {
    const editor = qs("aboutEditor");
    const aboutContent = qs("aboutContent");
    aboutContent.innerHTML = editor.innerHTML;
    closeAboutEditor();
    alert("About page updated for this session. (Not stored in DB yet.)");
}

function editToolsContent() {
    if (!currentUser || currentUser.role !== "admin") return;
    alert("Tools page editing persistence is not wired yet – coming later!");
}

// --------------------------
// NAV / VIEW HELPERS
// --------------------------
function hideAllPages() {
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
}

function switchView(name) {
    hideAllPages();
    const pageEl = elements.pages[name];
    if (pageEl) pageEl.classList.remove("hidden");
}

function showHome() {
    switchView("home");      // no more dynamic fetch here
}

function showLibrary() {
    switchView("library");
    fetchAndRenderTopCategories();
}

function showTools() {
    switchView("tools");
}

function showIA() {
    switchView("ia");
}

function showAbout() {
    switchView("about");
}

async function openRootCategory(rootName) {
  if (!flatCategories.length) await fetchCategoriesTree();
  const root = flatCategories.find((c) => !c.parent_id && c.name === rootName);
  if (!root) {
    alert(`Root category "${rootName}" not found.`);
    return;
  }
  showLibrary();
  openCategoryById(root.id);
}


// Manage Categories: show the 3 roots, then drill down with openCategoryById
async function showManageCategories() {
    await fetchCategoriesTree();

    switchView("category");
    qs("categoryTitle").textContent = "Manage Categories";
    qs("categoryDescription").textContent =
        "Click a category to drill down. You can add/edit/delete subcategories (but not the top 3 roots).";

    const subcontainer = qs("subcategoriesContainer");
    subcontainer.innerHTML = "";

    const roots = flatCategories.filter((c) => !c.parent_id);

    roots.forEach((r) => {
        const card = document.createElement("div");
        card.className = "subcategory-card";
        card.onclick = () => openCategoryById(r.id);

        let adminControlsHtml = "";
        if (currentUser && currentUser.role === "admin") {
            adminControlsHtml = `
                <div class="admin-controls">
                    <button class="admin-btn add" title="Add subcategory"
                        onclick="event.stopPropagation(); promptAddSubcategory(${r.id})">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            `;
        }

        card.innerHTML = `
            ${adminControlsHtml}
            <h4>${r.name}</h4>
        `;
        subcontainer.appendChild(card);
    });
}

// --------------------------
// BOOT
// --------------------------
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    updateLoginUI();

    if (elements.loginForm) {
        elements.loginForm.addEventListener("submit", handleLogin);
    }

    // clicking outside login modal closes it
    window.addEventListener("click", (e) => {
        if (e.target === elements.loginModal) {
            closeLogin();
        }
    });

    // Preload categories (for later) but don't touch DOM yet
    fetchCategoriesTree().catch((err) =>
        console.error("Error fetching categories:", err)
    );

    // Show static home content
    showHome();
});
