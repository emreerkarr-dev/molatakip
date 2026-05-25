// ============================
// MOLA TAKİP SİSTEMİ - app.js
// Firebase Firestore ile Çoklu Kullanıcı Desteği
// ============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyAv91YPN90YSYRFn1GPEdmDDftrJMiHe8w",
    authDomain: "mola-takip-c94f6.firebaseapp.com",
    projectId: "mola-takip-c94f6",
    storageBucket: "mola-takip-c94f6.firebasestorage.app",
    messagingSenderId: "654113312258",
    appId: "1:654113312258:web:90388cd785da54e7ab211b",
    measurementId: "G-1P58DGR4JC"
};

const firebaseApp = initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);
const mainDocRef = doc(firestore, 'molaDB', 'data');

// --- VERİTABANI ---
let localDB = { users: {}, requests: [] };

function getDB() {
    return JSON.parse(JSON.stringify(localDB));
}

function saveDB(data) {
    localDB = data;
    setDoc(mainDocRef, data).catch(err => {
        console.error("Firebase yazma hatası:", err);
        showNotification("Veritabanına yazılamadı! Firebase kurallarınızı kontrol edin.", "error");
    });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// --- SABİTLER ---
const DURATIONS = { short: 15, meal: 30 };
const MAX_DAILY = 60;

// --- DURUM ---
let currentUser = null;
let timerInterval = null;
let eventsBound = { employee: false, admin: false };

// --- DOM ---
const $ = id => document.getElementById(id);
const views = { login: $('login-view'), employee: $('employee-view'), admin: $('admin-view') };
const notifContainer = $('notification-container');

// ===================
// YARDIMCI FONKSİYONLAR
// ===================

function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.textContent = message;
    notifContainer.appendChild(n);

    if ("Notification" in window && Notification.permission === 'granted') {
        try { new Notification("Mola Takip", { body: message }); } catch(e) {}
    }

    setTimeout(() => {
        n.style.animation = 'notif-out 0.3s ease forwards';
        setTimeout(() => n.remove(), 300);
    }, 4000);
}

