// ==========================================
// 🗄️ db.js - DONNÉES, AUTH & SYNC CLOUD
// ==========================================

// ⚠️ CONFIGURATION FIREBASE — Remplace par tes vraies clés
// Console Firebase → Ton projet → Paramètres ⚙️ → Config web
const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyBg8ZBFBx93s7T4It6-qchq-Crc0IDfNhw",
    authDomain:        "disciplineboard-fbbef.firebaseapp.com",
    databaseURL:       "https://disciplineboard-fbbef-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "disciplineboard-fbbef",
    storageBucket:     "disciplineboard-fbbef.firebasestorage.app",
    messagingSenderId: "894567010816",
    appId:             "1:894567010816:web:c4f1759260b30c168cfee5"
};


// ─── VARIABLES GLOBALES ───────────────────────────────────────────────────────
let firebaseAuth      = null;
let firebaseDb        = null;
let currentUser       = null;
let syncDebounceTimer = null;
let isLoadingCloud    = false;

// ─── FIREBASE INIT ────────────────────────────────────────────────────────────
function initFirebase() {
    // Sécurité : render() peut ne pas encore exister au moment où db.js est parsé
    // On appelle initFirebase() depuis app.js uniquement, après que render soit défini.
    try {
        if (typeof firebase === 'undefined') {
            console.error("Firebase SDK non chargé. Vérifie les scripts dans index.html.");
            // Afficher quand même l'écran de login en mode dégradé
            state.authScreen = 'login';
            safeRender();
            return;
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
        firebaseAuth = firebase.auth();
        firebaseDb   = firebase.database();

        // Cet écouteur se déclenche dès que Firebase connaît l'état de connexion
        firebaseAuth.onAuthStateChanged(async (user) => {
            currentUser = user;
            if (user) {
                // Utilisateur déjà connecté → charger ses données
                await loadFromCloud();
                state.authScreen  = null;
                state.authLoading = false;
                state.authError   = null;
                saveStateLocal();
                safeRender();
            } else {
                // Pas connecté → afficher le login
                state.authScreen  = 'login';
                state.authLoading = false;
                saveStateLocal();
                safeRender();
            }
        });

    } catch(e) {
        console.error("Firebase initFirebase() error:", e);
        // Fallback : afficher le login même si Firebase plante
        state.authScreen = 'login';
        safeRender();
    }
}

// Appel sécurisé à render() (peut ne pas exister encore si appelé trop tôt)
function safeRender() {
    if (typeof render === 'function') render();
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────
async function authRegister(email, password, username) {
    if (!username || !username.trim()) {
        state.authError = "Choisis un pseudo.";
        safeRender(); return;
    }
    try {
        state.authLoading = true; state.authError = null; state.authInfo = null;
        safeRender();
        const cred = await firebaseAuth.createUserWithEmailAndPassword(email.trim(), password);
        await cred.user.updateProfile({ displayName: username.trim() });
        currentUser = cred.user;
        state.username = username.trim();
        await pushAllToCloud();
        state.authScreen = null; state.authLoading = false;
        saveStateLocal(); safeRender();
    } catch(e) {
        state.authLoading = false;
        state.authError = firebaseErrorMsg(e.code);
        safeRender();
    }
}

async function authLogin(email, password) {
    try {
        state.authLoading = true; state.authError = null; state.authInfo = null;
        safeRender();
        await firebaseAuth.signInWithEmailAndPassword(email.trim(), password);
        // onAuthStateChanged gère la suite automatiquement
    } catch(e) {
        state.authLoading = false;
        state.authError = firebaseErrorMsg(e.code);
        safeRender();
    }
}

async function authLogout() {
    if (!confirm("Se déconnecter ? Tes données sont sauvegardées dans le cloud.")) return;
    // Arrêter l'écoute temps réel
    if (firebaseDb && currentUser) {
        firebaseDb.ref(`users/${currentUser.uid}/data`).off();
    }
    await firebaseAuth.signOut();
    clearLocalStorage();
    // Réinitialiser le state sans écraser les getters
    const fresh = buildDefaultState();
    Object.keys(fresh).forEach(k => {
        if (k !== 'goals' && k !== 'sportLabels') state[k] = fresh[k];
    });
    state.authScreen = 'login';
    safeRender();
}

async function authResetPassword(email) {
    try {
        state.authLoading = true; state.authError = null; state.authInfo = null;
        safeRender();
        await firebaseAuth.sendPasswordResetEmail(email.trim());
        state.authLoading = false;
        state.authInfo = '📧 Email de réinitialisation envoyé !';
        safeRender();
    } catch(e) {
        state.authLoading = false;
        state.authError = firebaseErrorMsg(e.code);
        safeRender();
    }
}

function firebaseErrorMsg(code) {
    const msgs = {
        'auth/email-already-in-use':   'Cet email est déjà utilisé.',
        'auth/invalid-email':          'Adresse email invalide.',
        'auth/weak-password':          'Mot de passe trop court (6 caractères minimum).',
        'auth/user-not-found':         'Aucun compte avec cet email.',
        'auth/wrong-password':         'Mot de passe incorrect.',
        'auth/invalid-credential':     'Email ou mot de passe incorrect.',
        'auth/too-many-requests':      'Trop de tentatives. Réessaie dans quelques minutes.',
        'auth/network-request-failed': 'Erreur réseau. Vérifie ta connexion.',
        'auth/user-disabled':          'Ce compte a été désactivé.',
        'auth/api-key-not-valid':      '⚠️ Clé API Firebase invalide. Vérifie FIREBASE_CONFIG dans db.js.',
    };
    return msgs[code] || `Erreur Firebase : ${code}`;
}

// ─── SYNC CLOUD ────────────────────────────────────────────────────────────────
function userDataRef() {
    if (!currentUser || !firebaseDb) return null;
    return firebaseDb.ref(`users/${currentUser.uid}/data`);
}

async function loadFromCloud() {
    const ref = userDataRef();
    if (!ref) return;
    isLoadingCloud = true;
    state.syncStatus = 'syncing';
    try {
        const snap = await ref.once('value');
        const data = snap.val();
        if (data) {
            let exercises = DEFAULT_EXERCISES.map(e => ({ ...e }));
            if (data.exercises && Array.isArray(data.exercises)) exercises = data.exercises;
            state.username       = data.username       || currentUser.displayName || '';
            state.profilePic     = data.profilePic     || '';
            state.history        = data.history        || {};
            state.nutritionData  = data.nutritionData  || {};
            state.exercises      = exercises;
            state.habits         = data.habits         || DEFAULT_HABITS;
            state.dailyTasks     = data.dailyTasks     || [];
            state.lastHabitReset = data.lastHabitReset || formatDate(new Date());
            state.menus          = data.menus          || {};
            state.groceryList    = data.groceryList    || [];
            state.visionImages   = data.visionImages   || DEFAULT_VISION_BOARD;
            state.journal        = data.journal        || {};
            state.xp             = data.xp             ?? 0;
            state.coins          = data.coins          ?? 0;
            state.activeQuest    = data.activeQuest    || null;
            state._lastUpdate    = data._lastUpdate    || 0;
        } else {
            // Nouveau compte : initialiser avec les valeurs par défaut
            state.username = currentUser.displayName || '';
            await pushAllToCloud();
        }
        saveStateLocal();
        startRealtimeSync();
        state.syncStatus = 'ok';
    } catch(e) {
        console.error("loadFromCloud error:", e);
        state.syncStatus = 'error';
    }
    isLoadingCloud = false;
}

function startRealtimeSync() {
    const ref = userDataRef();
    if (!ref) return;
    ref.off('value'); // Éviter les doublons d'écouteurs
    ref.on('value', (snap) => {
        if (isLoadingCloud) return;
        const data = snap.val();
        if (!data) return;
        const cloudTs = data._lastUpdate || 0;
        const localTs  = state._lastUpdate || 0;
        // Ne mettre à jour que si le cloud est plus récent (tolérance 500ms)
        if (cloudTs > localTs + 500) {
            isLoadingCloud = true;
            let exercises = state.exercises;
            if (data.exercises && Array.isArray(data.exercises)) exercises = data.exercises;
            state.username       = data.username       ?? state.username;
            state.profilePic     = data.profilePic     ?? state.profilePic;
            state.history        = data.history        || state.history;
            state.nutritionData  = data.nutritionData  || state.nutritionData;
            state.exercises      = exercises;
            state.habits         = data.habits         || state.habits;
            state.dailyTasks     = data.dailyTasks     || state.dailyTasks;
            state.lastHabitReset = data.lastHabitReset || state.lastHabitReset;
            state.menus          = data.menus          || state.menus;
            state.groceryList    = data.groceryList    || state.groceryList;
            state.visionImages   = data.visionImages   || state.visionImages;
            state.journal        = data.journal        || state.journal;
            state.xp             = data.xp             ?? state.xp;
            state.coins          = data.coins          ?? state.coins;
            state.activeQuest    = data.activeQuest    || state.activeQuest;
            state._lastUpdate    = cloudTs;
            saveStateLocal();
            isLoadingCloud = false;
            safeRender();
        }
    });
}

// Debounce 1.5s pour grouper les écritures
function schedulePushToCloud() {
    if (!currentUser || !firebaseDb) return;
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    state.syncStatus = 'syncing';
    syncDebounceTimer = setTimeout(async () => {
        await pushAllToCloud();
        state.syncStatus = 'ok';
        safeRender();
    }, 1500);
}

async function pushAllToCloud() {
    const ref = userDataRef();
    if (!ref) return;
    try {
        await ref.set(buildCloudPayload());
    } catch(e) {
        console.error("pushAllToCloud error:", e);
        state.syncStatus = 'error';
    }
}

function buildCloudPayload() {
    const now = Date.now();
    state._lastUpdate = now;
    return {
        username:       state.username       || '',
        profilePic:     state.profilePic     || '',
        history:        state.history        || {},
        nutritionData:  state.nutritionData  || {},
        exercises:      state.exercises      || DEFAULT_EXERCISES,
        habits:         state.habits         || DEFAULT_HABITS,
        dailyTasks:     state.dailyTasks     || [],
        lastHabitReset: state.lastHabitReset || formatDate(new Date()),
        menus:          state.menus          || {},
        groceryList:    state.groceryList    || [],
        visionImages:   state.visionImages   || DEFAULT_VISION_BOARD,
        journal:        state.journal        || {},
        xp:             state.xp             || 0,
        coins:          state.coins          || 0,
        activeQuest:    state.activeQuest    || null,
        _lastUpdate:    now,
    };
}

// ─── ARÈNE (classement public) ────────────────────────────────────────────────
async function pushToCloud(myStats) {
    if (!firebaseDb) return;
    try { await firebaseDb.ref(`arena/${myStats.name}`).set(myStats); }
    catch(e) { console.error("Erreur Sync Arène", e); }
}

async function fetchCloudLeaderboard() {
    if (!firebaseDb) {
        return [
            { name: "DemoBot", xp: 14500, streak: 42, perfectDays: 20, pushups: 8500, situps: 4000, squats: 2500, profilePic: '', isMe: false },
            { name: state.username || "Toi", xp: state.xp, streak: calculateStreak(), perfectDays: getTotalStats().perfectDays, profilePic: state.profilePic, isMe: true }
        ];
    }
    try {
        const snap = await firebaseDb.ref('arena').once('value');
        const data = snap.val(); if (!data) return [];
        return Object.values(data).sort((a,b) => b.xp - a.xp).map(p => {
            if (p.name === state.username) p.isMe = true;
            return p;
        });
    } catch(e) { console.error("Erreur Fetch Arène", e); return []; }
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const DEFAULT_EXERCISES = [
    { key: 'pushups', label: 'Pompes', goal: 100 },
    { key: 'situps',  label: 'Abdos',  goal: 100 },
    { key: 'squats',  label: 'Squats', goal: 50  }
];
const DEFAULT_HABITS       = [{ id: 1, name: "Lecture (10 pages)", done: false }, { id: 2, name: "Méditation (10 min)", done: false }, { id: 3, name: "Code / Apprentissage", done: false }];
const DEFAULT_VISION_BOARD = ["https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=600&auto=format&fit=crop"];
const MOTIVATIONS          = ["La douleur d'aujourd'hui est la force de demain.", "Discipline = Liberté.", "1% meilleur chaque jour."];

const QUESTS = [
    { id: 'q_mur',       type: 'sport_total',  target: 1000, title: 'Le Mur de Fer',   desc: 'Cumuler 1 000 reps cette semaine',              xp: 250, icon: 'shield'  },
    { id: 'q_moine',     type: 'clean_streak', target: 3,    title: 'Le Moine de Fer', desc: 'Atteindre un streak de 3 jours Clean',          xp: 200, icon: 'leaf'    },
    { id: 'q_esprit',    type: 'habits_all',   target: 1,    title: "L'Esprit Clair",  desc: "Valider toutes tes habitudes aujourd'hui",      xp: 100, icon: 'brain'   },
    { id: 'q_spartiate', type: 'sport_double', target: 1,    title: 'Mode Spartiate',  desc: "Faire le double de l'objectif sur un exercice", xp: 150, icon: 'swords'  }
];

const ACHIEVEMENTS = [
    { id: 'p1', cat: 'pushups',     target: 1000,  title: 'Machine Exer. 1',  desc: '1 000 reps',  icon: 'zap'            },
    { id: 'p2', cat: 'pushups',     target: 5000,  title: 'Titan Exer. 1',    desc: '5 000 reps',  icon: 'mountain'       },
    { id: 'p3', cat: 'pushups',     target: 10000, title: 'Dieu Exer. 1',     desc: '10 000 reps', icon: 'crown'          },
    { id: 'a1', cat: 'situps',      target: 1000,  title: 'Blindage Exer. 2', desc: '1 000 reps',  icon: 'shield'         },
    { id: 'a2', cat: 'situps',      target: 5000,  title: 'Acier Exer. 2',    desc: '5 000 reps',  icon: 'shield-check'   },
    { id: 'a3', cat: 'situps',      target: 10000, title: 'Muraille Exer. 2', desc: '10 000 reps', icon: 'award'          },
    { id: 's1', cat: 'squats',      target: 1000,  title: 'Pilier Exer. 3',   desc: '1 000 reps',  icon: 'hammer'         },
    { id: 's2', cat: 'squats',      target: 5000,  title: 'Roc Exer. 3',      desc: '5 000 reps',  icon: 'flame'          },
    { id: 's3', cat: 'squats',      target: 10000, title: 'Montagne Exer. 3', desc: '10 000 reps', icon: 'star'           },
    { id: 'd1', cat: 'perfectDays', target: 7,     title: 'Semaine Parfaite', desc: '7 jours',     icon: 'calendar-check' },
    { id: 'd2', cat: 'perfectDays', target: 30,    title: 'Mois de Fer',      desc: '30 jours',    icon: 'swords'         },
    { id: 'd3', cat: 'perfectDays', target: 100,   title: 'Centurion',        desc: '100 jours',   icon: 'trophy'         }
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const formatDate = (date) => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
};

function safeLoad(key, defaultVal) {
    try {
        const v = localStorage.getItem(key);
        if (v === null) return defaultVal;
        const p = JSON.parse(v);
        return (p !== null && p !== undefined) ? p : defaultVal;
    } catch(e) { return defaultVal; }
}

function migrateExercises() {
    const stored = localStorage.getItem('udb_exercises');
    if (stored) { try { return JSON.parse(stored); } catch(e) {} }
    const ol = safeLoad('udb_sport_labels', null);
    const og = safeLoad('udb_goals', null);
    if (ol && og) return [
        { key: 'pushups', label: ol.pushups || 'Pompes', goal: og.pushups || 100 },
        { key: 'situps',  label: ol.situps  || 'Abdos',  goal: og.situps  || 100 },
        { key: 'squats',  label: ol.squats  || 'Squats', goal: og.squats  || 50  }
    ];
    return DEFAULT_EXERCISES.map(e => ({ ...e }));
}

function buildDefaultState() {
    return {
        activeTab:      'dashboard',
        currentDate:    formatDate(new Date()),
        username:       safeLoad('udb_username', ''),
        profilePic:     safeLoad('udb_profilePic', ''),
        history:        safeLoad('udb_history', {}),
        nutritionData:  safeLoad('udb_nutrition', {}),
        exercises:      migrateExercises(),
        habits:         safeLoad('udb_habits', DEFAULT_HABITS),
        dailyTasks:     safeLoad('udb_tasks', []),
        lastHabitReset: localStorage.getItem('udb_habit_date') || formatDate(new Date()),
        menus:          safeLoad('udb_menus', {}),
        groceryList:    safeLoad('udb_grocery', []),
        menuViewDate:   formatDate(new Date()),
        visionImages:   safeLoad('udb_vision', DEFAULT_VISION_BOARD),
        journal:        safeLoad('udb_journal', {}),
        xp:             safeLoad('udb_xp', 0),
        coins:          safeLoad('udb_coins', 0),
        activeQuest:    safeLoad('udb_quest', null),
        quote:          MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)],
        showModal:      null,
        // Auth & sync
        authScreen:     'loading',  // commence en 'loading', Firebase le change
        authLoading:    false,
        authError:      null,
        authInfo:       null,
        syncStatus:     'idle',
        _lastUpdate:    0,
    };
}

// Getters dynamiques (ne pas mettre dans buildDefaultState pour éviter les conflits de spread)
function getGoals()       { return Object.fromEntries(state.exercises.map(e => [e.key, e.goal])); }
function getSportLabels() { return Object.fromEntries(state.exercises.map(e => [e.key, e.label])); }

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = buildDefaultState();

// Compatibilité : state.goals et state.sportLabels sont des getters via fonctions
Object.defineProperty(state, 'goals',       { get: getGoals,       configurable: true, enumerable: false });
Object.defineProperty(state, 'sportLabels', { get: getSportLabels, configurable: true, enumerable: false });

let arenaLeaderboard = [];
let isFetchingArena  = false;

// ─── SAVE LOCAL ───────────────────────────────────────────────────────────────
function saveStateLocal() {
    try {
        localStorage.setItem('udb_username',     JSON.stringify(state.username));
        localStorage.setItem('udb_profilePic',   JSON.stringify(state.profilePic));
        localStorage.setItem('udb_history',      JSON.stringify(state.history));
        localStorage.setItem('udb_nutrition',    JSON.stringify(state.nutritionData));
        localStorage.setItem('udb_exercises',    JSON.stringify(state.exercises));
        localStorage.setItem('udb_goals',        JSON.stringify(getGoals()));
        localStorage.setItem('udb_sport_labels', JSON.stringify(getSportLabels()));
        localStorage.setItem('udb_habits',       JSON.stringify(state.habits));
        localStorage.setItem('udb_tasks',        JSON.stringify(state.dailyTasks));
        localStorage.setItem('udb_habit_date',   state.lastHabitReset);
        localStorage.setItem('udb_menus',        JSON.stringify(state.menus));
        localStorage.setItem('udb_grocery',      JSON.stringify(state.groceryList));
        localStorage.setItem('udb_vision',       JSON.stringify(state.visionImages));
        localStorage.setItem('udb_journal',      JSON.stringify(state.journal));
        localStorage.setItem('udb_xp',           JSON.stringify(state.xp));
        localStorage.setItem('udb_coins',        JSON.stringify(state.coins));
        localStorage.setItem('udb_quest',        JSON.stringify(state.activeQuest));
    } catch(e) { console.warn("saveStateLocal error:", e); }
}

function clearLocalStorage() {
    ['udb_username','udb_profilePic','udb_history','udb_nutrition','udb_exercises',
     'udb_goals','udb_sport_labels','udb_habits','udb_tasks','udb_habit_date',
     'udb_menus','udb_grocery','udb_vision','udb_journal','udb_xp','udb_coins','udb_quest']
    .forEach(k => localStorage.removeItem(k));
}

// ─── UPDATE STATE ─────────────────────────────────────────────────────────────
const CLOUD_DATA_KEYS = ['username','profilePic','history','nutritionData','exercises',
    'habits','dailyTasks','lastHabitReset','menus','groceryList','visionImages','journal','xp','coins','activeQuest'];

function updateState(patch) {
    // Appliquer le patch sans écraser les getters définis via defineProperty
    Object.keys(patch).forEach(k => {
        if (k !== 'goals' && k !== 'sportLabels') {
            state[k] = patch[k];
        }
    });
    saveStateLocal();
    // Sync cloud si une donnée métier a changé
    const hasDataChange = CLOUD_DATA_KEYS.some(k => k in patch);
    if (hasDataChange && currentUser && !isLoadingCloud) {
        schedulePushToCloud();
    }
    safeRender();
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────────────────────
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(buildCloudPayload()));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `udb_backup_${state.currentDate}.json`);
    document.body.appendChild(a); a.click(); a.remove();
}

