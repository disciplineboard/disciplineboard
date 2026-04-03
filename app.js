// ==========================================
// ⚙️ app.js - LOGIQUE UI & RENDU COMPLET
// ==========================================

try { if (typeof MobileDragDrop !== 'undefined') { MobileDragDrop.polyfill(); window.addEventListener('touchmove', function() {}, {passive: false}); } } catch(e) {}

let dashboardChart = null;
let dragSource     = { type: null, index: null };
let audioCtx       = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
    // 1. Afficher immédiatement l'écran de chargement (render est maintenant défini)
    render();
    // 2. Lancer Firebase (onAuthStateChanged mettra à jour authScreen → re-render)
    initFirebase();
}

function afterLogin() {
    // Réinitialiser les habitudes si nouveau jour
    if (state.lastHabitReset !== state.currentDate) {
        state.habits = state.habits.map(h => ({ ...h, done: false }));
        state.dailyTasks = [];
        state.lastHabitReset = state.currentDate;
        saveStateLocal();
    }
    if (!state.activeQuest) generateNewQuest();
    
    // Application du thème image persistant s'il existe
    applyPersistentImageTheme();
    
    render();
}

// ─── AUDIO & XP ───────────────────────────────────────────────────────────────
function playSound(type) {
    try {
        if (!audioCtx) { const A = window.AudioContext || window.webkitAudioContext; if(A) audioCtx = new A(); }
        if (!audioCtx || audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        if (type === 'pop')      { osc.type='sine';     osc.frequency.setValueAtTime(800,audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200,audioCtx.currentTime+0.05); gain.gain.setValueAtTime(0.3,audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01,audioCtx.currentTime+0.1); osc.start(); osc.stop(audioCtx.currentTime+0.1); }
        else if (type==='levelUp') { osc.type='triangle'; osc.frequency.setValueAtTime(440,audioCtx.currentTime); osc.frequency.setValueAtTime(554.37,audioCtx.currentTime+0.1); osc.frequency.setValueAtTime(659.25,audioCtx.currentTime+0.2); gain.gain.setValueAtTime(0.2,audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.5); osc.start(); osc.stop(audioCtx.currentTime+0.5); }
        else if (type==='epic')    { osc.type='square';   osc.frequency.setValueAtTime(300,audioCtx.currentTime); osc.frequency.setValueAtTime(400,audioCtx.currentTime+0.2); osc.frequency.setValueAtTime(600,audioCtx.currentTime+0.4); gain.gain.setValueAtTime(0.2,audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.8); osc.start(); osc.stop(audioCtx.currentTime+0.8); }
    } catch(e) {}
}

function addXp(amount) {
    const currentLevel = Math.floor(state.xp/100)+1;
    const newXp = Math.max(0, state.xp+amount);
    const newLevel = Math.floor(newXp/100)+1;
    updateState({ xp: newXp });
    if (newLevel > currentLevel) { playSound('levelUp'); confetti({ particleCount:200, spread:100, origin:{y:0.5}, colors:['#00ff88','#ffd700','#ffffff'], zIndex:1000 }); }
}

function addCoins(amount) {
    const newCoins = Math.max(0, (state.coins || 0) + amount);
    updateState({ coins: newCoins });
}

// ─── QUÊTES ───────────────────────────────────────────────────────────────────
function generateNewQuest() {
    const available = QUESTS.filter(q => !state.activeQuest || q.id !== state.activeQuest.id);
    const randomQ = available[Math.floor(Math.random()*available.length)];
    updateState({ activeQuest: { id: randomQ.id, claimed: false } });
}

function getQuestProgress() {
    if (!state.activeQuest) return 0;
    const qd = QUESTS.find(q => q.id === state.activeQuest.id); if (!qd) return 0;
    let progress = 0;
    if (qd.type === 'sport_total')  { for(let i=0;i<7;i++){ const d=new Date(); d.setDate(d.getDate()-i); const data=state.history[formatDate(d)]||{}; state.exercises.forEach(ex=>{ progress+=(data[ex.key]||0); }); } }
    else if (qd.type === 'clean_streak') { progress = calculateStreak(); }
    else if (qd.type === 'habits_all')   { progress = (state.habits.length>0 && state.habits.every(h=>h.done)) ? 1 : 0; }
    else if (qd.type === 'sport_double') { const today=getDaySportData(state.currentDate); if(state.exercises.some(ex=>(today[ex.key]||0)>=ex.goal*2)) progress=1; }
    return Math.min(progress, qd.target);
}

function claimQuestReward() {
    const qd = QUESTS.find(q => q.id === state.activeQuest.id); if (!qd) return;
    playSound('epic'); addXp(qd.xp); addCoins(100);
    confetti({ particleCount:300, spread:150, origin:{y:0.4}, colors:['#ffd700','#00ff88','#ff3b3b'], zIndex:1000 });
    updateState({ activeQuest: { ...state.activeQuest, claimed: true } });
}

// ─── PROFIL ───────────────────────────────────────────────────────────────────
function handleProfilePicUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas'); const MAX=150; let w=img.width, h=img.height;
            if(w>h){if(w>MAX){h*=MAX/w;w=MAX;}}else{if(h>MAX){w*=MAX/h;h=MAX;}}
            canvas.width=w; canvas.height=h; canvas.getContext('2d').drawImage(img,0,0,w,h);
            updateState({ profilePic: canvas.toDataURL('image/jpeg',0.8) });
        }; img.src = e.target.result;
    }; reader.readAsDataURL(file);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getDaySportData(dateStr) { return state.history[dateStr] || {}; }
