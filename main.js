//BASIC API HELPER



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
        highYield: qs("highYieldPage"),
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
let hasUnsavedChanges = false;

let navStack = []; // stores view names like "library", "category", "subcategory", "noteView"


let savedEditorSelectionRange = null;
let styledSectionCounter = 1;
let activeSectionNumberElement = null;

function saveEditorSelection() {
    const editor = elements.noteFormContent;
    const selection = window.getSelection();

    if (!editor || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    if (editor.contains(range.commonAncestorContainer)) {
        savedEditorSelectionRange = range.cloneRange();
    }
}

function restoreEditorSelection() {
    const editor = elements.noteFormContent;
    const selection = window.getSelection();

    if (!editor || !savedEditorSelectionRange) return false;

    selection.removeAllRanges();
    selection.addRange(savedEditorSelectionRange);
    editor.focus();

    return true;
}
function initToolbarSelectionProtection() {
    const toolbar = document.querySelector(".editor-toolbar");
    if (!toolbar) return;

    toolbar.addEventListener("mousedown", (e) => {
        const target = e.target;

        // Let inputs/selects work normally
        if (
            target.tagName === "INPUT" ||
            target.tagName === "SELECT" ||
            target.tagName === "TEXTAREA" ||
            target.closest("input") ||
            target.closest("select") ||
            target.closest("textarea")
        ) {
            saveEditorSelection();
            return;
        }

        // Buttons should not steal focus from the editor
        if (target.closest("button")) {
            e.preventDefault();
            saveEditorSelection();
        }
    });
}

function pushView(name) {
  const last = navStack[navStack.length - 1];
  if (last !== name) navStack.push(name);
}

function goBack(fallback = "library") {
  // remove current view
  navStack.pop();

  // go to previous view
  const prev = navStack[navStack.length - 1] || fallback;

  if (prev === "library") showLibrary();
  else if (prev === "category") switchView("category");
  else if (prev === "subcategory") switchView("subcategory");
  else if (prev === "noteView") switchView("noteView");
  else showLibrary();
}

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

    dd.style.display =
        dd.style.display === "block" ? "none" : "block";
}