function triggerImport() { document.getElementById('importFile').click(); }

function importData(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const d = JSON.parse(e.target.result);
            if (d && typeof d === 'object') {
                if (confirm("Attention : l'importation va écraser vos données actuelles. Continuer ?")) {
                    let exercises = DEFAULT_EXERCISES.map(ex => ({ ...ex }));
                    if (d.exercises && Array.isArray(d.exercises)) exercises = d.exercises;
                    else if (d.goals && d.sportLabels) exercises = Object.keys(d.goals).map(key => ({ key, label: d.sportLabels[key] || key, goal: d.goals[key] || 100 }));
                    updateState({
                        username: d.username || '', profilePic: d.profilePic || '',
                        history: d.history || {}, nutritionData: d.nutritionData || {},
                        exercises, habits: d.habits || DEFAULT_HABITS,
                        dailyTasks: d.dailyTasks || [], lastHabitReset: d.lastHabitReset || state.currentDate,
                        menus: d.menus || {}, groceryList: d.groceryList || [],
                        visionImages: d.visionImages || DEFAULT_VISION_BOARD,
                        journal: d.journal || {}, xp: d.xp || 0, coins: d.coins || 0, activeQuest: d.activeQuest || null
                    });
                    alert("Restauration réussie !");
                }
            }
        } catch(err) { alert("Le fichier est invalide."); }
    };
    reader.readAsText(file); event.target.value = '';
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function calculateStreak() {
    let s = 0; const d = new Date();
    while (true) {
        const stat = (state.nutritionData[formatDate(d)] || {}).status;
        if (stat === 'clean') s++;
        else if (formatDate(d) !== state.currentDate) break;
        d.setDate(d.getDate() - 1);
    }
    return s;
}

