        const app = {
            db: null,
            auth: null,
            appId: typeof __app_id !== 'undefined' ? __app_id : 'default-app-id',
            user: null, 
            shift: null, 
            leader: null,
            
            masterAssy: masterDataAssy,
            masterMP: masterDataMP,
            masterLeader: masterDataLeader,
            
            activeQueue: [],
            historyReports: [],
            validWpList: [], 
            
            scanDataTmp: null, 
            activeTaskTmpId: null, 
            resumePendingId: null, 
            batchItemsValid: [],
            isIstirahatGlobal: false,
            
            adminTab: 'overview', 

            init: async function() {
                try {
                    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
                    if(firebaseConfig && !firebase.apps.length) firebase.initializeApp(firebaseConfig);
                    
                    if(firebase.apps.length) {
                        this.auth = firebase.auth();
                        this.db = firebase.firestore();
                        try { await this.db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
                        
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await this.auth.signInWithCustomToken(__initial_auth_token);
                        } else {
                            await this.auth.signInAnonymously();
                        }
                        this.auth.onAuthStateChanged(user => {
                            if (user) {
                                this.user = user;
                                this.setupRealtimeListeners();
                            }
                        });
                    } else {
                        this.useLocalFallback();
                    }
                    
                    this.setupUIBindings();
                    this.startClock();
                    this.monitorNetwork();
                    
                    Chart.defaults.animation = false;
                    
                } catch(e) {
                    this.showToast("System Init Error", "error");
                }
            },

            setupRealtimeListeners: function() {
                if(!this.db || !this.user) return;
                const refQueue = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('active_queue');
                const refHist = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('history');

                refQueue.onSnapshot(snap => {
                    this.activeQueue = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    this.renderQueue();
                }, err => {});

                refHist.onSnapshot(snap => {
                    let allData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    allData.sort((a,b) => b.finishedAt - a.finishedAt);
                    this.historyReports = allData.slice(0, 1000); 
                    
                    if(!document.getElementById('admin-dashboard').classList.contains('hide')) {
                        if(this.adminTab === 'overview') this.renderAdminOverview();
                        if(this.adminTab === 'leaderboard') this.renderAdminLeaderboard();
                        if(this.adminTab === 'transactions') this.renderAdminTransactions();
                        if(this.adminTab === 'rekapline') this.renderRekapLine();
                        if(this.adminTab === 'rekapmp') this.renderRekapMP();
                    }
                }, err => {});
            },

            useLocalFallback: function() {
                let localAssy = JSON.parse(localStorage.getItem('localMasterAssy'));
                let localMP = JSON.parse(localStorage.getItem('localMasterMP'));
                this.masterAssy = (localAssy && localAssy.length > 0) ? localAssy : masterDataAssy;
                this.masterMP = (localMP && localMP.length > 0) ? localMP : masterDataMP;
                
                this.activeQueue = JSON.parse(localStorage.getItem('activeQueue') || '[]');
                this.historyReports = JSON.parse(localStorage.getItem('historyReports') || '[]');
                this.isIstirahatGlobal = JSON.parse(localStorage.getItem('isIstirahatGlobal') || 'false');
                this.renderQueue();
            },

            setupUIBindings: function() {
                const mainInput = document.getElementById('main-scan-input');
                mainInput.addEventListener('keypress', (e) => {
                    if(e.key === 'Enter') { this.processRawScan(mainInput.value, 'IN'); mainInput.value = ''; }
                });

                const scanOutInput = document.getElementById('scan-out-input');
                scanOutInput.addEventListener('keypress', (e) => {
                    if(e.key === 'Enter') { this.processRawScan(scanOutInput.value, 'OUT'); scanOutInput.value = ''; }
                });

                ['mp1-id', 'mp2-id', 'mp3-id'].forEach(id => {
                    const el = document.getElementById(id);
                    el.addEventListener('input', (e) => this.lookupMP(e.target.value, `${id.split('-')[0]}-info`));
                    el.addEventListener('keypress', (e) => {
                        if(e.key === 'Enter') {
                            let next = parseInt(id.charAt(2)) + 1;
                            if(next <= 3) document.getElementById(`mp${next}-id`).focus();
                            else this.startProcess();
                        }
                    });
                });
                
                ['b-mp1', 'b-mp2', 'b-mp3'].forEach((id, index) => {
                    const el = document.getElementById(id);
                    el.addEventListener('input', (e) => this.lookupMP(e.target.value, `${id}-info`));
                    el.addEventListener('keypress', (e) => {
                        if(e.key === 'Enter') {
                            let next = index + 2; 
                            if(next <= 3) document.getElementById(`b-mp${next}`).focus();
                            else this.startBatch();
                        }
                    });
                });

                const symbols = ['C', '/', '-', 'S', 'E', 'P'];
                this.validWpList = []; 
                for(let i = 1; i <= 12; i++) {
                    let mm = i.toString().padStart(2, '0');
                    for(let j = 1; j <= 12; j++) {
                        let nn = j.toString().padStart(2, '0');
                        for(let sym of symbols) {
                            this.validWpList.push(`${mm}${sym}${nn}`);
                        }
                    }
                }
            },

            monitorNetwork: function() {
                const updateStatus = () => {
                    const el = document.getElementById('network-status');
                    if(navigator.onLine) {
                        el.classList.add('bg-emerald-100', 'text-emerald-800');
                        setTimeout(() => el.classList.add('hide'), 3000);
                    } else {
                        el.classList.remove('hide', 'bg-emerald-100');
                        el.classList.add('bg-red-500', 'text-white');
                        document.getElementById('network-text').innerText = "Offline Mode";
                    }
                };
                window.addEventListener('online', updateStatus);
                window.addEventListener('offline', updateStatus);
                updateStatus();
            },

            showToast: function(msg, type='info') {
                const container = document.getElementById('toast-container');
                const toast = document.createElement('div');
                toast.className = `toast ${type}`;
                toast.innerHTML = `<i class="fas fa-info-circle mr-2"></i> ${msg}`;
                container.appendChild(toast);
                setTimeout(() => { toast.remove() }, 3000); 
            },

            login: function() {
                const lisensi = document.getElementById('login-lisensi').value.trim().toUpperCase();
                const pass = document.getElementById('login-pass').value.trim();
                
                const validLeader = this.masterLeader.find(l => l.lisensi === lisensi && l.pass === pass);
                
                if(validLeader) {
                    this.leader = validLeader;
                    this.shift = validLeader.shift;
                    
                    document.getElementById('header-shift').innerText = validLeader.shift;
                    document.getElementById('header-line').innerText = validLeader.line;
                    document.getElementById('header-leader').innerText = validLeader.nama;
                    
                    document.getElementById('login-screen').classList.add('hide');
                    document.getElementById('main-dashboard').classList.remove('hide');
                    this.showToast(`Welcome, ${validLeader.nama} (Line: ${validLeader.line})`, 'success');
                    setTimeout(() => document.getElementById('main-scan-input').focus(), 500);
                } else {
                    this.showToast('Lisensi atau Password tidak valid', 'error');
                }
            },
            logout: function() {
                this.shift = null; this.leader = null;
                document.getElementById('login-screen').classList.remove('hide');
                document.getElementById('main-dashboard').classList.add('hide');
                document.getElementById('admin-dashboard').classList.add('hide');
                document.getElementById('login-lisensi').value = '';
                document.getElementById('login-pass').value = '';
            },

            processRawScan: function(rawStr, mode) {
                let trimmedStr = rawStr.trim();
                let firstSpaceIndex = trimmedStr.indexOf(' ');

                if(firstSpaceIndex === -1 || trimmedStr.length < 12) {
                    this.showToast("Format Barcode tidak dikenali", "error");
                    return;
                }
                
                let noAssy = trimmedStr.substring(0, firstSpaceIndex); 
                let sn = trimmedStr.slice(-11);
                
                if(mode === 'IN') {
                    if(this.activeQueue.some(q => (q.isBatch && q.batchSNs.includes(sn)) || (!q.isBatch && q.sn === sn)) || this.historyReports.some(h => h.sn === sn)) {
                        this.showToast(`Duplicate: SN ${sn} sudah diproses!`, "error"); return;
                    }

                    const assyData = this.masterAssy.find(a => a.no_assy === noAssy);
                    if(!assyData) {
                        this.showToast(`Assy ${noAssy} tidak dikenal di Master Data`, "error"); return;
                    }

                    this.scanDataTmp = { noAssy, sn, cct: assyData.cct, umh: assyData.umh };
                    document.getElementById('init-assy').innerText = noAssy;
                    document.getElementById('init-sn').innerText = sn;
                    document.getElementById('init-cct').innerText = assyData.cct;
                    document.getElementById('init-umh').innerText = assyData.umh;
                    document.getElementById('wp-input').value = ''; 
                    
                    document.getElementById('init-form-container').classList.remove('hide');
                    document.getElementById('wp-input').focus();
                    
                } else if(mode === 'OUT') {
                    const activeItem = this.activeQueue.find(q => 
                        (q.isBatch && q.batchSNs.includes(sn)) || (!q.isBatch && q.sn === sn)
                    );

                    if(activeItem) {
                        if(activeItem.status === 'downtime') {
                            this.showToast("Gagal: Antrian sedang dalam status Downtime. Resume terlebih dahulu.", "warning"); return;
                        }
                        this.finishProcess(activeItem.id);
                    } else {
                        this.showToast(`SN ${sn} tidak ditemukan di Active Queue`, "error");
                    }
                }
            },

            lookupMP: function(val, targetId) {
                const target = document.getElementById(targetId);
                if(!val) { target.innerText = "-"; return; }
                const mp = this.masterMP.find(m => m.id.toUpperCase() === val.toUpperCase());
                if(mp) {
                    target.innerHTML = `<span class="font-bold text-blue-600">${mp.nama}</span> <span class="text-xs text-slate-500">(${mp.line})</span>`;
                } else {
                    target.innerHTML = `<span class="text-red-500">NRP Tidak Dikenal</span>`;
                }
            },

            cancelInit: function() {
                document.getElementById('init-form-container').classList.add('hide');
                this.scanDataTmp = null;
                this.resumePendingId = null; 
                document.getElementById('main-scan-input').focus();
            },

            startProcess: async function() {
                if(!this.scanDataTmp) return;
                const btn = document.getElementById('btn-start-process');
                btn.disabled = true;

                try {
                    let wpRaw = document.getElementById('wp-input').value;
                    let wp = wpRaw ? wpRaw.toUpperCase() : '';
                    
                    if(!this.validWpList.includes(wp)) {
                        this.showToast(`WP "${wp}" tidak valid. Pilih dari rekomendasi!`, "error"); return;
                    }

                    let mps = [];
                    for(let i=1; i<=3; i++) {
                        let id = document.getElementById(`mp${i}-id`).value.toUpperCase();
                        if(id) {
                            let mpData = this.masterMP.find(m => m.id.toUpperCase() === id);
                            if(mpData) mps.push(mpData);
                            else { this.showToast(`NRP ${id} tidak valid`, "error"); return; }
                        }
                    }
                    if(mps.length === 0) { this.showToast("Minimal 1 Manpower dibutuhkan", "warning"); return; }

                    if(this.resumePendingId) {
                        const item = this.activeQueue.find(q => q.id === this.resumePendingId);
                        if(item) {
                            let now = Date.now();
                            let additionalDt = now - item.lastDowntimeStart;
                            
                            this.updateQueueDoc(item.id, { 
                                mps: mps,
                                wp: wp,
                                status: 'running', 
                                totalDowntime: item.totalDowntime + additionalDt, 
                                lastDowntimeStart: null,
                                isGlobalPause: false 
                            });
                            
                            this.showToast(`SN ${item.sn} Berhasil Dilanjutkan!`, "success");
                        }
                        this.resumePendingId = null; 
                    } else {
                        let processData = {
                            sn: this.scanDataTmp.sn,
                            noAssy: this.scanDataTmp.noAssy,
                            cct: this.scanDataTmp.cct,
                            baseUmh: this.scanDataTmp.umh,
                            wp: wp,
                            mps: mps,
                            startTime: Date.now(),
                            status: 'running', 
                            totalDowntime: 0,
                            lastDowntimeStart: null,
                            isGlobalPause: false, 
                            shift: this.shift,
                            leaderName: this.leader.nama 
                        };
                        
                        this.showToast("Proses Dimulai", "success");
                        this.saveToQueue(processData);
                    }
                    
                    this.cancelInit(); 
                    
                    ['mp1-id','mp2-id','mp3-id'].forEach(id => {
                        document.getElementById(id).value = '';
                        document.getElementById(id.split('-')[0]+'-info').innerText = '-';
                    });
                } finally {
                    btn.disabled = false;
                }
            },

            saveToQueue: async function(data) {
                let docId = data.id || data.sn; 
                if(this.db) {
                    await this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('active_queue').doc(docId).set(data);
                } else {
                    this.activeQueue.push({ ...data, id: docId });
                    this.persistLocal('activeQueue', this.activeQueue);
                    this.renderQueue();
                }
            },

            renderQueue: function(filterText = '') {
                const container = document.getElementById('active-queue-container');
                const countBadge = document.getElementById('queue-count');
                
                let filtered = this.activeQueue.filter(q => q.status !== 'pending'); 

                if(filterText) {
                    let ft = filterText.toLowerCase();
                    filtered = filtered.filter(q => 
                        (q.sn && q.sn.toLowerCase().includes(ft)) || 
                        q.noAssy.toLowerCase().includes(ft) ||
                        (q.isBatch && q.batchSNs.some(bsn => bsn.toLowerCase().includes(ft)))
                    );
                }
                
                let sortedFiltered = filtered.sort((a, b) => a.startTime - b.startTime);

                countBadge.innerText = sortedFiltered.length;
                this.updatePendingCount();
                
                let btnIstirahat = document.getElementById('btn-istirahat');
                if(this.isIstirahatGlobal) {
                    btnIstirahat.innerHTML = `<i class="fas fa-play-circle"></i> Selesai Istirahat`;
                    btnIstirahat.classList.add('bg-emerald-100', 'text-emerald-700');
                    btnIstirahat.classList.remove('bg-amber-100', 'text-amber-700');
                } else {
                    btnIstirahat.innerHTML = `<i class="fas fa-coffee"></i> Mulai Istirahat`;
                    btnIstirahat.classList.add('bg-amber-100', 'text-amber-700');
                    btnIstirahat.classList.remove('bg-emerald-100', 'text-emerald-700');
                }

                if(sortedFiltered.length === 0) {
                    container.innerHTML = `<div class="h-full flex items-center justify-center text-slate-400 text-sm italic">Queue is empty. Scan an Assy to begin.</div>`;
                    return;
                }

                container.innerHTML = '';
                sortedFiltered.forEach((q, index) => {
                    let sequenceNumber = index + 1;
                    const isDT = q.status === 'downtime';
                    const bgClass = isDT ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200';
                    const iconPlayPause = isDT ? '<i class="fas fa-play"></i> Cont.' : '<i class="fas fa-pause"></i> Pause';
                    const colorPlayPause = isDT ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50';
                    
                    let snDisplay = q.isBatch 
                        ? `<span class="bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-bold mr-1 text-[10px]">BATCH x${q.batchSize}</span> ${q.sn} <span class="text-[10px] text-slate-400 font-normal italic">...dan lainnya</span>` 
                        : q.sn;
                    
                    let cctDisplay = q.isBatch ? `${q.cct} (x${q.batchSize})` : q.cct;

                    let html = `
                    <div class="queue-item flex justify-between items-center p-3 rounded-lg border ${bgClass} shadow-sm" id="q-${q.id}">
                        <div class="flex-1 flex items-center gap-4">
                            <div class="w-10 h-10 rounded-full flex items-center justify-center ${isDT?'bg-amber-200 text-amber-700 border-amber-300':'bg-blue-100 text-blue-600 border-blue-200'} shrink-0 font-bold text-lg border-2" title="Urutan Pemrosesan">
                                ${sequenceNumber}
                            </div>
                            <div>
                                <div class="flex gap-2 items-baseline">
                                    <span class="font-bold text-slate-800 font-mono text-sm">${snDisplay}</span>
                                    <span class="text-[10px] bg-slate-200 text-slate-600 px-1.5 rounded">${q.noAssy}</span>
                                    <span class="text-[10px] text-indigo-500 font-bold ml-2">CCT: ${cctDisplay}</span>
                                </div>
                                <div class="text-xs text-slate-500 mt-1">
                                    <i class="fas fa-users mr-1 text-slate-400"></i> ${q.mps.map(m=>m.nama.split(' ')[0]).join(', ')} 
                                    <span class="mx-1">|</span> W/P: <span class="font-bold">${q.wp}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex items-center gap-4">
                            <div class="text-right">
                                <div class="font-timer font-bold ${isDT?'text-amber-600':'text-blue-600'} text-lg timer-display" data-id="${q.id}">00:00:00</div>
                                <div class="text-[9px] text-slate-400 uppercase tracking-wide timer-label">${q.isGlobalPause ? 'ISTIRAHAT' : (isDT ? 'DOWNTIME' : 'DURATION')}</div>
                            </div>
                            
                            <div class="flex flex-col gap-1 shrink-0 w-24">
                                <button onclick="app.toggleItemDowntime('${q.id}')" class="w-full text-xs py-1.5 rounded border ${colorPlayPause} font-semibold flex items-center justify-center gap-1 shadow-sm">
                                    ${iconPlayPause}
                                </button>
                            </div>
                        </div>
                    </div>`;
                    container.insertAdjacentHTML('beforeend', html);
                });
                this.updateTimers(); 
            },

            filterQueue: function() {
                const text = document.getElementById('queue-search').value;
                this.renderQueue(text);
            },

            // --- FUNGSI BARU: Poka-Yoke Pemotongan Scan Barcode Otomatis di Active Queue ---
            handleQueueScanSearch: function() {
                let inputEl = document.getElementById('queue-search');
                let val = inputEl.value.trim();
                
                // Jika input disinyalir merupakan scan barcode utuh (karena ada spasi pemisah dan panjang sesuai)
                let spaceIdx = val.indexOf(' ');
                if(spaceIdx !== -1 && val.length >= 12) {
                    // Potong secara otomatis menyisakan 11 digit terakhir (Serial Number)
                    inputEl.value = val.slice(-11);
                }
                
                // Panggil ulang filter agar merender tampilan sesuai dengan 11 digit yang sudah bersih
                this.filterQueue();
            },

            startClock: function() {
                const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
                setInterval(() => {
                    const now = new Date();
                    let d = now.getDate().toString().padStart(2, '0');
                    let m = months[now.getMonth()];
                    let y = now.getFullYear();
                    let timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '.'); 
                    
                    document.getElementById('clock-display').innerText = `${d} ${m} ${y} - ${timeStr}`;
                    this.updateTimers();
                }, 1000);
            },

            updateTimers: function() {
                const now = Date.now();
                document.querySelectorAll('.timer-display').forEach(el => {
                    const id = el.getAttribute('data-id');
                    const item = this.activeQueue.find(q => q.id === id);
                    if(item) {
                        let activeMs = 0;
                        if(item.status === 'running') {
                            activeMs = now - item.startTime - item.totalDowntime;
                            el.innerText = this.formatMs(activeMs);
                            el.nextElementSibling.innerText = "DURATION";
                        } else if(item.status === 'downtime') {
                            let currentDtMs = now - item.lastDowntimeStart;
                            el.innerText = this.formatMs(currentDtMs);
                            el.nextElementSibling.innerText = item.isGlobalPause ? "ISTIRAHAT" : "DOWNTIME";
                        }
                    }
                });
            },
            
            formatMs: function(ms) {
                if(ms < 0) ms = 0;
                let totalSec = Math.floor(ms / 1000);
                let h = Math.floor(totalSec / 3600);
                let m = Math.floor((totalSec % 3600) / 60);
                let s = totalSec % 60;
                return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
            },

            toggleIstirahat: async function() {
                let now = Date.now();

                if(!this.isIstirahatGlobal) {
                    this.isIstirahatGlobal = true;
                    
                    let runnings = this.activeQueue.filter(q => q.status === 'running');
                    for(let q of runnings) {
                        await this.updateQueueDoc(q.id, { 
                            status: 'downtime', 
                            lastDowntimeStart: now, 
                            dtReason: 'Waktu Istirahat',
                            isGlobalPause: true 
                        });
                    }
                    this.showToast("Waktu Istirahat Dimulai. Proses berjalan dijeda sementara.", "info");
                } else {
                    this.isIstirahatGlobal = false;
                    
                    let globalPausedItems = this.activeQueue.filter(q => q.status === 'downtime' && q.isGlobalPause === true);
                    for(let q of globalPausedItems) {
                        let additionalDt = now - q.lastDowntimeStart;
                        await this.updateQueueDoc(q.id, { 
                            status: 'running', 
                            totalDowntime: q.totalDowntime + additionalDt, 
                            lastDowntimeStart: null,
                            isGlobalPause: false 
                        });
                    }
                    this.showToast("Waktu Istirahat Selesai. Antrian dilanjutkan.", "success");
                }
                
                if(!this.db) {
                    this.persistLocal('isIstirahatGlobal', this.isIstirahatGlobal);
                }
                this.renderQueue(); 
            },

            toggleItemDowntime: async function(id) {
                const item = this.activeQueue.find(q => q.id === id);
                if(!item) return;
                
                if(item.status === 'running') {
                    this.activeTaskTmpId = id;
                    document.getElementById('modal-downtime').classList.remove('hide');
                } else if(item.status === 'downtime') {
                    let now = Date.now();
                    let additionalDt = now - item.lastDowntimeStart;
                    await this.updateQueueDoc(id, { 
                        status: 'running', 
                        totalDowntime: item.totalDowntime + additionalDt, 
                        lastDowntimeStart: null,
                        isGlobalPause: false 
                    });
                }
            },

            confirmDowntime: async function() {
                let reason = document.getElementById('dt-reason').value;
                await this.updateQueueDoc(this.activeTaskTmpId, { 
                    status: 'downtime', 
                    lastDowntimeStart: Date.now(), 
                    dtReason: reason,
                    isGlobalPause: false 
                });
                this.closeModal('modal-downtime');
            },

            confirmPending: async function() {
                let reason = document.getElementById('dt-reason').value;
                await this.updateQueueDoc(this.activeTaskTmpId, { status: 'pending', lastDowntimeStart: Date.now(), dtReason: reason, isGlobalPause: false });
                this.closeModal('modal-downtime');
            },

            updatePendingCount: function() {
                const count = this.activeQueue.filter(q => q.status === 'pending').length;
                const badge = document.getElementById('pending-count');
                badge.innerText = count;
            },

            showPendingList: function() {
                let pendings = this.activeQueue.filter(q => q.status === 'pending');
                if(pendings.length === 0) { this.showToast("Tidak ada antrian pending", "info"); return; }
                
                const container = document.getElementById('pending-list-container');
                container.innerHTML = '';
                
                pendings.forEach(p => {
                    let snDisplay = p.isBatch ? `<span class="bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded text-[10px]">BATCH x${p.batchSize}</span> ${p.sn}` : p.sn;
                    let durationBeforePendingMs = p.lastDowntimeStart - p.startTime - p.totalDowntime;
                    let durationStr = this.formatMs(durationBeforePendingMs);

                    let html = `
                    <div class="flex justify-between items-center bg-white p-3 rounded-lg border border-red-200 shadow-sm">
                        <div>
                            <div class="font-bold text-slate-800 text-sm font-mono">${snDisplay}</div>
                            <div class="text-[10px] text-slate-500 mt-1">Assy: <span class="font-semibold">${p.noAssy}</span> | Alasan: <span class="text-red-600 font-bold">${p.dtReason}</span></div>
                            <div class="text-[10px] text-slate-400">Durasi sblm pending: ${durationStr}</div>
                        </div>
                        <button onclick="app.resumePendingInit('${p.id}')" class="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded font-bold text-xs shadow-sm">
                            <i class="fas fa-play-circle mr-1"></i> Lanjutkan
                        </button>
                    </div>`;
                    container.insertAdjacentHTML('beforeend', html);
                });

                document.getElementById('modal-pending-list').classList.remove('hide');
            },
            
            resumePendingInit: function(id) {
                const item = this.activeQueue.find(q => q.id === id);
                if(!item) return;

                this.closeModal('modal-pending-list');
                
                this.scanDataTmp = item;
                this.resumePendingId = item.id;
                
                let snDisplay = item.isBatch ? `BATCH (x${item.batchSize}) - ${item.sn}` : item.sn;

                document.getElementById('init-assy').innerText = item.noAssy;
                document.getElementById('init-sn').innerText = snDisplay;
                document.getElementById('init-cct').innerText = item.cct;
                document.getElementById('init-umh').innerText = item.baseUmh;
                
                document.getElementById('wp-input').value = item.wp; 
                ['mp1-id','mp2-id','mp3-id'].forEach(id => {
                    document.getElementById(id).value = '';
                    document.getElementById(id.split('-')[0]+'-info').innerText = '-';
                });
                
                document.getElementById('init-form-container').classList.remove('hide');
                document.getElementById('mp1-id').focus();
                
                this.showToast("Silakan masukkan ulang data Manpower (NRP) yang akan melanjutkan.", "info");
            },

            finishProcess: function(id) {
                this.activeTaskTmpId = id;
                document.getElementById('qc-error').innerText = '';
                document.querySelectorAll('.qc-check').forEach(cb => cb.checked = false);
                
                const item = this.activeQueue.find(q => q.id === id);
                if(item) {
                    let snDisplay = item.isBatch ? `BATCH (x${item.batchSize})<br><span class="text-[10px] text-slate-500 font-normal">Satu dari: ${item.sn}</span>` : item.sn;
                    let cctDisplay = item.isBatch ? `${item.cct * item.batchSize} <span class="text-[10px] text-slate-400 font-normal italic">(Base: ${item.cct})</span>` : item.cct;
                    let mpStr = item.mps.map(m => `<div class="truncate"><i class="fas fa-user-circle text-slate-400 mr-1"></i> <strong>${m.nama}</strong> <span class="text-[10px]">(${m.line})</span></div>`).join('');
                    
                    let activeMs = Date.now() - item.startTime - item.totalDowntime;
                    
                    document.getElementById('qc-detail-sn').innerHTML = snDisplay;
                    document.getElementById('qc-detail-assy').innerText = item.noAssy;
                    document.getElementById('qc-detail-cct').innerHTML = cctDisplay;
                    document.getElementById('qc-detail-wp').innerText = item.wp;
                    document.getElementById('qc-detail-mp').innerHTML = mpStr;
                    document.getElementById('qc-detail-duration').innerText = this.formatMs(activeMs);
                }

                document.getElementById('modal-qc').classList.remove('hide');
            },
            
            checkAllQC: function() {
                document.querySelectorAll('.qc-check').forEach(cb => cb.checked = true);
            },

            confirmFinish: async function() {
                let allChecked = true;
                document.querySelectorAll('.qc-check').forEach(cb => { if(!cb.checked) allChecked = false; });
                if(!allChecked) {
                    document.getElementById('qc-error').innerText = "Semua poin QC harus dicentang!"; return;
                }

                const item = this.activeQueue.find(q => q.id === this.activeTaskTmpId);
                if(!item) return;

                const now = Date.now();
                let activeMs = now - item.startTime - item.totalDowntime;
                let activeMin = activeMs / 60000;
                let dtMin = item.totalDowntime / 60000;
                
                let batchMultiplier = item.isBatch ? item.batchSize : 1;
                let targetUmh = (item.baseUmh * batchMultiplier) / item.mps.length; 
                let isOK = activeMin <= targetUmh; 
                
                let cctPerMp = item.cct / item.mps.length; 
                let durationPerUnit = activeMin / batchMultiplier; 
                let dtPerUnit = dtMin / batchMultiplier;

                let historyDataArray = [];

                if(item.isBatch) {
                    item.batchSNs.forEach(batchSn => {
                        historyDataArray.push({
                            ...item,
                            id: batchSn,
                            sn: batchSn,
                            finishedAt: now,
                            durationMin: durationPerUnit,
                            downtimeMin: dtPerUnit,
                            cctPerMp: cctPerMp, 
                            finalStatus: isOK ? "OK" : "OVERTIME",
                            isBatch: false, 
                            batchSNs: null,
                            batchSize: null
                        });
                    });
                } else {
                    historyDataArray.push({
                        ...item,
                        finishedAt: now,
                        durationMin: activeMin,
                        downtimeMin: dtMin,
                        cctPerMp: cctPerMp, 
                        finalStatus: isOK ? "OK" : "OVERTIME"
                    });
                }

                if(this.db) {
                    const batch = this.db.batch();
                    const qRef = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('active_queue').doc(item.id);
                    batch.delete(qRef);

                    historyDataArray.forEach(hData => {
                        const hRef = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('history').doc(hData.sn);
                        batch.set(hRef, hData);
                    });
                    await batch.commit();
                } else {
                    this.activeQueue = this.activeQueue.filter(q => q.id !== item.id);
                    historyDataArray.forEach(hData => this.historyReports.unshift(hData)); 
                    
                    this.persistLocal('activeQueue', this.activeQueue);
                    this.persistLocal('historyReports', this.historyReports);
                    this.renderQueue();
                }

                this.closeModal('modal-qc');
                this.showToast(`Proses Finish. Total Output +${(cctPerMp * batchMultiplier).toFixed(1)} CCT per MP`, "success");
                document.getElementById('scan-out-input').focus();
            },

            // --- FILTER DINAMIS UNTUK ADMIN TABS ---
            populateLineFilters: function() {
                let uniqueLines = new Set();
                this.masterMP.forEach(m => uniqueLines.add(m.line));
                
                ['flt-overview-line', 'flt-leaderboard-line', 'flt-rekap-mp-line', 'flt-trx-line'].forEach(id => {
                    const el = document.getElementById(id);
                    if(el && el.options.length <= 1) {
                        uniqueLines.forEach(line => {
                            el.insertAdjacentHTML('beforeend', `<option value="${line}">${line}</option>`);
                        });
                    }
                });
            },

            getFilteredReportsForAdmin: function() {
                let startInput = document.getElementById('flt-date-start').value;
                let endInput = document.getElementById('flt-date-end').value;
                let filtered = this.historyReports;

                if(startInput) {
                    let startMs = new Date(startInput).setHours(0,0,0,0);
                    filtered = filtered.filter(h => h.finishedAt >= startMs);
                }
                if(endInput) {
                    let endMs = new Date(endInput).setHours(23,59,59,999);
                    filtered = filtered.filter(h => h.finishedAt <= endMs);
                }
                return filtered;
            },

            switchAdminTab: function(tabName) {
                this.adminTab = tabName;
                
                ['overview', 'leaderboard', 'rekapline', 'rekapmp', 'transactions', 'master'].forEach(t => {
                    document.getElementById('tab-btn-' + t).classList.remove('admin-tab-active');
                    document.getElementById('admin-tab-' + t).classList.add('hide');
                });
                
                document.getElementById('tab-btn-' + tabName).classList.add('admin-tab-active');
                document.getElementById('admin-tab-' + tabName).classList.remove('hide');

                if(tabName === 'master') {
                    document.getElementById('admin-global-filter').classList.add('hide');
                } else {
                    document.getElementById('admin-global-filter').classList.remove('hide');
                    this.populateLineFilters(); // Pastikan filter dropdown sudah terisi
                }

                if(tabName === 'overview') this.renderAdminOverview();
                if(tabName === 'leaderboard') this.renderAdminLeaderboard();
                if(tabName === 'transactions') this.renderAdminTransactions();
                if(tabName === 'master') this.renderMasterDataTables();
                if(tabName === 'rekapline') this.renderRekapLine();
                if(tabName === 'rekapmp') this.renderRekapMP();
            },

            applyAdminFilter: function() {
                this.showToast("Menerapkan filter...", "info");
                if(this.adminTab === 'overview') this.renderAdminOverview();
                if(this.adminTab === 'leaderboard') this.renderAdminLeaderboard();
                if(this.adminTab === 'transactions') this.renderAdminTransactions();
                if(this.adminTab === 'rekapline') this.renderRekapLine();
                if(this.adminTab === 'rekapmp') this.renderRekapMP();
            },

            // --- TAB 1: OVERVIEW CCT DENGAN FILTER LINE ---
            renderAdminOverview: function() {
                const ctx = document.getElementById('adminChart');
                if(!ctx) return;
                
                let filteredData = this.getFilteredReportsForAdmin();
                let selLine = document.getElementById('flt-overview-line').value;
                
                let lineOutputAgg = {};
                let totalCctAll = 0;
                let totalDtMinutes = 0;

                filteredData.forEach(h => {
                    let outputPerMP = h.cct / h.mps.length;
                    h.mps.forEach(mp => {
                        if (selLine === 'ALL' || mp.line === selLine) {
                            lineOutputAgg[mp.line] = (lineOutputAgg[mp.line] || 0) + outputPerMP;
                            totalCctAll += outputPerMP; 
                        }
                    });
                    
                    // Jika filter ALL atau Line cocok dengan salah satu MP
                    if (selLine === 'ALL' || h.mps.some(mp => mp.line === selLine)) {
                        totalDtMinutes += (h.downtimeMin || 0);
                    }
                });
                
                // Jika difilter spesifik, kita hanya menghitung unit yang dikerjakan oleh line tersebut
                let totalUnitProcessed = filteredData.filter(h => selLine === 'ALL' || h.mps.some(mp => mp.line === selLine)).length;
                
                document.getElementById('ov-total-cct').innerText = totalCctAll.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 1});
                document.getElementById('ov-total-unit').innerText = totalUnitProcessed.toLocaleString();
                document.getElementById('ov-total-dt').innerText = (totalDtMinutes / 60).toFixed(1);
                
                let labels = Object.keys(lineOutputAgg);
                let data = labels.map(l => lineOutputAgg[l]);

                if(window.myAdminChart) window.myAdminChart.destroy();
                window.myAdminChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels.length ? labels : ['Belum Ada Data'],
                        datasets: [{
                            label: 'Total Output CCT per Line',
                            data: data.length ? data : [0],
                            backgroundColor: 'rgba(99, 102, 241, 0.8)', 
                            borderRadius: 6,
                            barPercentage: 0.6
                        }]
                    },
                    options: { 
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { 
                            y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
                            x: { grid: { display: false } }
                        }
                    }
                });
            },

            // --- TAB 2: LEADERBOARD DENGAN FILTER LINE ---
            renderAdminLeaderboard: function() {
                const lbContainer = document.getElementById('leaderboard-container');
                const perfectContainer = document.getElementById('perfect-leaderboard-container');
                
                let filteredData = this.getFilteredReportsForAdmin();
                let selLine = document.getElementById('flt-leaderboard-line').value;
                let mpScores = {}; 

                filteredData.forEach(h => {
                    let outputPerMP = h.cct / h.mps.length;
                    h.mps.forEach(mp => {
                        if (selLine === 'ALL' || mp.line === selLine) {
                            if(!mpScores[mp.id]) {
                                mpScores[mp.id] = { id: mp.id, nama: mp.nama, line: mp.line, cct: 0, totalTask: 0, okTask: 0 };
                            }
                            mpScores[mp.id].cct += outputPerMP;
                            mpScores[mp.id].totalTask++;
                            if (h.finalStatus === 'OK') mpScores[mp.id].okTask++;
                        }
                    });
                });

                // 1. Logic & Rendering untuk Top CCT
                let sortedMPs = Object.values(mpScores).sort((a,b) => b.cct - a.cct);
                lbContainer.innerHTML = '';
                
                if(sortedMPs.length === 0) {
                    lbContainer.innerHTML = `<div class="text-center text-slate-400 italic mt-10">Belum ada output MP pada rentang filter ini.</div>`;
                } else {
                    sortedMPs.forEach((mp, index) => {
                        let rankVisual = '';
                        let bgClass = 'bg-white border-b border-slate-100 hover:bg-slate-50 transition';
                        
                        if(index === 0) { 
                            rankVisual = '<div class="w-10 h-10 rounded-full bg-yellow-100 border border-yellow-300 flex items-center justify-center text-yellow-600 text-xl shadow-sm"><i class="fas fa-crown"></i></div>'; 
                            bgClass = 'bg-gradient-to-r from-yellow-50 to-white border border-yellow-200 shadow-sm rounded-lg'; 
                        } else if(index === 1) { 
                            rankVisual = '<div class="w-10 h-10 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-500 text-xl shadow-sm"><i class="fas fa-medal"></i></div>'; 
                            bgClass = 'bg-gradient-to-r from-slate-50 to-white border border-slate-200 shadow-sm rounded-lg'; 
                        } else if(index === 2) { 
                            rankVisual = '<div class="w-10 h-10 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 text-xl shadow-sm"><i class="fas fa-medal"></i></div>'; 
                            bgClass = 'bg-gradient-to-r from-orange-50 to-white border border-orange-100 shadow-sm rounded-lg'; 
                        } else { 
                            rankVisual = `<div class="w-8 text-center font-black text-slate-300 text-lg">${index+1}</div>`; 
                        }

                        let html = `
                        <div class="flex items-center justify-between p-3 ${bgClass}">
                            <div class="flex items-center gap-4">
                                <div class="shrink-0 flex justify-center w-12">${rankVisual}</div>
                                <div>
                                    <div class="font-bold text-slate-800 text-sm md:text-base">${mp.nama}</div>
                                    <div class="text-[10px] text-slate-500 font-semibold tracking-wide"><i class="fas fa-network-wired mr-1 opacity-50"></i> ${mp.line} <span class="mx-1">|</span> NRP: ${mp.id}</div>
                                </div>
                            </div>
                            <div class="text-right pr-4 border-r-4 border-indigo-100">
                                <div class="font-black text-indigo-600 text-xl leading-none">${mp.cct.toFixed(1)}</div>
                                <div class="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">Total CCT</div>
                            </div>
                        </div>`;
                        lbContainer.insertAdjacentHTML('beforeend', html);
                    });
                }

                // 2. Logic & Rendering untuk Elite Board (Always OK)
                perfectContainer.innerHTML = '';
                let perfectMPs = Object.values(mpScores).filter(m => m.totalTask > 0 && m.okTask === m.totalTask).sort((a,b) => b.cct - a.cct);

                if(perfectMPs.length === 0) {
                    perfectContainer.innerHTML = `<div class="text-center text-slate-400 italic mt-10">Belum ada MP dengan rekor sempurna (Bebas Overtime) pada rentang filter ini.</div>`;
                } else {
                    perfectMPs.forEach((mp, index) => {
                        let rankVisual = `<div class="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-600 text-xl shadow-sm"><i class="fas fa-star"></i></div>`;
                        let bgClass = 'bg-gradient-to-r from-emerald-50 to-white border border-emerald-200 shadow-sm rounded-lg';

                        let html = `
                        <div class="flex items-center justify-between p-3 ${bgClass}">
                            <div class="flex items-center gap-4">
                                <div class="shrink-0 flex justify-center w-12">${rankVisual}</div>
                                <div>
                                    <div class="font-bold text-slate-800 text-sm md:text-base">${mp.nama}</div>
                                    <div class="text-[10px] text-emerald-600 font-semibold tracking-wide"><i class="fas fa-check-circle mr-1 opacity-70"></i> ${mp.totalTask} Proses Berhasil (100%)</div>
                                </div>
                            </div>
                            <div class="text-right pr-4 border-r-4 border-emerald-200">
                                <div class="font-black text-emerald-700 text-xl leading-none">${mp.cct.toFixed(1)}</div>
                                <div class="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">CCT Diraih</div>
                            </div>
                        </div>`;
                        perfectContainer.insertAdjacentHTML('beforeend', html);
                    });
                }
            },

            // --- TAB 3: REKAP LINE ---
            renderRekapLine: function() {
                const container = document.getElementById('rekap-line-container');
                let data = this.getFilteredReportsForAdmin();
                
                let dateKeys = [...new Set(data.map(d => new Date(d.finishedAt).toISOString().split('T')[0]))].sort();
                
                let pivot = {};
                data.forEach(h => {
                    let dKey = new Date(h.finishedAt).toISOString().split('T')[0];
                    let cctPerMP = h.cct / h.mps.length;
                    h.mps.forEach(m => {
                        if(!pivot[m.line]) pivot[m.line] = { total: 0 };
                        if(!pivot[m.line][dKey]) pivot[m.line][dKey] = 0;
                        pivot[m.line][dKey] += cctPerMP;
                        pivot[m.line].total += cctPerMP;
                    });
                });

                let html = `<table class="w-full text-left border-collapse whitespace-nowrap text-xs min-w-max">
                    <thead class="bg-slate-100 text-slate-600 shadow-sm border-b-2 border-slate-200">
                        <tr>
                            <!-- Sticky Kolom Kiri -->
                            <th class="px-4 py-3 font-bold uppercase tracking-wider sticky left-0 bg-slate-100 border-r border-slate-200 z-30 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] w-48 min-w-[12rem]">Line Area</th>`;
                
                dateKeys.forEach(dk => {
                    let dObj = new Date(dk);
                    let dStr = `${dObj.getDate().toString().padStart(2,'0')}/${(dObj.getMonth()+1).toString().padStart(2,'0')}`;
                    html += `<th class="px-4 py-3 font-bold uppercase tracking-wider text-center border-r border-slate-200 bg-slate-50">${dStr}</th>`;
                });
                
                html += `<th class="px-4 py-3 font-bold uppercase tracking-wider text-right bg-indigo-100 text-indigo-800 sticky right-0 z-30 shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.1)] w-32 min-w-[8rem]">Total Output</th>
                        </tr>
                    </thead>
                    <tbody class="text-slate-700 divide-y divide-slate-200 bg-white">`;

                if(Object.keys(pivot).length === 0) {
                    html += `<tr><td colspan="${dateKeys.length + 2}" class="px-4 py-12 text-center text-slate-400 italic">Tidak ada data untuk rentang waktu ini.</td></tr>`;
                } else {
                    Object.keys(pivot).sort().forEach(line => {
                        html += `<tr class="hover:bg-blue-50 transition group">
                            <!-- Sticky Kiri Data -->
                            <td class="px-4 py-3 font-bold text-slate-700 sticky left-0 bg-white group-hover:bg-blue-50 border-r border-slate-200 z-10 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] w-48">${line}</td>`;
                        
                        dateKeys.forEach(dk => {
                            let val = pivot[line][dk] || 0;
                            html += `<td class="px-4 py-3 text-center border-r border-slate-100 font-mono">${val > 0 ? val.toFixed(1) : '-'}</td>`;
                        });

                        html += `<td class="px-4 py-3 font-black text-indigo-700 text-right bg-indigo-50/50 sticky right-0 z-10 shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.05)] w-32">${pivot[line].total.toFixed(1)}</td>
                        </tr>`;
                    });
                }
                html += `</tbody></table>`;
                container.innerHTML = html;
            },

            // --- TAB 4: REKAP PER MP DENGAN KONSOLIDASI KOLOM ---
            calculateMasaKerja: function(joinDateStr) {
                if(!joinDateStr || joinDateStr === '-') return '-';
                let joinDate = new Date(joinDateStr);
                if(isNaN(joinDate)) return '-';
                let now = new Date();
                
                let diffTime = Math.abs(now - joinDate);
                let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                let years = Math.floor(diffDays / 365);
                let months = Math.floor((diffDays % 365) / 30);
                
                if (years > 0) return `${years} Thn ${months} Bln`;
                if (months > 0) return `${months} Bln`;
                return `${diffDays} Hr`; 
            },

            renderRekapMP: function() {
                const container = document.getElementById('rekap-mp-container');
                const filterLine = document.getElementById('flt-rekap-mp-line').value; 
                
                let data = this.getFilteredReportsForAdmin();
                let dateKeys = [...new Set(data.map(d => new Date(d.finishedAt).toISOString().split('T')[0]))].sort();
                
                let pivot = {};
                data.forEach(h => {
                    let dKey = new Date(h.finishedAt).toISOString().split('T')[0];
                    let cctPerMP = h.cct / h.mps.length;
                    
                    h.mps.forEach(m => {
                        if(filterLine !== 'ALL' && m.line !== filterLine) return; 
                        
                        if(!pivot[m.id]) {
                            let masterInfo = this.masterMP.find(x => x.id === m.id) || {};
                            let joinDate = masterInfo.join_date || m.join_date || '-';
                            pivot[m.id] = { nama: m.nama, line: m.line, id: m.id, join_date: joinDate, total: 0 };
                        }
                        if(!pivot[m.id][dKey]) pivot[m.id][dKey] = 0;
                        pivot[m.id][dKey] += cctPerMP;
                        pivot[m.id].total += cctPerMP;
                    });
                });

                let html = `<table class="w-full text-left border-collapse whitespace-nowrap text-xs min-w-max">
                    <thead class="bg-slate-100 text-slate-600 shadow-sm border-b-2 border-slate-200">
                        <tr>
                            <!-- 1 Kolom Kiri di-Freeze (KONSOLIDASI INFORMASI MP) -->
                            <th class="px-4 py-3 font-bold uppercase tracking-wider sticky left-0 bg-slate-100 border-r border-slate-200 z-30 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)] min-w-[16rem]">Manpower Detail</th>`;
                
                dateKeys.forEach(dk => {
                    let dObj = new Date(dk);
                    let dStr = `${dObj.getDate().toString().padStart(2,'0')}/${(dObj.getMonth()+1).toString().padStart(2,'0')}`;
                    html += `<th class="px-4 py-3 font-bold uppercase tracking-wider text-center border-r border-slate-200 bg-slate-50">${dStr}</th>`;
                });
                
                html += `<th class="px-4 py-3 font-bold uppercase tracking-wider text-right bg-indigo-100 text-indigo-800 sticky right-0 z-30 shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.1)] w-32 min-w-[8rem]">Total Output</th>
                        </tr>
                    </thead>
                    <tbody class="text-slate-700 divide-y divide-slate-200 bg-white">`;

                if(Object.keys(pivot).length === 0) {
                    html += `<tr><td colspan="${dateKeys.length + 2}" class="px-4 py-12 text-center text-slate-400 italic">Tidak ada data untuk rentang waktu/line ini.</td></tr>`;
                } else {
                    Object.values(pivot).sort((a,b) => b.total - a.total).forEach(m => {
                        let masaKerja = this.calculateMasaKerja(m.join_date);
                        
                        // OPTIMASI: Penambahan fallback "|| '-'" untuk menghindari kata undefined muncul
                        html += `<tr class="hover:bg-blue-50 transition group">
                            <!-- Kolom Kiri Komposit -->
                            <td class="px-4 py-2 sticky left-0 bg-white group-hover:bg-blue-50 border-r border-slate-200 z-10 w-64 truncate">
                                <div class="font-bold text-slate-700 text-[13px]">${m.nama || '-'}</div>
                                <div class="text-[9px] text-slate-500 mt-0.5">
                                    <span class="font-mono bg-slate-100 px-1 rounded border border-slate-200">${m.id || '-'}</span> | Line: <span class="font-bold text-slate-700">${m.line || '-'}</span> | MK: <span class="text-teal-600 font-bold">${masaKerja || '-'}</span>
                                </div>
                            </td>`;
                        
                        dateKeys.forEach(dk => {
                            let val = m[dk] || 0;
                            html += `<td class="px-4 py-2 text-center border-r border-slate-100 font-mono">${val > 0 ? val.toFixed(1) : '-'}</td>`;
                        });

                        html += `<td class="px-4 py-2 font-black text-indigo-700 text-right bg-indigo-50/50 sticky right-0 z-10 shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.05)] w-32">${m.total.toFixed(1)}</td>
                        </tr>`;
                    });
                }
                html += `</tbody></table>`;
                container.innerHTML = html;
            },

            // --- TAB 5: TRANSACTIONS (DENGAN FILTER BARCODE) ---
            
            // FUNGSI BARU: Poka-Yoke Pemotongan Scan Barcode Otomatis
            handleTrxScanFilter: function() {
                let inputEl = document.getElementById('flt-trx-barcode');
                let val = inputEl.value.trim();
                
                // Jika input disinyalir merupakan scan barcode utuh (karena ada spasi pemisah)
                let spaceIdx = val.indexOf(' ');
                if(spaceIdx !== -1 && val.length >= 12) {
                    // Potong secara visual di dalam kotak pencarian (menyisakan 11 digit terakhir)
                    inputEl.value = val.slice(-11);
                }
                
                // Lanjutkan me-render tabel dengan value yang sudah terpotong
                this.renderAdminTransactions();
            },

            renderAdminTransactions: function() {
                const lineFilter = document.getElementById('flt-trx-line');
                const mpFilter = document.getElementById('flt-trx-mp');
                
                // Minta Dropdown Filter MP di-update jika MP baru muncul
                if(mpFilter.options.length <= 1) {
                    let uniqueMPs = new Map(); 
                    this.historyReports.forEach(h => {
                        h.mps.forEach(mp => { uniqueMPs.set(mp.id, mp.nama); });
                    });
                    uniqueMPs.forEach((nama, id) => {
                        mpFilter.insertAdjacentHTML('beforeend', `<option value="${id}">${nama} (${id})</option>`);
                    });
                }

                let timeFilteredData = this.getFilteredReportsForAdmin();
                
                let selLine = lineFilter.value;
                let selMP = mpFilter.value;
                let selBarcode = document.getElementById('flt-trx-barcode').value.trim().toLowerCase();
                
                const tbody = document.getElementById('admin-trx-tbody');
                tbody.innerHTML = '';
                
                let fullyFilteredData = timeFilteredData.filter(h => {
                    let matchLine = (selLine === 'ALL') ? true : h.mps.some(m => m.line === selLine);
                    let matchMP = (selMP === 'ALL') ? true : h.mps.some(m => m.id === selMP);
                    
                    // Filter Barcode/Assy fleksibel
                    let matchBarcode = (selBarcode === '') ? true : (
                        (h.sn && h.sn.toLowerCase().includes(selBarcode)) || 
                        (h.noAssy && h.noAssy.toLowerCase().includes(selBarcode))
                    );
                    
                    return matchLine && matchMP && matchBarcode;
                });

                if(fullyFilteredData.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="10" class="px-4 py-8 text-center text-slate-400 text-sm italic">Tidak ada transaksi sesuai filter yang dipilih.</td></tr>`;
                    return;
                }

                fullyFilteredData.forEach(h => {
                    let datetime = new Date(h.finishedAt).toLocaleString();
                    
                    // Kolom MP digabungkan menjadi satu baris transaksi utuh
                    let mpStr = h.mps.map(m => `<span class="font-semibold text-slate-700">${m.nama}</span> <span class="text-slate-400 text-[10px]">(${m.id})</span>`).join('<br>');
                    let lineStr = h.mps.map(m => m.line).join(', ');
                    
                    let cctStr = `<span class="font-bold text-indigo-600">${h.cct}</span> / <span class="text-slate-500">${(h.cct/h.mps.length).toFixed(1)}</span>`;
                    let statClass = h.finalStatus === 'OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800';

                    let row = `
                    <tr class="hover:bg-indigo-50/50 transition">
                        <td class="px-4 py-3 text-[10px] text-slate-500">${datetime}</td>
                        <td class="px-4 py-3 text-slate-600 font-semibold"><i class="fas fa-user-tie text-[10px] mr-1 text-slate-400"></i>${h.leaderName || '-'}</td>
                        <td class="px-4 py-3 font-mono text-blue-600 font-semibold">${h.sn}</td>
                        <td class="px-4 py-3">${h.noAssy}</td>
                        <td class="px-4 py-3">${cctStr}</td>
                        <td class="px-4 py-3 text-[10px] leading-tight">${mpStr}</td>
                        <td class="px-4 py-3 font-bold text-slate-600 text-[10px]">${lineStr}</td>
                        <td class="px-4 py-3 font-timer text-slate-600">${h.durationMin.toFixed(2)}</td>
                        <td class="px-4 py-3 font-timer text-amber-600">${(h.downtimeMin || 0).toFixed(2)}</td>
                        <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${statClass}">${h.finalStatus}</span></td>
                    </tr>`;
                    tbody.insertAdjacentHTML('beforeend', row);
                });
            },

            renderMasterDataTables: function() {
                const tbodyAssy = document.getElementById('master-assy-tbody');
                tbodyAssy.innerHTML = '';
                this.masterAssy.forEach(a => {
                    let row = `<tr>
                        <td class="px-3 py-1 font-mono text-blue-600 font-semibold">${a.no_assy}</td>
                        <td class="px-3 py-1">${a.cct}</td>
                        <td class="px-3 py-1">${a.umh}</td>
                    </tr>`;
                    tbodyAssy.insertAdjacentHTML('beforeend', row);
                });

                const tbodyMP = document.getElementById('master-mp-tbody');
                tbodyMP.innerHTML = '';
                this.masterMP.forEach(m => {
                    let row = `<tr>
                        <td class="px-3 py-1 font-mono font-semibold">${m.id}</td>
                        <td class="px-3 py-1 font-bold text-slate-700">${m.nama}</td>
                        <td class="px-3 py-1">${m.line}</td>
                        <td class="px-3 py-1 text-slate-500">${m.join_date || '-'}</td>
                        <td class="px-3 py-1">${m.shift}</td>
                    </tr>`;
                    tbodyMP.insertAdjacentHTML('beforeend', row);
                });
            },

            openReportModal: function() {
                let uniqueLines = new Set();
                this.historyReports.forEach(h => { h.mps.forEach(mp => uniqueLines.add(mp.line)); });

                let filterHtml = `<option value="ALL">Semua Line</option>`;
                uniqueLines.forEach(line => { filterHtml += `<option value="${line}">${line}</option>`; });
                
                document.getElementById('report-line-filter').innerHTML = filterHtml;
                document.getElementById('report-line-filter').value = 'ALL';

                document.getElementById('modal-report').classList.remove('hide');
                this.renderReportModal();
            },

            renderReportModal: function() {
                const tbody = document.getElementById('report-modal-tbody');
                const summaryContainer = document.getElementById('report-line-summary');
                const selectedFilterLine = document.getElementById('report-line-filter').value;
                tbody.innerHTML = '';
                
                let lineOutputAgg = {}; 

                this.historyReports.forEach(h => {
                    let relevantForTable = false;
                    let outputPerMP = h.cct / h.mps.length;
                    
                    h.mps.forEach(mp => {
                        lineOutputAgg[mp.line] = (lineOutputAgg[mp.line] || 0) + outputPerMP;
                        if(selectedFilterLine === 'ALL' || mp.line === selectedFilterLine) relevantForTable = true;
                    });

                    if(relevantForTable) {
                        let mpStr = h.mps.map(m => `${m.nama} (${m.line})`).join('<br>');
                        let statClass = h.finalStatus === 'OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800';

                        let row = `
                        <tr class="hover:bg-slate-50 border-b border-slate-100">
                            <td class="px-4 py-2 font-mono text-blue-600 font-semibold">${h.sn}</td>
                            <td class="px-4 py-2 text-[10px] text-slate-600 font-bold"><i class="fas fa-user-tie mr-1"></i>${h.leaderName || '-'}</td>
                            <td class="px-4 py-2">${h.noAssy}</td>
                            <td class="px-4 py-2 font-bold text-indigo-600">${h.cct} (Total)</td>
                            <td class="px-4 py-2 text-[10px] leading-tight">${mpStr}</td>
                            <td class="px-4 py-2 font-timer">${h.baseUmh.toFixed(1)}</td>
                            <td class="px-4 py-2 font-timer text-amber-600">${(h.downtimeMin || 0).toFixed(2)}</td>
                            <td class="px-4 py-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${statClass}">${h.finalStatus}</span></td>
                        </tr>`;
                        tbody.insertAdjacentHTML('beforeend', row);
                    }
                });

                let summaryHtml = '';
                for (const [line, output] of Object.entries(lineOutputAgg)) {
                    let highlightClass = (selectedFilterLine === line || selectedFilterLine === 'ALL') 
                        ? 'bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-500/20' 
                        : 'bg-slate-100 border-slate-200 opacity-50 grayscale';
                        
                    summaryHtml += `
                    <div class="${highlightClass} border rounded-xl p-3 flex flex-col items-center justify-center">
                        <span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">${line}</span>
                        <span class="text-2xl font-bold text-indigo-700 leading-none">${output.toFixed(1)} <span class="text-xs text-slate-400 font-normal">CCT</span></span>
                    </div>`;
                }
                summaryContainer.innerHTML = summaryHtml || '<div class="col-span-full text-xs text-slate-400">Belum ada output hari ini.</div>';

                if(tbody.innerHTML === '') {
                    tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400 text-sm italic">Tidak ada report transaksi untuk line tersebut.</td></tr>`;
                }
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
                    this.closeModal('modal-password');
                    document.getElementById('main-dashboard').classList.add('hide');
                    document.getElementById('admin-dashboard').classList.remove('hide');
                    this.switchAdminTab('overview'); 
                } else {
                    this.showToast("Password Leader salah/tidak sesuai!", "error");
                }
            },

            closeAdmin: function() {
                document.getElementById('admin-dashboard').classList.add('hide');
                document.getElementById('main-dashboard').classList.remove('hide');
            },

            exportCSV: function() {
                if(this.historyReports.length === 0) return;
                let csv = "Tanggal,Leader,Serial Number,No Assy,Total CCT,WP,Manpower,Line Allocation,CCT per MP,Start,Finish,Durasi (m),Downtime (m),Status\n";
                this.historyReports.forEach(h => {
                    let tgl = new Date(h.finishedAt).toLocaleString();
                    let mps = h.mps.map(m=>m.nama).join(' & ');
                    let lines = h.mps.map(m=>m.line).join(' & ');
                    csv += `"${tgl}","${h.leaderName || '-'}",${h.sn},${h.noAssy},${h.cct},${h.wp},"${mps}","${lines}",${h.cctPerMp.toFixed(2)},${new Date(h.startTime).toLocaleTimeString()},${new Date(h.finishedAt).toLocaleTimeString()},${h.durationMin.toFixed(2)},${(h.downtimeMin || 0).toFixed(2)},${h.finalStatus}\n`;
                });
                let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                let link = document.createElement("a");
                link.setAttribute("href", URL.createObjectURL(blob));
                link.setAttribute("download", `Assy_Detailed_Report.csv`);
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
            },

            closeModal: function(id) { document.getElementById(id).classList.add('hide'); },
            updateQueueDoc: async function(id, data) {
                if(this.db) {
                    await this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('active_queue').doc(id).update(data);
                } else {
                    let idx = this.activeQueue.findIndex(q => q.id === id);
                    if(idx>-1) {
                        this.activeQueue[idx] = { ...this.activeQueue[idx], ...data };
                        this.persistLocal('activeQueue', this.activeQueue);
                        this.renderQueue();
                    }
                }
            },
            persistLocal: function(k, d) { localStorage.setItem(k, JSON.stringify(d)); },
            
            openManualInputModal: function() {
                document.getElementById('manual-scan-trigger').value = '';
                document.getElementById('manual-assy').value = '';
                document.getElementById('manual-sn').value = '';
                document.getElementById('manual-cct').value = '';
                document.getElementById('manual-umh').value = '';
                document.getElementById('modal-manual').classList.remove('hide');
                setTimeout(() => document.getElementById('manual-scan-trigger').focus(), 100);
            },
            
            handleManualScanTrigger: function(val) {
                let trimmedStr = val.trim();
                let firstSpaceIndex = trimmedStr.indexOf(' ');
                if(firstSpaceIndex === -1 || trimmedStr.length < 12) { this.showToast("Format Barcode tidak dikenali", "error"); return; }
                
                document.getElementById('manual-assy').value = trimmedStr.substring(0, firstSpaceIndex);
                document.getElementById('manual-sn').value = trimmedStr.slice(-11);
                document.getElementById('manual-scan-trigger').value = ''; 
                this.showToast("Barcode terekstrak, silakan isi CCT dan UMH", "success");
                document.getElementById('manual-cct').focus();
            },

            confirmManualInput: function() {
                let assy = document.getElementById('manual-assy').value.trim();
                let sn = document.getElementById('manual-sn').value.trim();
                let cct = parseInt(document.getElementById('manual-cct').value);
                let umh = parseInt(document.getElementById('manual-umh').value);
                
                if(!assy || !sn || isNaN(cct) || isNaN(umh)) {
                    this.showToast("Semua kolom harus terisi dengan benar (termasuk CCT & UMH)", "warning"); return;
                }
                
                if(this.activeQueue.some(q => q.sn === sn) || this.historyReports.some(h => h.sn === sn)) {
                    this.showToast(`Duplicate: SN ${sn} sudah diproses!`, "error"); return;
                }
                
                this.closeModal('modal-manual');
                
                let assyObj = { no_assy: assy, cct: cct, umh: umh };
                let existing = this.masterAssy.find(a => a.no_assy === assy);
                if(!existing || existing.cct !== cct || existing.umh !== umh) {
                    this.saveNewAssy(assyObj);
                    this.showToast(`Sistem mempelajari & menyimpan data Assy ${assy} secara permanen!`, "success");
                }
                
                this.scanDataTmp = { noAssy: assy, sn: sn, cct: cct, umh: umh };
                document.getElementById('init-assy').innerText = assy;
                document.getElementById('init-sn').innerText = sn;
                document.getElementById('init-cct').innerText = cct;
                document.getElementById('init-umh').innerText = umh;
                document.getElementById('wp-input').value = ''; 
                
                document.getElementById('init-form-container').classList.remove('hide');
                document.getElementById('wp-input').focus();
            },

            saveNewAssy: async function(assyObj) {
                let existingIdx = this.masterAssy.findIndex(a => a.no_assy === assyObj.no_assy);
                if(existingIdx > -1) this.masterAssy[existingIdx] = assyObj;
                else this.masterAssy.push(assyObj);

                if(this.db) {
                    try {
                        const ref = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection('master_assy').doc(assyObj.no_assy);
                        await ref.set(assyObj);
                    } catch(e) {}
                } else {
                    this.persistLocal('localMasterAssy', this.masterAssy);
                }
                if(this.adminTab === 'master') this.renderMasterDataTables();
            },

            handleExcelUpload: function(event, type) {
                const file = event.target.files[0];
                if(!file) return;

                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, {type: 'array'});
                        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                        const json = XLSX.utils.sheet_to_json(worksheet);

                        let successCount = 0;
                        let batchData = [];

                        json.forEach(row => {
                            if(type === 'ASSY') {
                                let no_assy = row['ASSY'] || row['Assy'] || row['NO ASSY'] || row['no_assy'];
                                let cct = row['CCT'] || row['cct'] || row['Cct'];
                                let umh = row['UMH'] || row['umh'] || row['Umh'];

                                if(no_assy && cct !== undefined && umh !== undefined) {
                                    let obj = { no_assy: String(no_assy).trim(), cct: Number(cct), umh: Number(umh) };
                                    let idx = this.masterAssy.findIndex(a => a.no_assy === obj.no_assy);
                                    if(idx > -1) this.masterAssy[idx] = obj; else this.masterAssy.push(obj);
                                    batchData.push(obj);
                                    successCount++;
                                }
                            } else if(type === 'MP') {
                                let id = row['NRP (kode)'] || row['NRP'] || row['ID'] || row['id'];
                                let nama = row['Nama'] || row['NAMA'] || row['nama'];
                                let line = row['Line'] || row['LINE'] || row['line'];
                                let shift = row['Shift'] || row['SHIFT'] || row['shift'] || '-';
                                let joinDate = row['Join date'] || row['Join Date'] || '-';

                                if(id && nama && line) {
                                    let obj = { id: String(id).trim().toUpperCase(), nama: String(nama), line: String(line), shift: String(shift), join_date: String(joinDate) };
                                    let idx = this.masterMP.findIndex(m => m.id === obj.id);
                                    if(idx > -1) this.masterMP[idx] = obj; else this.masterMP.push(obj);
                                    batchData.push(obj);
                                    successCount++;
                                }
                            }
                        });

                        if(this.db && batchData.length > 0) {
                            const collName = type === 'ASSY' ? 'master_assy' : 'master_mp';
                            const keyId = type === 'ASSY' ? 'no_assy' : 'id';
                            const collRef = this.db.collection('artifacts').doc(this.appId).collection('public').doc('data').collection(collName);
                            let chunk = this.db.batch();
                            let count = 0;
                            
                            for(let obj of batchData) {
                                chunk.set(collRef.doc(obj[keyId]), obj);
                                count++;
                                if(count >= 400) { 
                                    await chunk.commit();
                                    chunk = this.db.batch();
                                    count = 0;
                                }
                            }
                            if(count > 0) await chunk.commit();
                        } else {
                            if(type === 'ASSY') this.persistLocal('localMasterAssy', this.masterAssy);
                            if(type === 'MP') this.persistLocal('localMasterMP', this.masterMP);
                        }

                        this.showToast(`Berhasil menyimpan ${successCount} data ${type} dari Excel!`, "success");
                        if(this.adminTab === 'master') this.renderMasterDataTables();
                        event.target.value = ''; 
                    } catch (err) {
                        console.error(err);
                        this.showToast("Gagal memproses Excel. Format tidak sesuai.", "error");
                    }
                };
                reader.readAsArrayBuffer(file);
            },

            openBatchMode: function() { 
                document.getElementById('modal-batch').classList.remove('hide');
                document.getElementById('batch-scan-trigger').value = '';
                document.getElementById('batch-valid-list').innerHTML = '';
                document.getElementById('b-wp-input').value = '';
                
                document.getElementById('batch-assy').innerText = '-';
                document.getElementById('batch-cct').innerText = '-';
                document.getElementById('batch-umh').innerText = '-';
                
                ['b-mp1', 'b-mp2', 'b-mp3'].forEach(id => {
                    document.getElementById(id).value = '';
                    document.getElementById(id + '-info').innerText = '';
                });
                this.batchItemsValid = [];
                this.updateBatchUI();
                
                setTimeout(() => document.getElementById('batch-scan-trigger').focus(), 100);
            },

            processBatchScan: function(rawStr) {
                let trimmedLine = rawStr.trim();
                document.getElementById('batch-scan-trigger').value = ''; 
                
                let firstSpaceIndex = trimmedLine.indexOf(' ');
                
                if(firstSpaceIndex === -1 || trimmedLine.length < 12) {
                    this.showToast("Format barcode tidak valid", "error"); 
                    return;
                }
                
                let noAssy = trimmedLine.substring(0, firstSpaceIndex);
                let sn = trimmedLine.slice(-11);

                let cct = null, umh = null;
                
                if(this.batchItemsValid.length === 0) {
                    const aData = this.masterAssy.find(a => a.no_assy === noAssy);
                    if(!aData) { this.showToast(`Assy ${noAssy} tidak ada di Master Data`, "error"); return; }
                    cct = aData.cct;
                    umh = aData.umh;
                    
                    document.getElementById('batch-assy').innerText = noAssy;
                    document.getElementById('batch-cct').innerText = cct;
                    document.getElementById('batch-umh').innerText = umh;
                } else {
                    let commonAssy = document.getElementById('batch-assy').innerText;
                    if(noAssy !== commonAssy) {
                        this.showToast(`Ditolak: Assy berbeda. (${noAssy} vs ${commonAssy})`, "error"); return;
                    }
                }
                
                if(this.activeQueue.some(q=>q.sn===sn) || this.historyReports.some(h=>h.sn===sn) || this.batchItemsValid.some(v=>v.sn===sn)) {
                    this.showToast(`Ditolak: Duplicate SN ${sn}`, "error"); return;
                }
                
                this.batchItemsValid.push({ noAssy, sn });
                this.updateBatchUI();
            },

            updateBatchUI: function() {
                const list = document.getElementById('batch-valid-list');
                list.innerHTML = '';
                this.batchItemsValid.forEach(v => {
                    list.innerHTML += `<div class="p-1 border-b flex justify-between"><span>${v.sn}</span> <span class="text-teal-600"><i class="fas fa-check"></i> Valid</span></div>`;
                });
                document.getElementById('batch-count').innerText = `${this.batchItemsValid.length} items`;
                document.getElementById('btn-batch-start').disabled = this.batchItemsValid.length === 0;
            },

            startBatch: async function() {
                let wpRaw = document.getElementById('b-wp-input').value;
                let wp = wpRaw ? wpRaw.toUpperCase() : '';
                
                if(!this.validWpList.includes(wp)) { this.showToast(`WP "${wp}" tidak valid. Pilih dari rekomendasi!`, "error"); return; }

                let mps = [];
                for(let i=1; i<=3; i++) {
                    let id = document.getElementById(`b-mp${i}`).value.toUpperCase();
                    if(id) {
                        let mpData = this.masterMP.find(m => m.id.toUpperCase() === id);
                        if(mpData) mps.push(mpData);
                        else { this.showToast(`MP ID ${id} invalid`, "error"); return; }
                    }
                }
                if(mps.length === 0) { this.showToast("Minimal 1 Manpower required", "warning"); return; }

                let cct = parseInt(document.getElementById('batch-cct').innerText);
                let umh = parseInt(document.getElementById('batch-umh').innerText);
                const now = Date.now();

                let batchId = `BCH-${now}`;
                let batchData = {
                    id: batchId,
                    sn: this.batchItemsValid[0].sn, 
                    batchSNs: this.batchItemsValid.map(v => v.sn), 
                    isBatch: true,
                    batchSize: this.batchItemsValid.length,
                    noAssy: this.batchItemsValid[0].noAssy,
                    cct: cct,
                    baseUmh: umh,
                    wp: wp,
                    mps: mps,
                    startTime: now,
                    status: 'running',
                    totalDowntime: 0,
                    lastDowntimeStart: null,
                    isGlobalPause: false,
                    shift: this.shift,
                    leaderName: this.leader.nama 
                };

                this.showToast(`Memulai Batch (${batchData.batchSize} unit) dalam 1 Antrian Visual`, "success");
                this.closeModal('modal-batch');
                
                this.saveToQueue(batchData);
            }
        };

        window.onload = () => app.init();
