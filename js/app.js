        const app = {
            db: null, auth: null, appId: typeof __app_id !== 'undefined' ? __app_id : 'default-app-id',
            user: null, shift: null, leader: null,
            
            masterAssy: masterDataAssy, masterMP: masterDataMP, masterLeader: masterDataLeader,
            activeQueue: [], historyReports: [], validWpList: [], 
            
            scanDataTmp: null, activeTaskTmpId: null, resumePendingId: null, 
            batchItemsValid: [], isIstirahatGlobal: false, adminTab: 'overview',
            
            unsubQueue: null, unsubHistory: null, adminHistoryReports: null, unsubAdminHistories: [],
            
            chartInstCCT: null, chartInstQTY: null,
            activeChartHighlight: null,
            
            tempMps: [], 
            isBatchModeConfirming: false,
            
            rekapMpFilterVals: { nama: '', line: '' },

            init: async function() {
                try {
                    // 1. Ubah nama ini menjadi myRealFirebaseConfig
                    const myRealFirebaseConfig = {
                        apiKey: "AIzaSyDfWp9DMuoDDr7M7LIfgQfok8xKmn4yOe0",
                        authDomain: "edr-assembling.firebaseapp.com",
                        databaseURL: "https://edr-assembling-default-rtdb.asia-southeast1.firebasedatabase.app",
                        projectId: "edr-assembling",
                        storageBucket: "edr-assembling.firebasestorage.app",
                        messagingSenderId: "156144912420",
                        appId: "1:156144912420:web:f5c04f476a902dae1c70b1"
                    };

                    // 2. Di ujung baris ini, ganti 'null' menjadi 'myRealFirebaseConfig'
                    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : myRealFirebaseConfig;
                    
                    if(firebaseConfig && !firebase.apps.length) firebase.initializeApp(firebaseConfig);
                    if(firebase.apps.length) {
                        this.auth = firebase.auth(); this.db = firebase.firestore();
                        try { await this.db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await this.auth.signInWithCustomToken(__initial_auth_token);
                        else await this.auth.signInAnonymously();
                        this.auth.onAuthStateChanged(user => { if(user){ this.user = user; } });
                    } else { this.useLocalFallback(); }
                    
                    this.setupUIBindings(); this.startClock(); this.monitorNetwork();
                    Chart.defaults.animation = false;
                } catch(e) { this.showToast("System Init Error", "error"); console.error(e); }
            },

            setupRealtimeListeners: function() {
                if(!this.leader) return;
                let lineKey = this.leader.line.replace(/\s+/g, '_');

                if(!this.db || !this.user) {
                    this.activeQueue = JSON.parse(localStorage.getItem(`activeQueue_${lineKey}`) || '[]');
                    this.historyReports = JSON.parse(localStorage.getItem(`history_${lineKey}`) || '[]');
                    this.renderQueue();
                    return;
                }

                if(this.unsubQueue) this.unsubQueue();
                this.unsubQueue = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`active_queue_${lineKey}`).onSnapshot(snap => {
                    this.activeQueue = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })); this.renderQueue();
                }, err => { this.showToast("Gagal menyinkronisasi antrian", "error"); });
                
                if(this.unsubHistory) this.unsubHistory();
                this.unsubHistory = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`history_${lineKey}`).onSnapshot(snap => {
                    let allData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    allData.sort((a,b) => b.finishedAt - a.finishedAt);
                    this.historyReports = allData.slice(0, 2000); 
                    if(!document.getElementById('admin-dashboard').classList.contains('hide') && !this.adminHistoryReports) this.applyAdminFilter(); 
                }, err => {});
            },

            useLocalFallback: function() {
                let la = JSON.parse(localStorage.getItem('masterAssy')); if(la) this.masterAssy = la;
                let lm = JSON.parse(localStorage.getItem('masterMP')); if(lm) this.masterMP = lm;
                let ll = JSON.parse(localStorage.getItem('masterLeader')); if(ll) this.masterLeader = ll;
                
                this.isIstirahatGlobal = JSON.parse(localStorage.getItem('isIstirahatGlobal') || 'false');
            },
            persistLocal: function(k, d) { localStorage.setItem(k, JSON.stringify(d)); },

            setupUIBindings: function() {
                ['main-scan-input', 'scan-out-input'].forEach(id => {
                    let el = document.getElementById(id);
                    el.addEventListener('keydown', (e) => { if(e.key==='Enter') { e.preventDefault(); this.processRawScan(el.value, id==='main-scan-input'?'IN':'OUT'); el.value=''; }});
                });

                const symbols = ['C', '/', '-', 'S', 'E', 'P'];
                this.validWpList = []; 
                for(let i=1; i<=12; i++) for(let j=1; j<=12; j++) for(let s of symbols) this.validWpList.push(`${i.toString().padStart(2,'0')}${s}${j.toString().padStart(2,'0')}`);
            },

            monitorNetwork: function() {
                const updateStatus = () => {
                    const el = document.getElementById('network-status');
                    if(navigator.onLine) { el.classList.add('bg-emerald-100', 'text-emerald-800'); setTimeout(()=>el.classList.add('hide'),3000); }
                    else { el.classList.remove('hide', 'bg-emerald-100'); el.classList.add('bg-red-500', 'text-white'); document.getElementById('network-text').innerText = "Offline"; }
                };
                window.addEventListener('online', updateStatus); window.addEventListener('offline', updateStatus); updateStatus();
            },
            showToast: function(msg, type='info') {
                const c = document.getElementById('toast-container'); const t = document.createElement('div');
                t.className = `toast ${type}`; t.innerHTML = `<i class="fas fa-info-circle mr-2"></i> ${msg}`;
                c.appendChild(t); setTimeout(() => t.remove(), 3000); 
            },

            formatDateShort: function(dateObj) {
                const m = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
                return `${dateObj.getDate().toString().padStart(2,'0')}-${m[dateObj.getMonth()]}`;
            },

            login: function() {
                const lisensi = document.getElementById('login-lisensi').value.trim().toUpperCase();
                const pass = document.getElementById('login-pass').value.trim();
                const validLeader = this.masterLeader.find(l => l.lisensi === lisensi && l.pass === pass);
                if(validLeader) {
                    this.leader = validLeader; this.shift = validLeader.shift;
                    document.getElementById('header-shift').innerText = validLeader.shift;
                    document.getElementById('header-leader').innerText = validLeader.nama;
                    document.getElementById('login-screen').classList.add('hide'); document.getElementById('main-dashboard').classList.remove('hide');
                    this.showToast(`Welcome, ${validLeader.nama} - Ruang: ${validLeader.line}`, 'success');
                    this.setupRealtimeListeners();
                    setTimeout(() => document.getElementById('main-scan-input').focus(), 500);
                } else this.showToast('Lisensi / Pass Salah', 'error');
            },
            logout: function() {
                if(this.unsubQueue) { this.unsubQueue(); this.unsubQueue = null; }
                if(this.unsubHistory) { this.unsubHistory(); this.unsubHistory = null; }
                if(this.unsubAdminHistories) { this.unsubAdminHistories.forEach(u => u()); this.unsubAdminHistories = []; }
                this.activeQueue = []; this.historyReports = []; this.adminHistoryReports = null;

                this.shift = null; this.leader = null;
                document.getElementById('login-screen').classList.remove('hide'); document.getElementById('main-dashboard').classList.add('hide');
                document.getElementById('admin-dashboard').classList.add('hide'); document.getElementById('login-lisensi').value=''; document.getElementById('login-pass').value='';
            },

            processRawScan: function(rawStr, mode) {
                let trimmedStr = rawStr.trim(); let spaceIdx = trimmedStr.indexOf(' ');
                if(spaceIdx === -1 || trimmedStr.length < 12) { this.showToast("Format Barcode tidak dikenali", "error"); return; }
                let noAssy = trimmedStr.substring(0, spaceIdx); let sn = trimmedStr.slice(-11);
                
                if(mode === 'IN') {
                    if(this.activeQueue.some(q => (q.isBatch && q.batchSNs.includes(sn)) || (!q.isBatch && q.sn === sn)) || this.historyReports.some(h => h.sn === sn)) { this.showToast(`Duplicate: SN ${sn}`, "error"); return; }
                    const assyData = this.masterAssy.find(a => a.no_assy === noAssy);
                    if(!assyData) { this.showToast(`Assy ${noAssy} tidak dikenal`, "error"); return; }
                    
                    this.scanDataTmp = { noAssy, sn, cct: assyData.cct, umh: assyData.umh };
                    document.getElementById('init-assy').innerText = noAssy; document.getElementById('init-sn').innerText = sn;
                    document.getElementById('init-cct').innerText = assyData.cct; document.getElementById('init-umh').innerText = assyData.umh;
                    document.getElementById('wp-input').value = ''; 
                    
                    this.tempMps = [];
                    this.renderTempMps(false);
                    document.getElementById('init-mp-input').value = '';
                    
                    document.getElementById('init-form-container').classList.remove('hide');
                    document.getElementById('init-line-select').value = this.leader.line; 
                    
                    document.getElementById('wp-input').focus();
                } else if(mode === 'OUT') {
                    const activeItem = this.activeQueue.find(q => (q.isBatch && q.batchSNs.includes(sn)) || (!q.isBatch && q.sn === sn));
                    if(activeItem) {
                        if(activeItem.status === 'downtime' || activeItem.status === 'pending') { this.showToast("Antrian sedang Pause/Pending.", "warning"); return; }
                        this.finishProcess(activeItem.id);
                    } else this.showToast(`SN ${sn} tidak di Active Queue`, "error");
                }
            },

            handleMpInputKeydown: function(event, inputEl, isBatch) {
                if(event.key === 'Enter') {
                    event.preventDefault();
                    let val = inputEl.value.trim().toUpperCase();
                    
                    if(val === '') {
                        app.promptConfirmStart(isBatch);
                        return;
                    }

                    if(this.tempMps.length >= 10) {
                        this.showToast("Maksimal mencapai 10 MP!", "warning");
                        inputEl.value = '';
                        return;
                    }

                    if(this.tempMps.some(m => m.id === val)) {
                        this.showToast("NRP ini sudah dimasukkan", "warning");
                        inputEl.value = '';
                        return;
                    }

                    let mpData = this.masterMP.find(m => m.id === val);
                    if(mpData) {
                        this.tempMps.push({ id: mpData.id, nama: mpData.nama });
                        inputEl.value = '';
                        this.renderTempMps(isBatch);
                    } else {
                        this.showToast(`NRP ${val} tidak dikenal`, "error");
                    }
                }
            },

            renderTempMps: function(isBatch) {
                let containerId = isBatch ? 'b-mp-list' : 'init-mp-list';
                let countId = isBatch ? 'b-mp-count' : 'init-mp-count';
                let container = document.getElementById(containerId);
                
                document.getElementById(countId).innerText = this.tempMps.length;
                container.innerHTML = '';
                
                this.tempMps.forEach((mp, idx) => {
                    let html = `
                        <div class="chip-enter flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-800 px-2 py-1 rounded-md text-[11px] font-bold shadow-sm">
                            <i class="fas fa-user-check text-blue-500"></i> ${mp.id} - ${mp.nama.split(' ')[0]}
                            <button onclick="app.removeTempMp(${idx}, ${isBatch})" class="text-blue-400 hover:text-red-500 ml-1 outline-none transition-colors"><i class="fas fa-times-circle"></i></button>
                        </div>
                    `;
                    container.insertAdjacentHTML('beforeend', html);
                });
            },

            removeTempMp: function(idx, isBatch) {
                this.tempMps.splice(idx, 1);
                this.renderTempMps(isBatch);
                document.getElementById(isBatch ? 'b-mp-input' : 'init-mp-input').focus();
            },

            cancelInit: function() { 
                document.getElementById('init-form-container').classList.add('hide'); 
                this.scanDataTmp = null; 
                this.resumePendingId = null; 
                this.tempMps = []; 
                document.getElementById('main-scan-input').focus(); 
            },

            promptConfirmStart: function(isBatch) {
                let wpRaw = isBatch ? document.getElementById('b-wp-input').value : document.getElementById('wp-input').value;
                let wp = wpRaw ? wpRaw.toUpperCase() : '';
                if(!this.validWpList.includes(wp)) { this.showToast(`WP tidak valid`, "error"); return; }
                
                let targetLine = isBatch ? document.getElementById('b-line-select').value : document.getElementById('init-line-select').value;
                if(this.tempMps.length === 0) { this.showToast("Minimal 1 Manpower! (Ketik lalu Enter terlebih dahulu)", "warning"); return; }

                this.isBatchModeConfirming = isBatch;

                let assyText = "", snText = "", cctText = "", umhText = "";
                if(isBatch) {
                    assyText = this.batchItemsValid[0]?.noAssy || "-";
                    snText = `BATCH MODE (${this.batchItemsValid.length} Unit)`;
                    cctText = document.getElementById('batch-cct').innerText;
                    umhText = document.getElementById('batch-umh').innerText;
                } else {
                    if(this.resumePendingId) {
                        const item = this.activeQueue.find(q => q.id === this.resumePendingId);
                        assyText = item.noAssy; snText = item.sn; cctText = item.cct; umhText = item.baseUmh;
                    } else if (this.scanDataTmp) {
                        assyText = this.scanDataTmp.noAssy; snText = this.scanDataTmp.sn; cctText = this.scanDataTmp.cct; umhText = this.scanDataTmp.umh;
                    }
                }

                document.getElementById('cs-assy').innerText = assyText;
                document.getElementById('cs-sn').innerText = snText;
                document.getElementById('cs-cct-umh').innerText = `${cctText} / ${umhText}`;
                document.getElementById('cs-wp').innerText = wp;
                document.getElementById('cs-line').innerText = targetLine;
                document.getElementById('cs-mp').innerHTML = this.tempMps.map((m, idx) => `<span class="text-blue-500 mr-1">${idx+1}.</span> ${m.id} - ${m.nama}`).join('<br>');

                document.getElementById('modal-confirm-start').classList.remove('hide');
                setTimeout(() => document.getElementById('btn-confirm-yes').focus(), 100);
            },

            executeStart: function() {
                this.closeModal('modal-confirm-start');
                if(this.isBatchModeConfirming) {
                    this.startBatch();
                } else {
                    this.startProcess();
                }
            },

            startProcess: async function() {
                if(!this.scanDataTmp) return;
                const btn = document.getElementById('btn-start-process'); btn.disabled = true;
                try {
                    let wpRaw = document.getElementById('wp-input').value; let wp = wpRaw ? wpRaw.toUpperCase() : '';
                    let targetLine = document.getElementById('init-line-select').value; 
                    let mps = [...this.tempMps]; 

                    if(this.resumePendingId) {
                        const item = this.activeQueue.find(q => q.id === this.resumePendingId);
                        if(item) {
                            let now = Date.now();
                            item.downtimes = item.downtimes || [];
                            if(item.downtimes.length > 0 && !item.downtimes[item.downtimes.length-1].end) {
                                let lastDt = item.downtimes[item.downtimes.length-1];
                                lastDt.end = now; lastDt.duration = lastDt.end - lastDt.start;
                                item.totalDowntime += lastDt.duration;
                            }
                            this.updateQueueDoc(item.id, { mps: mps, wp: wp, targetLine: targetLine, status: 'running', downtimes: item.downtimes, totalDowntime: item.totalDowntime, lastDowntimeStart: null, isGlobalPause: false });
                            this.showToast(`Resumed SN ${item.sn}`, "success");
                        }
                        this.resumePendingId = null; 
                    } else {
                        let processData = {
                            sn: this.scanDataTmp.sn, noAssy: this.scanDataTmp.noAssy, cct: this.scanDataTmp.cct, baseUmh: this.scanDataTmp.umh,
                            wp: wp, mps: mps, targetLine: targetLine, startTime: Date.now(), status: 'running', totalDowntime: 0, downtimes: [],
                            lastDowntimeStart: null, isGlobalPause: false, shift: this.shift, leaderName: this.leader.nama 
                        };
                        this.showToast("Process Started", "success"); this.saveToQueue(processData);
                    }
                    this.cancelInit(); 
                } finally { btn.disabled = false; }
            },

            saveToQueue: async function(data) {
                let docId = data.id || data.sn; 
                let lineKey = this.leader.line.replace(/\s+/g, '_');
                if(this.db) await this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`active_queue_${lineKey}`).doc(docId).set(data);
                else { this.activeQueue.push({ ...data, id: docId }); this.persistLocal(`activeQueue_${lineKey}`, this.activeQueue); this.renderQueue(); }
            },

            renderQueue: function(filterText = '') {
                const container = document.getElementById('active-queue-container');
                let filtered = this.activeQueue.filter(q => q.status !== 'pending'); 
                if(filterText) {
                    let ft = filterText.toLowerCase();
                    filtered = filtered.filter(q => (q.sn && q.sn.toLowerCase().includes(ft)) || q.noAssy.toLowerCase().includes(ft) || (q.isBatch && q.batchSNs.some(bsn => bsn.toLowerCase().includes(ft))));
                }
                let sortedFiltered = filtered.sort((a, b) => a.startTime - b.startTime);
                document.getElementById('queue-count').innerText = sortedFiltered.length;
                this.updatePendingCount();
                
                let btnIstirahat = document.getElementById('btn-istirahat');
                if(this.isIstirahatGlobal) { btnIstirahat.innerHTML = `<i class="fas fa-play-circle"></i> Selesai Istirahat`; btnIstirahat.className = "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1 transition shadow-sm"; }
                else { btnIstirahat.innerHTML = `<i class="fas fa-coffee"></i> Istirahat`; btnIstirahat.className = "bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-1.5 rounded font-bold text-xs flex items-center gap-1 transition shadow-sm"; }

                if(sortedFiltered.length === 0) { container.innerHTML = `<div class="h-full flex items-center justify-center text-slate-400 text-sm italic">Queue is empty.</div>`; return; }

                container.innerHTML = '';
                sortedFiltered.forEach((q, i) => {
                    const isDT = q.status === 'downtime';
                    const bgClass = isDT ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200';
                    let snDisplay = q.isBatch ? `<span class="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded mr-1 text-[9px]">BATCH x${q.batchSize}</span> ${q.sn}` : q.sn;
                    
                    let mps = q.mps || [];
                    let mpsName = mps.map(m => {
                        if (!m) return '';
                        return m.nama ? m.nama.split(' ')[0] : String(m);
                    }).join(', ');
                    let teamSizeLabel = mps.length > 3 ? `(+${mps.length-3} lainnya)` : '';

                    let batchMultiplier = q.isBatch ? q.batchSize : 1;
                    let targetMs = ((q.baseUmh * batchMultiplier) / (mps.length || 1)) * 60000;
                    let targetStr = this.formatMs(targetMs);

                    let html = `
                    <div class="queue-item flex justify-between items-center p-3 rounded-lg border ${bgClass} shadow-sm hover:border-blue-300 transition-colors cursor-context-menu" id="q-${q.id}" oncontextmenu="app.handleRightClickQueue(event, '${q.id}')" title="Klik Kanan untuk membatalkan (Cancel) proses">
                        <div class="flex-1 flex items-center gap-4">
                            <div class="w-8 h-8 rounded-full flex items-center justify-center ${isDT?'bg-amber-200 text-amber-700':'bg-blue-100 text-blue-600'} font-bold text-sm border shrink-0">${i + 1}</div>
                            <div>
                                <div class="flex items-baseline gap-2"><span class="font-bold text-slate-800 font-mono text-sm">${snDisplay}</span><span class="text-[9px] bg-slate-200 px-1 rounded">${q.noAssy}</span> <span class="text-[9px] text-indigo-600 font-bold ml-1">${q.targetLine}</span></div>
                                <div class="text-[11px] text-slate-500 mt-0.5"><i class="fas fa-users mr-1 text-blue-400"></i> ${mpsName} <span class="font-bold text-indigo-500">${teamSizeLabel}</span> <span class="mx-1">|</span> WP: <strong>${q.wp}</strong></div>
                            </div>
                        </div>
                        <div class="flex items-center gap-4">
                            <div class="text-right flex gap-3">
                                <div>
                                    <div class="flex items-end gap-1.5 justify-end">
                                        <div class="font-timer font-bold text-blue-600 text-[15px] timer-duration" data-id="${q.id}">00:00:00</div>
                                        <div class="font-timer font-bold text-slate-400 text-[11px] mb-[2px]">/ ${targetStr}</div>
                                    </div>
                                    <div class="text-[8px] text-slate-400 font-bold uppercase mt-0.5 tracking-wider">Aktual / Target</div>
                                </div>
                                <div class="${isDT ? '' : 'hide'} border-l border-amber-200 pl-3">
                                    <div class="font-timer font-bold text-amber-600 text-[15px] timer-downtime" data-id="${q.id}">00:00:00</div>
                                    <div class="text-[8px] text-amber-500 font-bold uppercase">${q.isGlobalPause ? 'ISTIRAHAT' : 'DOWNTIME'}</div>
                                </div>
                            </div>
                            <div class="flex flex-col gap-1 shrink-0 w-24">
                                ${isDT && !q.isGlobalPause ? 
                                `<button onclick="app.promptResumeDowntime('${q.id}')" class="w-full text-[10px] py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold"><i class="fas fa-play"></i> Resume</button>` : 
                                (q.isGlobalPause ? `<span class="text-[10px] text-center font-bold text-slate-400 border py-1 rounded bg-slate-100">Jeda Global</span>` : 
                                `<button onclick="app.openDowntimeModal('${q.id}')" class="w-full text-[10px] py-1 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold"><i class="fas fa-pause"></i> Downtime</button>`)
                                }
                                <button onclick="app.openPendingModal('${q.id}')" class="w-full text-[10px] py-1 rounded border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 font-bold"><i class="fas fa-clock"></i> Pending</button>
                            </div>
                        </div>
                    </div>`;
                    container.insertAdjacentHTML('beforeend', html);
                });
                this.updateTimers(); 
            },
            filterQueue: function() { this.renderQueue(document.getElementById('queue-search').value); },
            handleQueueScanSearch: function() {
                let el = document.getElementById('queue-search'); let val = el.value.trim();
                if(val.indexOf(' ') !== -1 && val.length >= 12) el.value = val.slice(-11);
                this.filterQueue();
            },

            startClock: function() {
                setInterval(() => {
                    const now = new Date();
                    let timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '.'); 
                    document.getElementById('clock-display').innerText = `${this.formatDateShort(now)} ${now.getFullYear()} - ${timeStr}`;
                    this.updateTimers();
                }, 1000);
            },

            updateTimers: function() {
                const now = Date.now();
                document.querySelectorAll('.timer-duration').forEach(el => {
                    const id = el.getAttribute('data-id'); const item = this.activeQueue.find(q => q.id === id);
                    if(item) {
                        let activeMs = now - item.startTime - item.totalDowntime;
                        if(item.status !== 'running') activeMs -= (now - item.lastDowntimeStart); 
                        el.innerText = this.formatMs(activeMs);
                    }
                });
                document.querySelectorAll('.timer-downtime').forEach(el => {
                    const id = el.getAttribute('data-id'); const item = this.activeQueue.find(q => q.id === id);
                    if(item && item.status === 'downtime') {
                        let currentDtMs = now - item.lastDowntimeStart;
                        el.innerText = this.formatMs(currentDtMs);
                    }
                });
            },
            formatMs: function(ms) {
                if(ms < 0) ms = 0; let totalSec = Math.floor(ms / 1000);
                let h = Math.floor(totalSec / 3600); let m = Math.floor((totalSec % 3600) / 60); let s = totalSec % 60;
                return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
            },

            toggleIstirahat: async function() {
                let now = Date.now();
                if(!this.isIstirahatGlobal) {
                    this.isIstirahatGlobal = true;
                    let runnings = this.activeQueue.filter(q => q.status === 'running');
                    for(let q of runnings) {
                        q.downtimes = q.downtimes || [];
                        q.downtimes.push({ reason: 'Istirahat', start: now, end: null, duration: 0 });
                        await this.updateQueueDoc(q.id, { status: 'downtime', lastDowntimeStart: now, downtimes: q.downtimes, isGlobalPause: true });
                    }
                    this.showToast("Istirahat Aktif", "info");
                } else {
                    this.isIstirahatGlobal = false;
                    let globals = this.activeQueue.filter(q => q.status === 'downtime' && q.isGlobalPause);
                    for(let q of globals) {
                        let lastDt = q.downtimes[q.downtimes.length - 1];
                        lastDt.end = now; lastDt.duration = lastDt.end - lastDt.start;
                        let tot = q.totalDowntime + lastDt.duration;
                        await this.updateQueueDoc(q.id, { status: 'running', totalDowntime: tot, lastDowntimeStart: null, downtimes: q.downtimes, isGlobalPause: false });
                    }
                    this.showToast("Selesai Istirahat", "success");
                }
                if(!this.db) this.persistLocal('isIstirahatGlobal', this.isIstirahatGlobal);
                this.renderQueue(); 
            },

            openDowntimeModal: function(id) { this.activeTaskTmpId = id; document.getElementById('modal-downtime').classList.remove('hide'); },
            openPendingModal: function(id) { this.activeTaskTmpId = id; document.getElementById('modal-pending').classList.remove('hide'); },

            confirmDowntime: async function() {
                let reason = document.getElementById('dt-reason').value; let now = Date.now();
                let item = this.activeQueue.find(q => q.id === this.activeTaskTmpId);
                item.downtimes = item.downtimes || []; item.downtimes.push({ reason: reason, start: now, end: null, duration: 0 });
                await this.updateQueueDoc(this.activeTaskTmpId, { status: 'downtime', lastDowntimeStart: now, downtimes: item.downtimes, isGlobalPause: false });
                this.closeModal('modal-downtime');
            },

            promptResumeDowntime: function(id) {
                this.activeTaskTmpId = id;
                let item = this.activeQueue.find(q => q.id === id);
                if(!item || !item.downtimes || item.downtimes.length === 0) return;
                
                let lastDt = item.downtimes[item.downtimes.length - 1];
                let currentDtMs = Date.now() - lastDt.start;
                
                document.getElementById('crd-reason').innerText = lastDt.reason;
                document.getElementById('crd-duration').innerText = this.formatMs(currentDtMs);
                
                document.getElementById('modal-resume-downtime').classList.remove('hide');
                setTimeout(() => document.getElementById('btn-resume-yes').focus(), 100);
            },

            executeResumeDowntime: async function() {
                let id = this.activeTaskTmpId;
                let item = this.activeQueue.find(q => q.id === id); let now = Date.now();
                let lastDt = item.downtimes[item.downtimes.length - 1];
                lastDt.end = now; lastDt.duration = lastDt.end - lastDt.start;
                let tot = item.totalDowntime + lastDt.duration;
                await this.updateQueueDoc(id, { status: 'running', totalDowntime: tot, lastDowntimeStart: null, downtimes: item.downtimes, isGlobalPause: false });
                this.closeModal('modal-resume-downtime');
            },

            confirmPending: async function() {
                let reason = document.getElementById('pd-reason').value; let now = Date.now();
                let item = this.activeQueue.find(q => q.id === this.activeTaskTmpId);
                item.downtimes = item.downtimes || []; item.downtimes.push({ reason: `PENDING: ${reason}`, start: now, end: null, duration: 0 });
                await this.updateQueueDoc(this.activeTaskTmpId, { status: 'pending', lastDowntimeStart: now, downtimes: item.downtimes, isGlobalPause: false });
                this.closeModal('modal-pending'); this.closeModal('modal-downtime'); 
            },

            updatePendingCount: function() { document.getElementById('pending-count').innerText = this.activeQueue.filter(q => q.status === 'pending').length; },
            
            showPendingList: function() {
                let pendings = this.activeQueue.filter(q => q.status === 'pending');
                if(pendings.length === 0) { this.showToast("Tidak ada pending", "info"); return; }
                const container = document.getElementById('pending-list-container'); container.innerHTML = '';
                pendings.forEach(p => {
                    let snDisplay = p.isBatch ? `<span class="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded text-[10px]">BATCH x${p.batchSize}</span> ${p.sn}` : p.sn;
                    let lastDt = p.downtimes[p.downtimes.length-1];
                    let pendingDurationStr = this.formatMs(Date.now() - lastDt.start); 

                    let html = `
                    <div class="flex justify-between items-center bg-white p-3 rounded-lg border border-red-200 shadow-sm">
                        <div>
                            <div class="font-bold text-slate-800 text-sm font-mono">${snDisplay} <span class="text-xs bg-slate-100 px-1 rounded">${p.noAssy}</span></div>
                            <div class="text-[10px] text-slate-600 mt-1 font-semibold">${lastDt.reason}</div>
                            <div class="text-[10px] text-red-500 font-bold font-timer mt-0.5">Waktu Pending: ${pendingDurationStr}</div>
                        </div>
                        <button onclick="app.resumePendingInit('${p.id}')" class="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded font-bold text-xs shadow-sm"><i class="fas fa-play"></i> Lanjut Inisiasi</button>
                    </div>`;
                    container.insertAdjacentHTML('beforeend', html);
                });
                document.getElementById('modal-pending-list').classList.remove('hide');
                
                if(this.pendingTimer) clearInterval(this.pendingTimer);
                this.pendingTimer = setInterval(() => {
                    if(!document.getElementById('modal-pending-list').classList.contains('hide')) this.showPendingList();
                    else clearInterval(this.pendingTimer);
                }, 1000);
            },
            
            resumePendingInit: function(id) {
                const item = this.activeQueue.find(q => q.id === id); if(!item) return;
                this.closeModal('modal-pending-list'); this.scanDataTmp = item; this.resumePendingId = item.id;
                let snDisplay = item.isBatch ? `BATCH (x${item.batchSize}) - ${item.sn}` : item.sn;
                document.getElementById('init-assy').innerText = item.noAssy; document.getElementById('init-sn').innerText = snDisplay;
                document.getElementById('init-cct').innerText = item.cct; document.getElementById('init-umh').innerText = item.baseUmh;
                
                document.getElementById('wp-input').value = item.wp; 
                document.getElementById('init-line-select').value = item.targetLine;
                
                this.tempMps = [...item.mps];
                this.renderTempMps(false);
                document.getElementById('init-mp-input').value = '';
                
                document.getElementById('init-form-container').classList.remove('hide'); document.getElementById('init-mp-input').focus();
                this.showToast("Silakan periksa atau tambah Manpower.", "info");
            },

            handleRightClickQueue: function(event, id) {
                // Faktual UX: event.preventDefault() digunakan agar menu bawaan OS/Browser (seperti 'Inspect', 'Save As') tidak muncul.
                event.preventDefault(); 
                this.cancelProcess(id);
            },

            cancelProcess: function(id) {
                this.activeTaskTmpId = id;
                const item = this.activeQueue.find(q => q.id === id);
                if(!item) return;
                
                let snDisplay = item.isBatch ? `BATCH (x${item.batchSize}) - ${item.sn}` : item.sn;
                document.getElementById('cc-sn').innerText = snDisplay;
                document.getElementById('cc-assy').innerText = item.noAssy;
                
                // Menampilkan Modal Kustom alih-alih menggunakan confirm() browser yang kaku
                document.getElementById('modal-cancel-process').classList.remove('hide');
                setTimeout(() => document.getElementById('btn-confirm-cancel').focus(), 100);
            },

            executeCancelProcess: async function() {
                let id = this.activeTaskTmpId;
                const item = this.activeQueue.find(q => q.id === id);
                if(!item) return;
                
                let lineKey = this.leader.line.replace(/\s+/g, '_');
                let snDisplay = item.isBatch ? `BATCH (x${item.batchSize}) - ${item.sn}` : item.sn;

                if(this.db) {
                    try {
                        await this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`active_queue_${lineKey}`).doc(id).delete();
                    } catch(e) {
                        this.showToast("Gagal membatalkan proses", "error");
                    }
                } else {
                    this.activeQueue = this.activeQueue.filter(q => q.id !== id);
                    this.persistLocal(`activeQueue_${lineKey}`, this.activeQueue);
                    this.renderQueue();
                }
                
                this.closeModal('modal-cancel-process');
                this.showToast(`Proses ${snDisplay} dibatalkan.`, "info");
            },

            finishProcess: function(id) {
                this.activeTaskTmpId = id; document.getElementById('qc-error').innerText = '';
                document.querySelectorAll('.qc-check').forEach(cb => cb.checked = false);
                const item = this.activeQueue.find(q => q.id === id);
                if(item) {
                    let snDisplay = item.isBatch ? `BATCH (x${item.batchSize})<br><span class="text-[10px] font-normal">${item.sn}</span>` : item.sn;
                    let mps = item.mps || [];
                    let mpStr = mps.map(m => `<div class="truncate"><i class="fas fa-user text-slate-400 mr-1"></i> <strong>${m ? (m.nama || String(m)) : '-'}</strong></div>`).join('');
                    let activeMs = Date.now() - item.startTime - item.totalDowntime;
                    
                    document.getElementById('qc-detail-sn').innerHTML = snDisplay; 
                    document.getElementById('qc-detail-line').innerText = `Target Output: ${item.targetLine}`;
                    document.getElementById('qc-detail-assy').innerText = item.noAssy; 
                    document.getElementById('qc-detail-cct').innerText = item.isBatch ? item.cct * item.batchSize : item.cct;
                    document.getElementById('qc-detail-wp').innerText = item.wp; 
                    document.getElementById('qc-detail-mp').innerHTML = mpStr;
                    document.getElementById('qc-detail-duration').innerText = this.formatMs(activeMs);
                }
                document.getElementById('modal-qc').classList.remove('hide');
            },
            
            confirmFinish: async function() {
                let allChecked = true; document.querySelectorAll('.qc-check').forEach(cb => { if(!cb.checked) allChecked = false; });
                if(!allChecked) { document.getElementById('qc-error').innerText = "Mohon teliti dan ceklis ke-6 poin QC secara manual!"; return; }
                const item = this.activeQueue.find(q => q.id === this.activeTaskTmpId); if(!item) return;

                const now = Date.now();
                let activeMs = now - item.startTime - item.totalDowntime; let activeMin = activeMs / 60000;
                let dtMin = item.totalDowntime / 60000;
                
                let batchMultiplier = item.isBatch ? item.batchSize : 1;
                let mpsLength = item.mps && item.mps.length > 0 ? item.mps.length : 1;
                
                let targetUmh = (item.baseUmh * batchMultiplier) / mpsLength; 
                let isOK = activeMin <= targetUmh; 
                
                let cctPerMp = item.cct / mpsLength; 
                let durationPerUnit = activeMin / batchMultiplier; let dtPerUnit = dtMin / batchMultiplier;

                let historyDataArray = [];
                let baseH = { ...item, finishedAt: now, durationMin: durationPerUnit, downtimeMin: dtPerUnit, cctPerMp: cctPerMp, finalStatus: isOK ? "OK" : "OVERTIME" };
                if(item.isBatch) {
                    item.batchSNs.forEach(batchSn => { historyDataArray.push({ ...baseH, id: batchSn, sn: batchSn, isBatch: false, batchSNs: null, batchSize: null }); });
                } else { historyDataArray.push(baseH); }

                let lineKey = this.leader.line.replace(/\s+/g, '_');

                if(this.db) {
                    const batch = this.db.batch();
                    batch.delete(this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`active_queue_${lineKey}`).doc(item.id));
                    historyDataArray.forEach(hData => { batch.set(this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`history_${lineKey}`).doc(hData.sn), hData); });
                    await batch.commit();
                } else {
                    this.activeQueue = this.activeQueue.filter(q => q.id !== item.id);
                    historyDataArray.forEach(hData => this.historyReports.unshift(hData)); 
                    this.persistLocal(`activeQueue_${lineKey}`, this.activeQueue); 
                    this.persistLocal(`history_${lineKey}`, this.historyReports); 
                    this.renderQueue();
                }

                this.closeModal('modal-qc'); this.showToast(`Finish: +${(cctPerMp * batchMultiplier).toFixed(1)} CCT/MP`, "success");
                document.getElementById('scan-out-input').focus();
            },

            toggleAllLines: function(el) {
                document.querySelectorAll('.flt-cb-line').forEach(cb => cb.checked = el.checked);
                this.applyAdminFilter();
            },
            checkLineState: function() {
                let allChecked = Array.from(document.querySelectorAll('.flt-cb-line')).every(cb => cb.checked);
                document.getElementById('cb-line-all').checked = allChecked;
                this.applyAdminFilter();
            },

            getFilteredReportsForAdmin: function() {
                let startInput = document.getElementById('flt-date-start').value; let endInput = document.getElementById('flt-date-end').value;
                let shiftInput = document.getElementById('flt-shift').value;
                let checkedLines = Array.from(document.querySelectorAll('.flt-cb-line:checked')).map(cb => cb.value);
                
                let sourceData = this.adminHistoryReports || this.historyReports;
                let filtered = sourceData;
                
                if(startInput) { let startMs = new Date(startInput).setHours(0,0,0,0); filtered = filtered.filter(h => h.finishedAt >= startMs); }
                if(endInput) { let endMs = new Date(endInput).setHours(23,59,59,999); filtered = filtered.filter(h => h.finishedAt <= endMs); }
                if(shiftInput !== 'ALL') { filtered = filtered.filter(h => h.shift === shiftInput); }
                filtered = filtered.filter(h => checkedLines.includes(h.targetLine));
                
                return filtered;
            },

            applyAdminFilter: function() {
                if(this.adminTab === 'overview') this.renderAdminOverview();
                if(this.adminTab === 'leaderboard') this.renderAdminLeaderboard();
                if(this.adminTab === 'transactions') this.renderAdminTransactions();
                if(this.adminTab === 'rekapline') this.renderRekapLine();
                if(this.adminTab === 'rekapmp') this.renderRekapMP();
            },

            switchAdminTab: function(tabName) {
                this.adminTab = tabName;
                ['overview', 'leaderboard', 'rekapline', 'rekapmp', 'transactions', 'master'].forEach(t => {
                    document.getElementById('tab-btn-' + t).classList.remove('admin-tab-active'); document.getElementById('admin-tab-' + t).classList.add('hide');
                });
                document.getElementById('tab-btn-' + tabName).classList.add('admin-tab-active'); document.getElementById('admin-tab-' + tabName).classList.remove('hide');

                if(tabName === 'overview' || tabName === 'leaderboard') document.getElementById('filter-line-checkboxes').classList.remove('hide');
                else document.getElementById('filter-line-checkboxes').classList.add('hide');

                if(tabName === 'master') document.getElementById('admin-global-filter').classList.add('hide');
                else document.getElementById('admin-global-filter').classList.remove('hide');

                this.applyAdminFilter();
                if(tabName === 'master') { this.renderMasterAssy(); this.renderMasterMP(); this.renderMasterLeader(); }
            },

            renderAdminOverview: function() {
                let data = this.getFilteredReportsForAdmin();
                let checkedLines = Array.from(document.querySelectorAll('.flt-cb-line:checked')).map(cb => cb.value);

                let totalCct = 0; let totalQty = 0; let uniqueAssys = new Set();
                let lineStats = {};
                
                checkedLines.forEach(l => lineStats[l] = { cct: 0, qty: 0, assys: new Set() });

                data.forEach(h => {
                    let l = h.targetLine;
                    if(lineStats[l]) {
                        totalCct += h.cct; 
                        totalQty += 1;
                        uniqueAssys.add(h.noAssy);
                        
                        lineStats[l].cct += h.cct;
                        lineStats[l].qty += 1;
                        lineStats[l].assys.add(h.noAssy);
                    }
                });
                
                document.getElementById('ov-total-cct').innerText = totalCct.toLocaleString();
                document.getElementById('ov-total-unit').innerText = totalQty.toLocaleString();
                document.getElementById('ov-total-var').innerText = uniqueAssys.size.toLocaleString();

                const container = document.getElementById('overview-line-cards');
                container.innerHTML = '';

                if(checkedLines.length === 0) {
                    container.innerHTML = `<div class="col-span-full text-center text-slate-400 py-10 italic">Silakan pilih minimal satu Line untuk menampilkan ringkasan.</div>`;
                    return;
                }

                checkedLines.sort().forEach(line => {
                    let stats = lineStats[line];
                    let html = `
                        <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 border-t-4 border-t-blue-500 flex flex-col transition-all hover:shadow-md">
                            <h3 class="font-bold text-slate-800 border-b border-slate-100 pb-3 mb-4 text-sm uppercase tracking-wider">
                                <i class="fas fa-industry text-blue-500 mr-2"></i> ${line}
                            </h3>
                            <div class="space-y-4 flex-1">
                                <div class="flex justify-between items-center bg-indigo-50/50 px-3 py-2 rounded-lg border border-indigo-100">
                                    <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wide">Total Output CCT</span>
                                    <span class="text-xl font-black text-indigo-700">${stats.cct.toLocaleString()}</span>
                                </div>
                                <div class="flex justify-between items-center bg-emerald-50/50 px-3 py-2 rounded-lg border border-emerald-100">
                                    <span class="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">Unit (QTY)</span>
                                    <span class="text-lg font-bold text-emerald-700">${stats.qty.toLocaleString()}</span>
                                </div>
                                <div class="flex justify-between items-center bg-amber-50/50 px-3 py-2 rounded-lg border border-amber-100">
                                    <span class="text-[10px] font-bold text-amber-500 uppercase tracking-wide">Varian (ASSY)</span>
                                    <span class="text-lg font-bold text-amber-700">${stats.assys.size.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    `;
                    container.insertAdjacentHTML('beforeend', html);
                });
            },

            renderAdminLeaderboard: function() {
                const lbContainer = document.getElementById('leaderboard-container'); 
                const unitContainer = document.getElementById('unit-leaderboard-container');
                const varContainer = document.getElementById('variant-leaderboard-container');
                
                let data = this.getFilteredReportsForAdmin(); 
                let mpScores = {}; 
                
                data.forEach(h => {
                    let mps = h.mps || [];
                    if (mps.length === 0) return;
                    let outputPerMP = h.cct / mps.length;
                    
                    mps.forEach(mp => {
                        if (!mp) return;
                        let id = mp.id || String(mp);
                        let nama = mp.nama || '-';
                        if(!mpScores[id]) mpScores[id] = { id: id, nama: nama, cct: 0, qty: 0, assys: new Set() };
                        mpScores[id].cct += outputPerMP; 
                        mpScores[id].qty += 1;
                        mpScores[id].assys.add(h.noAssy);
                    });
                });

                const renderList = (container, sortedArray, valKey, valFormat, valLabel, iconColorClass) => {
                    container.innerHTML = '';
                    if(sortedArray.length === 0) {
                        container.innerHTML = `<div class="text-center text-slate-400 italic mt-10">Data tidak ditemukan.</div>`;
                        return;
                    }
                    sortedArray.forEach((mp, i) => {
                        let rank = i===0 ? '<i class="fas fa-crown text-yellow-500"></i>' : (i===1 ? '<i class="fas fa-medal text-slate-400"></i>' : (i===2 ? '<i class="fas fa-medal text-orange-400"></i>' : i+1));
                        let val = valKey === 'assys' ? mp.assys.size : mp[valKey];
                        let formattedVal = valFormat === 'float' ? val.toFixed(1) : val;
                        container.innerHTML += `
                        <div class="flex justify-between items-center p-2 border-b text-sm hover:bg-slate-50 transition">
                            <div class="flex gap-3 items-center">
                                <span class="w-6 text-center font-bold text-slate-500">${rank}</span>
                                <div><p class="font-bold text-slate-700">${mp.nama}</p><p class="text-[10px] text-slate-500 font-mono">${mp.id}</p></div>
                            </div>
                            <div class="text-right">
                                <div class="font-black ${iconColorClass} text-lg leading-none">${formattedVal}</div>
                                <div class="text-[8px] text-slate-400 uppercase font-bold mt-1">${valLabel}</div>
                            </div>
                        </div>`;
                    });
                };

                let sortedCCT = Object.values(mpScores).sort((a,b) => b.cct - a.cct);
                let sortedQTY = Object.values(mpScores).sort((a,b) => b.qty - a.qty);
                let sortedVar = Object.values(mpScores).sort((a,b) => b.assys.size - a.assys.size);

                renderList(lbContainer, sortedCCT, 'cct', 'float', 'Total CCT', 'text-indigo-600');
                renderList(unitContainer, sortedQTY, 'qty', 'int', 'Unit Qty', 'text-emerald-600');
                renderList(varContainer, sortedVar, 'assys', 'int', 'Varian', 'text-purple-600');
            },

            renderRekapLine: function() {
                const container = document.getElementById('rekap-line-container'); let data = this.getFilteredReportsForAdmin();
                let dateKeys = [...new Set(data.map(d => new Date(d.finishedAt).toISOString().split('T')[0]))].sort();
                let pivot = {};
                data.forEach(h => {
                    let dKey = new Date(h.finishedAt).toISOString().split('T')[0];
                    let line = h.targetLine || '-';
                    if(!pivot[line]) pivot[line] = { total: 0 };
                    if(!pivot[line][dKey]) pivot[line][dKey] = 0;
                    pivot[line][dKey] += h.cct; 
                    pivot[line].total += h.cct;
                });

                let html = `<table class="w-full text-left border-collapse whitespace-nowrap text-xs min-w-max"><thead class="bg-slate-100 text-slate-600 shadow-sm border-b"><tr><th class="px-4 py-2 font-bold sticky left-0 bg-slate-100 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] w-48">Line Area</th>`;
                dateKeys.forEach(dk => { html += `<th class="px-4 py-2 font-bold text-center border-r bg-slate-50">${this.formatDateShort(new Date(dk))}</th>`; });
                html += `<th class="px-4 py-2 font-bold text-right bg-indigo-100 sticky right-0 z-10 shadow-[-2px_0_5px_rgba(0,0,0,0.05)]">Total Output</th></tr></thead><tbody class="bg-white divide-y divide-slate-100">`;
                
                Object.keys(pivot).sort().forEach(line => {
                    html += `<tr class="hover:bg-blue-50"><td class="px-4 py-2 font-bold sticky left-0 bg-white border-r z-0 w-48">${line}</td>`;
                    dateKeys.forEach(dk => { html += `<td class="px-4 py-2 text-center border-r font-mono">${pivot[line][dk] ? pivot[line][dk].toFixed(1) : '-'}</td>`; });
                    html += `<td class="px-4 py-2 font-black text-indigo-600 text-right bg-indigo-50 sticky right-0 z-0">${pivot[line].total.toFixed(1)}</td></tr>`;
                });
                html += `</tbody></table>`; container.innerHTML = html;
            },

            renderRekapMP: function() {
                const container = document.getElementById('rekap-mp-container'); 
                let data = this.getFilteredReportsForAdmin();
                let dateKeys = [...new Set(data.map(d => new Date(d.finishedAt).toISOString().split('T')[0]))].sort();
                
                if (!this.rekapMpFilterVals) {
                    this.rekapMpFilterVals = { nama: '', line: '' };
                }
                
                let fNama = (this.rekapMpFilterVals.nama || '').toLowerCase();
                let fLine = (this.rekapMpFilterVals.line || '').toLowerCase();
                
                let pivot = {};
                data.forEach(h => {
                    let dKey = new Date(h.finishedAt).toISOString().split('T')[0];
                    let mps = h.mps || [];
                    if (mps.length === 0) return;
                    let cctPerMP = h.cct / mps.length;
                    
                    mps.forEach(m => {
                        if (!m) return;
                        
                        let mId = m.id || String(m);
                        let mNama = m.nama || '-';
                        
                        let mInfo = this.masterMP.find(x => x && x.id === mId) || {};
                        let joinDate = mInfo.join_date || '-';
                        let line = h.targetLine || '-';
                        
                        if(fNama && !mNama.toLowerCase().includes(fNama) && !mId.toLowerCase().includes(fNama)) return;
                        if(fLine && !line.toLowerCase().includes(fLine)) return;
                        
                        let pKey = `${mId}-${line}`;
                        
                        if(!pivot[pKey]) {
                            pivot[pKey] = { nama: mNama, id: mId, join_date: joinDate, line: line, total: 0 };
                        }
                        if(!pivot[pKey][dKey]) pivot[pKey][dKey] = 0;
                        pivot[pKey][dKey] += cctPerMP; pivot[pKey].total += cctPerMP;
                    });
                });

                let html = `<table class="w-full text-left border-collapse whitespace-nowrap text-xs min-w-max">
                    <thead class="bg-slate-100 text-slate-600 shadow-sm border-b-2 border-slate-200">
                        <tr>
                            <th class="px-4 py-2 font-bold sticky left-0 bg-slate-100 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.05)] min-w-[16rem] align-top">
                                <div class="mb-1">Manpower Detail</div>
                                <div class="flex gap-2">
                                    <input type="text" id="flt-rmp-nama" value="${this.rekapMpFilterVals.nama}" oninput="if(!app.rekapMpFilterVals) app.rekapMpFilterVals={nama:'',line:''}; app.rekapMpFilterVals.nama=this.value; app.renderRekapMP()" placeholder="Filter Nama/NRP..." class="w-full text-[10px] p-1 border rounded font-normal text-slate-700 outline-none focus:ring-1 focus:ring-blue-500">
                                    <input type="text" id="flt-rmp-line" value="${this.rekapMpFilterVals.line}" oninput="if(!app.rekapMpFilterVals) app.rekapMpFilterVals={nama:'',line:''}; app.rekapMpFilterVals.line=this.value; app.renderRekapMP()" placeholder="Filter Line..." class="w-20 text-[10px] p-1 border rounded font-normal text-slate-700 outline-none focus:ring-1 focus:ring-blue-500">
                                </div>
                            </th>`;
                dateKeys.forEach(dk => { html += `<th class="px-4 py-2 font-bold text-center border-r bg-slate-50 align-top"><div class="pt-4">${this.formatDateShort(new Date(dk))}</div></th>`; });
                html += `<th class="px-4 py-2 font-bold text-right bg-indigo-100 sticky right-0 z-10 shadow-[-2px_0_5px_rgba(0,0,0,0.05)] align-top"><div class="pt-4">Total Output</div></th></tr></thead><tbody class="bg-white divide-y divide-slate-100">`;
                
                if(Object.keys(pivot).length === 0) {
                    html += `<tr><td colspan="${dateKeys.length + 2}" class="px-4 py-12 text-center text-slate-400 italic">Tidak ada data untuk rentang waktu/filter ini.</td></tr>`;
                } else {
                    Object.values(pivot).sort((a,b)=>b.total-a.total).forEach(m => {
                        let mk = app.calculateMasaKerja(m.join_date);
                        html += `<tr class="hover:bg-blue-50"><td class="px-4 py-2 sticky left-0 bg-white border-r z-0 w-64"><div class="font-bold">${m.nama || '-'}</div><div class="text-[9px] text-slate-500 mt-0.5"><span class="font-mono bg-slate-100 px-1 rounded">${m.id || '-'}</span> | Line: <span class="font-bold text-slate-700">${m.line || '-'}</span> | MK: <span class="text-teal-600 font-bold">${mk || '-'}</span></div></td>`;
                        dateKeys.forEach(dk => { html += `<td class="px-4 py-2 text-center border-r font-mono">${m[dk] ? m[dk].toFixed(1) : '-'}</td>`; });
                        html += `<td class="px-4 py-2 font-black text-indigo-600 text-right bg-indigo-50 sticky right-0 z-0">${m.total.toFixed(1)}</td></tr>`;
                    });
                }
                html += `</tbody></table>`; 
                container.innerHTML = html;
                
                if(document.activeElement && document.activeElement.id && document.activeElement.id.startsWith('flt-rmp')) {
                    let focusedId = document.activeElement.id;
                    setTimeout(() => { let el = document.getElementById(focusedId); if(el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
                }
            },

            calculateMasaKerja: function(jd) {
                if(!jd || jd==='-') return '-'; let d = new Date(jd); if(isNaN(d)) return '-';
                let dif = Math.ceil(Math.abs(new Date() - d) / 86400000); let y = Math.floor(dif/365); let m = Math.floor((dif%365)/30);
                if(y>0) return `${y}Thn ${m}Bln`; if(m>0) return `${m}Bln`; return `${dif}Hr`;
            },

            renderAdminTransactions: function() {
                let data = this.getFilteredReportsForAdmin();
                
                let fDate = document.getElementById('flt-col-date').value.toLowerCase();
                let fLeader = document.getElementById('flt-col-leader').value.toLowerCase();
                let fSn = document.getElementById('flt-col-sn').value.toLowerCase();
                let fAssy = document.getElementById('flt-col-assy').value.toLowerCase();
                let fMp = document.getElementById('flt-col-mp').value.toLowerCase();
                let fLine = document.getElementById('flt-col-line').value.toLowerCase();

                let filtered = data.filter(h => {
                    let dStr = new Date(h.finishedAt).toLocaleString().toLowerCase();
                    let mps = h.mps || [];
                    let mStr = mps.map(m => {
                        if (!m) return '';
                        let id = m.id || String(m);
                        let nama = m.nama || '';
                        return `${id} ${nama}`;
                    }).join(' ').toLowerCase();
                    return dStr.includes(fDate) && (h.leaderName||'').toLowerCase().includes(fLeader) &&
                           h.sn.toLowerCase().includes(fSn) && h.noAssy.toLowerCase().includes(fAssy) &&
                           mStr.includes(fMp) && (h.targetLine||'').toLowerCase().includes(fLine);
                });

                const tbody = document.getElementById('admin-trx-tbody'); tbody.innerHTML = '';
                filtered.forEach(h => {
                    let mps = h.mps || [];
                    let mpStr = mps.map(m => {
                        if (!m) return '';
                        let id = m.id || String(m);
                        let nama = m.nama || '-';
                        return `<b>${nama}</b> <span class="text-[9px]">(${id})</span>`;
                    }).join('<br>');

                    let dtHtml = '';
                    if(h.downtimes && h.downtimes.length > 0) {
                        h.downtimes.forEach(dt => { if(dt.duration > 0) dtHtml += `<div class="text-[9px] border-b border-dashed border-amber-100 pb-0.5 mb-0.5"><span class="font-bold">${dt.reason}</span>: ${this.formatMs(dt.duration)}</div>`; });
                    }
                    if(!dtHtml) dtHtml = '<span class="text-slate-300">-</span>';
                    
                    let statClass = h.finalStatus === 'OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800';
                    let tr = `<tr class="hover:bg-indigo-50 transition">
                        <td class="px-3 py-2 border-r border-slate-100">${new Date(h.finishedAt).toLocaleString()}</td>
                        <td class="px-3 py-2 border-r">${h.shift} - ${h.leaderName||'-'}</td>
                        <td class="px-3 py-2 border-r font-mono font-bold text-blue-600">${h.sn}</td>
                        <td class="px-3 py-2 border-r">${h.noAssy}</td>
                        <td class="px-3 py-2 border-r text-center">${mps.length>1 ? `<span class="font-bold text-indigo-600">${h.cct}</span><div class="text-[9px] text-slate-400">@ ${(h.cct/mps.length).toFixed(1)}</div>` : `<span class="font-bold text-indigo-600">${h.cct}</span>`}</td>
                        <td class="px-3 py-2 border-r leading-tight">${mpStr}</td>
                        <td class="px-3 py-2 border-r font-bold text-slate-600 text-center">${h.targetLine}</td>
                        <td class="px-3 py-2 border-r font-timer text-center">${h.durationMin.toFixed(2)}</td>
                        <td class="px-3 py-2 border-r font-mono text-amber-600">${dtHtml}<div class="font-bold text-amber-700 mt-1 pt-1 border-t border-amber-200 text-right">Tot: ${(h.downtimeMin || 0).toFixed(2)}m</div></td>
                        <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${statClass}">${h.finalStatus}</span></td>
                    </tr>`;
                    tbody.insertAdjacentHTML('beforeend', tr);
                });
            },

            // --- MASTER DATA MODALS & CRUD ---
            renderMasterAssy: function() {
                let src = document.getElementById('src-mas-assy').value.toLowerCase();
                const tb = document.getElementById('master-assy-tbody'); 
                
                let filtered = this.masterAssy.filter(a => a.no_assy.toLowerCase().includes(src));
                let displayData = filtered.slice(0, 150); // Meringankan RAM, render maks 150 baris
                let html = '';
                
                displayData.forEach(a => {
                    html += `<tr id="row-assy-${a.no_assy}"><td class="px-4 py-2 font-mono font-bold text-blue-600">${a.no_assy}</td><td class="px-4 py-2 editable-cell font-mono" contenteditable="true" onblur="app.saveInline('ASSY','${a.no_assy}','cct',this.innerText)">${a.cct}</td><td class="px-4 py-2 editable-cell font-mono" contenteditable="true" onblur="app.saveInline('ASSY','${a.no_assy}','umh',this.innerText)">${a.umh}</td><td class="px-4 py-2 text-[10px] text-slate-400">${a.last_edited||'-'}</td><td class="px-4 py-2"><button onclick="app.delMaster('ASSY','${a.no_assy}')" class="text-red-400 hover:text-red-600 transition"><i class="fas fa-trash"></i></button></td></tr>`;
                });
                
                if (filtered.length > 150) html += `<tr><td colspan="5" class="px-4 py-3 text-center text-xs text-slate-500 italic bg-slate-50 border-t">Menampilkan 150 dari ${filtered.length} data. Gunakan fitur pencarian untuk menemukan data spesifik.</td></tr>`;
                else if (filtered.length === 0) html = `<tr><td colspan="5" class="px-4 py-3 text-center text-xs text-slate-500 italic">Data tidak ditemukan.</td></tr>`;
                
                tb.innerHTML = html; // Pasang ke DOM hanya 1x
            },
            renderMasterMP: function() {
                let src = document.getElementById('src-mas-mp').value.toLowerCase();
                const tb = document.getElementById('master-mp-tbody'); 
                
                let filtered = this.masterMP.filter(m => m.id.toLowerCase().includes(src) || m.nama.toLowerCase().includes(src));
                let displayData = filtered.slice(0, 150);
                let html = '';
                
                displayData.forEach(m => {
                    html += `<tr id="row-mp-${m.id}"><td class="px-4 py-2 font-mono font-bold">${m.id}</td><td class="px-4 py-2 editable-cell font-bold text-slate-700" contenteditable="true" onblur="app.saveInline('MP','${m.id}','nama',this.innerText)">${m.nama}</td><td class="px-4 py-2 editable-cell font-mono text-slate-500" contenteditable="true" onblur="app.saveInline('MP','${m.id}','join_date',this.innerText)">${m.join_date}</td><td class="px-4 py-2 text-[10px] text-slate-400">${m.last_edited||'-'}</td><td class="px-4 py-2"><button onclick="app.delMaster('MP','${m.id}')" class="text-red-400 hover:text-red-600 transition"><i class="fas fa-trash"></i></button></td></tr>`;
                });
                
                if (filtered.length > 150) html += `<tr><td colspan="5" class="px-4 py-3 text-center text-xs text-slate-500 italic bg-slate-50 border-t">Menampilkan 150 dari ${filtered.length} data. Gunakan fitur pencarian untuk menemukan data spesifik.</td></tr>`;
                else if (filtered.length === 0) html = `<tr><td colspan="5" class="px-4 py-3 text-center text-xs text-slate-500 italic">Data tidak ditemukan.</td></tr>`;
                
                tb.innerHTML = html;
            },
            renderMasterLeader: function() {
                let src = document.getElementById('src-mas-leader').value.toLowerCase();
                const tb = document.getElementById('master-leader-tbody'); 
                
                let filtered = this.masterLeader.filter(l => l.lisensi.toLowerCase().includes(src) || l.nama.toLowerCase().includes(src));
                let displayData = filtered.slice(0, 150);
                let html = '';
                
                displayData.forEach(l => {
                    html += `<tr id="row-ld-${l.lisensi}"><td class="px-4 py-2 font-mono font-bold text-purple-600">${l.lisensi}</td><td class="px-4 py-2 editable-cell font-mono text-[10px] text-slate-400" contenteditable="true" onblur="app.saveInline('LEADER','${l.lisensi}','pass',this.innerText)">${l.pass}</td><td class="px-4 py-2 editable-cell font-bold" contenteditable="true" onblur="app.saveInline('LEADER','${l.lisensi}','nama',this.innerText)">${l.nama}</td><td class="px-4 py-2 editable-cell text-xs" contenteditable="true" onblur="app.saveInline('LEADER','${l.lisensi}','line',this.innerText)">${l.line}</td><td class="px-4 py-2 editable-cell font-bold text-center" contenteditable="true" onblur="app.saveInline('LEADER','${l.lisensi}','shift',this.innerText)">${l.shift}</td><td class="px-4 py-2 editable-cell font-mono" contenteditable="true" onblur="app.saveInline('LEADER','${l.lisensi}','target',this.innerText)">${l.target}</td><td class="px-4 py-2 text-[10px] text-slate-400">${l.last_edited||'-'}</td><td class="px-4 py-2"><button onclick="app.delMaster('LEADER','${l.lisensi}')" class="text-red-400 hover:text-red-600 transition"><i class="fas fa-trash"></i></button></td></tr>`;
                });
                
                if (filtered.length > 150) html += `<tr><td colspan="8" class="px-4 py-3 text-center text-xs text-slate-500 italic bg-slate-50 border-t">Menampilkan 150 dari ${filtered.length} data. Gunakan fitur pencarian untuk menemukan data spesifik.</td></tr>`;
                else if (filtered.length === 0) html = `<tr><td colspan="8" class="px-4 py-3 text-center text-xs text-slate-500 italic">Data tidak ditemukan.</td></tr>`;
                
                tb.innerHTML = html;
            },

            saveInline: async function(type, id, field, newVal) {
                let val = newVal.trim();
                let dateStr = new Date().toISOString().split('T')[0];
                let obj;
                if(type==='ASSY') { obj = this.masterAssy.find(x=>x.no_assy===id); if(field==='cct'||field==='umh') val = Number(val); }
                if(type==='MP') obj = this.masterMP.find(x=>x.id===id);
                if(type==='LEADER') { obj = this.masterLeader.find(x=>x.lisensi===id); if(field==='target') val = Number(val); }
                
                if(obj && obj[field] !== val) {
                    obj[field] = val; obj.last_edited = dateStr;
                    this.showToast("Data tersimpan otomatis.", "success");
                    this.persistMasterData();
                    if(type==='ASSY') this.renderMasterAssy(); if(type==='MP') this.renderMasterMP(); if(type==='LEADER') this.renderMasterLeader();
                }
            },
            
            openMasterModal: function(type) {
                if(type==='ASSY') { ['m-add-assy-no','m-add-assy-cct','m-add-assy-umh'].forEach(id=>document.getElementById(id).value=''); document.getElementById('modal-add-assy').classList.remove('hide'); setTimeout(()=>document.getElementById('m-add-assy-no').focus(), 100); }
                if(type==='MP') { ['m-add-mp-nrp','m-add-mp-nama','m-add-mp-join'].forEach(id=>document.getElementById(id).value=''); document.getElementById('modal-add-mp').classList.remove('hide'); setTimeout(()=>document.getElementById('m-add-mp-nrp').focus(), 100); }
                if(type==='LEADER') { ['m-add-ld-id','m-add-ld-pass','m-add-ld-nama','m-add-ld-line'].forEach(id=>document.getElementById(id).value=''); document.getElementById('m-add-ld-shift').value='A'; document.getElementById('modal-add-leader').classList.remove('hide'); setTimeout(()=>document.getElementById('m-add-ld-id').focus(), 100); }
            },
            saveNewMasterAssy: function() {
                let no = document.getElementById('m-add-assy-no').value.trim().toUpperCase(); let cct = document.getElementById('m-add-assy-cct').value; let umh = document.getElementById('m-add-assy-umh').value;
                if(!no || !cct || !umh) { this.showToast("Isi semua data Assy!", "warning"); return; }
                this.masterAssy.unshift({ no_assy: no, cct: Number(cct), umh: Number(umh), last_edited: new Date().toISOString().split('T')[0] });
                this.persistMasterData(); this.renderMasterAssy(); this.closeModal('modal-add-assy'); this.showToast("Data Assy ditambahkan.", "success");
            },
            saveNewMasterMP: function() {
                let nrp = document.getElementById('m-add-mp-nrp').value.trim().toUpperCase(); let nama = document.getElementById('m-add-mp-nama').value.trim(); let jd = document.getElementById('m-add-mp-join').value;
                if(!nrp || !nama) { this.showToast("NRP dan Nama wajib diisi!", "warning"); return; }
                this.masterMP.unshift({ id: nrp, nama: nama, join_date: jd || '-', shift: 'A', last_edited: new Date().toISOString().split('T')[0] });
                this.persistMasterData(); this.renderMasterMP(); this.closeModal('modal-add-mp'); this.showToast("Data MP ditambahkan.", "success");
            },
            saveNewMasterLeader: function() {
                let id = document.getElementById('m-add-ld-id').value.trim().toUpperCase(); let pass = document.getElementById('m-add-ld-pass').value; let nama = document.getElementById('m-add-ld-nama').value; let line = document.getElementById('m-add-ld-line').value; let shift = document.getElementById('m-add-ld-shift').value;
                if(!id || !pass || !nama || !line) { this.showToast("Semua kolom wajib diisi!", "warning"); return; }
                this.masterLeader.unshift({ lisensi: id, pass: pass, nama: nama, line: line, shift: shift, target: 5000, last_edited: new Date().toISOString().split('T')[0] });
                this.persistMasterData(); this.renderMasterLeader(); this.closeModal('modal-add-leader'); this.showToast("Otorisasi Leader ditambahkan.", "success");
            },

            delMaster: function(type, id) {
                if(!confirm(`Hapus data ${id}?`)) return;
                if(type==='ASSY') this.masterAssy = this.masterAssy.filter(x=>x.no_assy!==id);
                if(type==='MP') this.masterMP = this.masterMP.filter(x=>x.id!==id);
                if(type==='LEADER') this.masterLeader = this.masterLeader.filter(x=>x.lisensi!==id);
                this.persistMasterData();
                if(type==='ASSY') this.renderMasterAssy(); if(type==='MP') this.renderMasterMP(); if(type==='LEADER') this.renderMasterLeader();
            },
            persistMasterData: async function() {
                if(this.db) {
                    // Placeholder for Firestore commit
                } else {
                    this.persistLocal('masterAssy', this.masterAssy); this.persistLocal('masterMP', this.masterMP); this.persistLocal('masterLeader', this.masterLeader);
                }
            },

            openReportModal: function() {
                // UX Poka-Yoke: Kunci filter hanya untuk area Leader yang sedang aktif.
                // Karena arsitektur Data Sharding, data line lain memang tidak ditarik ke memori lokal.
                let filterHtml = `<option value="${this.leader.line}">${this.leader.line} (Area Anda)</option>`;
                let filterEl = document.getElementById('report-line-filter');
                filterEl.innerHTML = filterHtml;
                filterEl.disabled = true; // Kunci dropdown
                filterEl.classList.add('cursor-not-allowed', 'text-teal-700', 'bg-teal-50'); // Beri indikator visual bahwa ini ruang eksklusifnya
                
                document.getElementById('modal-report').classList.remove('hide');
                this.renderReportModal();
            },

            renderReportModal: function() {
                const tbody = document.getElementById('report-modal-tbody'); const summaryContainer = document.getElementById('report-line-summary');
                const filterLine = document.getElementById('report-line-filter').value;
                tbody.innerHTML = '';
                
                let todayMs = new Date().setHours(0,0,0,0);
                let todayData = this.historyReports.filter(h => h.finishedAt >= todayMs);
                
                let lineOutputAgg = {}; 
                todayData.forEach(h => {
                    let l = h.targetLine;
                    if(!lineOutputAgg[l]) lineOutputAgg[l] = { cct: 0, qty: 0, assys: new Set() };
                    lineOutputAgg[l].cct += h.cct; lineOutputAgg[l].qty += 1; lineOutputAgg[l].assys.add(h.noAssy);
                    
                    if(filterLine === 'ALL' || l === filterLine) {
                        let mps = h.mps || [];
                        let mpStr = mps.map(m => {
                            if (!m) return '';
                            return m.nama || String(m);
                        }).join(', ');
                        
                        let dtHtml = '';
                        if(h.downtimes && h.downtimes.length > 0) {
                            h.downtimes.forEach(dt => { if(dt.duration > 0) dtHtml += `<div class="text-[9px] border-b border-dashed border-amber-100 pb-0.5 mb-0.5"><span class="font-bold">${dt.reason}</span>: ${this.formatMs(dt.duration)}</div>`; });
                        }
                        if(!dtHtml) dtHtml = '<span class="text-slate-300">-</span>';
                        
                        let statClass = h.finalStatus === 'OK' ? 'text-emerald-600' : 'text-red-600';
                        tbody.innerHTML += `
                        <tr class="hover:bg-slate-50 border-b border-slate-100">
                            <td class="px-4 py-2 font-bold text-slate-700">${h.leaderName || '-'}</td>
                            <td class="px-4 py-2 font-mono text-blue-600">${h.sn}</td>
                            <td class="px-4 py-2">${h.noAssy}</td>
                            <td class="px-4 py-2 font-bold text-indigo-600 text-center">${h.cct}</td>
                            <td class="px-4 py-2 font-bold text-slate-700">${h.targetLine}</td>
                            <td class="px-4 py-2 truncate max-w-[150px]" title="${mpStr}">${mpStr}</td>
                            <td class="px-4 py-2 font-timer">${h.durationMin.toFixed(1)}</td>
                            <td class="px-4 py-2 font-mono text-amber-600">${dtHtml}<div class="font-bold text-amber-700 mt-1 pt-1 border-t border-amber-200 text-right">Tot: ${(h.downtimeMin || 0).toFixed(2)}m</div></td>
                            <td class="px-4 py-2 font-bold ${statClass}">${h.finalStatus}</td>
                        </tr>`;
                    }
                });

                let summaryHtml = '';
                for (const [line, data] of Object.entries(lineOutputAgg)) {
                    let hl = (filterLine === line || filterLine === 'ALL') ? 'bg-white border-indigo-200' : 'bg-slate-100 opacity-50';
                    summaryHtml += `
                    <div class="${hl} border rounded-xl p-3 flex flex-col transition-all">
                        <span class="text-[10px] text-slate-500 font-bold uppercase border-b pb-1 mb-2">${line}</span>
                        <div class="flex justify-between items-end"><span class="text-[9px] text-slate-400">Total CCT</span><span class="text-xl font-bold text-indigo-700 leading-none">${data.cct.toFixed(0)}</span></div>
                        <div class="flex justify-between items-end mt-1"><span class="text-[9px] text-slate-400">Qty Unit</span><span class="text-sm font-bold text-slate-700 leading-none">${data.qty}</span></div>
                        <div class="flex justify-between items-end mt-1"><span class="text-[9px] text-slate-400">Var. Assy</span><span class="text-sm font-bold text-slate-700 leading-none">${data.assys.size}</span></div>
                    </div>`;
                }
                summaryContainer.innerHTML = summaryHtml || '<div class="col-span-full text-xs text-slate-400 italic">Belum ada output hari ini.</div>';
                if(tbody.innerHTML === '') tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-8 text-center text-slate-400 text-sm italic">Data kosong.</td></tr>`;
            },
            
            exportDailyReport: function() {
                let todayMs = new Date().setHours(0,0,0,0); let data = this.historyReports.filter(h => h.finishedAt >= todayMs);
                if(data.length === 0) return;
                let csv = "Tanggal,Leader,Serial Number,No Assy,Target Line,Total CCT,WP,Manpower,Durasi (m),Downtime (m),Status\n";
                data.forEach(h => {
                    let tgl = new Date(h.finishedAt).toLocaleString(); 
                    let mps = h.mps || [];
                    let mpStr = mps.map(m => m ? (m.nama || String(m)) : '').join(' & ');
                    csv += `"${tgl}","${h.leaderName || '-'}",${h.sn},${h.noAssy},"${h.targetLine}",${h.cct},${h.wp},"${mpStr}",${h.durationMin.toFixed(2)},${(h.downtimeMin || 0).toFixed(2)},${h.finalStatus}\n`;
                });
                let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); let link = document.createElement("a");
                link.setAttribute("href", URL.createObjectURL(blob)); link.setAttribute("download", `Daily_Assembling_Report.csv`);
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
            },

            exportCSV: function() {
                let data = this.getFilteredReportsForAdmin(); if(data.length === 0) return;
                let csv = "Tanggal,Leader,Serial Number,No Assy,Target Line,Total CCT,WP,Manpower,Durasi (m),Downtime (m),Status\n";
                data.forEach(h => {
                    let tgl = new Date(h.finishedAt).toLocaleString(); 
                    let mps = h.mps || [];
                    let mpStr = mps.map(m => m ? (m.nama || String(m)) : '').join(' & ');
                    csv += `"${tgl}","${h.leaderName || '-'}",${h.sn},${h.noAssy},"${h.targetLine}",${h.cct},${h.wp},"${mpStr}",${h.durationMin.toFixed(2)},${(h.downtimeMin || 0).toFixed(2)},${h.finalStatus}\n`;
                });
                let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); let link = document.createElement("a");
                link.setAttribute("href", URL.createObjectURL(blob)); link.setAttribute("download", `Admin_Full_Report.csv`);
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
            },

            filterWpList: function(inputEl) {
                const val = inputEl.value.toUpperCase();
                const datalist = document.getElementById(inputEl.getAttribute('list'));
                if (!datalist) return;
                
                if (val.length >= 1) {
                    let filtered = this.validWpList.filter(wp => wp.startsWith(val));
                    let html = '';
                    filtered.forEach(wp => html += `<option value="${wp}">`);
                    datalist.innerHTML = html;
                } else {
                    datalist.innerHTML = ''; 
                }
            },

            openAdminLogin: function() {
                document.getElementById('admin-pass-input').value = '';
                document.getElementById('admin-auth-subtitle').innerText = `Otorisasi diperlukan untuk Leader: ${this.leader.nama}`;
                document.getElementById('modal-password').classList.remove('hide');
                setTimeout(() => document.getElementById('admin-pass-input').focus(), 100);
            },
            confirmPassword: function() {
                const pass = document.getElementById('admin-pass-input').value;
                if(this.leader && pass === this.leader.pass) { 
                    this.closeModal('modal-password'); document.getElementById('main-dashboard').classList.add('hide'); document.getElementById('admin-dashboard').classList.remove('hide');
                    this.loadAdminData();
                    this.switchAdminTab('overview'); 
                } else this.showToast("Password Leader salah!", "error");
            },

            loadAdminData: function() {
                if(!this.db) { this.adminHistoryReports = this.historyReports; return; }
                const lines = ['Line_1', 'Line_2', 'Line_3', 'Line_4'];
                this.adminHistoryReports = [];
                if(this.unsubAdminHistories) this.unsubAdminHistories.forEach(u => u());
                this.unsubAdminHistories = [];
                
                lines.forEach(lineKey => {
                    let u = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`history_${lineKey}`).onSnapshot(snap => {
                        let data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        // Hindari duplikasi saat line terupdate
                        this.adminHistoryReports = this.adminHistoryReports.filter(h => h.targetLine && h.targetLine.replace(/\s+/g, '_') !== lineKey);
                        this.adminHistoryReports.push(...data);
                        if(!document.getElementById('admin-dashboard').classList.contains('hide')) this.applyAdminFilter();
                    });
                    this.unsubAdminHistories.push(u);
                });
            },

            closeAdmin: function() { 
                document.getElementById('admin-dashboard').classList.add('hide'); 
                document.getElementById('main-dashboard').classList.remove('hide'); 
            },
            closeModal: function(id) { document.getElementById(id).classList.add('hide'); },
            
            handleExcelUpload: function(event, type) {
                const file = event.target.files[0]; if(!file) return;
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const data = new Uint8Array(e.target.result); const wb = XLSX.read(data, {type: 'array'});
                        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                        let sc = 0; let dStr = new Date().toISOString().split('T')[0];
                        json.forEach(row => {
                            if(type === 'ASSY') {
                                let no = row['ASSY'] || row['Assy']; let c = row['CCT'] || row['cct']; let u = row['UMH'] || row['umh'];
                                if(no && c!==undefined && u!==undefined) {
                                    let idx = this.masterAssy.findIndex(a => a.no_assy === String(no).trim());
                                    if(idx > -1) { this.masterAssy[idx].cct = Number(c); this.masterAssy[idx].umh = Number(u); this.masterAssy[idx].last_edited = dStr; }
                                    else this.masterAssy.push({no_assy: String(no).trim(), cct: Number(c), umh: Number(u), last_edited: dStr});
                                    sc++;
                                }
                            } else if(type === 'MP') {
                                let id = row['NRP'] || row['ID']; let nm = row['Nama']; let jd = row['Join Date'] || '-';
                                if(id && nm) {
                                    let idx = this.masterMP.findIndex(m => m.id === String(id).trim().toUpperCase());
                                    if(idx > -1) { this.masterMP[idx].nama = String(nm); this.masterMP[idx].join_date = String(jd); this.masterMP[idx].last_edited = dStr; }
                                    else this.masterMP.push({id: String(id).trim().toUpperCase(), nama: String(nm), join_date: String(jd), last_edited: dStr});
                                    sc++;
                                }
                            }
                        });
                        this.persistMasterData(); this.showToast(`Import ${sc} data ${type} sukses!`, "success");
                        if(this.adminTab === 'master') { this.renderMasterAssy(); this.renderMasterMP(); } event.target.value = ''; 
                    } catch (err) { this.showToast("Gagal proses Excel.", "error"); }
                }; reader.readAsArrayBuffer(file);
            },

            openManualInputModal: function() { ['manual-scan-trigger','manual-assy','manual-sn','manual-cct','manual-umh'].forEach(id=>document.getElementById(id).value=''); document.getElementById('modal-manual').classList.remove('hide'); setTimeout(() => document.getElementById('manual-scan-trigger').focus(), 100); },
            handleManualScanTrigger: function(val) { let tr=val.trim(); let s=tr.indexOf(' '); if(s===-1||tr.length<12){this.showToast("Format Salah","error");return;} document.getElementById('manual-assy').value=tr.substring(0,s); document.getElementById('manual-sn').value=tr.slice(-11); document.getElementById('manual-scan-trigger').value=''; this.showToast("Barcode terekstrak","success"); document.getElementById('manual-cct').focus(); },
            confirmManualInput: function() {
                let a=document.getElementById('manual-assy').value.trim(); let s=document.getElementById('manual-sn').value.trim();
                let c=parseInt(document.getElementById('manual-cct').value); let u=parseInt(document.getElementById('manual-umh').value);
                if(!a||!s||isNaN(c)||isNaN(u)) { this.showToast("Isi semua kolom", "warning"); return; }
                this.closeModal('modal-manual');
                let ex = this.masterAssy.find(x=>x.no_assy===a); if(!ex || ex.cct!==c || ex.umh!==u) this.saveNewAssy({no_assy:a,cct:c,umh:u});
                this.scanDataTmp = {noAssy:a,sn:s,cct:c,umh:u};
                document.getElementById('init-assy').innerText=a; document.getElementById('init-sn').innerText=s; document.getElementById('init-cct').innerText=c; document.getElementById('init-umh').innerText=u; document.getElementById('wp-input').value='';
                
                this.tempMps = []; this.renderTempMps(false); document.getElementById('init-mp-input').value = '';
                
                document.getElementById('init-form-container').classList.remove('hide'); document.getElementById('init-line-select').value=this.leader.line; document.getElementById('wp-input').focus();
            },
            openBatchMode: function() { document.getElementById('modal-batch').classList.remove('hide'); ['batch-scan-trigger','b-wp-input','b-mp-input'].forEach(id=>document.getElementById(id).value=''); ['batch-assy','batch-cct','batch-umh'].forEach(id=>document.getElementById(id).innerText='-'); this.batchItemsValid=[]; this.updateBatchUI(); this.tempMps = []; this.renderTempMps(true); setTimeout(() => document.getElementById('batch-scan-trigger').focus(), 100); },
            
            processBatchScan: function(val) {
                let tr=val.trim(); document.getElementById('batch-scan-trigger').value=''; let s=tr.indexOf(' '); if(s===-1||tr.length<12){this.showToast("Format invalid","error");return;}
                let a=tr.substring(0,s); let sn=tr.slice(-11); let c=null,u=null;
                
                if(this.activeQueue.some(q => (q.isBatch && q.batchSNs.includes(sn)) || (!q.isBatch && q.sn === sn)) || this.historyReports.some(h => h.sn === sn)) { 
                    this.showToast(`Serial ${sn} sudah diproses / ada di antrian!`, "error"); return; 
                }

                if(this.batchItemsValid.length===0){ let d=this.masterAssy.find(x=>x.no_assy===a); if(!d){this.showToast("Assy tdk ada di master","error");return;} c=d.cct; u=d.umh; document.getElementById('batch-assy').innerText=a; document.getElementById('batch-cct').innerText=c; document.getElementById('batch-umh').innerText=u; }
                else if(a!==document.getElementById('batch-assy').innerText){this.showToast("Assy berbeda!","error");return;}
                if(this.batchItemsValid.some(v=>v.sn===sn)){this.showToast("Duplicate di list batch ini","error");return;}
                this.batchItemsValid.push({noAssy:a,sn:sn}); this.updateBatchUI();
            },
            updateBatchUI: function() { let l=document.getElementById('batch-valid-list'); l.innerHTML=''; this.batchItemsValid.forEach(v=>{l.innerHTML+=`<div class="p-1 border-b flex justify-between"><span>${v.sn}</span> <span class="text-teal-600">Valid</span></div>`;}); document.getElementById('batch-count').innerText=this.batchItemsValid.length; document.getElementById('btn-batch-start').disabled=this.batchItemsValid.length===0; },
            startBatch: async function() {
                let w=document.getElementById('b-wp-input').value.toUpperCase(); 
                let mps=[...this.tempMps]; 
                let bData = { id:`BCH-${Date.now()}`, sn:this.batchItemsValid[0].sn, batchSNs:this.batchItemsValid.map(v=>v.sn), isBatch:true, batchSize:this.batchItemsValid.length, noAssy:this.batchItemsValid[0].noAssy, cct:parseInt(document.getElementById('batch-cct').innerText), baseUmh:parseInt(document.getElementById('batch-umh').innerText), wp:w, mps:mps, targetLine:document.getElementById('b-line-select').value, startTime:Date.now(), status:'running', totalDowntime:0, downtimes:[], lastDowntimeStart:null, isGlobalPause:false, shift:this.shift, leaderName:this.leader.nama };
                this.closeModal('modal-confirm-start'); this.closeModal('modal-batch'); this.showToast(`Batch Started`,"success"); this.saveToQueue(bData);
            },
            updateQueueDoc: async function(id, data) { 
                let lineKey = this.leader.line.replace(/\s+/g, '_');
                if(this.db) await this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(`active_queue_${lineKey}`).doc(id).update(data); 
                else { let idx=this.activeQueue.findIndex(q=>q.id===id); if(idx>-1){this.activeQueue[idx]={...this.activeQueue[idx],...data}; this.persistLocal(`activeQueue_${lineKey}`,this.activeQueue); this.renderQueue();} } 
            }
        };

        window.onload = () => app.init();