function getTotalStats() {
    let totals = { perfectDays: 0, cleanDays: 0 };
    state.exercises.forEach(ex => { totals[ex.key] = 0; });
    Object.values(state.history).forEach(day => {
        state.exercises.forEach(ex => { totals[ex.key] += (day[ex.key] || 0); });
        if (state.exercises.every(ex => (day[ex.key] || 0) >= ex.goal)) totals.perfectDays++;
    });
    Object.values(state.nutritionData).forEach(day => { if (day.status === 'clean') totals.cleanDays++; });
    return totals;
}

// ─── SHOP EXTENSIONS ───────────────────────────────────────────────────────────
const DEFAULT_SHOP_INVENTORY = { themes: [], effects: [], titles: [] };

function normalizeShopInventory(inv) {
    const src = (inv && typeof inv === 'object') ? inv : {};
    return {
        themes: Array.isArray(src.themes) ? src.themes : [],
        effects: Array.isArray(src.effects) ? src.effects : [],
        titles: Array.isArray(src.titles) ? src.titles : [],
    };
}

try {
    if (Array.isArray(CLOUD_DATA_KEYS) && !CLOUD_DATA_KEYS.includes('shopInventory')) {
        CLOUD_DATA_KEYS.push('shopInventory');
    }
} catch(e) {}