function getWeekDates(baseDateStr) {
    const [y,m,d]=baseDateStr.split('-').map(Number); const date=new Date(y,m-1,d); const day=date.getDay();
    const diff=date.getDate()-day+(day===0?-6:1); const monday=new Date(date); monday.setDate(diff); const week=[];
    for(let i=0;i<7;i++){const t=new Date(monday);t.setDate(monday.getDate()+i);week.push(formatDate(t));} return week;
}
function formatShortDay(dateStr) { const d=new Date(dateStr); const days=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']; return `${days[d.getDay()]} ${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`; }
function changeWeek(offset) { const [y,m,d]=state.menuViewDate.split('-').map(Number); const date=new Date(y,m-1,d); date.setDate(date.getDate()+(offset*7)); updateState({menuViewDate:formatDate(date)}); }

function calculateDailyScore(dateStr) {
    const sData = getDaySportData(dateStr);
    const sportProgress = state.exercises.length > 0 ? state.exercises.reduce((sum,ex) => sum+Math.min(1,(sData[ex.key]||0)/ex.goal), 0)/state.exercises.length : 0;
    const habitsDone = state.habits.filter(h=>h.done).length;
    const habitProgress = dateStr===state.currentDate ? (habitsDone/(state.habits.length||1)) : 0;
    const nData = state.nutritionData[dateStr]||{}; let nutriScore = nData.status==='clean'?1:(nData.status==='sugar'?0:0.5);
    return dateStr===state.currentDate ? Math.round(sportProgress*40+habitProgress*40+nutriScore*20) : Math.round(sportProgress*50+nutriScore*50);
}
function getMonthlyStats() {
    const prefix=state.currentDate.substring(0,7); let totals={};
    state.exercises.forEach(ex=>{totals[ex.key]=0;});
    Object.keys(state.history).forEach(date=>{ if(date.startsWith(prefix)) state.exercises.forEach(ex=>{totals[ex.key]+=(state.history[date][ex.key]||0);}); });
    return totals;
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────
function toggleHabit(id) { const h=state.habits.find(h=>h.id===id); const now=!h.done; if(now){playSound('pop');addXp(10);addCoins(5);}else{addXp(-10);addCoins(-5);} updateState({habits:state.habits.map(h=>h.id===id?{...h,done:now}:h)}); }
function addHabit(name) { if(name.trim()) updateState({habits:[...state.habits,{id:Date.now(),name:name.trim(),done:false}]}); }
function removeHabit(id) { updateState({habits:state.habits.filter(h=>h.id!==id)}); }
function addTask(text) { if(text.trim()) updateState({dailyTasks:[...state.dailyTasks,{id:Date.now(),text:text.trim(),done:false}]}); }
function toggleTask(id) { const t=state.dailyTasks.find(t=>t.id===id); const now=!t.done; if(now){playSound('pop');addXp(10);addCoins(20);}else{addXp(-10);addCoins(-20);} updateState({dailyTasks:state.dailyTasks.map(t=>t.id===id?{...t,done:now}:t)}); }
function removeTask(id) { updateState({dailyTasks:state.dailyTasks.filter(t=>t.id!==id)}); }
function addExo(type, amount) {
    const currentData=getDaySportData(state.currentDate); const ex=state.exercises.find(e=>e.key===type); const goal=ex?ex.goal:100;
    let newVal=Math.max(0,(currentData[type]||0)+amount);
    if(((currentData[type]||0)<goal)&&(newVal>=goal)&&amount>0){playSound('pop');addXp(20);addCoins(20);confetti({particleCount:100,spread:70,origin:{y:0.6},colors:['#00ff88','#ffffff'],zIndex:1000});}
    updateState({history:{...state.history,[state.currentDate]:{...currentData,[type]:newVal}}});
}
function confirmEditSport(type,value,dateStr=state.currentDate) {
    const numValue=Math.max(0,parseInt(value,10)||0); const currentData=getDaySportData(dateStr); const ex=state.exercises.find(e=>e.key===type); const goal=ex?ex.goal:100;
    if((currentData[type]||0)<goal&&numValue>=goal&&dateStr===state.currentDate){playSound('pop');addXp(20);addCoins(20);}
    updateState({history:{...state.history,[dateStr]:{...currentData,[type]:numValue}},showModal:null});
}
function confirmEditDaySport(dateStr,values) {
    const currentData=getDaySportData(dateStr); const newData={...currentData};
    state.exercises.forEach(ex=>{newData[ex.key]=Math.max(0,parseInt(values[ex.key],10)||0);});
    updateState({history:{...state.history,[dateStr]:newData},showModal:null});
}
function saveSportComment(dateStr,text) { updateState({history:{...state.history,[dateStr]:{...getDaySportData(dateStr),comment:text}}}); }
function setNutrition(status) {
    const oldStatus=(state.nutritionData[state.currentDate]||{}).status;
    if(status==='clean'&&oldStatus!=='clean'){playSound('pop');addXp(30);addCoins(15);}else if(oldStatus==='clean'&&status!=='clean'){addXp(-30);addCoins(-15);}
    updateState({nutritionData:{...state.nutritionData,[state.currentDate]:{...(state.nutritionData[state.currentDate]||{}),status}}});
}
function updateMealWeekly(dateStr,mealType,value) { updateState({menus:{...state.menus,[dateStr]:{...(state.menus[dateStr]||{breakfast:'',snack:'',lunch:'',dinner:''}),[mealType]:value}}}); }
function addGroceryItem(name) { if(name.trim()) updateState({groceryList:[...state.groceryList,{id:Date.now(),name:name.trim(),done:false}]}); }
function toggleGroceryItem(id) { updateState({groceryList:state.groceryList.map(i=>i.id===id?{...i,done:!i.done}:i)}); }
function removeGroceryItem(id) { updateState({groceryList:state.groceryList.filter(i=>i.id!==id)}); }
function addVisionImage(url) { const u=url.trim(); if(!u)return; const img=new Image(); img.onload=()=>updateState({visionImages:[u,...state.visionImages]}); img.src=u; }
function removeVisionImage(index) { const n=[...state.visionImages]; n.splice(index,1); updateState({visionImages:n}); }
function resetVisionBoard() { if(confirm("Supprimer toutes les images ?")) updateState({visionImages:[]}); }
function setJournalMood(mood) { updateState({journal:{...state.journal,[state.currentDate]:{...(state.journal[state.currentDate]||{mood:'',text:''}),mood}}}); }
function saveJournalText(text) { updateState({journal:{...state.journal,[state.currentDate]:{...(state.journal[state.currentDate]||{mood:'',text:''}),text}}}); }

// ─── EXERCICES DYNAMIQUES ─────────────────────────────────────────────────────
function addExercise(label, goal) {
    label=label.trim(); if(!label) return;
    goal=Math.max(1,parseInt(goal)||50);
    const key=label.toLowerCase().replace(/[^a-z0-9]/g,'_')+'_'+Date.now();
    updateState({exercises:[...state.exercises,{key,label,goal}]});
}
function removeExercise(key) {
    if(state.exercises.length<=1){alert("Garde au moins 1 exercice.");return;}
    if(!confirm("Supprimer cet exercice ?")) return;
    updateState({exercises:state.exercises.filter(e=>e.key!==key)});
}
function saveExerciseConfig(formEl) {
    const newExercises=state.exercises.map(ex=>({
        ...ex,
        label:(formEl.querySelector(`[data-label="${ex.key}"]`)||{}).value?.trim()||ex.label,
        goal:Math.max(1,parseInt((formEl.querySelector(`[data-goal="${ex.key}"]`)||{}).value)||ex.goal)
    }));
    updateState({exercises:newExercises,showModal:null});
}

// ─── DRAG & DROP ──────────────────────────────────────────────────────────────
function handleDragStart(e,type,index) { dragSource={type,index}; e.dataTransfer.effectAllowed='move'; e.target.classList.add('dragging'); }
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect='move'; return false; }
function handleDragEnter(e) { if(e.target.closest('[data-droppable]')) e.target.closest('[data-droppable]').classList.add('drag-over'); }
function handleDragLeave(e) { if(e.target.closest('[data-droppable]')) e.target.closest('[data-droppable]').classList.remove('drag-over'); }
function handleDrop(e,type,targetIndex) { e.stopPropagation(); e.preventDefault(); if(e.target.closest('[data-droppable]')) e.target.closest('[data-droppable]').classList.remove('drag-over'); if(dragSource.type===type&&dragSource.index!==null&&dragSource.index!==targetIndex){const list=[...state[type]];const moved=list.splice(dragSource.index,1)[0];list.splice(targetIndex,0,moved);updateState({[type]:list});} dragSource={type:null,index:null}; return false; }
function handleDragEnd(e) { e.target.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over')); }

// ─── ARÈNE ────────────────────────────────────────────────────────────────────
async function syncAndJoinArena() {
    if(!state.username||state.username.trim()===''){alert("Choisis un pseudo d'abord !"); return;}
    const stats=getTotalStats();
    const exTotals={};state.exercises.forEach(ex=>{exTotals[ex.key]=stats[ex.key]||0;});
    const myArenaData={name:state.username,xp:state.xp,streak:calculateStreak(),perfectDays:stats.perfectDays,...exTotals,profilePic:state.profilePic,lastUpdate:state.currentDate};
    isFetchingArena=true; render();
    await pushToCloud(myArenaData);
    arenaLeaderboard=await fetchCloudLeaderboard();
    isFetchingArena=false; render();
}

async function switchTab(tabId) {
    state.activeTab=tabId;
    if(tabId==='arena'){isFetchingArena=true;render();arenaLeaderboard=await fetchCloudLeaderboard();isFetchingArena=false;}
    render();
}

// ─── CHART ────────────────────────────────────────────────────────────────────
function initChart() {
    if(state.activeTab!=='dashboard') return;
    const ctx=document.getElementById('progressChart'); if(!ctx) return;
    if(dashboardChart) dashboardChart.destroy();
    const labels=[]; const data=[];
    for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const dStr=formatDate(d);labels.push(`${d.getDate()}/${d.getMonth()+1}`);data.push(calculateDailyScore(dStr));}
    dashboardChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Score',data,borderColor:'#00ff88',backgroundColor:'rgba(0,255,136,0.1)',borderWidth:2,pointBackgroundColor:'#00ff88',pointBorderColor:'#1a1d24',pointRadius:5,fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,max:100,grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#a0a5b1'}},x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#a0a5b1'}}},plugins:{legend:{display:false}}}});
}

// ==========================================
// 🎨 ÉCRAN AUTH
// ==========================================
function renderAuthScreen() {
    const screen = state.authScreen;

    if (screen === 'loading') {
        return `
        <div class="min-h-screen flex items-center justify-center">
            <div class="text-center">
                <div class="w-16 h-16 rounded-full border-4 border-neon border-t-transparent animate-spin mx-auto mb-6"></div>
                <p class="text-dim text-sm uppercase tracking-widest">Chargement...</p>
            </div>
        </div>`;
    }

    const errorHtml  = state.authError  ? `<div class="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">${state.authError}</div>` : '';
    const infoHtml   = state.authInfo   ? `<div class="bg-green-500/10 border border-green-500/30 text-green-400 text-sm rounded-xl px-4 py-3 mb-4">${state.authInfo}</div>` : '';
    const spinner    = state.authLoading ? `<div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle"></div>` : '';

    let title = '', formHtml = '';

    if (screen === 'login') {
        title = 'Connexion';
        formHtml = `
            <div class="space-y-3 mb-5">
                <input id="authEmail" type="email" placeholder="Email" autocomplete="email"
                    class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon">
                <input id="authPassword" type="password" placeholder="Mot de passe" autocomplete="current-password"
                    class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon">
            </div>
            ${errorHtml}${infoHtml}
            <button onclick="authLogin(document.getElementById('authEmail').value, document.getElementById('authPassword').value)"
                ${state.authLoading ? 'disabled' : ''}
                class="w-full py-3.5 rounded-xl font-bold text-main bg-neon uppercase tracking-wider hover:bg-neon/90 active:scale-95 transition mb-4 flex items-center justify-center">
                ${spinner}Se connecter
            </button>
            <div class="flex justify-between text-sm">
                <button onclick="updateState({authScreen:'register',authError:null,authInfo:null})" class="text-neon hover:underline">Créer un compte</button>
                <button onclick="updateState({authScreen:'reset',authError:null,authInfo:null})" class="text-dim hover:text-white">Mot de passe oublié ?</button>
            </div>`;

    } else if (screen === 'register') {
        title = 'Créer un compte';
        formHtml = `
            <div class="space-y-3 mb-5">
                <input id="authUsername" type="text" placeholder="Pseudo (visible dans l'arène)" autocomplete="nickname"
                    class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon">
                <input id="authEmail" type="email" placeholder="Email" autocomplete="email"
                    class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon">
                <input id="authPassword" type="password" placeholder="Mot de passe (6 car. min)" autocomplete="new-password"
                    class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon">
            </div>
            ${errorHtml}${infoHtml}
            <button onclick="authRegister(document.getElementById('authEmail').value, document.getElementById('authPassword').value, document.getElementById('authUsername').value)"
                ${state.authLoading ? 'disabled' : ''}
                class="w-full py-3.5 rounded-xl font-bold text-main bg-neon uppercase tracking-wider hover:bg-neon/90 active:scale-95 transition mb-4 flex items-center justify-center">
                ${spinner}Créer mon compte
            </button>
            <button onclick="updateState({authScreen:'login',authError:null,authInfo:null})" class="text-sm text-dim hover:text-white">← Retour à la connexion</button>`;

    } else if (screen === 'reset') {
        title = 'Réinitialiser le mot de passe';
        formHtml = `
            <p class="text-dim text-sm mb-4">Entre ton email pour recevoir un lien de réinitialisation.</p>
            <input id="authEmail" type="email" placeholder="Email" autocomplete="email"
                class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon mb-4">
            ${errorHtml}${infoHtml}
            <button onclick="authResetPassword(document.getElementById('authEmail').value)"
                ${state.authLoading ? 'disabled' : ''}
                class="w-full py-3.5 rounded-xl font-bold text-main bg-neon uppercase tracking-wider hover:bg-neon/90 active:scale-95 transition mb-4 flex items-center justify-center">
                ${spinner}Envoyer le lien
            </button>
            <button onclick="updateState({authScreen:'login',authError:null,authInfo:null})" class="text-sm text-dim hover:text-white">← Retour à la connexion</button>`;
    }

    return `
    <div class="min-h-screen flex items-center justify-center p-4">
        <div class="w-full max-w-sm">
            <div class="text-center mb-8">
                <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-neon/10 border border-neon/30 mb-4">
                    <i data-lucide="dumbbell" class="w-8 h-8 text-neon"></i>
                </div>
                <h1 class="text-3xl font-black uppercase tracking-widest">
                    Discipline<span class="text-neon">Board</span>
                </h1>
                <p class="text-dim text-xs mt-1 uppercase tracking-widest">Ta progression. Ton cloud.</p>
            </div>
            <div class="bg-card p-6 rounded-2xl border border-white/10 shadow-2xl">
                <h2 class="text-base font-bold text-white mb-5 uppercase tracking-widest">${title}</h2>
                ${formHtml}
            </div>
        </div>
    </div>`;
}

// ==========================================
// 🎨 RENDU PRINCIPAL
// ==========================================

function renderSyncBadge() {
    if (!currentUser) return '';
    const map = {
        idle:    ['cloud',       'text-dim/50',  ''],
        syncing: ['refresh-cw',  'text-neon',    'animate-spin'],
        ok:      ['cloud-check', 'text-neon/70', ''],
        error:   ['cloud-off',   'text-danger',  ''],
    };
    const [icon, color, anim] = map[state.syncStatus] || map.idle;
    const tips = { idle:'Sync active', syncing:'Synchronisation…', ok:'Synchronisé', error:'Erreur sync' };
    return `<span title="${tips[state.syncStatus]||''}" class="flex items-center gap-1 text-xs ${color}"><i data-lucide="${icon}" class="w-3.5 h-3.5 ${anim}"></i><span class="hidden md:inline">${tips[state.syncStatus]||''}</span></span>`;
}

function renderHeader() {
    const score=calculateDailyScore(state.currentDate);
    let scoreColor=score>70?'#00ff88':(score>30?'#ff3b3b':'#a0a5b1');
    const level=Math.floor(state.xp/100)+1; const xpProgress=state.xp%100;
    const defaultAvatar='https://via.placeholder.com/150/1a1d24/00ff88?text='+(state.username?state.username.charAt(0).toUpperCase():'?');
    const avatarSrc=state.profilePic||defaultAvatar;
    return `
    <header class="flex flex-col md:flex-row items-center justify-between p-6 bg-card rounded-2xl mb-6 border border-white/5 relative mt-4 md:mt-0">
        <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-danger via-main to-neon opacity-50 rounded-t-2xl"></div>
        <div class="z-10 mb-6 md:mb-0 text-center md:text-left flex-1 w-full">
            <div class="flex items-center gap-3 justify-center md:justify-start mb-1">
                <h1 class="text-2xl md:text-3xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-dim">Discipline Board</h1>
                ${renderSyncBadge()}
            </div>
            <div class="mt-3 flex flex-col max-w-sm mx-auto md:mx-0">
                <div class="flex justify-between text-[10px] font-bold uppercase mb-1"><span class="text-neon">Niveau ${level}</span><span class="text-dim">${xpProgress} / 100 XP</span></div>
                <div class="h-1.5 w-full bg-main rounded-full overflow-hidden border border-white/5"><div class="h-full bg-neon transition-all" style="width:${xpProgress}%"></div></div>
            </div>
        </div>
        <div class="flex items-center gap-4 shrink-0">
            <button onclick="authLogout()" title="Se déconnecter" class="text-dim hover:text-danger transition p-2 rounded-lg hover:bg-danger/10 border border-transparent hover:border-danger/20">
                <i data-lucide="log-out" class="w-4 h-4"></i>
            </button>
            <div class="relative w-14 h-14 md:w-16 md:h-16 rounded-full border-2 border-white/10 hover:border-neon transition cursor-pointer group overflow-hidden" onclick="document.getElementById('profilePicInput').click()">
                <img src="${avatarSrc}" alt="Avatar" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><i data-lucide="camera" class="w-5 h-5 text-white"></i></div>
            </div>
            <div class="relative w-20 h-20 flex items-center justify-center">
                <svg class="w-full h-full transform -rotate-90"><circle cx="50%" cy="50%" r="38%" stroke="#0f1115" stroke-width="8" fill="none"></circle><circle cx="50%" cy="50%" r="38%" stroke="${scoreColor}" stroke-width="8" fill="none" stroke-dasharray="240" stroke-dashoffset="${240*(1-score/100)}" class="transition-all duration-1000"></circle></svg>
                <div class="absolute inset-0 flex items-center justify-center"><span class="text-2xl font-bold text-white">${score}</span></div>
            </div>
        </div>
    </header>`;
}

function renderTabs() {
    const tabs=[{id:'dashboard',icon:'layout-dashboard',label:'Vue'},{id:'sport',icon:'dumbbell',label:'Sport'},{id:'discipline',icon:'list-todo',label:'Tâches'},{id:'nutrition',icon:'utensils',label:'Repas'},{id:'menus',icon:'calendar-days',label:'Menus'},{id:'journal',icon:'book',label:'Journal'},{id:'vision',icon:'image',label:'Vision'},{id:'arena',icon:'swords',label:'Arène'},{id:'success',icon:'trophy',label:'Succès'}];
    return `
    <nav class="hidden md:flex gap-2 mb-6 overflow-x-auto pb-2">
        ${tabs.map(t=>`<button onclick="switchTab('${t.id}')" class="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${state.activeTab===t.id?'bg-white text-main shadow-[0_0_20px_rgba(255,255,255,0.2)]':'bg-card text-dim hover:bg-white/5 hover:text-white'}"><i data-lucide="${t.icon}" class="w-4 h-4"></i> ${t.label}</button>`).join('')}
    </nav>
    <nav class="md:hidden fixed bottom-0 left-0 w-full bg-card border-t border-white/10 z-50 flex overflow-x-auto pb-safe">
        ${tabs.map(t=>`<button onclick="switchTab('${t.id}')" class="flex flex-col items-center justify-center gap-1 min-w-[70px] py-3 transition-all ${state.activeTab===t.id?'text-neon bg-white/5 shadow-[inset_0_2px_0_#00ff88]':'text-dim hover:text-white'}"><i data-lucide="${t.icon}" class="w-5 h-5"></i><span class="text-[9px] font-bold uppercase">${t.label}</span></button>`).join('')}
    </nav>`;
}

function renderDashboard() {
    const monthlyStats=getMonthlyStats();
    let questHtml='';
    if(state.activeQuest){const qd=QUESTS.find(q=>q.id===state.activeQuest.id);if(qd){const progress=getQuestProgress();const isComplete=progress>=qd.target;if(state.activeQuest.claimed){questHtml=`<div class="bg-card p-6 rounded-2xl border border-white/5 mb-6 text-center animate-fade-in flex flex-col items-center"><div class="w-12 h-12 bg-main rounded-full flex items-center justify-center mb-3"><i data-lucide="check-circle-2" class="text-neon w-6 h-6"></i></div><h3 class="font-bold text-white mb-1">Quête Terminée !</h3><p class="text-dim text-sm mb-4">Tu as gagné ${qd.xp} XP.</p><button onclick="generateNewQuest()" class="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-bold transition">Nouvelle Quête</button></div>`;}else{const pct=Math.min(100,(progress/qd.target)*100);questHtml=`<div class="bg-card p-6 rounded-2xl border ${isComplete?'border-gold shadow-[0_0_15px_rgba(255,215,0,0.1)]':'border-neon/30'} mb-6 relative overflow-hidden animate-fade-in">${isComplete?'<div class="absolute inset-0 bg-gold/5 animate-pulse"></div>':''}<div class="relative z-10"><div class="flex items-center gap-2 mb-4"><i data-lucide="scroll" class="text-dim w-4 h-4"></i><span class="text-[10px] text-dim uppercase tracking-widest font-bold">Quête Active</span></div><div class="flex flex-col md:flex-row md:items-end justify-between gap-4"><div class="flex items-start gap-4"><div class="w-12 h-12 rounded-full ${isComplete?'bg-gold/20':'bg-neon/10'} flex items-center justify-center shrink-0 border ${isComplete?'border-gold/50':'border-neon/30'}"><i data-lucide="${qd.icon}" class="${isComplete?'text-gold':'text-neon'} w-5 h-5"></i></div><div><h3 class="text-xl font-black text-white">${qd.title}</h3><p class="text-dim text-sm mt-1">${qd.desc}</p></div></div><div class="w-full md:w-auto text-right">${isComplete?`<button onclick="claimQuestReward()" class="w-full md:w-auto bg-gold text-main px-6 py-3 rounded-xl font-black uppercase text-sm hover:scale-105 transition-transform">Réclamer +${qd.xp} XP</button>`:`<div class="flex justify-between text-[10px] font-bold uppercase mb-1.5 text-neon"><span>${progress}</span><span>${qd.target}</span></div><div class="h-2 w-full md:w-48 bg-main rounded-full overflow-hidden border border-white/5"><div class="h-full bg-neon transition-all" style="width:${pct}%"></div></div><div class="text-[10px] text-dim uppercase mt-2 text-right">+${qd.xp} XP</div>`}</div></div></div></div>`;}}}
    return `<div class="space-y-6 animate-fade-in"><div class="grid grid-cols-1 md:grid-cols-${Math.min(state.exercises.length,4)} gap-6">${state.exercises.map(ex=>`<div class="bg-card p-8 rounded-2xl border border-white/5 flex flex-col items-center justify-center min-h-[220px]"><div class="w-16 h-16 rounded-full bg-main flex items-center justify-center mb-4 border border-neon/20"><span class="text-neon text-xs uppercase tracking-widest font-black truncate max-w-[56px]">${ex.label.substring(0,3)}</span></div><div class="text-6xl md:text-7xl font-black text-white leading-none">${monthlyStats[ex.key]||0}</div><div class="text-xs text-dim uppercase mt-3 tracking-widest truncate text-center">${ex.label}</div></div>`).join('')}</div>${questHtml}</div>`;
}

function renderSportCard(ex) {
    const data=getDaySportData(state.currentDate); const current=data[ex.key]||0; const progress=Math.min(100,(current/ex.goal)*100); const isDone=current>=ex.goal;
    return `<div class="bg-card p-6 rounded-2xl border border-white/5 relative overflow-hidden">${isDone?'<div class="absolute top-0 right-0 p-2 bg-neon/10 rounded-bl-xl text-neon"><i data-lucide="check-circle-2" class="w-5 h-5"></i></div>':''}<div class="flex justify-between items-end mb-4"><div><h3 class="text-lg font-bold text-white uppercase tracking-wider truncate max-w-[150px]">${ex.label}</h3><p class="text-dim text-xs mt-1">Objectif: ${ex.goal}</p></div><div class="flex items-center gap-3 cursor-pointer bg-main/50 px-3 py-1.5 rounded-xl" onclick="updateState({showModal:{type:'editSport',sportType:'${ex.key}',date:'${state.currentDate}'}})"><span class="text-3xl font-black ${isDone?'text-neon':'text-white'}">${current}</span><i data-lucide="pencil" class="w-4 h-4 text-dim opacity-40"></i></div></div><div class="h-2 w-full bg-main rounded-full overflow-hidden mb-6"><div class="h-full bg-gradient-to-r from-neon to-emerald-400 transition-all duration-500" style="width:${progress}%"></div></div><div class="grid grid-cols-4 gap-2"><button onclick="addExo('${ex.key}',-10)" class="bg-white/5 hover:bg-danger/20 text-danger/80 py-2 rounded-lg font-bold text-sm transition">-10</button><button onclick="addExo('${ex.key}',-1)" class="bg-white/5 hover:bg-danger/20 text-danger/80 py-2 rounded-lg font-bold text-sm transition">-1</button><button onclick="addExo('${ex.key}',1)" class="bg-white/5 hover:bg-neon/10 text-white hover:text-neon py-2 rounded-lg font-bold text-sm transition">+1</button><button onclick="addExo('${ex.key}',10)" class="bg-white/5 hover:bg-neon/10 text-white hover:text-neon py-2 rounded-lg font-bold text-sm transition">+10</button></div></div>`;
}

function renderSportHistory() {
    const historyKeys=Object.keys(state.history).filter(d=>d!==state.currentDate).sort((a,b)=>new Date(b)-new Date(a));
    let historyHTML=historyKeys.map(dateStr=>{const data=state.history[dateStr];const isPerfect=state.exercises.every(ex=>(data[ex.key]||0)>=ex.goal);const hasData=state.exercises.some(ex=>data[ex.key])||data.comment;if(!hasData)return'';const exCols=state.exercises.map(ex=>`<div class="text-center w-16"><span class="block text-dim text-[10px] uppercase mb-1 truncate">${ex.label}</span><span class="text-xl font-black">${data[ex.key]||0}</span></div>`).join('');return`<div class="bg-card p-5 rounded-2xl border ${isPerfect?'border-neon/30':'border-white/5'} flex flex-col md:flex-row gap-4 items-center relative"><button onclick="updateState({showModal:{type:'editDaySport',date:'${dateStr}'}})" class="absolute top-3 right-3 text-dim hover:text-neon p-2 bg-main rounded-lg border border-white/5"><i data-lucide="pencil" class="w-4 h-4"></i></button><div class="text-center md:text-left min-w-[120px]"><div class="text-white font-bold text-lg mb-1">${dateStr}</div>${isPerfect?'<span class="text-[10px] font-bold bg-neon/20 px-2 py-1 rounded text-neon uppercase flex items-center justify-center gap-1 w-max mx-auto md:mx-0"><i data-lucide="check-circle" class="w-3 h-3"></i> Validé</span>':'<span class="text-[10px] font-bold bg-white/10 px-2 py-1 rounded text-dim uppercase flex items-center justify-center gap-1 w-max mx-auto md:mx-0"><i data-lucide="circle-dashed" class="w-3 h-3"></i> Incomplet</span>'}</div><div class="flex flex-wrap gap-4 text-sm text-white justify-center border-y md:border-y-0 md:border-x border-white/10 py-4 md:py-0 md:px-6 w-full md:w-auto">${exCols}</div><div class="flex-1 w-full mt-2 md:mt-0"><textarea onchange="saveSportComment('${dateStr}',this.value)" class="w-full bg-main border border-white/5 rounded-xl p-3 text-sm text-white focus:border-neon focus:outline-none resize-none h-[60px]" placeholder="Commentaire...">${data.comment||''}</textarea></div></div>`;}).filter(h=>h!=='').join('');
    if(!historyHTML.trim()) historyHTML=`<div class="bg-card p-8 rounded-2xl border border-white/5 text-center text-dim"><p class="font-bold text-white mb-1">Aucun historique.</p></div>`;
    return `<div class="mt-12 animate-slide-up"><div class="flex justify-between items-center mb-6"><h3 class="text-xl font-bold flex items-center gap-2"><i data-lucide="award" class="text-neon"></i> Historique</h3><button onclick="updateState({showModal:{type:'selectDateToEdit'}})" class="bg-white/5 text-white text-xs px-3 py-2 rounded-lg font-bold flex items-center gap-2"><i data-lucide="calendar-plus" class="w-4 h-4"></i> Ajouter</button></div><div class="space-y-4">${historyHTML}</div></div>`;
}

function renderSportTab() { return `<div class="flex justify-between items-center mb-6 animate-fade-in"><h2 class="text-xl font-bold">Mes Exercices</h2><button onclick="updateState({showModal:{type:'manageExercises'}})" class="bg-neon/10 border border-neon/30 text-neon text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-neon/20 transition"><i data-lucide="sliders-horizontal" class="w-4 h-4"></i> Gérer les exercices</button></div><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-slide-up">${state.exercises.map(ex=>renderSportCard(ex)).join('')}</div>${renderSportHistory()}`; }

function renderDiscipline() { return `<div class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in"><div class="bg-card p-6 rounded-2xl border border-white/5"><h3 class="text-xl font-bold mb-6 flex items-center gap-2"><i data-lucide="repeat" class="text-neon"></i> Habitudes</h3><form onsubmit="event.preventDefault();addHabit(this.habit.value);this.reset();" class="flex gap-2 mb-4"><input name="habit" type="text" placeholder="Ajouter une habitude..." class="flex-1 bg-main border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-neon"><button type="submit" class="bg-white text-black px-4 py-2 rounded-lg font-bold">+</button></form><div class="space-y-3">${state.habits.map((h,idx)=>`<div draggable="true" ondragstart="handleDragStart(event,'habits',${idx})" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event,'habits',${idx})" ondragend="handleDragEnd(event)" data-droppable="true" class="flex items-center justify-between p-3 rounded-xl bg-main/50 cursor-move border border-transparent touch-manipulation"><div class="flex items-center flex-1"><i data-lucide="grip-vertical" class="w-4 h-4 text-dim/30 mr-2 shrink-0"></i><label class="flex items-center cursor-pointer flex-1"><div class="custom-checkbox relative w-6 h-6 mr-3 shrink-0"><input type="checkbox" class="opacity-0 absolute" ${h.done?'checked':''} onchange="toggleHabit(${h.id})"><div class="w-6 h-6 border-2 border-dim rounded-md flex items-center justify-center after:content-['✔'] after:text-black after:text-xs after:hidden"></div></div><span class="font-medium select-none text-sm md:text-base ${h.done?'text-dim line-through':'text-white'}">${h.name}</span></label></div><button onclick="removeHabit(${h.id})" class="text-dim hover:text-danger p-2 shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`).join('')}</div></div><div class="bg-card p-6 rounded-2xl border border-white/5"><h3 class="text-xl font-bold mb-6 flex items-center gap-2"><i data-lucide="target" class="text-danger"></i> Objectifs du Jour</h3><form onsubmit="event.preventDefault();addTask(this.task.value);this.reset();" class="flex gap-2 mb-4"><input name="task" type="text" placeholder="Ajouter une tâche..." class="flex-1 bg-main border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-neon"><button type="submit" class="bg-white text-black px-4 py-2 rounded-lg font-bold">+</button></form><div class="space-y-2">${state.dailyTasks.map((t,idx)=>`<div draggable="true" ondragstart="handleDragStart(event,'dailyTasks',${idx})" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event,'dailyTasks',${idx})" ondragend="handleDragEnd(event)" data-droppable="true" class="flex items-center justify-between p-3 rounded-xl bg-main/50 cursor-move border border-transparent touch-manipulation"><div class="flex items-center gap-3"><i data-lucide="grip-vertical" class="w-4 h-4 text-dim/30 shrink-0"></i><button onclick="toggleTask(${t.id})" class="w-5 h-5 border rounded-full flex items-center justify-center shrink-0 ${t.done?'bg-white border-white':'border-dim'}">${t.done?'<i data-lucide="check" class="w-3 h-3 text-black"></i>':''}</button><span class="select-none text-sm md:text-base ${t.done?'text-dim line-through':'text-white'}">${t.text}</span></div><button onclick="removeTask(${t.id})" class="text-dim hover:text-danger p-2 shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`).join('')}</div></div></div>`; }

