# app.py
from flask import Flask, render_template, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import os
import secrets
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from datetime import timedelta


def slugify(s):
    if not s:
        return ''
    s = s.strip().lower()
    out = ''
    for ch in s:
        if ch.isalnum() or ch in (' ', '-'):
            out += ch
    out = '-'.join(out.split())
    # remove multiple hyphens
    while '--' in out:
        out = out.replace('--', '-')
    return out

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE_DIR, 'database')
DB_PATH = os.path.join(DB_DIR, 'clinicalroots.db')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

os.makedirs(DB_DIR, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__,
            static_folder=os.path.join(BASE_DIR, 'frontend'),
            template_folder=os.path.join(BASE_DIR, 'frontend'))
CORS(app, supports_credentials=True)

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(16))
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config["JWT_SECRET_KEY"] = app.config['SECRET_KEY']
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=24)

jwt = JWTManager(app)

# DB helper
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def table_has_column(conn, table, column):
    cur = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r['name'] == column for r in cur)

# Initialization + migration
def init_db():
    conn = get_db_connection()
    c = conn.cursor()

    # users
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1
        )
    """)

    # medical_notes (keep category text for compatibility)
    c.execute("""
        CREATE TABLE IF NOT EXISTS medical_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            content TEXT NOT NULL,
            author_id INTEGER,
            category_id INTEGER,
            views INTEGER DEFAULT 0,
            is_published BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (author_id) REFERENCES users (id),
            FOREIGN KEY (category_id) REFERENCES categories (id)
        )
    """)

    # ensure category_id column exists if older schema
    if not table_has_column(conn, 'medical_notes', 'category_id'):
        try:
            c.execute("ALTER TABLE medical_notes ADD COLUMN category_id INTEGER")
        except Exception:
            pass

    # categories (infinite nesting)
    c.execute("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            slug TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_id) REFERENCES categories (id)
        )
    """)

    # create default admin if missing
    c.execute("SELECT * FROM users WHERE email = 'imenemazouz05@gmail.com'")
    if c.fetchone() is None:
        # admin password from earlier conversation: 'Zain%2005'
        admin_pass_hash = generate_password_hash('Zain%2005')
        c.execute("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
                  ('admin_user', 'imenemazouz05@gmail.com', admin_pass_hash, 'admin'))
        conn.commit()
        print("Created default admin user.")

    # Migrate distinct textual categories from notes into categories table and set category_id
    distinct = c.execute("SELECT DISTINCT category FROM medical_notes WHERE category IS NOT NULL AND TRIM(category) != ''").fetchall()
    def get_or_create_path(path):
        parts = [p.strip() for p in path.split('::') if p.strip()]
        parent = None
        last_id = None
        for part in parts:
            s = slugify(part)
            if parent:
                row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id = ?", (s, parent)).fetchone()
            else:
                row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id IS NULL", (s,)).fetchone()
            if row:
                last_id = row['id']
                parent = last_id
                continue
            # create unique slug
            base = s or slugify(part)
            unique = base
            i = 1
            while conn.execute("SELECT id FROM categories WHERE slug = ?", (unique,)).fetchone():
                unique = f"{base}-{i}"
                i += 1
            conn.execute("INSERT INTO categories (name, parent_id, slug) VALUES (?, ?, ?)", (part, parent, unique))
            conn.commit()
            last_id = conn.execute("SELECT last_insert_rowid() as id").fetchone()['id']
            parent = last_id
        return last_id

    for row in distinct:
        txt = row['category']
        if not txt: continue
        try:
            cid = get_or_create_path(txt)
            if cid:
                c.execute("UPDATE medical_notes SET category_id = ? WHERE category = ?", (cid, txt))
                conn.commit()
        except Exception as e:
            print("Migration error for category:", txt, e)

    # create test structure: Medical::Cardiology::Sub 1 and Sub 2 (per your earlier test request)
    def ensure_test_subs():
        med_id = get_or_create_path("Medical")
        cardio_id = get_or_create_path("Medical::Cardiology")
        # create Sub 1 and Sub 2 under cardiology if missing
        row = conn.execute("SELECT id FROM categories WHERE name = ? AND parent_id = ?", ("Sub 1", cardio_id)).fetchone()
        if not row:
            conn.execute("INSERT INTO categories (name, parent_id, slug, description) VALUES (?, ?, ?, ?)",
                         ("Sub 1", cardio_id, slugify("Sub 1"), "Test subcategory"))
        row = conn.execute("SELECT id FROM categories WHERE name = ? AND parent_id = ?", ("Sub 2", cardio_id)).fetchone()
        if not row:
            conn.execute("INSERT INTO categories (name, parent_id, slug, description) VALUES (?, ?, ?, ?)",
                         ("Sub 2", cardio_id, slugify("Sub 2"), "Test subcategory"))
        conn.commit()
    ensure_test_subs()

    conn.close()
    print("DB initialized/migrated.")