if (!state.shopInventory) state.shopInventory = normalizeShopInventory(DEFAULT_SHOP_INVENTORY);

const _origBuildDefaultState = buildDefaultState;
buildDefaultState = function() {
    const s = _origBuildDefaultState();
    s.shopInventory = normalizeShopInventory(safeLoad('udb_shop_inventory', DEFAULT_SHOP_INVENTORY));
    return s;
};

const _origSaveStateLocal = saveStateLocal;
saveStateLocal = function() {
    _origSaveStateLocal();
    try { localStorage.setItem('udb_shop_inventory', JSON.stringify(normalizeShopInventory(state.shopInventory))); } catch(e) {}
};

const _origClearLocalStorage = clearLocalStorage;
clearLocalStorage = function() {
    _origClearLocalStorage();
    localStorage.removeItem('udb_shop_inventory');
};

const _origBuildCloudPayload = buildCloudPayload;
buildCloudPayload = function() {
    const payload = _origBuildCloudPayload();
    payload.shopInventory = normalizeShopInventory(state.shopInventory);
    return payload;
};

const _origLoadFromCloud = loadFromCloud;
loadFromCloud = async function() {
    await _origLoadFromCloud();
    try {
        const ref = userDataRef();
        if (!ref) return;
        const snap = await ref.once('value');
        const data = snap.val() || {};
        state.shopInventory = normalizeShopInventory(data.shopInventory || state.shopInventory);
        saveStateLocal();
    } catch(e) {}
};