function renderNutrition() { const todayStatus=(state.nutritionData[state.currentDate]||{}).status; return `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in"><div class="bg-card p-6 rounded-2xl border border-white/5 md:col-span-1"><h3 class="text-xl font-bold mb-6">Aujourd'hui</h3><div class="flex flex-col gap-3"><button onclick="setNutrition('clean')" class="p-4 rounded-xl border-2 flex items-center justify-center gap-3 transition-all ${todayStatus==='clean'?'border-neon bg-neon/10 text-neon':'border-white/5 bg-main'}"><i data-lucide="leaf" class="w-5 h-5"></i><span class="font-bold">Journée Clean</span></button><button onclick="setNutrition('sugar')" class="p-4 rounded-xl border-2 flex items-center justify-center gap-3 transition-all ${todayStatus==='sugar'?'border-danger bg-danger/10 text-danger':'border-white/5 bg-main'}"><i data-lucide="cookie" class="w-5 h-5"></i><span class="font-bold">J'ai craqué</span></button></div><div class="mt-8 pt-8 border-t border-white/5 text-center"><div class="text-dim text-sm uppercase tracking-widest mb-2">Streak actuel</div><div class="text-4xl font-black text-white">${calculateStreak()} <span class="text-base font-normal text-dim">Jours</span></div></div></div><div class="bg-card p-6 rounded-2xl border border-white/5 md:col-span-2"><h3 class="text-xl font-bold mb-6">Historique (28 Jours)</h3><div class="grid grid-cols-7 gap-2">${[...Array(28)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(27-i));const stat=(state.nutritionData[formatDate(d)]||{}).status;let color='bg-main';if(stat==='clean')color='bg-neon shadow-[0_0_5px_rgba(0,255,136,0.3)]';else if(stat==='sugar')color='bg-danger shadow-[0_0_5px_rgba(255,59,59,0.3)]';return`<div title="${formatDate(d)}" class="aspect-square rounded-md ${color} border border-white/5"></div>`;}).join('')}</div></div></div>`; }

