// --------------------------
// BASIC API HELPER
// --------------------------
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

    const res = await fetch(url, options);

    if (!res.ok) {
        if (res.status === 401) {
            alert("Session expired. Please log in again.");
            handleLogout(false);
            openLogin();
            throw new Error("Unauthorized");
        }
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
        tools: qs("toolsPage"),
        ia: qs("iaPage"),
        about: qs("aboutPage"),
    },
    subcategoriesGrid: qs("subcategoriesContainer"),
    notesContainer: qs("notesContainer"),
    adminNotesContainer: qs("adminNotesContainer"),
    noteTitle: qs("noteTitle"),
    noteBody: qs("noteBody"),
    noteMeta: qs("noteMeta"),
    loginForm: qs("loginForm"),
    loginModal: qs("loginModal"),
    loginBtn: qs("loginBtn"),
    userMenu: qs("userMenu"),
    userEmailDisplay: qs("userEmailDisplay"),
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
let currentCategoryId = null; // category currently being viewed
let categoriesTree = [];
let flatCategories = []; // {id, name, parent_id, path}
let adminNoteCache = {}; // id -> note
let editingNoteId = null; // null = create mode

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
async function fetchAndRenderTopCategories() {
    if (!flatCategories.length) {
        await fetchCategoriesTree();
    }

    const grid =
        document.getElementById("subcategoriesGrid") ||
        document.querySelector(".categories");
    if (!grid) return;

    grid.innerHTML = "";

    const tops = flatCategories.filter((c) => !c.parent_id);
    tops.forEach((c) => {
        const div = document.createElement("div");
        div.className = "subcategory-card category-card";
        div.style.cursor = "pointer";
        div.onclick = () => openCategoryById(c.id);
        div.innerHTML = `<h4>${c.name}</h4><p>${c.path}</p>`;
        grid.appendChild(div);
    });
}

async function openCategoryById(catId) {
    if (!flatCategories.length) {
        await fetchCategoriesTree();
    }
    currentCategoryId = catId;

    const cat = getCategoryById(catId);
    const header = qs("categoryTitle");
    if (header) header.textContent = cat ? cat.name : "Category";

    const desc = qs("categoryDescription");
    if (desc) desc.textContent = cat ? cat.path : "";

    switchView("category");

    const children = flatCategories.filter((c) => c.parent_id === catId);

    const subcontainer = qs("subcategoriesContainer");
    subcontainer.innerHTML = "";

    // Admin button to add subcategory under this category
    if (currentUser && currentUser.role === "admin") {
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
    children.forEach((ch) => {
        const card = document.createElement("div");
        card.className = "subcategory-card";
        card.onclick = () => openCategoryById(ch.id);

        let adminControlsHtml = "";
        if (currentUser && currentUser.role === "admin") {
            const isRoot = !ch.parent_id;
            // Do not allow edit/delete of 3 root cats (enforced in backend too)
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
            <p>${ch.path}</p>
        `;
        subcontainer.appendChild(card);
    });

    // Notes in this category
    const notes = await api(`/api/notes?category=${catId}`);
    const notesContainer = qs("notesContainer");
    notesContainer.innerHTML = "";

    // Admin "add note" button for this category
    if (currentUser && currentUser.role === "admin") {
        const btnWrap = document.createElement("div");
        btnWrap.style.marginBottom = "1rem";

        const btn = document.createElement("button");
        btn.className = "btn btn-primary";
        btn.textContent = `+ Add note in "${cat.name}"`;
        btn.onclick = () => showAddNote(catId);

        btnWrap.appendChild(btn);
        notesContainer.appendChild(btnWrap);
    }

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
}

async function showNoteView(noteId) {
    switchView("noteView");
    const note = await api(`/api/note/${noteId}`);

    elements.noteTitle.textContent = note.title;
    elements.noteBody.innerHTML = note.content;
    const cat = getCategoryById(note.category_id);
    elements.noteMeta.textContent = cat ? cat.path : "";
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

// --------------------------
// ADMIN – NOTES
// --------------------------
function fillNoteFormSelects(preselectedCategoryId = null) {
    // root select = 3 main categories
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
            opt.textContent = c.path.replace(/^.+ :: /, ""); // drop root name
            subSelect.appendChild(opt);
        });
        if (selectedLeafId) {
            subSelect.value = selectedLeafId;
        }
    }

    rootSelect.onchange = () => {
        populateSubs(rootSelect.value);
    };

    // preselect if we know target category
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
    // sources & tags in HTML – we won't send to backend yet
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
    const text = prompt("Heading text:");
    if (!text) return;
    document.execCommand("insertHTML", false, `<h3>${text}</h3>`);
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

    // status: 'published' | 'drafts' | 'bin'
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

    // preselect category
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
    // optional; fill your own list if you add it to HTML
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

// Simple change-password flow using prompts
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
// ABOUT / TOOLS (simple client-side editing)
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
    switchView("home");
    fetchAndRenderTopCategories();
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

function showManageCategories() {
    // just open the category page with top-level categories
    switchView("category");
    qs("categoryTitle").textContent = "Manage Categories";
    qs("categoryDescription").textContent =
        "Click a category to drill down. You can add/edit/delete subcategories (but not the top 3 roots).";
    fetchAndRenderTopCategories();
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

    fetchCategoriesTree().then(() => {
        showHome();
    });
});