const _origStartRealtimeSync = startRealtimeSync;
startRealtimeSync = function() {
    _origStartRealtimeSync();
    const ref = userDataRef();
    if (!ref) return;
    ref.on('value', (snap) => {
        if (isLoadingCloud) return;
        const data = snap.val();
        if (!data) return;
        if (!('shopInventory' in data)) return;
        state.shopInventory = normalizeShopInventory(data.shopInventory);
        saveStateLocal();
        safeRender();
    });
};

// ─── SHOP EXTENSIONS: SOUNDS + SELECTIONS PERSISTENCE ─────────────────────────
const DEFAULT_SHOP_SELECTIONS = {
    activeSoundPack: null,
    activeImageThemeUrl: ''
};

function normalizeShopSelections(src) {
    const data = (src && typeof src === 'object') ? src : {};
    return {
        activeSoundPack: typeof data.activeSoundPack === 'string' ? data.activeSoundPack : null,
        activeImageThemeUrl: typeof data.activeImageThemeUrl === 'string' ? data.activeImageThemeUrl : ''
    };
}

const _origNormalizeShopInventory = normalizeShopInventory;
normalizeShopInventory = function(inv) {
    const normalized = _origNormalizeShopInventory(inv);
    const sounds = (inv && typeof inv === 'object' && Array.isArray(inv.sounds)) ? inv.sounds : [];
    return { ...normalized, sounds };
};