@app.before_first_request
def boot():
    try:
        init_db()
    except Exception as e:
        print("init_db error:", e)

# -------------------------
# Helpers for categories
# -------------------------
def build_category_tree(rows):
    nodes = {r['id']: dict(r) for r in rows}
    for nid in nodes:
        nodes[nid]['children'] = []
    tree = []
    for nid, node in list(nodes.items()):
        pid = node['parent_id']
        if pid and pid in nodes:
            nodes[pid]['children'].append(node)
        else:
            tree.append(node)
    return tree

def get_full_category_path(conn, category_id):
    if not category_id:
        return ''
    parts = []
    cur = category_id
    while cur:
        r = conn.execute("SELECT id, name, parent_id FROM categories WHERE id = ?", (cur,)).fetchone()
        if not r:
            break
        parts.append(r['name'])
        cur = r['parent_id']
    return "::".join(reversed(parts))

# -------------------------
# Public routes
# -------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/categories/tree', methods=['GET'])
def api_categories_tree():
    conn = get_db_connection()
    rows = conn.execute("SELECT id, name, parent_id, slug, description FROM categories ORDER BY name").fetchall()
    conn.close()
    tree = build_category_tree([dict(r) for r in rows])
    return jsonify(tree)

@app.route('/api/category/<int:cat_id>/path', methods=['GET'])
def api_category_path(cat_id):
    conn = get_db_connection()
    path = get_full_category_path(conn, cat_id)
    conn.close()
    return jsonify({'path': path})

