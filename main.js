// ---------- BACKEND BASE ----------
const API_BASE = "https://imeneee.pythonanywhere.com";

function apiUrl(path) {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${API_BASE}${path}`;
}

// ---------- Small helpers ----------
function apiHeaders() {
    const token = sessionStorage.getItem('jwt');
    return token
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        : { 'Content-Type': 'application/json' };
}

async function api(path, opts = {}) {
    const url = apiUrl(path);
    const options = { headers: apiHeaders(), ...opts };

    const res = await fetch(url, options);
    if (!res.ok) {
        if (res.status === 401) {
            alert("Session expired. Please log in again.");
            handleLogout(false);
            openLogin();
            throw new Error("Unauthorized");
        }
        const text = await res.text().catch(() => null);
        throw new Error(text || `HTTP ${res.status}`);
    }
    if (res.status === 204) return {};
    return res.json();
}

function qs(id) { return document.getElementById(id); }

// ---------- Elements ----------
const elements = {
    pages: {
        home: qs('homePage'),
        library: qs('libraryPage'),
        category: qs('categoryPage'),
        subcategory: qs('subcategoryPage'),
        noteView: qs('notePage'),
        admin: qs('adminDashboard'),
        addNote: qs('addNotePage'),
        adminNotes: qs('adminNotesPage'),
        tools: qs('toolsPage'),
        ia: qs('iaPage'),
        about: qs('aboutPage'),
    },
    subcategoriesGrid: qs('subcategoriesContainer'),
    notesContainer: qs('notesContainer'),
    notesListHeader: qs('notesListHeader') || qs('categoryTitle'),
    noteTitle: qs('noteTitle'),
    noteBody: qs('noteBody'),
    noteMeta: qs('noteMeta'),
    loginForm: qs('loginForm'),
    loginModal: qs('loginModal'),
    loginBtn: qs('loginBtn'),
    signupBtn: qs('signupBtn'),
    userMenu: qs('userMenu'),
    userDropdownContent: qs('userDropdownContent'),
    addNoteForm: qs('noteForm'),
    noteFormTitle: qs('noteFormTitle'),
    noteFormCategory: qs('noteFormCategory'),
    noteFormSubcategory: qs('noteFormSubcategory'),
    noteFormContent: qs('noteFormContent'),
    noteFormSources: qs('noteFormSources'),
    noteFormTags: qs('noteFormTags'),
    publishedCount: qs('publishedCount'),
    draftsCount: qs('draftsCount'),
    deletedCount: qs('deletedCount'),
    totalViews: qs('totalViews'),
};

let currentUser = null;
let currentCategoryId = null;
let currentCategoryPath = "";
let categoriesTree = [];
let flatCategories = [];
let editingNoteId = null;

// ---------- AUTH ----------
async function handleLogin(e) {
    e.preventDefault();
    const email = qs('loginEmail').value.trim();
    const password = qs('loginPassword').value;

    try {
        const res = await fetch(apiUrl('/api/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.message || "Login failed");
            return;
        }

        sessionStorage.setItem('jwt', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        updateLoginUI();
        closeLogin();
        showHome();

    } catch (err) {
        console.error(err);
        alert("Login error: " + err.message);
    }
}

function updateLoginUI() {
    const stored = sessionStorage.getItem('user');
    currentUser = stored ? JSON.parse(stored) : null;

    if (!currentUser) {
        if (elements.loginBtn) elements.loginBtn.classList.remove('hidden');
        if (elements.signupBtn) elements.signupBtn.classList.remove('hidden');
        if (elements.userMenu) elements.userMenu.classList.add('hidden');
        document.body.classList.remove('admin-logged-in');
        return;
    }

    if (elements.loginBtn) elements.loginBtn.classList.add('hidden');
    if (elements.signupBtn) elements.signupBtn.classList.add('hidden');
    if (elements.userMenu) elements.userMenu.classList.remove('hidden');
    document.body.classList.add('admin-logged-in');
}

function handleLogout(showAlert = true) {
    sessionStorage.removeItem('jwt');
    sessionStorage.removeItem('user');
    currentUser = null;
    updateLoginUI();
    showHome();
    if (showAlert) alert("Logged out.");
}

function openLogin() { if (elements.loginModal) elements.loginModal.style.display = 'flex'; }
function closeLogin() { if (elements.loginModal) elements.loginModal.style.display = 'none'; }

function toggleUserMenu() {
    if (!elements.userDropdownContent) return;
    const d = elements.userDropdownContent;
    d.style.display = d.style.display === 'block' ? 'none' : 'block';
}

// ---------- THEME ----------
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark') {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

(function initTheme() {
    const stored = localStorage.getItem('theme');
    if (stored) {
        document.documentElement.setAttribute('data-theme', stored);
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
    }
})();

// ---------- NAVIGATION ----------
function hideAllPages() {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
}

function switchView(name) {
    hideAllPages();
    if (elements.pages[name]) {
        elements.pages[name].classList.remove('hidden');
    }
}

function showHome() {
    switchView('home');
    fetchAndRenderTopCategories().catch(console.error);
}

function showLibrary() {
    switchView('library');
    fetchAndRenderTopCategories().catch(console.error);
}

function showTools() {
    switchView('tools');
}

function showIA() {
    switchView('ia');
}

function showAbout() {
    switchView('about');
}

function showAdminDashboard() {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    switchView('admin');
    fetchAdminStats().catch(console.error);
    fetchTopNotes().catch(console.error);
}

function showAddNote() {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    editingNoteId = null;
    if (elements.addNoteTitle) elements.addNoteTitle = "Add New Note";
    switchView('addNote');
    populateNoteCategorySelect().catch(console.error);
    if (elements.noteFormTitle) elements.noteFormTitle.value = '';
    if (elements.noteFormSubcategory) elements.noteFormSubcategory.innerHTML = '<option value="">Select Subcategory</option>';
    if (elements.noteFormContent) elements.noteFormContent.innerHTML = '';
    if (elements.noteFormSources) elements.noteFormSources.value = '';
    if (elements.noteFormTags) elements.noteFormTags.value = '';
}

function showAdminNotes(status) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    // Simple placeholder — can be extended
    switchView('adminNotes');
    const title = qs('adminNotesTitle');
    const desc = qs('adminNotesDescription');
    if (title) title.textContent = `Notes (${status})`;
    if (desc) desc.textContent = `Management view for ${status} notes coming soon.`;
}

// ---------- CATEGORIES ----------
async function fetchCategoriesTree() {
    const tree = await api('/api/categories/tree');
    categoriesTree = tree;
    flatCategories = [];

    function walk(nodes, parentPath = '') {
        nodes.forEach(n => {
            const path = parentPath ? `${parentPath}::${n.name}` : n.name;
            flatCategories.push({
                id: n.id,
                name: n.name,
                parent_id: n.parent_id,
                path
            });
            if (n.children && n.children.length) {
                walk(n.children, path);
            }
        });
    }
    walk(categoriesTree);
    return tree;
}

async function fetchAndRenderTopCategories() {
    await fetchCategoriesTree();
    const grid = document.getElementById('subcategoriesGrid') || document.querySelector('.categories');
    if (!grid) return;

    grid.innerHTML = '';
    const tops = flatCategories.filter(c => !c.parent_id);
    tops.forEach(c => {
        const div = document.createElement('div');
        div.className = 'subcategory-card category-card';
        div.style.cursor = 'pointer';
        div.onclick = () => openCategoryById(c.id);
        div.innerHTML = `
            <h4>${c.name}</h4>
            <p>${c.path}</p>
        `;
        grid.appendChild(div);
    });
}

// open category by ID
async function openCategoryById(catId) {
    currentCategoryId = catId;
    const cat = flatCategories.find(c => c.id === catId);
    currentCategoryPath = cat ? cat.path : '';

    // category header
    const header = qs('categoryTitle');
    const desc = qs('categoryDescription');
    if (header) header.textContent = cat ? cat.name : 'Category';
    if (desc) desc.textContent = cat ? cat.path : '';

    switchView('category');

    // children categories
    const children = flatCategories.filter(c => c.parent_id === catId);
    const subcontainer = qs('subcategoriesContainer');
    if (subcontainer) subcontainer.innerHTML = '';

    if (subcontainer) {
        if (children.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = `<div class="empty-state-icon">📂</div><p>No subcategories yet.</p>`;
            subcontainer.appendChild(empty);
        } else {
            children.forEach(ch => {
                const card = document.createElement('div');
                card.className = 'subcategory-card';
                card.onclick = () => openCategoryById(ch.id);
                card.innerHTML = `
                    <h4>${ch.name}</h4>
                    <p style="color: var(--text-light);">${ch.path}</p>
                    <div class="admin-controls">
                        <button class="admin-btn edit" title="Rename" onclick="event.stopPropagation(); editCategoryClient(${ch.id})"><i class="fas fa-pen"></i></button>
                        <button class="admin-btn delete" title="Delete" onclick="event.stopPropagation(); deleteCategoryClient(${ch.id})"><i class="fas fa-trash-alt"></i></button>
                    </div>
                `;
                subcontainer.appendChild(card);
            });
        }

        // add subcategory button at bottom (admin)
        if (currentUser?.role === 'admin') {
            const btnRow = document.createElement('div');
            btnRow.style.marginTop = '1rem';
            btnRow.innerHTML = `
                <button class="btn btn-primary" onclick="promptAddSubcategory(${catId})">
                    + Add Subcategory
                </button>
            `;
            subcontainer.appendChild(btnRow);
        }
    }

    // notes in this category
    const notes = await api(`/api/notes?category=${catId}`);
    const notesContainer = qs('notesContainer') || qs('subcategoryPage')?.querySelector('#notesContainer');
    if (!notesContainer) return;
    notesContainer.innerHTML = '';

    const headerDiv = document.createElement('div');
    headerDiv.style.display = 'flex';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.marginBottom = '1rem';
    headerDiv.innerHTML = `<h3>Notes</h3>`;

    if (currentUser?.role === 'admin') {
        const btnNote = document.createElement('button');
        btnNote.className = 'btn btn-primary';
        btnNote.textContent = '+ Add Note';
        btnNote.onclick = () => openAddNoteForCategory(catId);
        headerDiv.appendChild(btnNote);
    }

    notesContainer.appendChild(headerDiv);

    if (!notes || notes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `<div class="empty-state-icon">📄</div><p>No notes yet in this category.</p>`;
        notesContainer.appendChild(empty);
    } else {
        notes.forEach(n => {
            const card = document.createElement('div');
            card.className = 'note-item';
            card.onclick = () => showNoteView(n.id);
            card.innerHTML = `
                <div class="note-info">
                    <h4>${n.title}</h4>
                    <div class="note-meta">${currentCategoryPath}</div>
                </div>
                <div class="note-views">${n.views} views</div>
                ${currentUser?.role === 'admin' ? `
                    <div class="admin-controls">
                        <button class="admin-btn edit" title="Edit" onclick="event.stopPropagation(); openEditNote(${n.id})"><i class="fas fa-pen"></i></button>
                        <button class="admin-btn delete" title="Delete" onclick="event.stopPropagation(); deleteNoteClient(${n.id})"><i class="fas fa-trash-alt"></i></button>
                    </div>
                ` : ''}
            `;
            notesContainer.appendChild(card);
        });
    }
}

// open category by name (for home cards)
async function showCategory(nameOrId) {
    await fetchCategoriesTree();

    // numeric -> treat as id
    if (!isNaN(Number(nameOrId))) {
        return openCategoryById(Number(nameOrId));
    }

    const target = String(nameOrId).toLowerCase();
    let found = null;
    function search(nodes) {
        for (const n of nodes) {
            if (n.name.toLowerCase() === target) return n;
            if (n.children && n.children.length) {
                const f = search(n.children);
                if (f) return f;
            }
        }
        return null;
    }
    found = search(categoriesTree);
    if (!found) {
        alert(`Category "${nameOrId}" not found`);
        return;
    }
    openCategoryById(found.id);
}

// ---------- CATEGORY ADMIN ----------
async function promptAddSubcategory(parentId) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    const name = prompt('Name for new subcategory:');
    if (!name || !name.trim()) return;

    try {
        await api('/api/category', {
            method: 'POST',
            body: JSON.stringify({ name: name.trim(), parent_id: parentId })
        });
        await fetchCategoriesTree();
        openCategoryById(parentId);
        alert('Subcategory created.');
    } catch (err) {
        console.error(err);
        alert('Error creating subcategory: ' + err.message);
    }
}

async function editCategoryClient(catId) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    const newName = prompt('New category name:');
    if (!newName) return;

    try {
        await api(`/api/category/${catId}`, {
            method: 'PUT',
            body: JSON.stringify({ name: newName })
        });
        await fetchCategoriesTree();
        const cat = flatCategories.find(c => c.id === catId);
        if (cat?.parent_id) {
            openCategoryById(cat.parent_id);
        } else {
            fetchAndRenderTopCategories();
        }
        alert('Category renamed.');
    } catch (err) {
        console.error(err);
        alert('Error updating category: ' + err.message);
    }
}

async function deleteCategoryClient(catId) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    if (!confirm('Delete this category? (Only empty categories can be deleted.)')) return;

    try {
        const res = await api(`/api/category/${catId}`, { method: 'DELETE' });
        alert(res.message || 'Category deleted.');
        await fetchCategoriesTree();
        const cat = flatCategories.find(c => c.id === catId);
        if (cat?.parent_id) {
            openCategoryById(cat.parent_id);
        } else {
            fetchAndRenderTopCategories();
            showHome();
        }
    } catch (err) {
        console.error(err);
        alert('Delete failed: ' + err.message);
    }
}

// ---------- NOTES ADMIN ----------
async function populateNoteCategorySelect() {
    await fetchCategoriesTree();
    const select = elements.noteFormCategory;
    const subSelect = elements.noteFormSubcategory;

    if (!select || !subSelect) return;

    select.innerHTML = `<option value="">Select Category</option>`;
    flatCategories
        .filter(c => !c.parent_id) // top level
        .forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            select.appendChild(opt);
        });

    select.onchange = function () {
        const rootId = Number(this.value);
        subSelect.innerHTML = `<option value="">Select Subcategory</option>`;
        if (!rootId) return;
        flatCategories
            .filter(c => c.parent_id === rootId)
            .forEach(ch => {
                const o = document.createElement('option');
                o.value = ch.id;
                o.textContent = ch.name;
                subSelect.appendChild(o);
            });
    };
}

function getSelectedCategoryForNote() {
    const rootVal = elements.noteFormCategory?.value;
    const subVal = elements.noteFormSubcategory?.value;
    if (subVal) return Number(subVal);
    if (rootVal) return Number(rootVal);
    return null;
}

async function openAddNoteForCategory(catId) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    editingNoteId = null;
    switchView('addNote');
    await populateNoteCategorySelect();

    // try to preselect
    const cat = flatCategories.find(c => c.id === catId);
    if (cat) {
        // find top-level ancestor
        let root = cat;
        while (root.parent_id) {
            root = flatCategories.find(c => c.id === root.parent_id) || root;
        }
        elements.noteFormCategory.value = String(root.id);
        elements.noteFormCategory.dispatchEvent(new Event('change'));
        if (cat.id !== root.id) {
            elements.noteFormSubcategory.value = String(cat.id);
        }
    }

    elements.noteFormTitle.value = '';
    elements.noteFormContent.innerHTML = '';
    elements.noteFormSources.value = '';
    elements.noteFormTags.value = '';
}

async function openEditNote(noteId) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    try {
        const note = await api(`/api/note/${noteId}`);
        editingNoteId = noteId;
        switchView('addNote');
        await populateNoteCategorySelect();

        elements.noteFormTitle.value = note.title;
        // naive: we don't know exact nesting; so just set category_id as a subcategory
        const catId = note.category_id;
        const cat = flatCategories.find(c => c.id === catId);
        if (cat) {
            let root = cat;
            while (root.parent_id) {
                root = flatCategories.find(c => c.id === root.parent_id) || root;
            }
            elements.noteFormCategory.value = String(root.id);
            elements.noteFormCategory.dispatchEvent(new Event('change'));
            if (cat.id !== root.id) {
                elements.noteFormSubcategory.value = String(cat.id);
            }
        }

        elements.noteFormContent.innerHTML = note.content;
    } catch (err) {
        console.error(err);
        alert("Error loading note: " + err.message);
    }
}

async function deleteNoteClient(noteId) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    if (!confirm('Delete this note?')) return;
    try {
        await api(`/api/note/${noteId}`, { method: 'DELETE' });
        alert('Note deleted.');
        if (currentCategoryId) openCategoryById(currentCategoryId);
    } catch (err) {
        console.error(err);
        alert('Delete error: ' + err.message);
    }
}

async function saveNote(isDraft) {
    if (!currentUser || currentUser.role !== 'admin') {
        alert("Admin only");
        return;
    }
    const title = elements.noteFormTitle.value.trim();
    const categoryId = getSelectedCategoryForNote();
    const content = elements.noteFormContent.innerHTML.trim();

    if (!title || !categoryId || !content) {
        alert('Title, category, and content are required.');
        return;
    }

    const payload = {
        title,
        content,
        category: categoryId,
        is_draft: !!isDraft,
    };

    try {
        if (!editingNoteId) {
            await api('/api/note', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            alert(isDraft ? 'Draft saved.' : 'Note published.');
        } else {
            await api(`/api/note/${editingNoteId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert(isDraft ? 'Draft updated.' : 'Note updated.');
        }

        if (currentCategoryId) {
            openCategoryById(currentCategoryId);
        } else {
            showAdminDashboard();
        }
    } catch (err) {
        console.error(err);
        alert('Error saving note: ' + err.message);
    }
}