try {
    if (Array.isArray(CLOUD_DATA_KEYS) && !CLOUD_DATA_KEYS.includes('activeSoundPack')) {
        CLOUD_DATA_KEYS.push('activeSoundPack');
    }
    if (Array.isArray(CLOUD_DATA_KEYS) && !CLOUD_DATA_KEYS.includes('activeImageThemeUrl')) {
        CLOUD_DATA_KEYS.push('activeImageThemeUrl');
    }
} catch(e) {}

const _origBuildDefaultStateShopSelections = buildDefaultState;
buildDefaultState = function() {
    const s = _origBuildDefaultStateShopSelections();
    const localSelections = normalizeShopSelections({
        activeSoundPack: safeLoad('udb_active_sound_pack', null),
        activeImageThemeUrl: safeLoad('udb_active_image_theme_url', '')
    });
    s.activeSoundPack = localSelections.activeSoundPack;
    s.activeImageThemeUrl = localSelections.activeImageThemeUrl;
    return s;
};

const _origSaveStateLocalShopSelections = saveStateLocal;
saveStateLocal = function() {
    _origSaveStateLocalShopSelections();
    const selections = normalizeShopSelections(state);
    try {
        localStorage.setItem('udb_active_sound_pack', JSON.stringify(selections.activeSoundPack));
        localStorage.setItem('udb_active_image_theme_url', JSON.stringify(selections.activeImageThemeUrl));
    } catch(e) {}
};