@app.route('/api/categories/flat', methods=['GET'])
@jwt_required()
def api_categories_flat():
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin only'}), 403
    conn = get_db_connection()
    rows = conn.execute("SELECT id, name, parent_id, slug, description FROM categories ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

# -------------------------
# Notes endpoints (public)
# -------------------------
@app.route('/api/notes', methods=['GET'])
def api_get_notes():
    conn = get_db_connection()
    category_param = request.args.get('category')
    search = request.args.get('search')
    params = []
    base = "SELECT id, title, category, category_id, views, updated_at FROM medical_notes WHERE is_published = 1"

    if category_param:
        # accept id or path or slug
        if category_param.isdigit():
            base += " AND category_id = ?"
            params.append(int(category_param))
        else:
            # try to interpret as path with '::' or single name
            cid = None
            if "::" in category_param:
                parts = [p.strip() for p in category_param.split("::") if p.strip()]
                parent = None
                for part in parts:
                    s = slugify(part)
                    if parent:
                        row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id = ?", (s, parent)).fetchone()
                    else:
                        row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id IS NULL", (s,)).fetchone()
                    if not row:
                        row = None
                        break
                    parent = row['id']
                cid = parent
            else:
                s = slugify(category_param)
                row = conn.execute("SELECT * FROM categories WHERE slug = ?", (s,)).fetchone()
                cid = row['id'] if row else None
            if cid:
                base += " AND category_id = ?"
                params.append(cid)
            else:
                conn.close()
                return jsonify([])

    if search:
        base += " AND (title LIKE ? OR content LIKE ?)"
        params.append(f"%{search}%")
        params.append(f"%{search}%")

    base += " ORDER BY updated_at DESC"
    rows = conn.execute(base, params).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/note/<int:note_id>', methods=['GET'])
def api_get_note(note_id):
    conn = get_db_connection()
    note = conn.execute("SELECT id, title, category, category_id, content, views, updated_at FROM medical_notes WHERE id = ? AND is_published = 1", (note_id,)).fetchone()
    if not note:
        conn.close()
        return jsonify({'message': 'Note not found'}), 404
    conn.execute("UPDATE medical_notes SET views = views + 1 WHERE id = ?", (note_id,))
    conn.commit()
    updated = dict(note)
    updated['views'] = updated.get('views', 0) + 1
    if updated.get('category_id'):
        updated['category_path'] = get_full_category_path(conn, updated['category_id'])
    conn.close()
    return jsonify(updated)

# -------------------------
# Note CRUD (admin)
# -------------------------
@app.route('/api/note', methods=['POST'])
@jwt_required()
def api_create_note():
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    data = request.get_json()
    title = data.get('title')
    category = data.get('category')  # path or id
    content = data.get('content')
    author_id = cur_user['id']
    if not title or not content:
        return jsonify({'message': 'Title and content required'}), 400
    conn = get_db_connection()
    category_id = None
    if category:
        if isinstance(category, int) or (isinstance(category, str) and category.isdigit()):
            category_id = int(category)
        else:
            # create/resolve path
            parts = [p.strip() for p in category.split("::") if p.strip()]
            parent = None
            for part in parts:
                s = slugify(part)
                if parent:
                    row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id = ?", (s, parent)).fetchone()
                else:
                    row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id IS NULL", (s,)).fetchone()
                if not row:
                    # create
                    conn.execute("INSERT INTO categories (name, parent_id, slug) VALUES (?, ?, ?)", (part, parent, s))
                    conn.commit()
                    row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id IS ?", (s, parent)).fetchone()
                parent = row['id']
            category_id = parent
    try:
        # keep textual category (backwards compatibility) as the human path
        text_cat = category if isinstance(category, str) else (get_full_category_path(conn, category_id) if category_id else '')
        conn.execute("INSERT INTO medical_notes (title, category, content, author_id, category_id) VALUES (?, ?, ?, ?, ?)",
                     (title, text_cat, content, author_id, category_id))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Note created'})
    except Exception as e:
        conn.close()
        print("Error creating note:", e)
        return jsonify({'message': 'Error creating note'}), 500

@app.route('/api/note/<int:note_id>', methods=['PUT'])
@jwt_required()
def api_update_note(note_id):
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    data = request.get_json()
    title = data.get('title')
    content = data.get('content')
    category = data.get('category')
    conn = get_db_connection()
    category_id = None
    if category:
        if isinstance(category, int) or (isinstance(category, str) and category.isdigit()):
            category_id = int(category)
        else:
            parts = [p.strip() for p in category.split("::") if p.strip()]
            parent = None
            for part in parts:
                s = slugify(part)
                if parent:
                    row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id = ?", (s, parent)).fetchone()
                else:
                    row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id IS NULL", (s,)).fetchone()
                if not row:
                    conn.execute("INSERT INTO categories (name, parent_id, slug) VALUES (?, ?, ?)", (part, parent, s))
                    conn.commit()
                    row = conn.execute("SELECT * FROM categories WHERE slug = ? AND parent_id IS ?", (s, parent)).fetchone()
                parent = row['id']
            category_id = parent
    try:
        text_cat = category if isinstance(category, str) else (get_full_category_path(conn, category_id) if category_id else '')
        conn.execute("UPDATE medical_notes SET title = ?, content = ?, category = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                     (title, content, text_cat, category_id, note_id))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Note updated'})
    except Exception as e:
        conn.close()
        print("Error updating note:", e)
        return jsonify({'message': 'Error updating note'}), 500

@app.route('/api/note/<int:note_id>', methods=['DELETE'])
@jwt_required()
def api_delete_note(note_id):
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM medical_notes WHERE id = ?", (note_id,))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Note deleted'})
    except Exception as e:
        conn.close()
        print("Error deleting note:", e)
        return jsonify({'message': 'Error deleting note'}), 500

# -------------------------
# Category CRUD (admin)
# -------------------------
@app.route('/api/category', methods=['POST'])
@jwt_required()
def api_create_category():
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    data = request.get_json()
    name = data.get('name')
    parent_id = data.get('parent_id')
    description = data.get('description', '')
    if not name:
        return jsonify({'message': 'Name required'}), 400
    conn = get_db_connection()
    try:
        s = slugify(name)
        base = s or slugify(name)
        unique = base
        i = 1
        while conn.execute("SELECT id FROM categories WHERE slug = ?", (unique,)).fetchone():
            unique = f"{base}-{i}"
            i += 1
        conn.execute("INSERT INTO categories (name, parent_id, slug, description) VALUES (?, ?, ?, ?)",
                     (name, parent_id, unique, description))
        conn.commit()
        new_id = conn.execute("SELECT last_insert_rowid() as id").fetchone()['id']
        conn.close()
        return jsonify({'message': 'Category created', 'id': new_id})
    except Exception as e:
        conn.close()
        print("Error creating category:", e)
        return jsonify({'message': 'Error creating category'}), 500

@app.route('/api/category/<int:cat_id>', methods=['PUT'])
@jwt_required()
def api_update_category(cat_id):
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    data = request.get_json()
    new_name = data.get('name')
    new_parent = data.get('parent_id')
    new_description = data.get('description')
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (cat_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'message': 'Category not found'}), 404
    try:
        updates = []
        params = []
        if new_name:
            updates.append("name = ?")
            params.append(new_name)
            s = slugify(new_name)
            base = s or slugify(new_name)
            unique = base
            i = 1
            while conn.execute("SELECT id FROM categories WHERE slug = ? AND id != ?", (unique, cat_id)).fetchone():
                unique = f"{base}-{i}"
                i += 1
            updates.append("slug = ?")
            params.append(unique)
        if new_parent is not None:
            if int(new_parent) == int(cat_id):
                conn.close()
                return jsonify({'message': 'Cannot set parent to self'}), 400
            updates.append("parent_id = ?")
            params.append(new_parent)
        if new_description is not None:
            updates.append("description = ?")
            params.append(new_description)
        if not updates:
            conn.close()
            return jsonify({'message': 'Nothing to update.'})
        params.append(cat_id)
        sql = f"UPDATE categories SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        conn.execute(sql, params)
        conn.commit()
        conn.close()
        return jsonify({'message': 'Category updated'})
    except Exception as e:
        conn.close()
        print("Error updating category:", e)
        return jsonify({'message': 'Error updating category'}), 500

@app.route('/api/category/<int:cat_id>', methods=['DELETE'])
@jwt_required()
def api_delete_category(cat_id):
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    conn = get_db_connection()
    try:

        # collect all descendant ids
        to_delete = []
        stack = [cat_id]
        while stack:
            cur = stack.pop()
            to_delete.append(cur)
            children = conn.execute("SELECT id FROM categories WHERE parent_id = ?", (cur,)).fetchall()
            for ch in children:
                stack.append(ch['id'])

        # unset notes' category_id
        qmarks = ','.join('?'*len(to_delete))
        conn.execute(f"UPDATE medical_notes SET category_id = NULL WHERE category_id IN ({qmarks})", to_delete)
        conn.execute(f"DELETE FROM categories WHERE id IN ({qmarks})", to_delete)
        conn.commit()
        conn.close()
        return jsonify({'message': 'Category and descendants deleted'})
    except Exception as e:
        conn.close()
        print("Error deleting category:", e)
        return jsonify({'message': 'Error deleting category'}), 500


# Admin stats / top notes (existing)

@app.route('/api/admin_stats', methods=['GET'])
@jwt_required()
def api_admin_stats():
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    conn = get_db_connection()
    total_notes = conn.execute("SELECT COUNT(id) FROM medical_notes").fetchone()[0]
    total_users = conn.execute("SELECT COUNT(id) FROM users").fetchone()[0]
    total_views = conn.execute("SELECT SUM(views) FROM medical_notes").fetchone()[0] or 0
    last_update = conn.execute("SELECT MAX(updated_at) FROM medical_notes").fetchone()[0]
    conn.close()
    return jsonify({'total_notes': total_notes, 'total_users': total_users, 'total_views': total_views, 'last_update': last_update})

@app.route('/api/note_views', methods=['GET'])
@jwt_required()
def api_top_notes():
    cur_user = get_jwt_identity()
    if cur_user['role'] != 'admin':
        return jsonify({'message': 'Admin required'}), 403
    conn = get_db_connection()
    rows = conn.execute("SELECT id, title, category, views FROM medical_notes ORDER BY views DESC LIMIT 5").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# Auth (existing)

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    conn = get_db_connection()
    user = conn.execute("SELECT id, email, password_hash, role FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    if user and check_password_hash(user['password_hash'], password):
        identity = {'id': user['id'], 'role': user['role']}
        token = create_access_token(identity=identity)
        return jsonify({'message': 'Login successful', 'token': token, 'user': {'id': user['id'], 'email': user['email'], 'role': user['role']}})
    return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/api/logout', methods=['POST'])
def api_logout():
    return jsonify({'message': 'Logged out'})

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