// ---------- NOTE VIEW ----------
async function showNoteView(noteId) {
    switchView('noteView');
    elements.noteTitle.textContent = 'Loading...';
    elements.noteBody.innerHTML = '';

    try {
        const note = await api(`/api/note/${noteId}`);
        elements.noteTitle.textContent = note.title;
        elements.noteBody.innerHTML = note.content;
        elements.noteMeta.textContent = currentCategoryPath || '';
        // reset progress
        const fill = qs('progressFill');
        const text = qs('progressText');
        if (fill) fill.style.width = '0%';
        if (text) text.textContent = '0%';
    } catch (err) {
        console.error(err);
        elements.noteTitle.textContent = 'Error loading note';
        elements.noteBody.textContent = err.message;
    }
}

// ---------- ADMIN STATS ----------
async function fetchAdminStats() {
    if (!currentUser) return;
    try {
        const stats = await api('/api/admin_stats');
        if (elements.publishedCount) elements.publishedCount.textContent = stats.total_notes ?? 0;
        if (elements.draftsCount) elements.draftsCount.textContent = stats.draft_notes ?? 0;
        if (elements.deletedCount) elements.deletedCount.textContent = stats.deleted_notes ?? 0;
        if (elements.totalViews) elements.totalViews.textContent = stats.total_views ?? 0;
    } catch (err) {
        console.error(err);
    }
}