const _origClearLocalStorageShopSelections = clearLocalStorage;
clearLocalStorage = function() {
    _origClearLocalStorageShopSelections();
    localStorage.removeItem('udb_active_sound_pack');
    localStorage.removeItem('udb_active_image_theme_url');
};

const _origBuildCloudPayloadShopSelections = buildCloudPayload;
buildCloudPayload = function() {
    const payload = _origBuildCloudPayloadShopSelections();
    const selections = normalizeShopSelections(state);
    payload.activeSoundPack = selections.activeSoundPack;
    payload.activeImageThemeUrl = selections.activeImageThemeUrl;
    return payload;
};

const _origLoadFromCloudShopSelections = loadFromCloud;
loadFromCloud = async function() {
    await _origLoadFromCloudShopSelections();
    try {
        const ref = userDataRef();
        if (!ref) return;
        const snap = await ref.once('value');
        const data = snap.val() || {};
        const selections = normalizeShopSelections({
            activeSoundPack: ('activeSoundPack' in data) ? data.activeSoundPack : state.activeSoundPack,
            activeImageThemeUrl: ('activeImageThemeUrl' in data) ? data.activeImageThemeUrl : state.activeImageThemeUrl
        });
        state.activeSoundPack = selections.activeSoundPack;
        state.activeImageThemeUrl = selections.activeImageThemeUrl;
        saveStateLocal();
        if (typeof applyPersistentImageTheme === 'function') applyPersistentImageTheme();
        safeRender();
    } catch(e) {}
};

const _origStartRealtimeSyncShopSelections = startRealtimeSync;
startRealtimeSync = function() {
    _origStartRealtimeSyncShopSelections();
    const ref = userDataRef();
    if (!ref) return;
    ref.on('value', (snap) => {
        if (isLoadingCloud) return;
        const data = snap.val();
        if (!data) return;
        if (!('activeSoundPack' in data) && !('activeImageThemeUrl' in data)) return;
        const selections = normalizeShopSelections({
            activeSoundPack: ('activeSoundPack' in data) ? data.activeSoundPack : state.activeSoundPack,
            activeImageThemeUrl: ('activeImageThemeUrl' in data) ? data.activeImageThemeUrl : state.activeImageThemeUrl
        });
        state.activeSoundPack = selections.activeSoundPack;
        state.activeImageThemeUrl = selections.activeImageThemeUrl;
        saveStateLocal();
        if (typeof applyPersistentImageTheme === 'function') applyPersistentImageTheme();
        safeRender();
    });
};