function hideUserMenu() {
    const dd = qs("userDropdownContent");
    if (dd) {
        dd.style.display = "none";
    }
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
    const parentId = cat ? cat.parent_id : null;

    const children = flatCategories.filter((c) => c.parent_id === catId);

    let notes = [];

    try {
        notes = await api(`/api/notes?category=${catId}`);
    } catch (err) {
        console.error("Error fetching notes:", err);
        notes = [];
    }

    const hasChildren = children.length > 0;
    const hasNotes = notes.length > 0;
    const isEmpty = !hasChildren && !hasNotes;

    // =====================================================
    // CASE 1: CATEGORY HAS CHILDREN
    // Show only: Add subcategory
    // Do NOT show add note here
    // =====================================================
    if (hasChildren) {
        switchView("category");

        const categoryBackBtn = document.querySelector("#categoryPage .back-btn");

        if (categoryBackBtn) {
            categoryBackBtn.onclick = () => {
                if (parentId) openCategoryById(parentId);
                else showLibrary();
            };

            categoryBackBtn.textContent = parentId
                ? "← Back"
                : "← Back to Library";
        }

        const header = qs("categoryTitle");
        const desc = qs("categoryDescription");

        if (header) {
            header.textContent = cat ? cat.name : "Category";
        }

        if (desc) {
            desc.textContent = cat
                ? cat.path.replaceAll(" :: ", " | ")
                : "";
        }

        const subcontainer = qs("subcategoriesContainer");

        if (subcontainer) {
            subcontainer.innerHTML = "";
        }

        // Admin button: only add subcategory
        if (currentUser && currentUser.role === "admin" && cat && subcontainer) {
            const btnWrap = document.createElement("div");
            btnWrap.className = "admin-category-action-row single-action";

            const btn = document.createElement("button");
            btn.className = "btn btn-success admin-choice-btn";
            btn.textContent = `+ Add subcategory under "${cat.name}"`;
            btn.onclick = () => promptAddSubcategory(catId);

            btnWrap.appendChild(btn);
            subcontainer.appendChild(btnWrap);
        }

        // Render child subcategories
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
                                <button
                                    class="admin-btn edit"
                                    title="Rename"
                                    onclick="event.stopPropagation(); promptRenameCategory(${ch.id})"
                                >
                                    <i class="fas fa-pen"></i>
                                </button>

                                <button
                                    class="admin-btn delete"
                                    title="Delete"
                                    onclick="event.stopPropagation(); promptDeleteCategory(${ch.id})"
                                >
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

        return;
    }

    // =====================================================
    // CASE 2: EMPTY CATEGORY
    // Show both buttons:
    // Add subcategory + Add note
    // =====================================================
    if (isEmpty) {
        switchView("subcategory");
    
        const subcategoryBackBtn = qs("subcategoryBackBtn");
    
        if (subcategoryBackBtn) {
            subcategoryBackBtn.onclick = () => {
                if (parentId) openCategoryById(parentId);
                else showLibrary();
            };
    
            subcategoryBackBtn.textContent = parentId
                ? "← Back"
                : "← Back to Library";
        }
    
        const subTitle = qs("subcategoryTitle");
        const subDesc = qs("subcategoryDescription");
    
        if (subTitle) {
            subTitle.textContent = cat ? cat.name : "Subcategory";
        }
    
        if (subDesc) {
            subDesc.textContent = cat
                ? cat.path.replaceAll(" :: ", " | ")
                : "";
        }
    
        const notesContainer = qs("notesContainer");
    
        if (notesContainer) {
            notesContainer.innerHTML = "";
    
            if (currentUser && currentUser.role === "admin" && cat) {
                const choiceWrap = document.createElement("div");
                choiceWrap.className = "admin-category-action-row two-actions";
    
                const addSubBtn = document.createElement("button");
                addSubBtn.type = "button";
                addSubBtn.className = "btn btn-success admin-choice-btn";
                addSubBtn.textContent = `+ Add subcategory under "${cat.name}"`;
    
                addSubBtn.addEventListener("click", async () => {
                    await promptAddSubcategory(catId);
                });
    
                const addNoteBtn = document.createElement("button");
                addNoteBtn.type = "button";
                addNoteBtn.className = "btn btn-primary admin-choice-btn";
                addNoteBtn.textContent = `+ Add note in "${cat.name}"`;
    
                addNoteBtn.addEventListener("click", () => {
                    showAddNote(catId);
                });
    
                choiceWrap.appendChild(addSubBtn);
                choiceWrap.appendChild(addNoteBtn);
    
                notesContainer.appendChild(choiceWrap);
            }
    
            const emptyState = document.createElement("div");
            emptyState.className = "empty-state";
            emptyState.innerHTML = `
                <div class="empty-state-icon">📝</div>
                <p>This category is empty.</p>
                <p style="font-size: 0.9rem; opacity: 0.8;">
                    Add notes directly, or create subcategories to organize it further.
                </p>
            `;
    
            notesContainer.appendChild(emptyState);
        }
    
        return;
    }

    // =====================================================
    // CASE 3: CATEGORY HAS NOTES
    // Show only: Add note
    // Do NOT show add subcategory here
    // =====================================================
    switchView("subcategory");

    const subcategoryBackBtn = qs("subcategoryBackBtn");

    if (subcategoryBackBtn) {
        subcategoryBackBtn.onclick = () => {
            if (parentId) openCategoryById(parentId);
            else showLibrary();
        };

        subcategoryBackBtn.textContent = parentId
            ? "← Back"
            : "← Back to Library";
    }

    const subTitle = qs("subcategoryTitle");
    const subDesc = qs("subcategoryDescription");

    if (subTitle) {
        subTitle.textContent = cat ? cat.name : "Subcategory";
    }

    if (subDesc) {
        subDesc.textContent = cat
            ? cat.path.replaceAll(" :: ", " | ")
            : "";
    }

    const notesContainer = qs("notesContainer");

    if (notesContainer) {
        notesContainer.innerHTML = "";
    }

    // Admin button: only add note
    if (currentUser && currentUser.role === "admin" && cat && notesContainer) {
        const btnWrap = document.createElement("div");
        btnWrap.className = "admin-category-action-row single-action";

        const btn = document.createElement("button");
        btn.className = "btn btn-primary admin-choice-btn";
        btn.textContent = `+ Add note in "${cat.name}"`;
        btn.onclick = () => showAddNote(catId);

        btnWrap.appendChild(btn);
        notesContainer.appendChild(btnWrap);
    }

    // Render notes
    if (notesContainer) {
        notes.forEach((n, index) => {
            const card = document.createElement("div");
            card.className = "note-item";
            card.dataset.noteId = n.id;

            const isAdmin = currentUser && currentUser.role === "admin";
            card.draggable = isAdmin;

            card.onclick = () => showNoteView(n.id);

            const orderControlsHtml = isAdmin
                ? `
                    <div class="note-order-controls">
                        <button
                            class="note-order-btn"
                            title="Move note up"
                            ${index === 0 ? "disabled" : ""}
                            onclick="event.stopPropagation(); moveNoteOrder(${n.id}, 'up')"
                        >
                            ⌃
                        </button>

                        <button
                            class="note-order-btn"
                            title="Move note down"
                            ${index === notes.length - 1 ? "disabled" : ""}
                            onclick="event.stopPropagation(); moveNoteOrder(${n.id}, 'down')"
                        >
                            ⌄
                        </button>
                    </div>
                `
                : "";

            card.innerHTML = `
                <div class="note-info">
                    <h4>${n.title}</h4>
                    <div class="note-meta">${n.views} views</div>
                    ${isAdmin ? `<div class="note-drag-hint">Hold and drag to reorder</div>` : ""}
                </div>

                ${orderControlsHtml}
            `;

            notesContainer.appendChild(card);
        });

        if (currentUser && currentUser.role === "admin") {
            initNoteDragOrdering(notesContainer);
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

  const headingSelector = ".heading-block, .main-heading, h1, h2";
  const headings = Array.from(container.querySelectorAll(headingSelector));

  headings.forEach((heading) => {
    const title = heading.classList.contains("heading-block")
      ? heading.querySelector(".main-heading")
      : heading;

    if (!title) return;

    title.style.cursor = "pointer";

    const contentNodes = [];
    let node = heading.nextElementSibling;

    while (node && !node.matches(headingSelector)) {
      contentNodes.push(node);
      node = node.nextElementSibling;
    }

    if (!contentNodes.length) return;

    contentNodes.forEach((n) => n.classList.add("collapsed-section"));

    title.onclick = () => {
      const shouldOpen = contentNodes[0].classList.contains("collapsed-section");

      contentNodes.forEach((n) => {
        n.classList.toggle("collapsed-section", !shouldOpen);
      });
    };
  });
}



async function showNoteView(noteId) {
  switchView("noteView");

  const note = await api(`/api/note/${noteId}`);

  const noteBackBtn = qs("noteBackBtn");
  if (noteBackBtn) {
    noteBackBtn.onclick = () => openCategoryById(note.category_id);
  }

  elements.noteTitle.textContent = note.title;
  elements.noteBody.innerHTML = note.content;

  const cat = getCategoryById(note.category_id);
  const path = cat ? cat.path.replaceAll(" :: ", " | ") : "";
  elements.noteMeta.textContent = path;

  initCollapsibleHeadings(elements.noteBody);
}

async function moveNoteOrder(noteId, direction) {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only");
        return;
    }

    try {
        await api(`/api/note/${noteId}/move`, {
            method: "POST",
            body: JSON.stringify({ direction }),
        });

        if (currentCategoryId) {
            await openCategoryById(currentCategoryId);
        }
    } catch (err) {
        alert("Error moving note: " + err.message);
    }
}

function initNoteDragOrdering(container) {
    let draggedCard = null;

    container.querySelectorAll(".note-item").forEach((card) => {
        card.addEventListener("dragstart", (e) => {
            draggedCard = card;
            card.classList.add("dragging-note");
            e.dataTransfer.effectAllowed = "move";
        });

        card.addEventListener("dragend", async () => {
            if (!draggedCard) return;

            draggedCard.classList.remove("dragging-note");
            draggedCard = null;

            await saveDraggedNoteOrder(container);
        });

        card.addEventListener("dragover", (e) => {
            e.preventDefault();

            const dragging = container.querySelector(".dragging-note");
            if (!dragging) return;

            const afterElement = getDragAfterElement(container, e.clientY);

            if (afterElement == null) {
                container.appendChild(dragging);
            } else {
                container.insertBefore(dragging, afterElement);
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [
        ...container.querySelectorAll(".note-item:not(.dragging-note)")
    ];

    return draggableElements.reduce(
        (closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return {
                    offset: offset,
                    element: child,
                };
            }

            return closest;
        },
        {
            offset: Number.NEGATIVE_INFINITY,
            element: null,
        }
    ).element;
}

async function saveDraggedNoteOrder(container) {
    const noteIds = [...container.querySelectorAll(".note-item")]
        .map((card) => parseInt(card.dataset.noteId, 10))
        .filter(Boolean);

    try {
        await api("/api/notes/reorder", {
            method: "POST",
            body: JSON.stringify({ note_ids: noteIds }),
        });

        if (currentCategoryId) {
            await openCategoryById(currentCategoryId);
        }
    } catch (err) {
        alert("Error saving note order: " + err.message);
    }
}

// --------------------------
// HIGH-YIELD PAGE
// --------------------------

let highYieldRootId = null;
let highYieldSelectedNoteId = null;

function normalizeName(name) {
    return String(name || "").toLowerCase().replace(/\s+/g, "").replace(/-/g, "");
}

async function getHighYieldRoot() {
    if (!flatCategories.length) {
        await fetchCategoriesTree();
    }

    const root = flatCategories.find(
        (c) => !c.parent_id && normalizeName(c.name) === "highyield"
    );

    if (!root) {
        alert('High-Yield root category not found. Check app.py seed and reload PythonAnywhere.');
        return null;
    }

    highYieldRootId = root.id;
    return root;
}

function getDirectChildren(parentId) {
    return flatCategories.filter((c) => c.parent_id === parentId);
}

async function showHighYieldPage() {
    switchView("highYield");

    await fetchCategoriesTree();

    const root = await getHighYieldRoot();
    if (!root) return;

    await renderHighYieldSidebar(root.id);

    qs("highYieldBreadcrumb").textContent = "High-Yield Facts";
    qs("highYieldNoteTitle").textContent = "High-Yield Facts";
    qs("highYieldNoteBody").innerHTML = `
        <p>Select a topic from the left menu.</p>
    `;
    qs("highYieldAtGlance").innerHTML = `
        <p>Select a note to see a quick summary.</p>
    `;
    qs("highYieldKeyPoint").classList.add("hidden");
}

async function renderHighYieldSidebar(rootId) {
    const sidebar = qs("highYieldSidebar");
    if (!sidebar) return;

    sidebar.innerHTML = "";

    const categories = getDirectChildren(rootId);

    if (!categories.length) {
        sidebar.innerHTML = `
            <div class="empty-state" style="color: rgba(255,255,255,0.75); padding: 1rem 0;">
                <p>No High-Yield categories yet.</p>
            </div>
        `;
        return;
    }

    for (const cat of categories) {
        const notes = await api(`/api/notes?category=${cat.id}`);

        const group = document.createElement("div");
        group.className = "hy-menu-category";

        const notesHtml = notes.length
            ? notes.map((note) => `
                <button class="hy-menu-note" onclick="openHighYieldNote(${note.id})">
                    ${escapeHtml(note.title)}
                </button>
            `).join("")
            : `<div style="color: rgba(255,255,255,0.55); font-size: 0.85rem; padding: 0.5rem 0.65rem;">No notes yet</div>`;

        group.innerHTML = `
            <button class="hy-menu-category-title" onclick="toggleHighYieldCategory(this)">
                <span>
                    <i class="fas fa-stethoscope"></i>
                    ${escapeHtml(cat.name)}
                </span>

                <span class="hy-category-admin">
                    <span class="hy-mini-btn" title="Rename" onclick="event.stopPropagation(); promptRenameHighYieldCategory(${cat.id})">
                        <i class="fas fa-pen"></i>
                    </span>
                    <span class="hy-mini-btn" title="Delete" onclick="event.stopPropagation(); promptDeleteHighYieldCategory(${cat.id})">
                        <i class="fas fa-trash"></i>
                    </span>
                </span>

                <span>⌄</span>
            </button>

            <div class="hy-menu-notes">
                ${notesHtml}
            </div>
        `;

        sidebar.appendChild(group);
    }

    // Open the first category by default
    const firstGroup = sidebar.querySelector(".hy-menu-category");
    if (firstGroup) firstGroup.classList.add("open");
}

function toggleHighYieldCategory(button) {
    const group = button.closest(".hy-menu-category");
    if (!group) return;
    group.classList.toggle("open");
}

async function openHighYieldNote(noteId) {
    highYieldSelectedNoteId = noteId;

    const note = await api(`/api/note/${noteId}`);

    qs("highYieldNoteTitle").textContent = note.title;
    qs("highYieldNoteBody").innerHTML = note.content;

    const cat = getCategoryById(note.category_id);
    const path = cat ? cat.path.replaceAll(" :: ", " › ") : "High-Yield Facts";
    qs("highYieldBreadcrumb").textContent = path;

    renderHighYieldAtGlance(note.content);

    document.querySelectorAll(".hy-menu-note").forEach((btn) => {
        btn.classList.toggle(
            "active",
            btn.textContent.trim() === note.title.trim()
        );
    });
}

function renderHighYieldAtGlance(content) {
    const glance = qs("highYieldAtGlance");
    const keyBox = qs("highYieldKeyPoint");
    const keyText = qs("highYieldKeyPointText");

    if (!glance) return;

    const temp = document.createElement("div");
    temp.innerHTML = content;

    const plainText = temp.textContent.trim();

    // Key point: first useful sentence from the note
    const firstSentence = plainText.split(". ").find((s) => s.trim().length > 30);

    if (firstSentence && keyBox && keyText) {
        keyText.textContent = firstSentence.trim() + ".";
        keyBox.classList.remove("hidden");
    } else if (keyBox) {
        keyBox.classList.add("hidden");
    }

    // At a glance: use headings/subheadings first
    const headings = [...temp.querySelectorAll(".main-heading, .subheading-title, h2, h3")]
        .map((h) => h.textContent.trim())
        .filter(Boolean)
        .slice(0, 4);

    if (!headings.length) {
        glance.innerHTML = `
            <p>No summary headings detected yet.</p>
        `;
        return;
    }

    const icons = ["fa-user-group", "fa-gear", "fa-triangle-exclamation", "fa-shield-halved"];

    glance.innerHTML = headings.map((h, index) => `
        <div class="hy-glance-item">
            <i class="fas ${icons[index] || "fa-circle-info"}"></i>
            <div>
                <strong>${escapeHtml(h)}</strong>
            </div>
        </div>
    `).join("");
}

async function addHighYieldCategory() {
    const root = await getHighYieldRoot();
    if (!root) return;

    await promptAddSubcategory(root.id);
    await fetchCategoriesTree();
    await showHighYieldPage();
}

async function promptRenameHighYieldCategory(catId) {
    await promptRenameCategory(catId);
    await fetchCategoriesTree();
    await showHighYieldPage();
}

async function promptDeleteHighYieldCategory(catId) {
    await promptDeleteCategory(catId);
    await fetchCategoriesTree();
    await showHighYieldPage();
}

async function showHighYieldAdmin() {
    const root = await getHighYieldRoot();
    if (!root) return;

    openCategoryById(root.id);
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
    hasUnsavedChanges = false;

    qs("addNoteTitle").textContent = "Add New Note";

    elements.noteFormTitle.value = "";
    elements.noteFormContent.innerHTML = "";

    const sources = qs("noteFormSources");
    const tags = qs("noteFormTags");

    if (sources) sources.value = "";
    if (tags) tags.value = "";

    fillNoteFormSelects(categoryId);

    hasUnsavedChanges = false;
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

  styledSectionCounter = 1;
    
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

    // Let Cmd/Ctrl + Tab be used for the numbered box shortcut
    if (e.metaKey || e.ctrlKey) return;

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

function initEditorShortcuts() {
  const editor = elements.noteFormContent;
  if (!editor) return;

  editor.addEventListener("keydown", (e) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;

    if (!isCmdOrCtrl) return;

    // Cmd/Ctrl + H = main heading
    if (e.key.toLowerCase() === "h") {
      e.preventDefault();
      insertHeading();
    }

      
    // Cmd/Ctrl + S = subheading
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      applyStyledSectionTitle();
    }
  
  });
}


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

const SAVED_COLORS_KEY = "clinicalrootsSavedTextColors";
const MAX_SAVED_COLORS = 8;

function getSavedColors() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_COLORS_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function setSavedColors(colors) {
    localStorage.setItem(SAVED_COLORS_KEY, JSON.stringify(colors));
}

function toggleColorPicker() {
    saveEditorSelection();

    const panel = qs("colorPickerPanel");
    if (!panel) return;

    panel.classList.toggle("hidden");
    renderSavedColors();
}
function previewPickedColor(color) {
    const picker = qs("textColorPicker");
    if (picker) picker.value = color;
}

function applyPickedColor(color = null) {
    const picked = color || qs("textColorPicker")?.value;

    if (!picked) return;

    restoreEditorSelection();

    document.execCommand("foreColor", false, picked);

    savedEditorSelectionRange = null;
    hasUnsavedChanges = true;

    if (elements.noteFormContent) {
        elements.noteFormContent.focus();
    }
}

function savePickedColor() {
    const picked = qs("textColorPicker")?.value;

    if (!picked) return;

    let colors = getSavedColors();

    // Remove duplicate first, so saving an existing color moves it to the front
    colors = colors.filter((c) => c.toLowerCase() !== picked.toLowerCase());

    colors.unshift(picked);

    if (colors.length > MAX_SAVED_COLORS) {
        colors = colors.slice(0, MAX_SAVED_COLORS);
    }

    setSavedColors(colors);
    renderSavedColors();
}

function renderSavedColors() {
    const bar = qs("savedColorsBar");
    if (!bar) return;

    const colors = getSavedColors();

    if (!colors.length) {
        bar.innerHTML = `<span class="saved-color-empty">No saved colors yet</span>`;
        return;
    }

    bar.innerHTML = "";

    colors.forEach((color) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "saved-color-swatch";
        swatch.style.backgroundColor = color;
        swatch.title = color;

        swatch.onclick = () => {
            previewPickedColor(color);
            applyPickedColor(color);
        };

        bar.appendChild(swatch);
    });
}

// Keep the old function name so any old onclick still works
function changeTextColor() {
    toggleColorPicker();
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

function changeWritingSize(size) {
    if (!size) return;

    const editor = elements.noteFormContent;
    if (!editor) return;

    restoreEditorSelection();

    const selection = window.getSelection();

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) return;

    if (!selection.isCollapsed) {
        const selectedContent = range.extractContents();

        const span = document.createElement("span");
        span.style.fontSize = size;
        span.appendChild(selectedContent);

        range.insertNode(span);

        range.setStartAfter(span);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        savedEditorSelectionRange = null;
        hasUnsavedChanges = true;
        editor.focus();
        return;
    }

    document.execCommand(
        "insertHTML",
        false,
        `<span style="font-size:${size};">&#8203;</span>`
    );

    hasUnsavedChanges = true;
    editor.focus();
}

function toggleSectionTitlePanel() {
    saveEditorSelection();

    const panel = qs("sectionTitlePanel");
    if (!panel) return;

    panel.classList.toggle("hidden");

    const input = qs("sectionTitleNumberInput");
    if (input) setTimeout(() => input.focus(), 0);
}

function openSectionNumberEdit(numberElement) {
    const savedScrollY = window.scrollY;
    const savedScrollX = window.scrollX;

    activeSectionNumberElement = numberElement;

    const panel = qs("sectionTitlePanel");
    const input = qs("sectionTitleNumberInput");

    if (!panel || !input) return;

    input.value = numberElement.textContent.trim();

    panel.classList.remove("hidden");

    requestAnimationFrame(() => {
        try {
            input.focus({ preventScroll: true });
        } catch (e) {
            input.focus();
        }

        input.select();

        window.scrollTo(savedScrollX, savedScrollY);
    });
}

function applyStyledSectionTitle() {
    const editor = elements.noteFormContent;
    if (!editor) return;

    const numberInput = qs("sectionTitleNumberInput");
    const panel = qs("sectionTitlePanel");

    // If admin double-clicked an existing number box, edit that number
    if (activeSectionNumberElement) {
        const rawNumber = numberInput ? numberInput.value.trim() : "";

        if (!rawNumber) {
            alert("Please enter a number or label.");
            return;
        }

        activeSectionNumberElement.textContent = rawNumber;

        const numericValue = parseInt(rawNumber, 10);

        if (!isNaN(numericValue)) {
            styledSectionCounter = numericValue + 1;
        }

        activeSectionNumberElement = null;

        if (numberInput) numberInput.value = "";
        if (panel) panel.classList.add("hidden");

        hasUnsavedChanges = true;

        try {
            editor.focus({ preventScroll: true });
        } catch (e) {
            editor.focus();
        }

        return;
    }

    // Normal click: insert number box at cursor.
    // If text is selected, put the number before the selected text.
    restoreEditorSelection();

    const selection = window.getSelection();
    const currentNumber = styledSectionCounter;
    styledSectionCounter++;

    let selectedText = "";

    if (selection.rangeCount) {
        selectedText = selection.toString().trim();
    }

    let html = "";

    if (selectedText) {
        html = `
            <span class="styled-section-number" contenteditable="true">${currentNumber}</span>
            <span class="styled-section-text">${escapeHtml(selectedText)}</span>&nbsp;
        `;
    } else {
        html = `
            <span class="styled-section-number" contenteditable="true">${currentNumber}</span>&nbsp;
        `;
    }

    document.execCommand("insertHTML", false, html);

    if (numberInput) numberInput.value = "";
    if (panel) panel.classList.add("hidden");

    savedEditorSelectionRange = null;
    hasUnsavedChanges = true;

    try {
        editor.focus({ preventScroll: true });
    } catch (e) {
        editor.focus();
    }
}

function insertImage() {
    const choice = prompt("Type 1 for image URL, or 2 to upload from device:");

    if (choice === "1") {
        const url = prompt("Image URL:");
        if (!url) return;

        const alt = prompt("Description:") || "";

        document.execCommand(
            "insertHTML",
            false,
            `<img src="${url}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;">`
        );

        return;
    }

    if (choice === "2") {
        const input = qs("imageUploadInput");
        if (input) input.click();
        return;
    }

    alert("Invalid choice.");
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please upload an image file.");
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        document.execCommand(
            "insertHTML",
            false,
            `<img src="${e.target.result}" alt="Uploaded image" style="max-width:100%;height:auto;">`
        );
    };

    reader.readAsDataURL(file);

    event.target.value = "";
}

// ==========================
// UNSAVED CHANGES WARNING
// ==========================

function initUnsavedChangesWarning() {

    const editor = elements.noteFormContent;
    const title = elements.noteFormTitle;

    if (editor) {
        editor.addEventListener("input", () => {
            hasUnsavedChanges = true;
        });
    }

    if (title) {
        title.addEventListener("input", () => {
            hasUnsavedChanges = true;
        });
    }

    // Browser/tab close warning
    window.addEventListener("beforeunload", (e) => {

        if (!hasUnsavedChanges) return;

        e.preventDefault();
        e.returnValue = "";

    });
}

// Custom warning before leaving editor pages
function confirmLeaveEditor() {

    if (!hasUnsavedChanges) return true;

    return confirm(
        "You sure u dont want to save it zainy? 😭"
    );
}

function initCleanPasteBehavior() {
  const editor = elements.noteFormContent;
  if (!editor) return;

  editor.addEventListener("paste", (e) => {
    e.preventDefault();

    const text = (e.clipboardData || window.clipboardData).getData("text/plain");

    document.execCommand(
      "insertHTML",
      false,
      `<span style="color:#000000; font-family: inherit;">${escapeHtml(text).replace(/\n/g, "<br>")}</span>`
    );
  });
}

function insertKeyConcept() {
  const editor = elements.noteFormContent;
  if (!editor) return;

  const html = `
<div class="key-concept-card">
<div class="key-concept-toggle">💡 Key Concept: <span contenteditable="true">What is this?</span> ⌄</div>

<div class="key-concept-popup">
<div class="key-concept-title" contenteditable="true">Key Concept</div>

<div contenteditable="true">

</div>

</div>
</div>

<p><br></p>
`;

  document.execCommand("insertHTML", false, html);
  editor.focus();
}


async function saveNote(isDraft) {
    if (!currentUser || currentUser.role !== "admin") {
        alert("Admin only");
        return;
    }

    const title = elements.noteFormTitle.value.trim();
    const content = elements.noteFormContent.innerHTML.trim();
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

        hasUnsavedChanges = false;

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

    hasUnsavedChanges = false;

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
    const currentlyEditingNote =
    !elements.pages.addNote.classList.contains("hidden");

if (
    currentlyEditingNote &&
    hasUnsavedChanges &&
    name !== "addNote"
) {
    const ok = confirmLeaveEditor();

    if (!ok) return;
}
    
  hideAllPages();
  const pageEl = elements.pages[name];

  if (!pageEl) {
    console.error("❌ switchView missing page:", name, elements.pages);

    // Never blank screen again:
    elements.pages.home?.classList.remove("hidden");

    // Visible error banner on screen
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<div style="position:fixed;top:80px;left:0;right:0;z-index:9999;background:#ffeded;color:#7a0000;padding:10px 14px;border-bottom:1px solid #ffb3b3;font-family:sans-serif;">
        Missing page element for <b>${name}</b>. Check the HTML id and elements.pages mapping.
      </div>`
    );
    return;
  }

  pageEl.classList.remove("hidden");
}



function showHome() {
    switchView("home");      // no more dynamic fetch here
}


function showLibrary() {
  switchView("library");

  fetchAndRenderTopCategories().catch(err => {
    console.error("❌ Library load failed:", err);
    const grid = qs("subcategoriesGrid");
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <p>Could not load categories.</p>
          <p style="font-size:0.9rem;opacity:0.8;">${err.message}</p>
        </div>
      `;
    }
  });
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

    initUnsavedChangesWarning();

    if (elements.loginForm) {
        elements.loginForm.addEventListener("submit", handleLogin);
    }

    window.addEventListener("click", (e) => {
        if (e.target === elements.loginModal) {
            closeLogin();
        }
    });

    fetchCategoriesTree().catch((err) =>
        console.error("Error fetching categories:", err)
    );

    initSubheadingLineBehavior();
    initTabBulletBehavior();
    initCleanPasteBehavior();
    initEditorShortcuts();
    initToolbarSelectionProtection();
    renderSavedColors();

    if (elements.noteFormContent) {
        elements.noteFormContent.addEventListener("mouseup", saveEditorSelection);
        elements.noteFormContent.addEventListener("keyup", saveEditorSelection);
    
        elements.noteFormContent.addEventListener("dblclick", (e) => {
            const numberBox = e.target.closest(".styled-section-number");
        
            if (!numberBox) return;
        
            e.preventDefault();
            e.stopPropagation();
        
            openSectionNumberEdit(numberBox);
        });
    }

    document.addEventListener("click", (e) => {
        const colorPanel = qs("colorPickerPanel");
        const colorTool = document.querySelector(".color-tool");
    
        if (colorPanel && colorTool && !colorTool.contains(e.target)) {
            colorPanel.classList.add("hidden");
        }
    
        const sectionPanel = qs("sectionTitlePanel");
        const sectionTool = document.querySelector(".section-title-tool");
    
        if (sectionPanel && sectionTool && !sectionTool.contains(e.target)) {
            sectionPanel.classList.add("hidden");
        }
    });
    
    showHome();
    
});