async function fetchTopNotes() {
    if (!currentUser) return;
    try {
        const top = await api('/api/note_views');
        const list = qs('adminTopNotesList');
        if (list) {
            list.innerHTML = top.map(n => `<p>${n.title} (${n.views})</p>`).join('');
        }
    } catch (err) {
        console.error(err);
    }
}

// ---------- EDITOR HELPER BUTTONS ----------
function formatText(cmd) {
    document.execCommand(cmd, false, null);
}

function insertHeading() {
    document.execCommand('formatBlock', false, 'h2');
}

function insertList() {
    document.execCommand('insertUnorderedList', false, null);
}

function insertLink() {
    const url = prompt('Enter URL:');
    if (url) {
        document.execCommand('createLink', false, url);
    }
}

function insertImage() {
    const url = prompt('Enter image URL:');
    if (url) {
        document.execCommand('insertImage', false, url);
    }
}

// ---------- ABOUT PAGE EDITOR (LOCAL ONLY) ----------
function editAboutContent() {
    const aboutContent = qs('aboutContent');
    const modal = qs('aboutEditorModal');
    const editor = qs('aboutEditor');
    if (!aboutContent || !modal || !editor) return;
    editor.innerHTML = aboutContent.innerHTML;
    modal.style.display = 'flex';
}

function closeAboutEditor() {
    const modal = qs('aboutEditorModal');
    if (modal) modal.style.display = 'none';
}

function formatAboutText(cmd) {
    document.execCommand(cmd, false, null);
}

function insertAboutHeading() {
    document.execCommand('formatBlock', false, 'h2');
}

function insertAboutList() {
    document.execCommand('insertUnorderedList', false, null);
}

function insertAboutLink() {
    const url = prompt('Enter URL:');
    if (url) {
        document.execCommand('createLink', false, url);
    }
}

function saveAboutContent() {
    const editor = qs('aboutEditor');
    const aboutContent = qs('aboutContent');
    if (!editor || !aboutContent) return;
    aboutContent.innerHTML = editor.innerHTML;
    closeAboutEditor();
    alert('About content updated locally (not saved to backend).');
}

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', () => {
    updateLoginUI();
    if (elements.loginForm) {
        elements.loginForm.addEventListener('submit', handleLogin);
    }
    fetchAndRenderTopCategories().catch(console.error);
});