function requestNotifPermission() {
    if ("Notification" in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function switchView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[name].classList.add('active');
}

function fmtTime(ms) {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function hideLoading() {
    const ls = $('loading-screen');
    if (ls) { ls.classList.add('hide'); setTimeout(() => ls.remove(), 600); }
    $('app').style.display = '';
}

// ===================
// GİRİŞ / ÇIKIŞ
// ===================

function login(username, role) {
    currentUser = { username, role };
    sessionStorage.setItem('currentUser', JSON.stringify(currentUser));

    const db = getDB();
    if (role === 'employee' && !db.users[username]) {
        db.users[username] = { usedTime: 0, shift: '', hasTakenMealBreak: false };
        saveDB(db);
    }

    requestNotifPermission();

    if (role === 'employee') {
        setupEmployeeView();
        switchView('employee');
    } else {
        setupAdminView();
        switchView('admin');
    }
    startTimer();
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem('currentUser');
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    switchView('login');
}

// ===================
// ÇALIŞAN EKRANI
// ===================

function setupEmployeeView() {
    $('emp-welcome').textContent = currentUser.username;
    $('emp-avatar').textContent = currentUser.username.charAt(0).toUpperCase();

    if (!eventsBound.employee) {
        eventsBound.employee = true;
        $('emp-logout').addEventListener('click', logout);
        $('request-form').addEventListener('submit', e => { e.preventDefault(); createRequest(); });
    }
    renderEmployee();
}

function renderEmployee() {
    if (!currentUser || currentUser.role !== 'employee') return;
    const db = getDB();
    const u = db.users[currentUser.username] || { usedTime: 0, shift: '', hasTakenMealBreak: false };

    // Haklar
    const rem = MAX_DAILY - u.usedTime;
    const pct = Math.round((u.usedTime / MAX_DAILY) * 100);
    $('emp-remaining').textContent = rem;
    $('emp-used').textContent = u.usedTime;
    $('emp-progress').style.width = pct + '%';
    $('emp-progress-label').textContent = `%${pct}`;

    // Yemek uyarısı
    $('emp-meal-warning').style.display = u.hasTakenMealBreak ? 'none' : '';

    // Vardiya & Aktif molalar
    renderShiftList('emp-shift-list', db);
    renderActiveBreaks('active-breaks-list', db);

    // Taleplerim
    const myReqs = (db.requests || [])
        .filter(r => r.username === currentUser.username)
        .sort((a, b) => b.createdAt - a.createdAt);

    const list = $('emp-requests-list');
    list.innerHTML = '';

    if (myReqs.length === 0) {
        list.innerHTML = '<div class="empty-state">Henüz talebiniz yok.</div>';
        return;
    }

    myReqs.forEach(req => {
        const typeStr = req.type === 'short' ? 'Kısa Mola (15dk)' : 'Yemek Molası (30dk)';
        const statusMap = {
            pending:   ['Bekliyor', 'status-pending'],
            approved:  ['Onaylandı', 'status-approved'],
            rejected:  ['Reddedildi', 'status-rejected'],
            active:    ['Kullanımda', 'status-active'],
            completed: ['Tamamlandı', 'status-completed']
        };
        const [sText, sClass] = statusMap[req.status] || ['', ''];
        const resInfo = req.reservationTime ? ` · Rez: ${req.reservationTime}` : '';
        const canCancel = req.status === 'pending' || req.status === 'approved';

        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
            <div class="list-item-info">
                <strong>${typeStr}</strong>
                <span>${new Date(req.createdAt).toLocaleTimeString('tr-TR').slice(0,5)}${resInfo}</span>
            </div>
            <div class="action-buttons">
                <span class="status-badge ${sClass}">${sText}</span>
                ${req.status === 'approved' ? `<button class="btn btn-success btn-sm" data-action="start" data-id="${req.id}">Başlat</button>` : ''}
                ${canCancel ? `<button class="btn btn-danger btn-sm" data-action="cancel" data-id="${req.id}">İptal</button>` : ''}
            </div>
        `;
        list.appendChild(el);
    });

    // Event delegation
    list.onclick = e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'start') startBreak(btn.dataset.id);
        if (btn.dataset.action === 'cancel') cancelRequest(btn.dataset.id);
    };
}

function createRequest() {
    const type = document.querySelector('input[name="break-type"]:checked').value;
    const resTime = $('reservation-time').value;
    const db = getDB();
    const u = db.users[currentUser.username];

    if (!u) { showNotification("Kullanıcı bulunamadı!", "error"); return; }
    if (u.usedTime + DURATIONS[type] > MAX_DAILY) {
        showNotification("Günlük mola limitinizi (60dk) aşıyorsunuz!", "error");
        return;
    }

    db.requests.push({
        id: generateId(),
        username: currentUser.username,
        type, status: 'pending',
        reservationTime: resTime || null,
        createdAt: Date.now()
    });
    saveDB(db);
    $('request-form').reset();
    showNotification("Talebiniz yöneticiye iletildi.", "success");
}

function cancelRequest(id) {
    const db = getDB();
    const req = db.requests.find(r => r.id === id);
    if (req && (req.status === 'pending' || req.status === 'approved')) {
        req.status = 'rejected';
        saveDB(db);
        showNotification("Talep iptal edildi.", "info");
    }
}

function startBreak(id) {
    const db = getDB();
    const req = db.requests.find(r => r.id === id);
    if (!req || req.status !== 'approved') return;

    // Kapasite kontrolü
    const active = db.requests.filter(r => r.status === 'active');
    if (active.some(r => r.type === req.type)) {
        const n = req.type === 'short' ? 'Kısa mola' : 'Yemek molası';
        showNotification(`${n} kapasitesi dolu! Lütfen bekleyin.`, "error");
        return;
    }

    req.status = 'active';
    req.startedAt = Date.now();
    req.endsAt = Date.now() + DURATIONS[req.type] * 60 * 1000;

    const u = db.users[currentUser.username];
    if (u) {
        u.usedTime += DURATIONS[req.type];
        if (req.type === 'meal') u.hasTakenMealBreak = true;
    }

    saveDB(db);
    showNotification("Molanız başladı! İyi dinlenmeler.", "success");
}

// ===================
// YÖNETİCİ EKRANI
// ===================

function setupAdminView() {
    $('admin-welcome').textContent = currentUser.username;
    $('admin-avatar').textContent = currentUser.username.charAt(0).toUpperCase();

    if (!eventsBound.admin) {
        eventsBound.admin = true;
        $('admin-logout').addEventListener('click', logout);
        $('add-shift-form').addEventListener('submit', e => {
            e.preventDefault();
            addShift();
        });
    }
    renderAdmin();
}

function addShift() {
    const name = $('shift-username').value.trim();
    const time = $('shift-time').value.trim();
    if (!name || !time) return;

    const db = getDB();
    if (!db.users[name]) {
        db.users[name] = { usedTime: 0, shift: time, hasTakenMealBreak: false };
    } else {
        db.users[name].shift = time;
    }
    saveDB(db);
    $('add-shift-form').reset();
    showNotification(`${name} için vardiya kaydedildi.`, "success");
}

function renderAdmin() {
    if (!currentUser || currentUser.role !== 'admin') return;
    const db = getDB();

    // İstatistikler
    const activeReqs = (db.requests || []).filter(r => r.status === 'active');
    const pendingReqs = (db.requests || []).filter(r => r.status === 'pending');
    $('stat-short').textContent = activeReqs.filter(r => r.type === 'short').length;
    $('stat-meal').textContent = activeReqs.filter(r => r.type === 'meal').length;
    $('stat-pending').textContent = pendingReqs.length;
    $('stat-employees').textContent = Object.keys(db.users || {}).length;
    $('pending-badge').textContent = pendingReqs.length;

    // Bekleyen Talepler
    const pendingList = $('admin-pending-list');
    pendingList.innerHTML = '';
    if (pendingReqs.length === 0) {
        pendingList.innerHTML = '<div class="empty-state">Bekleyen talep yok.</div>';
    } else {
        pendingReqs.sort((a, b) => a.createdAt - b.createdAt).forEach(req => {
            const typeStr = req.type === 'short' ? 'Kısa Mola (15dk)' : 'Yemek Molası (30dk)';
            const resInfo = req.reservationTime ? `<br><span style="color:var(--warning);">Rez: ${req.reservationTime}</span>` : '';
            const el = document.createElement('div');
            el.className = 'list-item';
            el.innerHTML = `
                <div class="list-item-info">
                    <strong>${req.username}</strong>
                    <span>${typeStr}${resInfo}</span>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-success btn-sm" data-action="approve" data-id="${req.id}">Onayla</button>
                    <button class="btn btn-danger btn-sm" data-action="reject" data-id="${req.id}">Reddet</button>
                </div>
            `;
            pendingList.appendChild(el);
        });
    }
    pendingList.onclick = e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        updateRequestStatus(btn.dataset.id, btn.dataset.action === 'approve' ? 'approved' : 'rejected');
    };

    // Çalışan Durumları
    renderEmployeeStatuses(db);
    // Aktif Molalar
    renderActiveBreaks('admin-active-list', db);
    // Vardiyalar
    renderShiftList('admin-shift-list', db);
    // Raporlar
    renderReports(db);
}

function updateRequestStatus(id, status) {
    const db = getDB();
    const req = db.requests.find(r => r.id === id);
    if (req) {
        req.status = status;
        saveDB(db);
        showNotification(`Talep ${status === 'approved' ? 'onaylandı' : 'reddedildi'}.`, status === 'approved' ? 'success' : 'warning');
    }
}

function renderEmployeeStatuses(db) {
    const container = $('admin-employee-list');
    if (!container) return;
    container.innerHTML = '';

    const users = Object.keys(db.users || {});
    if (users.length === 0) {
        container.innerHTML = '<div class="empty-state">Kayıtlı çalışan yok.</div>';
        return;
    }

    users.forEach(name => {
        const u = db.users[name];
        const rem = MAX_DAILY - (u.usedTime || 0);
        const meal = u.hasTakenMealBreak
            ? '<span class="status-badge status-active">Yemek ✓</span>'
            : '<span class="status-badge status-rejected">Yemek Zorunlu</span>';
        const shift = u.shift ? `<span style="color:var(--text-dim); font-size:0.75rem;"> · ${u.shift}</span>` : '';

        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
            <div class="list-item-info">
                <strong>${name}${shift}</strong>
                <span>Kalan: ${rem} dk · Kullanılan: ${u.usedTime || 0} dk</span>
            </div>
            <div>${meal}</div>
        `;
        container.appendChild(el);
    });
}

function renderReports(db) {
    const container = $('admin-reports-list');
    if (!container) return;
    container.innerHTML = '';

    const completed = (db.requests || []).filter(r => r.status === 'completed').sort((a, b) => b.createdAt - a.createdAt);
    if (completed.length === 0) {
        container.innerHTML = '<div class="empty-state">Henüz tamamlanan mola yok.</div>';
        return;
    }

    completed.forEach(req => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
            <div class="list-item-info">
                <strong>${req.username}</strong>
                <span>${req.type === 'short' ? 'Kısa' : 'Yemek'} · ${new Date(req.createdAt).toLocaleDateString('tr-TR')}</span>
            </div>
            <span class="status-badge status-completed">Tamamlandı</span>
        `;
        container.appendChild(el);
    });
}

// ===================
// ORTAK FONKSİYONLAR
// ===================

function renderActiveBreaks(containerId, db) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = '';

    const active = (db.requests || []).filter(r => r.status === 'active');
    if (active.length === 0) {
        container.innerHTML = '<div class="empty-state">Şu an molada olan kimse yok.</div>';
        return;
    }

    active.forEach(req => {
        const totalMs = DURATIONS[req.type] * 60 * 1000;
        const left = Math.max(0, req.endsAt - Date.now());
        const pct = (left / totalMs) * 100;
        const circumference = 2 * Math.PI * 16;
        const dashLen = (pct / 100) * circumference;
        const typeLabel = req.type === 'short' ? 'Kısa Mola' : 'Yemek Molası';
        const circleClass = req.type;

        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
            <div class="list-item-info">
                <strong>${req.username}</strong>
                <span>${typeLabel}</span>
            </div>
            <div class="timer-wrap">
                <div class="timer-circle-container">
                    <svg viewBox="0 0 36 36" class="circular-chart">
                        <circle class="circle-bg" cx="18" cy="18" r="16"/>
                        <circle class="circle-progress ${circleClass}" id="circle-${req.id}"
                            cx="18" cy="18" r="16"
                            stroke-dasharray="${dashLen} ${circumference}"
                            stroke-dashoffset="0"/>
                    </svg>
                    <div class="timer-text-center" id="timer-${req.id}">${fmtTime(left)}</div>
                </div>
            </div>
        `;
        container.appendChild(el);
    });
}

function renderShiftList(containerId, db) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = '';

    const withShift = Object.keys(db.users || {}).filter(n => db.users[n].shift);
    if (withShift.length === 0) {
        container.innerHTML = '<div class="empty-state">Atanmış vardiya yok.</div>';
        return;
    }

    withShift.forEach(name => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
            <div class="list-item-info"><strong>${name}</strong></div>
            <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted);">${db.users[name].shift}</span>
        `;
        container.appendChild(el);
    });
}

// ===================
// ZAMANLAYICI
// ===================

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        if (!currentUser) return;

        const db = getDB();
        let changed = false;
        const now = Date.now();
        const circumference = 2 * Math.PI * 16;

        (db.requests || []).filter(r => r.status === 'active').forEach(req => {
            const totalMs = DURATIONS[req.type] * 60 * 1000;
            const left = req.endsAt - now;

            // UI güncelle
            const timerEl = $(`timer-${req.id}`);
            const circleEl = $(`circle-${req.id}`);
            if (timerEl) timerEl.textContent = fmtTime(left);
            if (circleEl) {
                const pct = Math.max(0, left / totalMs) * 100;
                circleEl.setAttribute('stroke-dasharray', `${(pct / 100) * circumference} ${circumference}`);
            }

            // Süre bitti
            if (left <= 0) {
                req.status = 'completed';
                changed = true;
                showNotification(`${req.username} kullanıcısının molası bitti!`, 'warning');
            }
        });

        // Rezervasyon kontrolü
        const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        (db.requests || []).filter(r => r.status === 'approved' && r.reservationTime).forEach(req => {
            if (req.reservationTime === nowTime && !req._notified) {
                req._notified = true;
                changed = true;
                if (currentUser.username === req.username) {
                    showNotification("Rezerve ettiğiniz molanın vakti geldi! Başlatın.", "warning");
                }
            }
        });

        if (changed) saveDB(db);
    }, 1000);
}

// ===================
// GİRİŞ FORMU
// ===================

$('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('username').value.trim();
    const role = $('role').value;
    if (!name) return;
    login(name, role);
});

// ===================
// FIREBASE SYNC & INIT
// ===================

let initialized = false;

onSnapshot(mainDocRef,
    snapshot => {
        if (snapshot.exists()) {
            localDB = snapshot.data();
            // Firestore arrays sometimes need normalization
            if (!Array.isArray(localDB.requests)) localDB.requests = [];
            if (!localDB.users || typeof localDB.users !== 'object') localDB.users = {};
        } else {
            // İlk kez: boş DB oluştur
            setDoc(mainDocRef, localDB).catch(console.error);
        }

        if (!initialized) {
            initialized = true;
            hideLoading();
            const saved = sessionStorage.getItem('currentUser');
            if (saved) {
                const u = JSON.parse(saved);
                login(u.username, u.role);
            } else {
                switchView('login');
            }
        } else {
            // Firebase'den gelen gerçek zamanlı güncelleme → UI'ı yenile
            if (currentUser) {
                if (currentUser.role === 'employee') renderEmployee();
                if (currentUser.role === 'admin') renderAdmin();
            }
        }
    },
    error => {
        console.error("Firebase bağlantı hatası:", error);
        hideLoading();
        showNotification("Firebase bağlantı hatası! Kuralları kontrol edin.", "error");
        // Offline fallback
        switchView('login');
    }
);