function renderArena() { let leaderboardHtml='';if(isFetchingArena){leaderboardHtml=`<div class="text-center py-12 text-dim animate-pulse"><i data-lucide="refresh-cw" class="w-8 h-8 mx-auto mb-4 animate-spin"></i></div>`;}else if(arenaLeaderboard.length===0){leaderboardHtml=`<div class="text-center py-12 text-dim">Personne dans l'arène !</div>`;}else{leaderboardHtml=arenaLeaderboard.map((player,index)=>{let rankIcon=`<span class="text-dim font-bold">${index+1}</span>`;let borderClass="border-white/5";if(index===0){rankIcon=`<i data-lucide="crown" class="w-5 h-5 text-gold"></i>`;borderClass="border-gold/30 bg-gold/5";}else if(index===1){rankIcon=`<i data-lucide="medal" class="w-5 h-5 text-silver"></i>`;borderClass="border-silver/30";}else if(index===2){rankIcon=`<i data-lucide="medal" class="w-5 h-5 text-bronze"></i>`;borderClass="border-bronze/30";}const level=Math.floor(player.xp/100)+1;const pAvatar=player.profilePic||`https://via.placeholder.com/150/1a1d24/a0a5b1?text=${player.name.charAt(0).toUpperCase()}`;
// Build reps pills from exercises
const repKeys = state.exercises.map(ex => ex.key);
const repPills = state.exercises.map(ex => {
    const val = (player[ex.key] || 0);
    return `<div class="flex flex-col items-center px-3 py-1.5 bg-main/60 rounded-lg border border-white/5 min-w-[60px]"><span class="text-[10px] text-dim uppercase tracking-widest truncate max-w-[60px]">${ex.label}</span><span class="font-black text-sm text-white">${val.toLocaleString('fr-FR')}</span></div>`;
}).join('');
const playerJson = JSON.stringify(player).replace(/'/g,"&#39;").replace(/"/g,'&quot;');
return`<div class="flex flex-col p-4 rounded-xl border ${borderClass} ${player.isMe?'ring-1 ring-neon/50':''} mb-3 cursor-pointer hover:border-neon/40 transition-all" onclick="openArenaPlayerModal(${playerJson})"><div class="flex justify-between items-center mb-3"><div class="flex items-center gap-3"><div class="relative w-10 h-10 rounded-full border border-white/10 overflow-hidden shrink-0"><img src="${pAvatar}" class="w-full h-full object-cover"><div class="absolute -bottom-1 -right-1 bg-main rounded-full">${rankIcon}</div></div><h4 class="font-bold text-white text-lg">${player.name}${player.isMe?' <span class="bg-neon/20 text-neon text-[9px] uppercase px-1.5 py-0.5 rounded">Moi</span>':''}</h4></div><div class="text-right"><div class="font-black text-xl text-neon">${(player.xp||0).toLocaleString()} XP</div><div class="text-xs text-dim">Niveau ${level}</div></div></div><div class="flex flex-wrap gap-2 pt-2 border-t border-white/5">${repPills}</div></div>`;}).join('');}return`<div class="animate-fade-in max-w-4xl mx-auto"><div class="bg-card p-6 rounded-2xl border border-white/5 mb-6"><h3 class="text-xl font-bold mb-4 flex items-center gap-2"><i data-lucide="swords" class="text-neon"></i> Arène Multijoueur</h3><div class="flex flex-col sm:flex-row gap-3"><input type="text" id="arenaPseudo" value="${state.username}" placeholder="Ton Pseudo..." class="flex-1 bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon"><button onclick="state.username=document.getElementById('arenaPseudo').value;syncAndJoinArena();" class="bg-neon text-main px-6 py-3 rounded-xl font-bold hover:bg-neon/80 transition">Rejoindre & Synchroniser</button></div></div><div class="bg-card p-6 rounded-2xl border border-white/5"><h3 class="text-lg font-bold mb-6 flex items-center gap-2 text-gold"><i data-lucide="trophy"></i> Classement</h3>${leaderboardHtml}</div></div>`; }

function openArenaPlayerModal(player) {
    updateState({ showModal: { type: 'arenaPlayerStats', player } });
}

function renderArenaPlayerModal(player) {
    const level = Math.floor((player.xp||0)/100)+1;
    const xpInLevel = (player.xp||0) % 100;
    const pAvatar = player.profilePic || `https://via.placeholder.com/150/1a1d24/a0a5b1?text=${(player.name||'?').charAt(0).toUpperCase()}`;
    const streak = player.streak || 0;
    const perfectDays = player.perfectDays || 0;

    const exRows = state.exercises.map(ex => {
        const val = player[ex.key] || 0;
        const goal = ex.goal || 1;
        const pct = Math.min(100, Math.round((val / (goal * 30)) * 100)); // rapport sur 30 jours d'objectif
        return `<div class="mb-4">
            <div class="flex justify-between items-center mb-1.5">
                <span class="text-sm font-bold text-white uppercase tracking-wide">${ex.label}</span>
                <span class="text-neon font-black text-lg">${val.toLocaleString('fr-FR')} <span class="text-xs text-dim font-normal">reps</span></span>
            </div>
            <div class="h-2 w-full bg-main rounded-full overflow-hidden border border-white/5">
                <div class="h-full bg-gradient-to-r from-neon to-emerald-400 transition-all duration-700" style="width:${pct}%"></div>
            </div>
        </div>`;
    }).join('');

    return `<div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onclick="if(event.target===this)updateState({showModal:null})">
        <div class="bg-card p-6 rounded-2xl border border-white/10 w-full max-w-sm animate-pop">
            <div class="flex justify-between items-start mb-6">
                <h3 class="text-xl font-bold text-white flex items-center gap-2"><i data-lucide="user" class="text-neon w-5 h-5"></i> Profil du Joueur</h3>
                <button onclick="updateState({showModal:null})" class="text-dim hover:text-white p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="flex items-center gap-4 mb-6 pb-6 border-b border-white/10">
                <div class="relative shrink-0">
                    <div class="w-16 h-16 rounded-full border-2 border-neon/40 overflow-hidden"><img src="${pAvatar}" class="w-full h-full object-cover"></div>
                    <div class="absolute -bottom-1 -right-1 bg-neon text-main text-[10px] font-black px-1.5 py-0.5 rounded-full leading-tight">Niv.${level}</div>
                </div>
                <div class="flex-1">
                    <div class="font-black text-white text-xl leading-tight">${player.name||'?'}${player.isMe?' <span class="bg-neon/20 text-neon text-[9px] uppercase px-1.5 py-0.5 rounded">Moi</span>':''}</div>
                    <div class="text-neon font-bold text-lg mt-0.5">${(player.xp||0).toLocaleString('fr-FR')} XP</div>
                    <div class="mt-2"><div class="h-1.5 w-full bg-main rounded-full overflow-hidden"><div class="h-full bg-neon" style="width:${xpInLevel}%"></div></div><div class="text-[10px] text-dim mt-1">${xpInLevel}/100 XP → niveau ${level+1}</div></div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-6">
                <div class="bg-main rounded-xl p-3 text-center border border-white/5">
                    <div class="text-2xl font-black text-white">${streak}</div>
                    <div class="text-[10px] text-dim uppercase tracking-widest mt-1">Streak Clean</div>
                </div>
                <div class="bg-main rounded-xl p-3 text-center border border-white/5">
                    <div class="text-2xl font-black text-white">${perfectDays}</div>
                    <div class="text-[10px] text-dim uppercase tracking-widest mt-1">Jours Parfaits</div>
                </div>
            </div>
            <div class="mb-2"><p class="text-[10px] text-dim uppercase tracking-widest font-bold mb-4">Total des Reps</p>${exRows}</div>
            <button onclick="updateState({showModal:null})" class="w-full py-3 rounded-xl font-bold text-main bg-neon uppercase tracking-wider hover:bg-neon/90 transition mt-2">Fermer</button>
        </div>
    </div>`;
}

function renderMenus() { const weekDates=getWeekDates(state.menuViewDate);const startStr=formatShortDay(weekDates[0]);const endStr=formatShortDay(weekDates[6]);const weekHTML=weekDates.map(dateStr=>{const dayMenu=state.menus[dateStr]||{breakfast:'',lunch:'',snack:'',dinner:''};const isToday=dateStr===state.currentDate;return`<div class="flex flex-col xl:flex-row gap-2 items-start xl:items-center p-3 rounded-xl border transition-all ${isToday?'border-neon/50 bg-neon/5':'border-white/5 bg-main'}"><div class="w-full xl:w-28 shrink-0 flex xl:flex-col justify-between items-center xl:items-start font-bold ${isToday?'text-neon':'text-white'}"><span>${formatShortDay(dateStr)}</span>${isToday?'<span class="text-[9px] uppercase bg-neon text-main px-2 py-0.5 rounded-sm mt-1">Aujourd\'hui</span>':''}</div><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 w-full"><div class="relative"><span class="xl:hidden text-[10px] text-dim uppercase absolute -top-2 left-2 bg-main px-1">Petit-déj</span><textarea onchange="updateMealWeekly('${dateStr}','breakfast',this.value)" class="w-full bg-card border border-white/10 rounded-lg px-3 py-2 pt-3 xl:pt-2 text-xs text-white focus:outline-none focus:border-neon h-[60px] resize-none">${dayMenu.breakfast}</textarea></div><div class="relative"><span class="xl:hidden text-[10px] text-dim uppercase absolute -top-2 left-2 bg-main px-1">Déjeuner</span><textarea onchange="updateMealWeekly('${dateStr}','lunch',this.value)" class="w-full bg-card border border-white/10 rounded-lg px-3 py-2 pt-3 xl:pt-2 text-xs text-white focus:outline-none focus:border-neon h-[60px] resize-none">${dayMenu.lunch}</textarea></div><div class="relative"><span class="xl:hidden text-[10px] text-dim uppercase absolute -top-2 left-2 bg-main px-1">Collation</span><textarea onchange="updateMealWeekly('${dateStr}','snack',this.value)" class="w-full bg-card border border-white/10 rounded-lg px-3 py-2 pt-3 xl:pt-2 text-xs text-white focus:outline-none focus:border-neon h-[60px] resize-none">${dayMenu.snack}</textarea></div><div class="relative"><span class="xl:hidden text-[10px] text-dim uppercase absolute -top-2 left-2 bg-main px-1">Dîner</span><textarea onchange="updateMealWeekly('${dateStr}','dinner',this.value)" class="w-full bg-card border border-white/10 rounded-lg px-3 py-2 pt-3 xl:pt-2 text-xs text-white focus:outline-none focus:border-neon h-[60px] resize-none">${dayMenu.dinner}</textarea></div></div></div>`;}).join('');return`<div class="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fade-in"><div class="bg-card p-4 rounded-2xl border border-white/5 lg:col-span-3"><div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4"><h3 class="text-xl font-bold flex items-center gap-2"><i data-lucide="calendar-days" class="text-neon"></i> Semaine</h3><div class="flex items-center gap-2 bg-main p-1.5 rounded-xl border border-white/10 w-full md:w-auto justify-between"><button onclick="changeWeek(-1)" class="p-2 hover:bg-white/10 rounded-lg text-dim"><i data-lucide="chevron-left" class="w-4 h-4"></i></button><span class="text-xs font-bold px-2 text-white">${startStr} - ${endStr}</span><button onclick="changeWeek(1)" class="p-2 hover:bg-white/10 rounded-lg text-dim"><i data-lucide="chevron-right" class="w-4 h-4"></i></button><div class="w-px h-6 bg-white/10 mx-1"></div><button onclick="updateState({menuViewDate:state.currentDate})" class="px-3 py-1.5 hover:bg-white/10 rounded-lg text-xs font-bold text-neon">Aujourd'hui</button></div></div><div class="space-y-3">${weekHTML}</div></div><div class="bg-card p-4 rounded-2xl border border-white/5 lg:col-span-1 h-fit sticky top-6"><h3 class="text-xl font-bold mb-4 flex items-center gap-2"><i data-lucide="shopping-cart" class="text-neon"></i> Courses</h3><form onsubmit="event.preventDefault();addGroceryItem(this.item.value);this.reset();" class="flex gap-2 mb-4"><input name="item" type="text" placeholder="Ajouter..." class="flex-1 bg-main border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-neon"><button type="submit" class="bg-white text-black px-3 py-2 rounded-lg font-bold">+</button></form><div class="space-y-2 max-h-[400px] overflow-y-auto pr-2">${state.groceryList.map(item=>`<div class="flex items-center justify-between p-2.5 rounded-xl bg-main/50"><label class="flex items-center cursor-pointer flex-1"><div class="custom-checkbox relative w-5 h-5 mr-3 shrink-0"><input type="checkbox" class="opacity-0 absolute" ${item.done?'checked':''} onchange="toggleGroceryItem(${item.id})"><div class="w-5 h-5 border-2 border-dim rounded-md transition-all flex items-center justify-center after:content-['✔'] after:text-black after:text-[10px] after:hidden"></div></div><span class="text-sm font-medium ${item.done?'text-dim line-through':'text-white'}">${item.name}</span></label><button onclick="removeGroceryItem(${item.id})" class="text-dim hover:text-danger p-1"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`).join('')}</div></div></div>`; }

function renderJournal() { const todayData=state.journal[state.currentDate]||{mood:'',text:''};const moods=[{emoji:'🚀',label:'Au top'},{emoji:'💪',label:'Motivé'},{emoji:'😐',label:'Neutre'},{emoji:'😴',label:'Fatigué'},{emoji:'😡',label:'Frustré'}];const historyKeys=Object.keys(state.journal).filter(d=>d!==state.currentDate).sort((a,b)=>new Date(b)-new Date(a));let historyHTML=historyKeys.map(dateStr=>{const data=state.journal[dateStr];if(!data.mood&&!data.text)return'';return`<div class="bg-card p-4 rounded-xl border border-white/5 flex flex-col gap-2"><div class="flex justify-between items-center border-b border-white/5 pb-2"><span class="font-bold text-white text-sm">${dateStr}</span><span class="text-2xl">${data.mood||'📝'}</span></div><p class="text-dim text-sm whitespace-pre-wrap">${data.text||'<em class="opacity-50 text-xs">Aucune note.</em>'}</p></div>`;}).filter(h=>h!=='').join('');if(!historyHTML)historyHTML=`<p class="text-dim text-sm text-center py-8 italic">Aucun historique.</p>`;return`<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in"><div class="bg-card p-6 rounded-2xl border border-white/5 lg:col-span-2"><h3 class="text-xl font-bold mb-6 flex items-center gap-2"><i data-lucide="book-open" class="text-neon"></i> Journal du Jour</h3><div class="mb-6"><label class="block text-xs text-dim uppercase tracking-widest mb-3">Mon humeur</label><div class="flex flex-wrap gap-2">${moods.map(m=>`<button onclick="setJournalMood('${m.emoji}')" title="${m.label}" class="flex flex-col items-center justify-center p-2 rounded-xl border-2 w-14 h-14 md:w-16 md:h-16 ${todayData.mood===m.emoji?'border-neon bg-neon/10 scale-110':'border-white/5 bg-main'}"><span class="text-2xl md:text-3xl">${m.emoji}</span></button>`).join('')}</div></div><div><label class="block text-xs text-dim uppercase tracking-widest mb-3">Notes & Réflexions</label><textarea onchange="saveJournalText(this.value)" class="w-full bg-main border border-white/5 rounded-xl p-4 text-sm text-white focus:border-neon focus:outline-none h-[180px] resize-none" placeholder="Qu'est-ce qui s'est bien passé aujourd'hui ?">${todayData.text||''}</textarea></div></div><div class="bg-card p-6 rounded-2xl border border-white/5 h-fit max-h-[600px] flex flex-col"><h3 class="text-xl font-bold mb-6 flex items-center gap-2 shrink-0"><i data-lucide="history" class="text-neon"></i> Historique</h3><div class="overflow-y-auto pr-2 space-y-4 flex-1">${historyHTML}</div></div></div>`; }

function renderVisionBoard() { return`<div class="animate-fade-in"><div class="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4"><h3 class="text-xl font-bold flex items-center gap-2"><i data-lucide="eye" class="text-neon"></i> Vision Board</h3><div class="flex flex-col sm:flex-row w-full lg:w-auto gap-3"><form onsubmit="event.preventDefault();addVisionImage(this.imageUrl.value);this.reset();" class="flex flex-1 gap-2"><input name="imageUrl" type="url" placeholder="Coller l'URL..." required class="flex-1 sm:w-72 bg-main border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-neon"><button type="submit" class="bg-white/10 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 text-sm"><i data-lucide="plus" class="w-4 h-4"></i><span class="hidden sm:inline">Ajouter</span></button></form>${state.visionImages.length>0?`<button onclick="resetVisionBoard()" class="bg-danger/10 text-danger px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 text-sm border border-danger/20"><i data-lucide="trash" class="w-4 h-4"></i><span class="hidden sm:inline">Tout effacer</span></button>`:''}</div></div>${state.visionImages.length===0?`<div class="bg-card p-12 rounded-2xl border border-white/5 text-center"><p class="text-white font-bold mb-2">Votre Vision Board est vide</p></div>`:`<div class="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">${state.visionImages.map((img,idx)=>`<div draggable="true" ondragstart="handleDragStart(event,'visionImages',${idx})" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event,'visionImages',${idx})" ondragend="handleDragEnd(event)" data-droppable="true" class="relative group rounded-xl overflow-hidden border border-white/5 break-inside-avoid cursor-move touch-manipulation"><img src="${img}" alt="Vision" class="w-full h-auto object-cover pointer-events-none"><div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center"><button onclick="removeVisionImage(${idx})" class="bg-danger/80 text-white p-3 rounded-full shadow-lg z-10"><i data-lucide="trash-2" class="w-5 h-5"></i></button></div></div>`).join('')}</div>`}</div>`; }

function renderSuccessTab() { const stats=getTotalStats();const cards=ACHIEVEMENTS.map(ach=>{const current=stats[ach.cat]||0;const progress=Math.min(100,(current/ach.target)*100);const isUnlocked=current>=ach.target;return`<div class="${isUnlocked?'bg-neon/10 border-neon/50':'bg-card border-white/5 opacity-80 grayscale'} p-4 md:p-5 rounded-2xl border flex flex-col relative overflow-hidden">${isUnlocked?'<div class="absolute -right-4 -top-4 w-20 h-20 bg-neon/20 blur-2xl rounded-full pointer-events-none"></div>':''}<div class="flex items-center gap-4 mb-5 z-10"><div class="w-10 h-10 md:w-12 md:h-12 rounded-full ${isUnlocked?'bg-neon/20':'bg-white/5'} flex shrink-0 items-center justify-center border ${isUnlocked?'border-neon/30':'border-white/10'}"><i data-lucide="${ach.icon}" class="w-5 h-5 md:w-6 md:h-6 ${isUnlocked?'text-neon':'text-dim'}"></i></div><div><h4 class="${isUnlocked?'text-white font-black':'text-white/50 font-bold'} text-sm md:text-base leading-tight uppercase tracking-wider">${ach.title}</h4><p class="text-[10px] md:text-xs ${isUnlocked?'text-neon/80':'text-dim/60'} mt-1">${ach.desc}</p></div></div><div class="mt-auto z-10"><div class="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-1.5 ${isUnlocked?'text-neon':'text-dim'}"><span>${current.toLocaleString('fr-FR')}</span><span>${ach.target.toLocaleString('fr-FR')}</span></div><div class="h-1.5 w-full bg-main rounded-full overflow-hidden"><div class="h-full ${isUnlocked?'bg-neon':'bg-white/20'} transition-all duration-1000" style="width:${progress}%"></div></div></div></div>`;}).join('');return`<div class="animate-slide-up"><div class="flex justify-between items-center mb-6"><h3 class="text-xl font-bold flex items-center gap-2"><i data-lucide="medal" class="text-neon"></i> Temple de la Renommée</h3></div><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${cards}</div></div>`; }

// ─── MODALS ───────────────────────────────────────────────────────────────────
function renderModal() {
    if (!state.showModal) return '';
    if (state.showModal.type==='manageExercises') { const rows=state.exercises.map(ex=>`<div class="flex items-center gap-3 p-3 bg-main rounded-xl border border-white/5"><div class="flex-1 grid grid-cols-2 gap-2"><input type="text" data-label="${ex.key}" value="${ex.label}" placeholder="Nom" class="bg-card border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-neon focus:outline-none"><input type="number" data-goal="${ex.key}" value="${ex.goal}" min="1" placeholder="Objectif" class="bg-card border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center font-bold focus:border-neon focus:outline-none"></div><button onclick="removeExercise('${ex.key}')" class="shrink-0 p-2 text-dim hover:text-danger transition rounded-lg hover:bg-danger/10"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`).join('');return`<div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onclick="if(event.target===this)updateState({showModal:null})"><div class="bg-card p-6 rounded-2xl border border-white/10 w-full max-w-lg animate-pop flex flex-col max-h-[90vh]"><div class="flex justify-between items-center mb-2 shrink-0"><h3 class="text-xl font-bold text-white flex items-center gap-2"><i data-lucide="sliders-horizontal" class="text-neon w-5 h-5"></i> Gérer les exercices</h3><button onclick="updateState({showModal:null})" class="text-dim hover:text-white p-1"><i data-lucide="x" class="w-5 h-5"></i></button></div><p class="text-dim text-xs mb-5 shrink-0">Modifie le nom et l'objectif, ou supprime des exercices.</p><form id="exConfigForm" class="flex flex-col gap-2 overflow-y-auto pr-1 mb-4 flex-1"><div class="grid grid-cols-2 gap-2 px-3 mb-1"><span class="text-[10px] text-dim uppercase tracking-widest font-bold">Nom</span><span class="text-[10px] text-dim uppercase tracking-widest font-bold text-center">Objectif / jour</span></div>${rows}</form><div class="border-t border-white/10 pt-4 shrink-0"><p class="text-xs text-dim uppercase tracking-widest font-bold mb-3 flex items-center gap-2"><i data-lucide="plus-circle" class="w-3.5 h-3.5 text-neon"></i> Ajouter un exercice</p><div class="flex gap-2"><input type="text" id="newExLabel" placeholder="Ex: Tractions" class="flex-1 bg-main border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-neon focus:outline-none"><input type="number" id="newExGoal" placeholder="20" min="1" value="20" class="w-20 bg-main border border-white/10 rounded-lg px-3 py-2 text-white text-sm text-center font-bold focus:border-neon focus:outline-none"><button onclick="addExercise(document.getElementById('newExLabel').value,document.getElementById('newExGoal').value);document.getElementById('newExLabel').value='';document.getElementById('newExGoal').value='20';" class="bg-neon/20 border border-neon/40 text-neon px-3 py-2 rounded-lg font-bold text-sm hover:bg-neon/30 transition flex items-center"><i data-lucide="plus" class="w-4 h-4"></i></button></div></div><button onclick="saveExerciseConfig(document.getElementById('exConfigForm'))" class="mt-4 w-full py-3 rounded-xl font-bold text-main bg-neon uppercase tracking-wider hover:bg-neon/90 transition shrink-0">Enregistrer</button></div></div>`; }
    if (state.showModal.type==='editSport') { const {sportType,date}=state.showModal;const currentVal=getDaySportData(date)[sportType]||0;const ex=state.exercises.find(e=>e.key===sportType);return`<div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onclick="if(event.target===this)updateState({showModal:null})"><div class="bg-card p-6 rounded-2xl border border-white/10 w-full max-w-sm animate-pop"><div class="flex justify-between items-center mb-6"><h3 class="text-xl font-bold text-white">Modifier ${ex?ex.label:sportType}</h3><button onclick="updateState({showModal:null})" class="text-dim"><i data-lucide="x" class="w-5 h-5"></i></button></div><form onsubmit="event.preventDefault();confirmEditSport('${sportType}',this.amount.value,'${date}');"><input type="number" name="amount" value="${currentVal}" min="0" class="w-full bg-main border border-white/10 rounded-xl px-4 py-4 text-white text-2xl text-center font-black focus:outline-none focus:border-neon mb-6"><button type="submit" class="w-full py-4 rounded-xl font-bold text-main bg-neon uppercase tracking-wider">Mettre à jour</button></form></div></div>`; }
    if (state.showModal.type==='selectDateToEdit') return`<div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onclick="if(event.target===this)updateState({showModal:null})"><div class="bg-card p-6 rounded-2xl border border-white/10 w-full max-w-sm animate-pop"><div class="flex justify-between items-center mb-6"><h3 class="text-xl font-bold text-white">Date à modifier</h3><button onclick="updateState({showModal:null})" class="text-dim"><i data-lucide="x" class="w-5 h-5"></i></button></div><input type="date" id="datePickerModal" value="${state.currentDate}" max="${state.currentDate}" class="w-full bg-main border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon mb-6"><button onclick="updateState({showModal:{type:'editDaySport',date:document.getElementById('datePickerModal').value}})" class="w-full py-4 rounded-xl font-bold text-main bg-neon uppercase tracking-wider">Continuer</button></div></div>`;
    if (state.showModal.type==='arenaPlayerStats') { return renderArenaPlayerModal(state.showModal.player); }
    if (state.showModal.type==='editDaySport') { const dateStr=state.showModal.date;const data=getDaySportData(dateStr);const colCount=Math.min(state.exercises.length,3);const inputsHtml=state.exercises.map(ex=>`<div><label class="block text-[10px] text-dim uppercase tracking-widest mb-2 text-center truncate">${ex.label}</label><input type="number" name="${ex.key}" value="${data[ex.key]||0}" min="0" class="w-full bg-main border border-white/10 rounded-xl px-2 py-3 text-white text-xl text-center font-black focus:border-neon focus:outline-none"></div>`).join('');return`<div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onclick="if(event.target===this)updateState({showModal:null})"><div class="bg-card p-6 rounded-2xl border border-white/10 w-full max-w-md animate-pop"><div class="flex justify-between items-center mb-6"><h3 class="text-xl font-bold text-white">Scores du ${dateStr}</h3><button onclick="updateState({showModal:null})" class="text-dim"><i data-lucide="x" class="w-5 h-5"></i></button></div><form onsubmit="event.preventDefault();const vals={};state.exercises.forEach(ex=>vals[ex.key]=this[ex.key].value);confirmEditDaySport('${dateStr}',vals);"><div class="grid grid-cols-${colCount} gap-4 mb-6">${inputsHtml}</div><button type="submit" class="w-full py-4 rounded-xl font-bold text-main bg-neon uppercase tracking-wider">Sauvegarder</button></form></div></div>`; }
    return '';
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function render() {
    const app = document.getElementById('app');
    if (!app) return;

    // ✅ Si un écran d'auth est actif, on l'affiche en priorité absolue
    if (state.authScreen) {
        app.innerHTML = renderAuthScreen();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    // Réinitialisation habitudes si nouveau jour
    if (state.lastHabitReset !== state.currentDate) {
        state.habits = state.habits.map(h => ({ ...h, done: false }));
        state.dailyTasks = [];
        state.lastHabitReset = state.currentDate;
        saveStateLocal();
        if (!state.activeQuest) generateNewQuest();
    }

    let content = '';
    switch(state.activeTab) {
        case 'sport':      content = renderSportTab();    break;
        case 'discipline': content = renderDiscipline();  break;
        case 'nutrition':  content = renderNutrition();   break;
        case 'menus':      content = renderMenus();       break;
        case 'journal':    content = renderJournal();     break;
        case 'vision':     content = renderVisionBoard(); break;
        case 'arena':      content = renderArena();       break;
        case 'success':    content = renderSuccessTab();  break;
        default:           content = renderDashboard();
    }

    app.innerHTML = `
        ${renderHeader()}
        ${renderTabs()}
        <input type="file" id="profilePicInput" accept="image/*" class="hidden" onchange="handleProfilePicUpload(event)">
        <main class="pb-28 md:pb-0">${content}</main>
        <footer class="mt-8 text-center text-dim text-xs pb-32 md:pb-8 flex flex-col md:flex-row justify-center items-center gap-4">
            <div class="flex flex-wrap justify-center items-center gap-3">
                <button onclick="exportData()" class="hover:text-white flex items-center gap-1 text-neon"><i data-lucide="download" class="w-3 h-3"></i> Sauvegarder</button>
                <span class="text-white/20">&bull;</span>
                <button onclick="triggerImport()" class="hover:text-white flex items-center gap-1 text-danger"><i data-lucide="upload" class="w-3 h-3"></i> Charger</button>
                <input type="file" id="importFile" accept=".json" class="hidden" onchange="importData(event)">
            </div>
            <div class="text-white/30">UD Board v7.0 — Cloud Sync</div>
        </footer>
        ${renderModal()}
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (state.activeTab === 'dashboard') setTimeout(initChart, 50);
}

// ─── COINS UI ──────────────────────────────────────────────────────────────────
let coinsUiReady = false;

function injectCoinsUiStyles() {
    if (document.getElementById('coins-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'coins-ui-style';
    style.textContent = `
        @keyframes coinPopIn {
            0% { opacity: 0; transform: translateY(-8px) scale(0.9); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes coinFloatUp {
            0% { opacity: 0; transform: translateY(0); }
            15% { opacity: 1; transform: translateY(-6px); }
            100% { opacity: 0; transform: translateY(-26px); }
        }
    `;
    document.head.appendChild(style);
}

function syncCoinsHeaderBadge() {
    const headerActions = document.querySelector('header .flex.items-center.gap-4.shrink-0');
    if (!headerActions) return;
    let badge = document.getElementById('coinsHeaderBadge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'coinsHeaderBadge';
        badge.className = 'px-3 py-1.5 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-300 text-sm font-black flex items-center gap-1.5';
        badge.style.animation = 'coinPopIn 180ms ease-out';
        badge.innerHTML = `<span>🪙</span><span id="coinsHeaderValue">0</span>`;
        headerActions.insertBefore(badge, headerActions.firstChild);
    }
    const valueEl = document.getElementById('coinsHeaderValue');
    if (valueEl) valueEl.textContent = (state.coins || 0).toLocaleString('fr-FR');
}

function showCoinsGainFx(amount) {
    if (!amount || amount <= 0) return;
    const fx = document.createElement('div');
    fx.className = 'fixed top-20 right-6 md:right-10 z-[1200] pointer-events-none text-yellow-300 font-black text-lg';
    fx.style.animation = 'coinFloatUp 900ms ease-out forwards';
    fx.textContent = `+${amount} 🪙`;
    document.body.appendChild(fx);
    setTimeout(() => { if (fx && fx.parentNode) fx.parentNode.removeChild(fx); }, 950);
}

function ensureCoinsUi() {
    if (coinsUiReady) return;
    coinsUiReady = true;
    injectCoinsUiStyles();

    const baseRender = render;
    render = function() {
        baseRender();
        syncCoinsHeaderBadge();
    };

    const baseUpdateState = updateState;
    updateState = function(patch) {
        const prevCoins = state.coins || 0;
        baseUpdateState(patch);
        const nextCoins = state.coins || 0;
        syncCoinsHeaderBadge();
        if (nextCoins > prevCoins) showCoinsGainFx(nextCoins - prevCoins);
    };
}

// ─── COINS PAR RÉPÉTITION ─────────────────────────────────────────────────────
let repsCoinsReady = false;

function ensureRepsCoins() {
    if (repsCoinsReady) return;
    repsCoinsReady = true;

    const baseAddExo = addExo;
    addExo = function(type, amount) {
        const before = (getDaySportData(state.currentDate)[type] || 0);
        baseAddExo(type, amount);
        const after = (getDaySportData(state.currentDate)[type] || 0);
        const gained = Math.max(0, after - before);
        if (gained > 0) addCoins(gained);
    };

    const baseConfirmEditSport = confirmEditSport;
    confirmEditSport = function(type, value, dateStr = state.currentDate) {
        const before = (getDaySportData(dateStr)[type] || 0);
        baseConfirmEditSport(type, value, dateStr);
        const after = (getDaySportData(dateStr)[type] || 0);
        const gained = Math.max(0, after - before);
        if (gained > 0) addCoins(gained);
    };

    const baseConfirmEditDaySport = confirmEditDaySport;
    confirmEditDaySport = function(dateStr, values) {
        const beforeData = getDaySportData(dateStr);
        let gained = 0;
        state.exercises.forEach(ex => {
            const before = beforeData[ex.key] || 0;
            const next = Math.max(0, parseInt(values[ex.key], 10) || 0);
            gained += Math.max(0, next - before);
        });
        baseConfirmEditDaySport(dateStr, values);
        if (gained > 0) addCoins(gained);
    };
}

window.addEventListener('DOMContentLoaded', ensureRepsCoins);
window.addEventListener('DOMContentLoaded', ensureCoinsUi);
window.addEventListener('DOMContentLoaded', init);

// ─── SHOP UI & LOGIC ───────────────────────────────────────────────────────────
const SHOP_CATALOG = {
    themes: [
        // NOUVEAU THÈME IMAGE
        { id: 'theme_latina', name: 'Latina', price: 1200, url: "Gemini_Generated_Image_.png" }
    ],
    effects: [
        { id: 'effect_explosion', name: 'Explosion', price: 600 },
        { id: 'effect_pizza_rain', name: 'Pluie de Pizza', price: 400 },
        { id: 'effect_dumbbell_rain', name: "Pluie d'Haltères", price: 450 },

    ],
    titles: [
        { id: 'title_beast', name: 'Maxi Gooner', price: 800 },
        { id: 'title_legend', name: 'Maxi Gooner Pro', price: 2000 },
        { id: 'title_maxi_gonner_pro_max', name: 'Maxi Gonner Pro Max', price: 900 }
    ],
    sounds: [
        { id: 'sound_pack_rigolo', name: 'FAHHHHHHHHHHHHHH', price: 400, audioFile: 'fahhhhhhhhhhhhhh.mp3' },
        { id: 'sound_pack_vine_boom', name: 'vine-boom', price: 0, audioFile: 'vine-boom.mp3' },
        { id: 'sound_dry_fart', name: 'dry-fart', price: 400, audioFile: 'dry-fart.mp3' },
        { id: 'sound_rizz_effect', name: 'rizz-sound-effect', price: 450, audioFile: 'rizz-sound-effect' },
    ]
};

let shopReady = false;
let shopOpen = false;

function getShopInventory() {
    if (!state.shopInventory || typeof state.shopInventory !== 'object') {
        state.shopInventory = { themes: [], effects: [], titles: [], sounds: [] };
    }
    if (!Array.isArray(state.shopInventory.themes)) state.shopInventory.themes = [];
    if (!Array.isArray(state.shopInventory.effects)) state.shopInventory.effects = [];
    if (!Array.isArray(state.shopInventory.titles)) state.shopInventory.titles = [];
    if (!Array.isArray(state.shopInventory.sounds)) state.shopInventory.sounds = [];
    return state.shopInventory;
}

function isShopOwned(category, itemId) {
    const inv = getShopInventory();
    return inv[category] && inv[category].includes(itemId);
}

function buyShopItem(category, itemId) {
    const items = SHOP_CATALOG[category] || [];
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const inv = getShopInventory();
    if (inv[category] && inv[category].includes(itemId)) return;
    if ((state.coins || 0) < item.price) return;
    
    const nextInvCategory = inv[category] ? [...inv[category], itemId] : [itemId];
    const nextInv = { ...inv, [category]: nextInvCategory };
    
    let nextPatch = { coins: (state.coins || 0) - item.price, shopInventory: nextInv };
    
    // Logique spécifique pour l'activation immédiate des thèmes image
    if (category === 'themes' && item.url) {
        nextPatch.activeImageThemeUrl = item.url;
    }
    
    updateState(nextPatch);
    
    // Application immédiate du thème visuel
    if (category === 'themes' && item.url) {
        applyPersistentImageTheme();
    }
}

function createShopItemRow(category, item) {
    const owned = isShopOwned(category, item.id);
    return `
        <div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-main/50 border border-white/10">
            <div class="min-w-0">
                <div class="text-white font-bold text-sm truncate">${item.name}</div>
                <div class="text-yellow-300 text-xs font-bold mt-1">${item.price} 🪙</div>
            </div>
            <button ${owned ? 'disabled' : ''} onclick="buyShopItem('${category}','${item.id}')" class="${owned ? 'bg-white/10 text-dim cursor-default' : 'bg-neon text-main hover:bg-neon/90'} px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition">
                ${owned ? 'Acheté' : 'Acheter'}
            </button>
        </div>
    `;
}

function renderShopPanel() {
    const existing = document.getElementById('shopPanelMount');
    if (existing) existing.remove();
    const mount = document.createElement('div');
    mount.id = 'shopPanelMount';
    mount.className = 'fixed right-4 bottom-24 md:bottom-6 z-[1100]';
    const themesHtml = SHOP_CATALOG.themes.map(i => createShopItemRow('themes', i)).join('');
    const effectsHtml = SHOP_CATALOG.effects.map(i => createShopItemRow('effects', i)).join('');
    const titlesHtml = SHOP_CATALOG.titles.map(i => createShopItemRow('titles', i)).join('');
    const soundsHtml = SHOP_CATALOG.sounds.map(i => createShopItemRow('sounds', i)).join('');
    
    mount.innerHTML = `
        <div class="flex flex-col items-end gap-3">
            ${shopOpen ? `
            <div class="w-[320px] max-w-[92vw] bg-card border border-white/10 rounded-2xl shadow-2xl p-4 max-h-[70vh] overflow-y-auto">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-white font-black uppercase tracking-wider text-sm">Shop</h3>
                    <div class="text-yellow-300 text-xs font-black">${(state.coins || 0).toLocaleString('fr-FR')} 🪙</div>
                </div>
                <div class="space-y-2 mb-4">
                    <div class="text-[10px] text-dim uppercase tracking-widest font-bold">Thèmes</div>
                    ${themesHtml}
                </div>
                <div class="space-y-2 mb-4">
                    <div class="text-[10px] text-dim uppercase tracking-widest font-bold">Packs sonores</div>
                    ${soundsHtml}
                </div>
                <div class="space-y-2 mb-4">
                    <div class="text-[10px] text-dim uppercase tracking-widest font-bold">Effets</div>
                    ${effectsHtml}
                </div>
                <div class="space-y-2">
                    <div class="text-[10px] text-dim uppercase tracking-widest font-bold">Titres</div>
                    ${titlesHtml}
                </div>
            </div>
            ` : ''}
            <button id="shopToggleBtn" class="bg-yellow-400 text-main px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider shadow-[0_10px_30px_rgba(250,204,21,0.35)] hover:scale-105 transition-transform">
                Shop 🪙
            </button>
        </div>
    `;
    document.body.appendChild(mount);
    const btn = document.getElementById('shopToggleBtn');
    if (btn) btn.addEventListener('click', () => { shopOpen = !shopOpen; renderShopPanel(); });
}

function ensureShopFeature() {
    if (shopReady) return;
    shopReady = true;
    getShopInventory();
    const baseRender = render;
    render = function() {
        baseRender();
        renderShopPanel();
    };
}

window.buyShopItem = buyShopItem;
window.addEventListener('DOMContentLoaded', ensureShopFeature);

// ─── SYNC REPS -> XP + COINS ──────────────────────────────────────────────────
let repsSyncReady = false;

function syncCoinsWithReps(oldReps, newReps) {
    const prev = Math.max(0, parseInt(oldReps, 10) || 0);
    const next = Math.max(0, parseInt(newReps, 10) || 0);
    const delta = next - prev;
    if (delta === 0) return 0;
    addXp(delta);
    addCoins(delta);
    return delta;
}

function ensureRepsSync() {
    if (repsSyncReady) return;
    repsSyncReady = true;

    const prevAddExo = addExo;
    addExo = function(type, amount) {
        const oldReps = (getDaySportData(state.currentDate)[type] || 0);
        prevAddExo(type, amount);
        const newReps = (getDaySportData(state.currentDate)[type] || 0);
        const delta = newReps - oldReps;
        syncCoinsWithReps(oldReps, newReps);
        if (delta > 0) addCoins(-delta);
    };

    const prevConfirmEditSport = confirmEditSport;
    confirmEditSport = function(type, value, dateStr = state.currentDate) {
        const oldReps = (getDaySportData(dateStr)[type] || 0);
        prevConfirmEditSport(type, value, dateStr);
        const newReps = (getDaySportData(dateStr)[type] || 0);
        const delta = newReps - oldReps;
        syncCoinsWithReps(oldReps, newReps);
        if (delta > 0) addCoins(-delta);
    };

    const prevConfirmEditDaySport = confirmEditDaySport;
    confirmEditDaySport = function(dateStr, values) {
        const oldData = getDaySportData(dateStr);
        let positiveDelta = 0;
        let totalOld = 0;
        let totalNew = 0;
        state.exercises.forEach(ex => {
            const before = Math.max(0, parseInt(oldData[ex.key], 10) || 0);
            const after = Math.max(0, parseInt(values[ex.key], 10) || 0);
            totalOld += before;
            totalNew += after;
            positiveDelta += Math.max(0, after - before);
        });
        prevConfirmEditDaySport(dateStr, values);
        syncCoinsWithReps(totalOld, totalNew);
        if (positiveDelta > 0) addCoins(-positiveDelta);
    };
}

window.syncCoinsWithReps = syncCoinsWithReps;
window.addEventListener('DOMContentLoaded', ensureRepsSync);

// ─── SHOP PREVIEW ──────────────────────────────────────────────────────────────
let shopPreviewReady = false;
let activeShopPreview = null;
let shopPreviewSnapshot = null;

function showShopPreviewFeedback(text) {
    const el = document.createElement('div');
    el.className = 'fixed left-1/2 -translate-x-1/2 top-6 z-[1300] bg-white text-main px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider shadow-2xl';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%, -8px)'; el.style.transition = 'all 220ms ease'; }, 900);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
}

function applyThemePreview(item) {
    const body = document.body;
    if (!shopPreviewSnapshot) {
        shopPreviewSnapshot = {
            filter: body.style.filter || '',
            boxShadow: body.style.boxShadow || '',
            bg: body.style.background || '',
            bgSize: body.style.backgroundSize || '',
            bgAttachment: body.style.backgroundAttachment || '',
            bgPosition: body.style.backgroundPosition || ''
        };
    }
    
    // Logique pour les thèmes Image (Latina)
    if (item.url) {
        body.style.backgroundImage = `url('${item.url}')`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundAttachment = 'fixed';
        body.style.backgroundPosition = 'top';
    } 
    // Logique pour les thèmes de filtres existants
    else if (item.name === 'Feu') {
        body.style.filter = 'saturate(1.15) hue-rotate(-18deg)';
        body.style.boxShadow = 'inset 0 0 180px rgba(255,80,0,0.15)';
    } else if (item.name === 'Gold') {
        body.style.filter = 'saturate(1.25) hue-rotate(8deg)';
        body.style.boxShadow = 'inset 0 0 180px rgba(255,215,0,0.16)';
    } else if (item.name === 'Cyber') {
        body.style.filter = 'saturate(1.2) hue-rotate(38deg)';
        body.style.boxShadow = 'inset 0 0 180px rgba(0,255,255,0.12)';
    }
}

function applyEffectPreview(name) {
    if (name === 'Confettis') {
        confetti({ particleCount: 180, spread: 120, origin: { y: 0.6 }, zIndex: 1200 });
    } else if (name === 'Explosion') {
        confetti({ particleCount: 260, spread: 180, startVelocity: 55, origin: { y: 0.55 }, zIndex: 1200, colors: ['#ff3b3b', '#ffd700', '#ffffff'] });
    }
}

function applySoundPreview(name) {
    if (name === 'Cyber') playSound('epic');
    else if (name === 'Gold') playSound('levelUp');
    else playSound('pop');
}

function applyTitlePreview(name) {
    const host = document.querySelector('header .z-10.mb-6.md\\:mb-0.text-center.md\\:text-left.flex-1.w-full');
    if (!host) return;
    let titleEl = document.getElementById('shopPreviewTitleTag');
    if (!titleEl) {
        titleEl = document.createElement('div');
        titleEl.id = 'shopPreviewTitleTag';
        titleEl.className = 'mt-2 text-[10px] uppercase tracking-widest font-black text-gold bg-gold/10 border border-gold/30 inline-flex px-2 py-1 rounded';
        host.appendChild(titleEl);
    }
    titleEl.textContent = name;
}

function clearTitlePreview() {
    const el = document.getElementById('shopPreviewTitleTag');
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function previewShopItem(category, itemId) {
    const items = SHOP_CATALOG[category] || [];
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    cancelShopPreview(false);
    activeShopPreview = { category, itemId };
    if (category === 'themes') {
        applyThemePreview(item);
        applySoundPreview(item.name);
    } else if (category === 'effects') {
        applyEffectPreview(item.name);
    } else if (category === 'titles') {
        applyTitlePreview(item.name);
    }
    showShopPreviewFeedback(`Prévisualisation: ${item.name}`);
    renderShopPanel();
}

function cancelShopPreview(withFeedback = true) {
    const body = document.body;
    if (shopPreviewSnapshot) {
        body.style.filter = shopPreviewSnapshot.filter;
        body.style.boxShadow = shopPreviewSnapshot.boxShadow;
        body.style.background = shopPreviewSnapshot.bg;
        body.style.backgroundSize = shopPreviewSnapshot.bgSize;
        body.style.backgroundAttachment = shopPreviewSnapshot.bgAttachment;
        body.style.backgroundPosition = shopPreviewSnapshot.bgPosition;
    }
    clearTitlePreview();
    activeShopPreview = null;
    if (withFeedback) showShopPreviewFeedback('Prévisualisation annulée');
    renderShopPanel();
}

function isItemPreviewed(category, itemId) {
    return !!activeShopPreview && activeShopPreview.category === category && activeShopPreview.itemId === itemId;
}

function ensureShopPreviewFeature() {
    if (shopPreviewReady) return;
    shopPreviewReady = true;

    // Logique de rendu des boutons déplacée dans ensureShopTitleVisibilityFix pour cohérence
}

window.previewShopItem = previewShopItem;
window.cancelShopPreview = cancelShopPreview;
window.addEventListener('DOMContentLoaded', ensureShopPreviewFeature);

// ─── SHOP PREVIEW LAYOUT FIX ──────────────────────────────────────────────────
let shopPreviewLayoutFixReady = false;

function ensureShopPreviewLayoutStyles() {
    if (document.getElementById('shop-preview-layout-fix-style')) return;
    const style = document.createElement('style');
    style.id = 'shop-preview-layout-fix-style';
    style.textContent = `
        #shopPreviewOverlay {
            position: fixed;
            left: 16px;
            bottom: 16px;
            z-index: 1350;
            width: min(360px, calc(100vw - 32px));
        }
    `;
    document.head.appendChild(style);
}

function getShopItemByName(name) {
    const all = [
        ...SHOP_CATALOG.themes.map(i => ({ ...i, category: 'themes' })),
        ...SHOP_CATALOG.effects.map(i => ({ ...i, category: 'effects' })),
        ...SHOP_CATALOG.titles.map(i => ({ ...i, category: 'titles' })),
        ...SHOP_CATALOG.sounds.map(i => ({ ...i, category: 'sounds' })),
    ];
    return all.find(i => i.name === name) || null;
}

function renderShopPreviewOverlay() {
    const existing = document.getElementById('shopPreviewOverlay');
    if (existing) existing.remove();
    if (!activeShopPreview) return;
    const item = (SHOP_CATALOG[activeShopPreview.category] || []).find(i => i.id === activeShopPreview.itemId);
    if (!item) return;
    const el = document.createElement('div');
    el.id = 'shopPreviewOverlay';
    el.innerHTML = `
        <div class="bg-card border border-white/15 rounded-2xl p-4 shadow-2xl backdrop-blur">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div>
                    <div class="text-[10px] uppercase tracking-widest text-dim font-bold">Prévisualisation</div>
                    <div class="text-white font-black text-sm mt-1">${item.name}</div>
                </div>
                <button onclick="cancelShopPreview()" class="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide">Fermer</button>
            </div>
            <div class="text-dim text-xs">
                ${activeShopPreview.category === 'themes' ? 'Aperçu du thème (visuel) et son de démonstration.' : ''}
                ${activeShopPreview.category === 'effects' ? 'Aperçu effet visuel temporaire.' : ''}
                ${activeShopPreview.category === 'titles' ? 'Aperçu du titre temporaire sous le pseudo.' : ''}
                ${activeShopPreview.category === 'sounds' ? 'Lecture du son de démonstration.' : ''}
            </div>
        </div>
    `;
    document.body.appendChild(el);
}

const _prevRenderShopPanelPreviewFix = renderShopPanel;
renderShopPanel = function() {
    _prevRenderShopPanelPreviewFix();
    renderShopPreviewOverlay();
};

window.addEventListener('DOMContentLoaded', () => { ensureShopPreviewLayoutStyles(); });

// ─── SHOP PREVIEW ACTIVATION (SOUNDS + VISUALS) ───────────────────────────────
let shopPreviewActivationReady = false;

function playPreviewSoundPack(name) {
    // Cette fonction est conservée pour compatibilité mais la logique est gérée par Single Global Audio
}

function runVisualPreview(name) {
    try {
        if (name === 'Explosion de Ballons') {
            confetti({ particleCount: 180, spread: 140, origin: { y: 0.62 }, zIndex: 1400, colors: ['#ff4d6d', '#ffd166', '#4ecdc4', '#ffffff'] });
        } else if (name === 'Étoiles Filantes') {
            confetti({ particleCount: 150, angle: 60, spread: 70, origin: { x: 0, y: 0.35 }, zIndex: 1400, colors: ['#ffffff', '#ffe66d', '#a0c4ff'] });
            confetti({ particleCount: 150, angle: 120, spread: 70, origin: { x: 1, y: 0.35 }, zIndex: 1400, colors: ['#ffffff', '#ffe66d', '#a0c4ff'] });
        } else if (name === 'Pluie de Pizza') {
            // Géré par pizza rain logic
        } else if (name === "Pluie d'Haltères") {
            // Géré par dumbbell rain logic
        } else if (name === 'Confettis Arc-en-ciel') {
            confetti({ particleCount: 260, spread: 160, origin: { y: 0.58 }, zIndex: 1400, colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'] });
        }
    } catch(e) {}
}

const _prevPreviewShopItemActivation = previewShopItem;
previewShopItem = function(category, itemId) {
    _prevPreviewShopItemActivation(category, itemId);
    const item = (SHOP_CATALOG[category] || []).find(i => i.id === itemId);
    if (!item) return;
    if (category === 'effects') runVisualPreview(item.name);
};

// ─── PIZZA RAIN PREVIEW ────────────────────────────────────────────────────────
let pizzaPreviewTimer = null;

function removePizzaRainPreview() {
    const layer = document.getElementById('pizzaRainPreviewLayer');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    if (pizzaPreviewTimer) {
        clearTimeout(pizzaPreviewTimer);
        pizzaPreviewTimer = null;
    }
}

function spawnPizzaPiece(container) {
    const pizza = document.createElement('div');
    pizza.textContent = '🍕';
    pizza.style.position = 'absolute';
    pizza.style.left = `${Math.random() * 100}%`;
    pizza.style.top = '-10%';
    pizza.style.fontSize = `${28 + Math.random() * 24}px`;
    pizza.style.opacity = `${0.85 + Math.random() * 0.15}`;
    pizza.style.willChange = 'transform, top, left, opacity';
    pizza.style.transition = `transform ${3 + Math.random() * 2}s linear, top ${3 + Math.random() * 2}s linear, left ${3 + Math.random() * 2}s ease-in-out, opacity ${3 + Math.random() * 2}s linear`;
    pizza.style.pointerEvents = 'none';
    pizza.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.25))';
    container.appendChild(pizza);
    requestAnimationFrame(() => {
        pizza.style.top = '112%';
        pizza.style.left = `${Math.max(0, Math.min(100, (parseFloat(pizza.style.left) + (Math.random() * 24 - 12))))}%`;
        pizza.style.transform = `rotate(${Math.random() * 1080 - 540}deg)`;
        pizza.style.opacity = '0.95';
    });
    setTimeout(() => { if (pizza.parentNode) pizza.parentNode.removeChild(pizza); }, 5600);
}

function runPizzaRainPreview() {
    removePizzaRainPreview();
    const layer = document.createElement('div');
    layer.id = 'pizzaRainPreviewLayer';
    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.zIndex = '1450';
    layer.style.pointerEvents = 'none';
    layer.style.overflow = 'hidden';
    document.body.appendChild(layer);

    for (let i = 0; i < 26; i++) {
        setTimeout(() => spawnPizzaPiece(layer), i * 120);
    }

    pizzaPreviewTimer = setTimeout(removePizzaRainPreview, 5200);
}

const _prevRunVisualPreviewPizza = runVisualPreview;
runVisualPreview = function(name) {
    _prevRunVisualPreviewPizza(name);
    if (name === 'Pluie de Pizza') runPizzaRainPreview();
};

const _prevCancelShopPreviewPizza = cancelShopPreview;
cancelShopPreview = function(withFeedback = true) {
    removePizzaRainPreview();
    _prevCancelShopPreviewPizza(withFeedback);
};

// ─── DUMBBELL RAIN PREVIEW ─────────────────────────────────────────────────────
let dumbbellPreviewTimer = null;

function removeDumbbellRainPreview() {
    const layer = document.getElementById('dumbbellRainPreviewLayer');
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    if (dumbbellPreviewTimer) {
        clearTimeout(dumbbellPreviewTimer);
        dumbbellPreviewTimer = null;
    }
}

function spawnDumbbellPiece(container) {
    const dumbbell = document.createElement('div');
    dumbbell.textContent = '🏋️';
    dumbbell.style.position = 'absolute';
    dumbbell.style.left = `${Math.random() * 100}%`;
    dumbbell.style.top = '-12%';
    dumbbell.style.fontSize = `${26 + Math.random() * 20}px`;
    dumbbell.style.opacity = `${0.82 + Math.random() * 0.18}`;
    dumbbell.style.willChange = 'transform, top, left, opacity';
    dumbbell.style.transition = `transform ${3.2 + Math.random() * 2.1}s linear, top ${3.2 + Math.random() * 2.1}s linear, left ${3.2 + Math.random() * 2.1}s ease-in-out, opacity ${3.2 + Math.random() * 2.1}s linear`;
    dumbbell.style.pointerEvents = 'none';
    dumbbell.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.28))';
    container.appendChild(dumbbell);
    requestAnimationFrame(() => {
        dumbbell.style.top = '114%';
        dumbbell.style.left = `${Math.max(0, Math.min(100, (parseFloat(dumbbell.style.left) + (Math.random() * 26 - 13))))}%`;
        dumbbell.style.transform = `rotate(${Math.random() * 1200 - 600}deg)`;
        dumbbell.style.opacity = '0.96';
    });
    setTimeout(() => { if (dumbbell.parentNode) dumbbell.parentNode.removeChild(dumbbell); }, 5900);
}

function runDumbbellRainPreview() {
    removeDumbbellRainPreview();
    const layer = document.createElement('div');
    layer.id = 'dumbbellRainPreviewLayer';
    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.zIndex = '1451';
    layer.style.pointerEvents = 'none';
    layer.style.overflow = 'hidden';
    document.body.appendChild(layer);

    for (let i = 0; i < 24; i++) {
        setTimeout(() => spawnDumbbellPiece(layer), i * 130);
    }

    dumbbellPreviewTimer = setTimeout(removeDumbbellRainPreview, 5400);
}

const _prevRunVisualPreviewDumbbell = runVisualPreview;
runVisualPreview = function(name) {
    _prevRunVisualPreviewDumbbell(name);
    if (name === "Pluie d'Haltères") runDumbbellRainPreview();
};

const _prevCancelShopPreviewDumbbell = cancelShopPreview;
cancelShopPreview = function(withFeedback = true) {
    removeDumbbellRainPreview();
    _prevCancelShopPreviewDumbbell(withFeedback);
};

// ─── STOP DYNAMIC PREVIEW AUDIO helper ────────────────────────────────────────
function stopDynamicPreviewAudio() {
    // Cette fonction est conservée pour compatibilité mais la logique est centralisée
}

// ─── AUDIO PREVIEW CONFLICT FIX helper ────────────────────────────────────────
function stopShopAudioPreview() {
    // Cette fonction est conservée pour compatibilité mais la logique est centralisée
}

// ─── SINGLE GLOBAL AUDIO PREVIEW (SHOP) ───────────────────────────────────────
const shopGlobalPreviewAudio = new Audio();
shopGlobalPreviewAudio.preload = 'auto';

function stopGlobalShopPreviewAudio() {
    try {
        shopGlobalPreviewAudio.pause();
        shopGlobalPreviewAudio.currentTime = 0;
    } catch(e) {}
}

function playGlobalShopPreviewAudio(audioFile) {
    if (!audioFile) return false;
    try {
        stopGlobalShopPreviewAudio();
        // Sécurité extension
        let src = String(audioFile);
        if (!src.endsWith('.mp3') && !src.includes('.')) src += '.mp3';
        
        shopGlobalPreviewAudio.src = src;
        shopGlobalPreviewAudio.load();
        shopGlobalPreviewAudio.play().catch(() => {});
        return true;
    } catch(e) {
        return false;
    }
}

function getSoundItemById(itemId) {
    return (SHOP_CATALOG.sounds || []).find(i => i && i.id === itemId) || null;
}

const _prevPreviewShopItemGlobalAudio = previewShopItem;
previewShopItem = function(category, itemId) {
    _prevPreviewShopItemGlobalAudio(category, itemId);
    if (category !== 'sounds') return;
    const item = getSoundItemById(itemId);
    if (!item) return;
    const audioFile = item.audioFile || item.file || item.url || '';
    playGlobalShopPreviewAudio(audioFile);
};

const _prevCancelShopPreviewGlobalAudio = cancelShopPreview;
cancelShopPreview = function(withFeedback = true) {
    stopGlobalShopPreviewAudio();
    _prevCancelShopPreviewGlobalAudio(withFeedback);
};

// ─── SHOP TITLE VISIBILITY FIX ────────────────────────────────────────────────
let shopTitleVisibilityFixReady = false;

function applyShopTitleVisibilityFix() {
    const panel = document.getElementById('shopPanelMount');
    if (!panel) return;

    const rows = panel.querySelectorAll('.bg-main\\/50.border.border-white\\/10.rounded-xl');
    rows.forEach(row => {
        // Nettoyage anciens boutons de prévisualisation injectés
        row.querySelectorAll('button[data-preview-inline="1"]').forEach(b => b.remove());

        const titleEl = row.querySelector('.text-white.font-bold.text-sm');
        if (titleEl) {
            titleEl.classList.remove('truncate');
            titleEl.style.whiteSpace = 'normal';
            titleEl.style.wordBreak = 'break-word';
            titleEl.style.lineHeight = '1.2';
            titleEl.style.maxWidth = '100%';
        }

        const actions = row.querySelector('button')?.parentElement;
        if (!actions) return;

        const itemName = (titleEl?.textContent || '').trim();
        const item = getShopItemByName(itemName);
        if (!item) return;

        actions.style.display = 'flex';
        actions.style.flexDirection = 'column';
        actions.style.gap = '6px';
        actions.style.alignItems = 'stretch';
        actions.style.flexShrink = '0';

        // Injection bouton prévisualisation
        const btn = document.createElement('button');
        btn.setAttribute('data-preview-inline', '1');
        const isPreviewing = isItemPreviewed(item.category, item.id);
        
        btn.className = `${isPreviewing ? 'bg-white text-main' : 'bg-white/10 text-white hover:bg-white/20'} px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition`;
        btn.textContent = isPreviewing ? 'Annuler' : 'Prévisualiser';
        btn.onclick = () => {
            if (isPreviewing) cancelShopPreview();
            else previewShopItem(item.category, item.id);
        };
        actions.insertBefore(btn, actions.firstChild);
    });
}

const _prevRenderShopPanelVisibilityFix = renderShopPanel;
renderShopPanel = function() {
    _prevRenderShopPanelVisibilityFix();
    applyShopTitleVisibilityFix();
};

// ─── SOUND PREVIEW SINGLE-APPLY FIX ───────────────────────────────────────────
// Intégré directement dans la logique Single Global Audio ci-dessus

// ─── GLOBAL BUTTON SOUND (EQUIPPED SOUND PACK) ────────────────────────────────
let globalButtonSoundReady = false;

function equipActiveSoundPack(itemId) {
    updateState({ activeSoundPack: itemId });
    if (typeof renderShopPanel === 'function') renderShopPanel();
}

function unequipActiveSoundPack() {
    updateState({ activeSoundPack: null });
    if (typeof renderShopPanel === 'function') renderShopPanel();
}

function playEquippedSoundPack() {
    if (!state.activeSoundPack || state.showModal) return;
    
    const sounds = SHOP_CATALOG.sounds || [];
    const item = sounds.find(s => s.id === state.activeSoundPack);
    
    if (item && (item.audioFile || item.file || item.url)) {
        try {
            let src = item.audioFile || item.file || item.url;
            if (!src.endsWith('.mp3') && !src.includes('.')) src += '.mp3';
            
            const a = new Audio(src);
            a.volume = 1;
            a.play().catch(() => {});
        } catch(e) {}
    }
}

function ensureGlobalButtonSound() {
    if (globalButtonSoundReady) return;
    globalButtonSoundReady = true;

    // 1. Écoute globale clics boutons
    document.addEventListener('click', function(e) {
        if (e.target.closest('button')) {
            // Pas de son si on clique dans le shop (conflit précoute)
            if (e.target.closest('#shopPanelMount')) return;
            setTimeout(playEquippedSoundPack, 10);
        }
    });

    // 2. Rendu boutons sélection shop
    const _prevRenderShopPanelGlobalSound = renderShopPanel;
    renderShopPanel = function() {
        _prevRenderShopPanelGlobalSound();
        const panel = document.getElementById('shopPanelMount');
        if (!panel) return;

        const rows = panel.querySelectorAll('.bg-main\\/50.border.border-white\\/10.rounded-xl');
        rows.forEach(row => {
            const titleEl = row.querySelector('.text-white.font-bold.text-sm');
            if (!titleEl) return;
            const itemName = (titleEl.textContent || '').trim();
            const item = (SHOP_CATALOG.sounds || []).find(s => s.name === itemName);

            if (item) {
                const actions = row.querySelector('button')?.parentElement;
                if (!actions) return;

                const inv = getShopInventory();
                const isOwned = inv.sounds && inv.sounds.includes(item.id);

                if (isOwned) {
                    const isEquipped = state.activeSoundPack === item.id;
                    if (!actions.querySelector('[data-equip-sound-btn]')) {
                        const equipBtn = document.createElement('button');
                        equipBtn.setAttribute('data-equip-sound-btn', '1');
                        equipBtn.className = isEquipped
                            ? 'bg-neon text-main px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition mt-1'
                            : 'bg-white/10 text-white hover:bg-white/20 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition mt-1';
                        equipBtn.textContent = isEquipped ? 'Sélectionné' : 'Sélectionner';
                        equipBtn.onclick = (e) => {
                            e.stopPropagation();
                            if (isEquipped) unequipActiveSoundPack();
                            else equipActiveSoundPack(item.id);
                        };
                        actions.appendChild(equipBtn);
                    }
                }
            }
        });
    };
}

window.addEventListener('DOMContentLoaded', ensureGlobalButtonSound);

// ─── INITIALISATION THEME IMAGE PERSISTANT ────────────────────────────────────
function applyPersistentImageTheme() {
    if (state.activeImageThemeUrl) {
        const body = document.body;
        body.style.backgroundImage = `url('${state.activeImageThemeUrl}')`;
        
        // --- LES CHANGEMENTS ICI ---
        
        // 1. On autorise la répétition (mosaïque)
        body.style.backgroundRepeat = 'repeat'; 
        
        // 2. On définit la taille d'un "carreau". 
        // 300px est une bonne taille, mais vous pouvez mettre 200px (plus petit) ou 500px (plus grand)
        body.style.backgroundSize = '300px'; 
        
        // 3. On peut laisser 'fixed' pour que le motif ne bouge pas quand on scrolle, 
        // ou mettre 'scroll' pour qu'il bouge avec la page.
        body.style.backgroundAttachment = 'fixed'; 

        // ---------------------------

        body.classList.add('has-image-theme');

        // On garde la transparence pour que le texte reste lisible par-dessus les images répétées
        if (!document.getElementById('theme-dynamic-style')) {
            const style = document.createElement('style');
            style.id = 'theme-dynamic-style';
            style.textContent = `
                .has-image-theme .bg-card { 
                    background-color: rgba(26, 29, 36, 0.7) !important; 
                    backdrop-filter: blur(5px);
                }
                .has-image-theme {
                    background-color: #1a1d24 !important;
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// ─── QUETE SECONDAIRE JOURNALIERE (EXTENSION) ─────────────────────────────────
const SECONDARY_DAILY_QUESTS = [
    "Va marcher jusqu'a une vache et prends-toi en photo 🐄",
    "Prends une douche froide",
    "Passe 1h sans aucune distraction (mode avion)",
    "Lis 10 pages d'un livre",
    "Ne te plains de rien pendant 24h",
    "Fais 1h de deep work sans interruption totale",
    "Passe la journee sans telephone",
    "Va t'asseoir seul avec tes pensees pendant 30 minutes (aucun stimulus)",
    "Chaque fois que tu procrastines -> 10 pompes",
    "Note chaque distraction que tu as pendant 1h",
    "Passe 3h sans aucun stimulus (pas de musique, telephone, sucre, video)",
    "Evite toute gratification instantanee pendant 6h",
    "Pas de chaise aujourd'hui",
    "Planifie ta journee a la minute pres et respecte-la",
    "Fais une tache importante des le reveil"
];

const SECONDARY_DAILY_QUEST_XP = 120;
const SECONDARY_DAILY_QUEST_COINS = 180;
const SECONDARY_DAILY_QUEST_STORAGE_KEY = 'udb_secondary_daily_quest';

function normalizeSecondaryDailyQuest(raw) {
    const fallback = {
        date: state.currentDate,
        questId: 'sq_0',
        title: SECONDARY_DAILY_QUESTS[0],
        accepted: false,
        completed: false,
        claimed: false,
        xp: SECONDARY_DAILY_QUEST_XP,
        coins: SECONDARY_DAILY_QUEST_COINS
    };
    if (!raw || typeof raw !== 'object') return fallback;
    return {
        date: typeof raw.date === 'string' ? raw.date : state.currentDate,
        questId: typeof raw.questId === 'string' ? raw.questId : fallback.questId,
        title: typeof raw.title === 'string' ? raw.title : fallback.title,
        accepted: !!raw.accepted,
        completed: !!raw.completed,
        claimed: !!raw.claimed,
        xp: Number.isFinite(raw.xp) ? Math.max(1, Math.floor(raw.xp)) : fallback.xp,
        coins: Number.isFinite(raw.coins) ? Math.max(1, Math.floor(raw.coins)) : fallback.coins
    };
}

function pickRandomSecondaryDailyQuest(excludedQuestId = null) {
    const pool = SECONDARY_DAILY_QUESTS.map((title, idx) => ({ questId: `sq_${idx}`, title }))
        .filter(q => q.questId !== excludedQuestId);
    const selected = pool[Math.floor(Math.random() * pool.length)] || { questId: 'sq_0', title: SECONDARY_DAILY_QUESTS[0] };
    return {
        date: state.currentDate,
        questId: selected.questId,
        title: selected.title,
        accepted: false,
        completed: false,
        claimed: false,
        xp: SECONDARY_DAILY_QUEST_XP,
        coins: SECONDARY_DAILY_QUEST_COINS
    };
}

function saveSecondaryDailyQuestLocal() {
    try {
        localStorage.setItem(SECONDARY_DAILY_QUEST_STORAGE_KEY, JSON.stringify(state.secondaryDailyQuest || null));
    } catch(e) {}
}

function loadSecondaryDailyQuestLocal() {
    try {
        const raw = localStorage.getItem(SECONDARY_DAILY_QUEST_STORAGE_KEY);
        if (!raw) return null;
        return normalizeSecondaryDailyQuest(JSON.parse(raw));
    } catch(e) {
        return null;
    }
}

function ensureSecondaryDailyQuestFresh(forceReplace = false) {
    let current = normalizeSecondaryDailyQuest(state.secondaryDailyQuest || loadSecondaryDailyQuestLocal());
    const mustRotate = forceReplace || !current || current.date !== state.currentDate;
    if (mustRotate) {
        current = pickRandomSecondaryDailyQuest(current ? current.questId : null);
    }
    state.secondaryDailyQuest = current;
    saveSecondaryDailyQuestLocal();
}

function acceptSecondaryDailyQuest() {
    ensureSecondaryDailyQuestFresh(false);
    if (!state.secondaryDailyQuest) return;
    state.secondaryDailyQuest = { ...state.secondaryDailyQuest, accepted: true };
    saveSecondaryDailyQuestLocal();
    render();
}

function refuseSecondaryDailyQuest() {
    ensureSecondaryDailyQuestFresh(true);
    render();
}

function completeSecondaryDailyQuest() {
    ensureSecondaryDailyQuestFresh(false);
    const sq = state.secondaryDailyQuest;
    if (!sq || !sq.accepted || sq.claimed) return;
    state.secondaryDailyQuest = { ...sq, completed: true };
    saveSecondaryDailyQuestLocal();
    render();
}

function claimSecondaryDailyQuestReward() {
    ensureSecondaryDailyQuestFresh(false);
    const sq = state.secondaryDailyQuest;
    if (!sq || !sq.accepted || !sq.completed || sq.claimed) return;
    playSound('epic');
    addXp(sq.xp);
    addCoins(sq.coins);
    confetti({ particleCount: 220, spread: 120, origin: { y: 0.45 }, colors: ['#ffd700', '#00ff88', '#ffffff'], zIndex: 1000 });
    state.secondaryDailyQuest = { ...sq, claimed: true };
    saveSecondaryDailyQuestLocal();
    render();
}

function renderSecondaryDailyQuestCard() {
    ensureSecondaryDailyQuestFresh(false);
    const sq = state.secondaryDailyQuest;
    if (!sq) return '';

    let actions = '';
    let status = '<span class="text-[10px] uppercase tracking-widest text-dim font-bold">Mission du jour</span>';

    if (sq.claimed) {
        status = '<span class="text-[10px] uppercase tracking-widest text-neon font-bold">Mission validee</span>';
        actions = `
            <div class="text-xs text-dim">Reviens demain pour une nouvelle mission secondaire.</div>
        `;
    } else if (!sq.accepted) {
        actions = `
            <div class="flex flex-col sm:flex-row gap-2 mt-4">
                <button onclick="acceptSecondaryDailyQuest()" class="bg-neon text-main px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider">Accepter</button>
                <button onclick="refuseSecondaryDailyQuest()" class="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition">Refuser</button>
            </div>
        `;
    } else if (!sq.completed) {
        status = '<span class="text-[10px] uppercase tracking-widest text-gold font-bold">Mission acceptee</span>';
        actions = `
            <div class="flex flex-col sm:flex-row gap-2 mt-4">
                <button onclick="completeSecondaryDailyQuest()" class="bg-gold text-main px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider">Mission accomplie</button>
                <button onclick="refuseSecondaryDailyQuest()" class="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition">Changer mission</button>
            </div>
        `;
    } else {
        status = '<span class="text-[10px] uppercase tracking-widest text-neon font-bold">Mission terminee</span>';
        actions = `
            <div class="flex flex-col sm:flex-row gap-2 mt-4">
                <button onclick="claimSecondaryDailyQuestReward()" class="bg-neon text-main px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider">Reclamer +${sq.xp} XP / +${sq.coins} 🪙</button>
            </div>
        `;
    }

    return `
        <div class="bg-card p-5 rounded-2xl border border-neon/25 animate-fade-in">
            <div class="flex items-center justify-between gap-3 mb-3">
                <div class="flex items-center gap-2">
                    <i data-lucide="flag" class="w-4 h-4 text-neon"></i>
                    ${status}
                </div>
                <div class="text-[10px] uppercase tracking-widest text-dim font-bold">+${sq.xp} XP · +${sq.coins} 🪙</div>
            </div>
            <p class="text-white font-bold leading-snug">${sq.title}</p>
            ${actions}
        </div>
    `;
}

function injectSecondaryDailyQuestInDashboard(html) {
    const card = renderSecondaryDailyQuestCard();
    if (!card) return html;
    return html.replace(
        '<div class="space-y-6 animate-fade-in">',
        `<div class="space-y-6 animate-fade-in">${card}`
    );
}

function ensureSecondaryDailyQuestFeature() {
    if (typeof renderDashboard === 'function' && !renderDashboard._secondaryDailyQuestWrapped) {
        const baseRenderDashboard = renderDashboard;
        renderDashboard = function() {
            const html = baseRenderDashboard();
            return injectSecondaryDailyQuestInDashboard(html);
        };
        renderDashboard._secondaryDailyQuestWrapped = true;
    }

    if (typeof afterLogin === 'function' && !afterLogin._secondaryDailyQuestWrapped) {
        const baseAfterLogin = afterLogin;
        afterLogin = function() {
            ensureSecondaryDailyQuestFresh(false);
            baseAfterLogin();
        };
        afterLogin._secondaryDailyQuestWrapped = true;
    }

    if (typeof render === 'function' && !render._secondaryDailyQuestWrapped) {
        const baseRender = render;
        render = function() {
            ensureSecondaryDailyQuestFresh(false);
            baseRender();
        };
        render._secondaryDailyQuestWrapped = true;
    }

    ensureSecondaryDailyQuestFresh(false);
}

window.addEventListener('DOMContentLoaded', ensureSecondaryDailyQuestFeature);