
        // =====================================================
        // REAL-TIME SYNC & OFFLINE SUPPORT
        // =====================================================
        
        // Pending changes queue for offline sync
        let pendingChanges = [];
        const PENDING_CHANGES_KEY = 'zpms_pending_changes';
        
        // Load pending changes from storage
        function loadPendingChanges() {
            try {
                pendingChanges = JSON.parse(localStorage.getItem(PENDING_CHANGES_KEY) || '[]');
            } catch (e) {
                pendingChanges = [];
            }
        }
        
        // Save pending changes to storage
        function savePendingChanges() {
            try {
                localStorage.setItem(PENDING_CHANGES_KEY, JSON.stringify(pendingChanges));
            } catch (e) {
                console.warn('Could not save pending changes');
            }
        }
        
        // Add a change to the pending queue (for offline mode)
        function queueChange(action, payload) {
            const change = {
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                action: action,
                payload: payload,
                timestamp: new Date().toISOString()
            };
            pendingChanges.push(change);
            savePendingChanges();
            return change.id;
        }
        
        // Sync pending changes when back online
        async function syncPendingChanges() {
            if (!navigator.onLine || pendingChanges.length === 0) return;
            
            console.log(`Syncing ${pendingChanges.length} pending changes...`);
            const changesToSync = [...pendingChanges];
            
            for (const change of changesToSync) {
                try {
                    // Attempt to sync this change
                    const response = await fetch(`${API_URL}?action=${change.action}`, {
                        method: 'POST',
                        headers: API_HEADERS,
                        body: JSON.stringify(change.payload)
                    });
                    
                    if (response.ok) {
                        // Remove from pending queue
                        pendingChanges = pendingChanges.filter(c => c.id !== change.id);
                        savePendingChanges();
                        console.log(`Synced change: ${change.id}`);
                    }
                } catch (e) {
                    console.error(`Failed to sync change ${change.id}:`, e);
                }
            }
            
            if (pendingChanges.length === 0) {
                showToast('All changes synced successfully!', 'success');
            }
        }
        
        // Real-time polling for updates
        let realtimePollingInterval = null;
        const REALTIME_POLL_INTERVAL = 30000; // 30 seconds
        
        function startRealtimePolling() {
            if (realtimePollingInterval) return;
            
            realtimePollingInterval = setInterval(async () => {
                if (!navigator.onLine) return;
                if (!user || !user[COL.id]) return;
                
                try {
                    // Check for updates to current view
                    const currentView = document.getElementById('main-view')?.dataset?.currentView;
                    
                    if (currentView === 'progress') {
                        // Refresh progress data silently
                        if (typeof refreshProgressData === 'function') {
                            await refreshProgressData();
                        }
                    } else if (currentView === 'team') {
                        // Check for team updates
                        await checkTeamUpdates();
                    }
                } catch (e) {
                    // Silent fail for polling
                }
            }, REALTIME_POLL_INTERVAL);
        }
        
        function stopRealtimePolling() {
            if (realtimePollingInterval) {
                clearInterval(realtimePollingInterval);
                realtimePollingInterval = null;
            }
        }
        
        // Check for team updates
        async function checkTeamUpdates() {
            if (!user) return;
            
            const myId = user[COL.id];
            const myName = user[COL.name];
            
            let filter = `${COL.mgr}.ilike.%${myId}%`;
            if (myName) filter += `,${COL.mgr}.ilike.%${myName}%`;
            
            try {
                const { data } = await db.from('active_list').select('id,status').or(filter);
                if (data) {
                    // Check if any status changed
                    const currentStatuses = {};
                    data.forEach(d => { currentStatuses[d.id] = d.status; });
                    
                    // Compare with cached statuses
                    let hasChanges = false;
                    data.forEach(d => {
                        const cached = getEmployeeFromCache(d.id);
                        if (cached && cached[COL.stat] !== d.status) {
                            hasChanges = true;
                        }
                    });
                    
                    if (hasChanges) {
                        // Show notification about updates
                        showToast('Team data updated', 'info');
                    }
                }
            } catch (e) {
                // Silent fail
            }
        }
        
        // Session validation with backend
        async function validateSessionWithBackend() {
            const token = localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token');
            if (!token) return false;
            
            try {
                const response = await fetch(`${API_URL}?action=validateSession`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (!response.ok) {
                    return false;
                }
                
                const data = await response.json();
                return data.valid === true;
            } catch (e) {
                // If offline, assume session is valid if we have a token
                return !navigator.onLine;
            }
        }
        
        // Extend session with backend
        async function extendSessionWithBackend() {
            const token = localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token');
            if (!token) return false;
            
            try {
                const response = await fetch(`${API_URL}?action=extendSession`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                return response.ok;
            } catch (e) {
                return false;
            }
        }
        
        // Logout with backend
        async function logoutWithBackend() {
            const token = localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token');
            if (token) {
                try {
                    await fetch(`${API_URL}?action=logout`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });
                } catch (e) {
                    // Continue with local logout even if backend fails
                }
            }
        }
        
        // Initialize on load
        loadPendingChanges();
        
        // =====================================================
        // END REAL-TIME SYNC & OFFLINE SUPPORT
        // =====================================================

        // --- NOTIFICATION CENTER ---
        let notificationData = [];
        const NOTIFICATION_READ_KEY = 'zpms_notifications_read';

        // Get read notification IDs from localStorage
        function getReadNotifications() {
            try {
                return JSON.parse(localStorage.getItem(NOTIFICATION_READ_KEY) || '[]');
            } catch (e) {
                return [];
            }
        }

        // Save read notification IDs to localStorage
        function saveReadNotifications(readIds) {
            try {
                // Keep only last 100 to prevent storage bloat
                localStorage.setItem(NOTIFICATION_READ_KEY, JSON.stringify(readIds.slice(-100)));
            } catch (e) {
                console.warn('Could not save read notifications');
            }
        }

        // Mark a notification as read
        function markNotificationRead(notificationId, index) {
            const readIds = getReadNotifications();
            if (!readIds.includes(notificationId)) {
                readIds.push(notificationId);
                saveReadNotifications(readIds);
            }
            
            // Update UI immediately
            const item = document.querySelector(`[data-notification-id="${notificationId}"]`);
            if (item) {
                item.classList.remove('unread');
            }
            
            // Update badge count
            updateNotificationBadge();
            
            // Execute the notification action
            if (notificationData[index] && notificationData[index].action) {
                notificationData[index].action();
            }
        }

        // Mark all notifications as read
        function markAllNotificationsRead() {
            const readIds = getReadNotifications();
            notificationData.forEach(n => {
                if (!readIds.includes(n.id)) {
                    readIds.push(n.id);
                }
            });
            saveReadNotifications(readIds);
            
            // Update UI
            document.querySelectorAll('.notification-item.unread').forEach(item => {
                item.classList.remove('unread');
            });
            
            updateNotificationBadge();
            showToast('All notifications marked as read', 'success');
        }

        function toggleNotifications() {
            const panel = document.getElementById('notification-panel');
            const overlay = document.getElementById('notification-overlay');
            const isOpen = panel.classList.contains('open');

            if (isOpen) {
                closeNotifications();
            } else {
                panel.classList.add('open');
                overlay.classList.add('open');
                refreshNotifications();
            }
        }

        function closeNotifications() {
            document.getElementById('notification-panel').classList.remove('open');
            document.getElementById('notification-overlay').classList.remove('open');
        }

        function refreshNotifications() {
            // Generate notifications from current system state
            notificationData = [];
            const readIds = getReadNotifications();

            if (typeof allCompanyData !== 'undefined' && allCompanyData.length > 0 && typeof user !== 'undefined') {
                const myId = (user[COL.id] || '').toString().toLowerCase();
                const myName = (user[COL.name] || '').toString().toLowerCase();
                const uRole = typeof getRole === 'function' ? getRole(user) : 'Staff';

                // Find pending submissions for managers
                const pendingForMe = allCompanyData.filter(u => {
                    const mgrStr = (u[COL.mgr] || '').toString().toLowerCase();
                    const isMyReport = mgrStr.includes(myId) || (myName.length > 3 && mgrStr.includes(myName));
                    return isMyReport && u[COL.stat] === 'Submitted to Manager';
                });

                pendingForMe.forEach(u => {
                    const nId = `submission_${u[COL.id]}`;
                    notificationData.push({
                        id: nId,
                        type: 'submission',
                        title: 'Scorecard Submitted',
                        desc: `${u[COL.name]} has submitted their scorecard for review.`,
                        time: 'Pending your action',
                        isRead: readIds.includes(nId),
                        action: () => { closeNotifications(); loadEval(u[COL.id]); }
                    });
                });

                // Admin notifications
                if (uRole === 'Admin' || uRole === 'Master') {
                    const hrPending = allCompanyData.filter(u => u[COL.stat] === 'Submitted to HR');
                    if (hrPending.length > 0) {
                        const nId = `hr_pending_${hrPending.length}`;
                        notificationData.push({
                            id: nId,
                            type: 'approval',
                            title: 'HR Approvals Pending',
                            desc: `${hrPending.length} scorecard(s) waiting for final approval.`,
                            time: 'Requires action',
                            isRead: readIds.includes(nId),
                            action: () => { closeNotifications(); loadHRAdmin(); switchAdminTab('app'); }
                        });
                    }

                    const readyToPublish = allCompanyData.filter(u => u[COL.stat] === 'Approved');
                    if (readyToPublish.length > 0) {
                        const nId = `ready_publish_${readyToPublish.length}`;
                        notificationData.push({
                            id: nId,
                            type: 'published',
                            title: 'Ready to Publish',
                            desc: `${readyToPublish.length} scorecard(s) approved and ready to publish.`,
                            time: 'Optional action',
                            isRead: readIds.includes(nId),
                            action: () => { closeNotifications(); loadHRAdmin(); switchAdminTab('app'); }
                        });
                    }
                }

                // Check if own scorecard was returned
                const myData = allCompanyData.find(u => (u[COL.id] || '').toString().toLowerCase() === myId);
                if (myData && (myData[COL.stat] === 'Returned' || myData[COL.stat] === 'Draft (Returned by Manager)')) {
                    const nId = `returned_${myId}`;
                    notificationData.push({
                        id: nId,
                        type: 'returned',
                        title: 'Scorecard Returned',
                        desc: 'Your scorecard was returned. Please review and resubmit.',
                        time: 'Requires action',
                        isRead: readIds.includes(nId),
                        action: () => { closeNotifications(); loadEval(myId); }
                    });
                }
            }

            renderNotifications();
            updateNotificationBadge();
        }

        function renderNotifications() {
            const list = document.getElementById('notification-list');
            if (!list) return;

            if (notificationData.length === 0) {
                list.innerHTML = `
                    <div class="notification-empty">
                        <i class="fa-regular fa-bell-slash"></i>
                        <div style="font-weight:600; font-size:1rem; margin-bottom:8px;">You're all caught up!</div>
                        <div style="font-size:0.85rem;">No pending notifications at this time.</div>
                    </div>`;
                return;
            }

            list.innerHTML = notificationData.map((n, i) => `
                <div class="notification-item ${n.isRead ? '' : 'unread'}" data-notification-id="${n.id}" onclick="markNotificationRead('${n.id}', ${i})">
                    <div class="notification-icon ${n.type}">
                        <i class="fa-solid ${n.type === 'submission' ? 'fa-paper-plane' :
                    n.type === 'approval' ? 'fa-clipboard-check' :
                        n.type === 'published' ? 'fa-rocket' : 'fa-rotate-left'}"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-title">${n.title}</div>
                        <div class="notification-desc">${n.desc}</div>
                        <div class="notification-time">${n.time}</div>
                    </div>
                    ${!n.isRead ? '<div class="notification-unread-dot"></div>' : ''}
                </div>
            `).join('');
        }

        function updateNotificationBadge() {
            const badge = document.getElementById('notification-count');
            if (!badge) return;

            // Count only UNREAD notifications
            const unreadCount = notificationData.filter(n => !n.isRead).length;
            
            if (unreadCount > 0) {
                badge.innerText = unreadCount > 9 ? '9+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        // Refresh notifications when app loads
        function initNotifications() {
            if (typeof allCompanyData !== 'undefined' && allCompanyData.length > 0) {
                refreshNotifications();
            }
        }

        // --- PDF EXPORT FUNCTION ---
        async function exportScoreAsPdf() {
            if (typeof html2pdf === 'undefined') {
                showToast('PDF library not loaded. Please refresh and try again.', 'error');
                return;
            }

            showToast('Generating PDF with charts...', 'info');

            // Get employee info for filename
            const empName = targetUser ? (targetUser[COL.name] || 'Employee').split('(')[0].trim() : 'Employee';
            const empId = targetUser ? (targetUser[COL.id] || '') : '';
            const empJob = targetUser ? (targetUser[COL.job] || '-') : '-';
            const empDiv = targetUser ? (targetUser[COL.div] || '-') : '-';
            const empStatus = targetUser ? (targetUser[COL.stat] || 'Draft') : 'Draft';
            const comp = targetUser ? getCompany(targetUser[COL.id]) : '-';
            const filename = `Scorecard_${empName.replace(/\s+/g, '_')}_${empId}_${new Date().toISOString().split('T')[0]}.pdf`;

            // Calculate scores
            const w = getW(targetUser[COL.lvl], targetUser[COL.job]);
            let goals = targetUser[COL.goals] || [];
            if (typeof goals === 'string') try { goals = JSON.parse(goals); } catch(e) { goals = []; }
            
            // Calculate final score
            const sharedScore = (masterData.rating || 0) * (w.s / 100);
            let individualScore = 0;
            let totalWeight = 0;
            goals.forEach(g => { totalWeight += (g.weight || 0); });
            goals.forEach(g => {
                const goalScore = (g.rating || 0) * (g.weight || 0);
                const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                individualScore += goalScore * scaleFactor;
            });
            const finalScore = (sharedScore + individualScore).toFixed(2);
            const ratingNum = Math.round(parseFloat(finalScore));
            const ratingLabel = ratingLabels[ratingNum] || 'N/A';

            // Generate SVG charts
            function generateScoreGauge(score, maxScore = 6) {
                const percentage = (score / maxScore) * 100;
                const radius = 70;
                const circumference = 2 * Math.PI * radius;
                const strokeDashoffset = circumference - (percentage / 100) * circumference;
                const color = score >= 5 ? '#10b981' : score >= 4 ? '#0d9488' : score >= 3 ? '#f59e0b' : score >= 2 ? '#f97316' : '#ef4444';
                
                return `
                <svg width="180" height="180" viewBox="0 0 180 180">
                    <circle cx="90" cy="90" r="${radius}" fill="none" stroke="#e2e8f0" stroke-width="12"/>
                    <circle cx="90" cy="90" r="${radius}" fill="none" stroke="${color}" stroke-width="12"
                            stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDashoffset}"
                            stroke-linecap="round" transform="rotate(-90 90 90)"/>
                    <text x="90" y="85" text-anchor="middle" font-size="32" font-weight="800" fill="${color}">${score}</text>
                    <text x="90" y="110" text-anchor="middle" font-size="12" fill="#64748b">${ratingLabel}</text>
                </svg>`;
            }

            function generateWeightPieChart(shared, individual) {
                const total = shared + individual;
                const sharedAngle = (shared / total) * 360;
                const sharedRad = (sharedAngle - 90) * (Math.PI / 180);
                const endX = 50 + 40 * Math.cos(sharedRad);
                const endY = 50 + 40 * Math.sin(sharedRad);
                const largeArc = sharedAngle > 180 ? 1 : 0;
                
                return `
                <svg width="120" height="120" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="#e2e8f0"/>
                    <path d="M50,50 L50,10 A40,40 0 ${largeArc},1 ${endX},${endY} Z" fill="#0d9488"/>
                    <circle cx="50" cy="50" r="25" fill="white"/>
                    <text x="50" y="48" text-anchor="middle" font-size="10" font-weight="700" fill="#0d9488">${shared}%</text>
                    <text x="50" y="60" text-anchor="middle" font-size="7" fill="#64748b">Shared</text>
                </svg>`;
            }

            function generateGoalRatingBar(goals) {
                if (!goals || goals.length === 0) return '<div style="color:#94a3b8; text-align:center; padding:20px;">No goals to display</div>';
                
                return goals.map((g, i) => {
                    const rating = g.rating || 0;
                    const width = (rating / 6) * 100;
                    const color = rating >= 5 ? '#10b981' : rating >= 4 ? '#0d9488' : rating >= 3 ? '#f59e0b' : rating >= 2 ? '#f97316' : '#ef4444';
                    return `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span style="font-size:11px; font-weight:600; color:#1e293b; max-width:70%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(g.title)}</span>
                            <span style="font-size:11px; font-weight:700; color:${color};">${rating}/6</span>
                        </div>
                        <div style="background:#e2e8f0; height:8px; border-radius:4px; overflow:hidden;">
                            <div style="background:${color}; width:${width}%; height:100%; border-radius:4px;"></div>
                        </div>
                    </div>`;
                }).join('');
            }

            function generateRatingDistribution(goals) {
                const dist = [0, 0, 0, 0, 0, 0];
                goals.forEach(g => {
                    const r = g.rating || 0;
                    if (r >= 1 && r <= 6) dist[r - 1]++;
                });
                const maxVal = Math.max(...dist, 1);
                const labels = ['IDLE', 'STAGNANT', 'WALKER', 'RUNNER', 'FLYER', 'ASTRONAUT'];
                const colors = ['#ef4444', '#f97316', '#f59e0b', '#0d9488', '#10b981', '#059669'];
                
                return `
                <svg width="280" height="140" viewBox="0 0 280 140">
                    ${dist.map((val, i) => {
                        const barHeight = (val / maxVal) * 80;
                        const x = 20 + i * 44;
                        return `
                            <rect x="${x}" y="${100 - barHeight}" width="30" height="${barHeight}" fill="${colors[i]}" rx="4"/>
                            <text x="${x + 15}" y="115" text-anchor="middle" font-size="7" fill="#64748b">${labels[i].slice(0, 3)}</text>
                            <text x="${x + 15}" y="130" text-anchor="middle" font-size="9" font-weight="700" fill="#1e293b">${val}</text>
                        `;
                    }).join('')}
                </svg>`;
            }

            // Create PDF content wrapper
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'width: 210mm; padding: 15mm; background: white; color: #1e293b; font-family: Inter, Arial, sans-serif; font-size: 11px; line-height: 1.4;';

            // Header
            wrapper.innerHTML = `
                <div style="text-align: center; margin-bottom: 25px; padding-bottom: 15px; border-bottom: 3px solid #0d9488;">
                    <h1 style="margin: 0; font-size: 22px; color: #0d9488; font-weight: 800;">ZAIN PERFORMANCE SCORECARD</h1>
                    <p style="margin: 8px 0 0; font-size: 11px; color: #64748b;">Performance Evaluation Report • ${currentCycle} Cycle</p>
                    <p style="margin: 4px 0 0; font-size: 10px; color: #94a3b8;">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>

                <!-- Employee Info & Score Summary -->
                <div style="display: flex; gap: 20px; margin-bottom: 25px;">
                    <!-- Employee Details -->
                    <div style="flex: 1; background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <h3 style="margin: 0 0 12px; font-size: 12px; color: #0d9488; text-transform: uppercase; letter-spacing: 1px;">Employee Information</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr><td style="padding: 6px 0; color: #64748b; width: 35%;">Name:</td><td style="padding: 6px 0; font-weight: 700;">${escapeHTML(empName)}</td></tr>
                            <tr><td style="padding: 6px 0; color: #64748b;">Employee ID:</td><td style="padding: 6px 0; font-weight: 600; font-family: monospace; background: #e2e8f0; padding: 2px 8px; border-radius: 4px; display: inline-block;">${escapeHTML(empId)}</td></tr>
                            <tr><td style="padding: 6px 0; color: #64748b;">Job Title:</td><td style="padding: 6px 0; font-weight: 600;">${escapeHTML(empJob)}</td></tr>
                            <tr><td style="padding: 6px 0; color: #64748b;">Division:</td><td style="padding: 6px 0;">${escapeHTML(empDiv)}</td></tr>
                            <tr><td style="padding: 6px 0; color: #64748b;">Company:</td><td style="padding: 6px 0; color: #0d9488; font-weight: 600;">${escapeHTML(comp)}</td></tr>
                            <tr><td style="padding: 6px 0; color: #64748b;">Status:</td><td style="padding: 6px 0;"><span style="background: ${empStatus === 'Published' ? '#d1fae5' : empStatus === 'Approved' ? '#dbeafe' : '#fef3c7'}; color: ${empStatus === 'Published' ? '#059669' : empStatus === 'Approved' ? '#1d4ed8' : '#d97706'}; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 700;">${empStatus}</span></td></tr>
                        </table>
                    </div>

                    <!-- Score Gauge -->
                    <div style="width: 200px; text-align: center; background: linear-gradient(135deg, #f0fdfa, #ecfdf5); padding: 15px; border-radius: 12px; border: 2px solid #0d9488;">
                        <h3 style="margin: 0 0 10px; font-size: 12px; color: #0d9488; text-transform: uppercase;">Final Score</h3>
                        ${generateScoreGauge(parseFloat(finalScore))}
                    </div>
                </div>

                <!-- Score Breakdown -->
                <div style="display: flex; gap: 15px; margin-bottom: 25px;">
                    <div style="flex: 1; background: #f0fdfa; padding: 15px; border-radius: 12px; border: 1px solid #99f6e4; text-align: center;">
                        <div style="font-size: 10px; color: #0d9488; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Shared Goals</div>
                        <div style="font-size: 28px; font-weight: 800; color: #0d9488;">${w.s}%</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Contribution: ${sharedScore.toFixed(2)}</div>
                    </div>
                    <div style="flex: 1; background: #eff6ff; padding: 15px; border-radius: 12px; border: 1px solid #bfdbfe; text-align: center;">
                        <div style="font-size: 10px; color: #1d4ed8; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Individual Goals</div>
                        <div style="font-size: 28px; font-weight: 800; color: #1d4ed8;">${w.i}%</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Contribution: ${individualScore.toFixed(2)}</div>
                    </div>
                    <div style="flex: 1; background: linear-gradient(135deg, #fef3c7, #fef9c3); padding: 15px; border-radius: 12px; border: 1px solid #fde047; text-align: center;">
                        <div style="font-size: 10px; color: #b45309; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Company Rating</div>
                        <div style="font-size: 28px; font-weight: 800; color: #b45309;">${masterData.rating || 0}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Shared Goal Score</div>
                    </div>
                </div>

                <!-- Charts Section -->
                <div style="display: flex; gap: 20px; margin-bottom: 25px; page-break-inside: avoid;">
                    <!-- Goals Performance Chart -->
                    <div style="flex: 1; background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <h3 style="margin: 0 0 15px; font-size: 12px; color: #1e293b; font-weight: 700;">
                            <span style="color: #0d9488;">●</span> Individual Goals Performance
                        </h3>
                        ${generateGoalRatingBar(goals)}
                    </div>

                    <!-- Rating Distribution -->
                    <div style="width: 320px; background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <h3 style="margin: 0 0 10px; font-size: 12px; color: #1e293b; font-weight: 700;">
                            <span style="color: #0d9488;">●</span> Rating Distribution
                        </h3>
                        <div style="text-align: center;">
                            ${generateRatingDistribution(goals)}
                        </div>
                    </div>
                </div>

                <!-- Individual Objectives Detail -->
                <div style="page-break-before: auto;">
                    <h3 style="margin: 0 0 15px; font-size: 14px; color: #0d9488; font-weight: 700; border-bottom: 2px solid #0d9488; padding-bottom: 8px;">
                        <span style="background: #0d9488; color: white; padding: 2px 8px; border-radius: 4px; margin-right: 8px;">★</span>
                        Individual Objectives Detail
                    </h3>
                    ${goals.map((g, i) => {
                        const rating = g.rating || 0;
                        const rLabel = ratingLabels[rating] || 'Not Rated';
                        const color = rating >= 5 ? '#10b981' : rating >= 4 ? '#0d9488' : rating >= 3 ? '#f59e0b' : rating >= 2 ? '#f97316' : rating > 0 ? '#ef4444' : '#94a3b8';
                        const tHeaders = ['IDLE', 'STAGNANT', 'WALKER', 'RUNNER', 'FLYER', 'ASTRONAUT'];
                        
                        return `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; margin-bottom: 12px; page-break-inside: avoid; ${rating === 0 ? 'border-left: 4px solid #f59e0b;' : ''}">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                                <div style="flex: 1;">
                                    <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">${i + 1}. ${escapeHTML(g.title)}</div>
                                    <div style="font-size: 10px; color: #64748b;">${g.desc || 'No description'}</div>
                                </div>
                                <div style="text-align: right; min-width: 100px;">
                                    <div style="background: ${color}; color: white; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; display: inline-block;">
                                        ${rating > 0 ? `${rating} - ${rLabel}` : 'Pending'}
                                    </div>
                                    <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Weight: ${Math.round((g.weight || 0) * 100)}%</div>
                                </div>
                            </div>
                            
                            <div style="display: flex; gap: 4px; margin-top: 10px;">
                                ${tHeaders.map((h, ti) => `
                                    <div style="flex: 1; background: ${ti === 3 ? '#d1fae5' : '#f1f5f9'}; padding: 6px; border-radius: 6px; text-align: center; ${ti === 3 ? 'border: 1px solid #10b981;' : ''}">
                                        <div style="font-size: 8px; font-weight: 700; color: ${ti === 3 ? '#059669' : '#64748b'}; margin-bottom: 3px;">${h.slice(0, 3)}</div>
                                        <div style="font-size: 9px; color: #1e293b;">${g.targets && g.targets[ti] ? escapeHTML(g.targets[ti].toString().slice(0, 15)) : '-'}</div>
                                    </div>
                                `).join('')}
                            </div>
                            
                            ${g.comment ? `
                            <div style="margin-top: 10px; background: #eff6ff; padding: 10px; border-radius: 8px; border-left: 3px solid #3b82f6;">
                                <div style="font-size: 9px; font-weight: 700; color: #1d4ed8; margin-bottom: 4px;">MANAGER FEEDBACK</div>
                                <div style="font-size: 10px; color: #1e293b; font-style: italic;">"${escapeHTML(g.comment)}"</div>
                            </div>` : ''}
                        </div>`;
                    }).join('')}
                </div>

                <!-- Footer -->
                <div style="text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; font-size: 9px; color: #94a3b8;">
                        Zain Iraq Performance Management System © ${new Date().getFullYear()} | This document is confidential and intended for authorized personnel only.
                    </p>
                </div>
            `;

            // PDF options
            const opt = {
                margin: [5, 5, 5, 5],
                filename: filename,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff',
                    letterRendering: true
                },
                jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'portrait'
                },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
            };

            try {
                await html2pdf().set(opt).from(wrapper).save();
                showToast('PDF with charts downloaded successfully!', 'success');
            } catch (e) {
                console.error('PDF export error:', e);
                showToast('Failed to generate PDF: ' + e.message, 'error');
            }
        }

        // --- KEYBOARD SHORTCUTS ---
        let shortcutsModalOpen = false;

        function initKeyboardShortcuts() {
            document.addEventListener('keydown', handleKeyboardShortcut);
        }

        function handleKeyboardShortcut(e) {
            // Ignore if typing in an input
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

            // Ignore if modifier keys (except for specific combos)
            const key = e.key.toLowerCase();

            // Escape - close any modal/panel
            if (e.key === 'Escape') {
                closeNotifications();
                closeShortcutsModal();
                try { closeConfirm(); } catch (err) { }
                try { closeGoalModal(); } catch (err) { }
                try { closeUserModal(); } catch (err) { }
                return;
            }

            // ? or Shift+/ - Show shortcuts help
            if (key === '?' || (e.shiftKey && key === '/')) {
                e.preventDefault();
                toggleShortcutsModal();
                return;
            }

            // D - Toggle dark mode
            if (key === 'd' && !e.ctrlKey && !e.metaKey) {
                toggleTheme();
                return;
            }

            // N - Toggle notifications
            if (key === 'n' && !e.ctrlKey && !e.metaKey) {
                toggleNotifications();
                return;
            }

            // S - Save (if on scorecard)
            if (key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (typeof saveDraft === 'function') {
                    saveDraft();
                    showToast('Saved!', 'success');
                }
                return;
            }

            // Navigation shortcuts (1-5 for main sections)
            const navItems = document.querySelectorAll('.nav-item');
            if (key >= '1' && key <= '9') {
                const idx = parseInt(key) - 1;
                if (navItems[idx]) {
                    navItems[idx].click();
                }
                return;
            }
        }

        function toggleShortcutsModal() {
            if (shortcutsModalOpen) {
                closeShortcutsModal();
            } else {
                openShortcutsModal();
            }
        }

        function openShortcutsModal() {
            if (document.getElementById('shortcuts-modal')) return;

            const modal = document.createElement('div');
            modal.id = 'shortcuts-modal';
            modal.style.cssText = `
                position: fixed; inset: 0; background: rgba(0,0,0,0.5);
                display: flex; justify-content: center; align-items: center;
                z-index: 10000; backdrop-filter: blur(4px); animation: fadeIn 0.2s ease;
            `;
            modal.onclick = (e) => { if (e.target === modal) closeShortcutsModal(); };

            modal.innerHTML = `
                <div style="background: var(--bg-card); border-radius: 16px; padding: 32px; max-width: 420px; 
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: scaleIn 0.25s ease;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <h3 style="margin:0; font-size:1.25rem; color:var(--text-main);">
                            <i class="fa-solid fa-keyboard" style="color:var(--primary); margin-right:10px;"></i>
                            Keyboard Shortcuts
                        </h3>
                        <button onclick="closeShortcutsModal()" style="background:none; border:none; cursor:pointer; 
                                font-size:1.25rem; color:var(--text-muted);">&times;</button>
                    </div>
                    <div style="display:grid; gap:12px;">
                        <div class="shortcut-row"><kbd>?</kbd> <span>Show this help</span></div>
                        <div class="shortcut-row"><kbd>D</kbd> <span>Toggle dark mode</span></div>
                        <div class="shortcut-row"><kbd>N</kbd> <span>Toggle notifications</span></div>
                        <div class="shortcut-row"><kbd>1-5</kbd> <span>Navigate to section</span></div>
                        <div class="shortcut-row"><kbd>Ctrl+S</kbd> <span>Save scorecard</span></div>
                        <div class="shortcut-row"><kbd>Esc</kbd> <span>Close modal/panel</span></div>
                    </div>
                    <div style="margin-top:24px; padding-top:16px; border-top:1px solid var(--border); 
                                text-align:center; color:var(--text-muted); font-size:0.85rem;">
                        Press <kbd>Esc</kbd> to close
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            shortcutsModalOpen = true;
        }

        function closeShortcutsModal() {
            const modal = document.getElementById('shortcuts-modal');
            if (modal) modal.remove();
            shortcutsModalOpen = false;
        }

        // Initialize shortcuts when app loads
        document.addEventListener('DOMContentLoaded', initKeyboardShortcuts);


        // --- 1. SECURE CONFIGURATION ---
        // --- 1. SECURE CONFIGURATION ---
        // REPLACE THIS with your actual Railway PHP URL
        const API_URL = 'https://pms-back-production-b693.up.railway.app';

        // SECURITY: XSS Protection Helper - defined early so it's available everywhere
        function escapeHTML(str) {
            if (!str) return "";
            return str.toString().replace(/[&<>'"]/g,
                tag => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    "'": '&#39;',
                    '"': '&quot;'
                }[tag]));
        }

        // REPLACE THIS with the "API_SECRET" you set in Railway Variables
        // Shared Headers Helper (Ensures every request is authorized)
        // REPLACE THIS BLOCK
        const API_HEADERS = {
            'Content-Type': 'application/json',
            get 'Authorization'() {
                return 'Bearer ' + (localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token') || '');
            }
        };

        // --- SECURITY: TOKEN ROTATION ---
        const TOKEN_ROTATION_INTERVAL = 15 * 60 * 1000; // 15 minutes
        let lastTokenRotation = Date.now();

        async function rotateToken() {
            const currentToken = localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token');
            if (!currentToken) return;

            try {
                const res = await fetch(`${API_URL}?action=rotateToken`, {
                    method: 'POST',
                    headers: API_HEADERS,
                    body: JSON.stringify({ token: currentToken })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.token) {
                        localStorage.setItem('zpms_token', data.token);
                        sessionStorage.setItem('zpms_token', data.token);
                        lastTokenRotation = Date.now();
                        logActivity('TOKEN_ROTATED', 'Session token rotated');
                    }
                }
            } catch (e) {
                console.warn('Token rotation failed:', e);
            }
        }

        function checkTokenRotation() {
            if (Date.now() - lastTokenRotation > TOKEN_ROTATION_INTERVAL) {
                rotateToken();
            }
        }

        // Check for token rotation on user activity
        document.addEventListener('click', () => {
            localStorage.setItem('zpms_time', Date.now()); // Update idle timer
            checkTokenRotation();
        });

        // --- SECURITY: ACTIVITY LOGGING ---
        const activityLog = [];
        const MAX_LOG_ENTRIES = 100;

        function logActivity(action, details = '', targetId = null) {
            const entry = {
                timestamp: new Date().toISOString(),
                action: action,
                details: details,
                targetId: targetId,
                userId: localStorage.getItem('zpms_uid') || 'unknown',
                sessionId: (localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token'))?.slice(-8) || 'none'
            };

            activityLog.unshift(entry);

            // Keep log size manageable
            if (activityLog.length > MAX_LOG_ENTRIES) {
                activityLog.pop();
            }

            // Store in sessionStorage for persistence during session
            try {
                sessionStorage.setItem('zpms_activity_log', JSON.stringify(activityLog.slice(0, 50)));
            } catch (e) { /* Storage full, ignore */ }

            // Send critical events to server
            if (['LOGIN', 'LOGOUT', 'SUBMIT', 'APPROVE', 'REJECT', 'PUBLISH'].includes(action)) {
                sendActivityToServer(entry);
            }
        }

        async function sendActivityToServer(entry) {
            try {
                await fetch(`${API_URL}?action=logActivity`, {
                    method: 'POST',
                    headers: API_HEADERS,
                    body: JSON.stringify(entry)
                });
            } catch (e) {
                console.warn('Failed to log activity:', e);
            }
        }

        function getActivityLog() {
            return activityLog;
        }

        function showActivityLog() {
            const log = getActivityLog();
            console.table(log);
            return log;
        }

        // Load any existing log from session
        try {
            const savedLog = sessionStorage.getItem('zpms_activity_log');
            if (savedLog) {
                activityLog.push(...JSON.parse(savedLog));
            }
        } catch (e) { /* Invalid log, ignore */ }


        // --- 2. THE BRIDGE (Connects Frontend to PHP) ---
        const db = {
            from: (table) => {
                return {
                    select: (cols) => {
                        return {
                            // 1. Exact Match (Login, Profile)
                            eq: (col, val) => {
                                const execute = async () => {
                                    let action = (table === 'company_settings') ? 'getSettings' : 'checkID';
                                    if (action === 'getSettings' && !localStorage.getItem('zpms_token') && !sessionStorage.getItem('zpms_token')) {
                                        return { data: null, error: null };
                                    }

                                    try {
                                        const res = await fetch(`${API_URL}?action=${action}`, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': API_HEADERS.Authorization // Access the getter
                                            },
                                            body: JSON.stringify({ id: val })
                                        });
                                        
                                        // Handle session expiry gracefully
                                        if (res.status === 401 || res.status === 403) {
                                            handleSessionExpired();
                                            return { data: null, error: { message: "Session expired" } };
                                        }
                                        
                                        if (!res.ok) return { data: null, error: { message: "Server Error: " + res.status } };
                                        return { data: await res.json(), error: null };
                                    } catch (e) { return { data: null, error: e }; }
                                };
                                return {
                                    then: (resolve, reject) => execute().then(resolve, reject),
                                    single: async () => {
                                        const r = await execute();
                                        // Backend checkID/getSettings already returns a single object, but we ensure safety
                                        if (r.data && Array.isArray(r.data)) r.data = r.data.length ? r.data[0] : null;
                                        return r;
                                    },
                                    maybeSingle: async () => {
                                        const r = await execute();
                                        if (r.data && Array.isArray(r.data)) r.data = r.data.length ? r.data[0] : null;
                                        return r;
                                    }
                                };
                            },

                            // 2. Range (Directory) - Note: This just wraps the fetchAll logic if called via db
                            range: async (from, to) => {
                                try {
                                    const res = await fetch(`${API_URL}?action=fetchAll&from=${from}&to=${to}`, {
                                        headers: API_HEADERS
                                    });
                                    if (res.status === 401 || res.status === 403) {
                                        handleSessionExpired();
                                        return { data: [], error: { message: "Session expired" } };
                                    }
                                    return { data: await res.json(), error: null };
                                } catch (e) { return { data: [], error: e }; }
                            },

                            // 3. Limit (Column Mapping)
                            limit: async (n) => {
                                const res = await fetch(`${API_URL}?action=fetchAll&from=0&to=1`, {
                                    headers: API_HEADERS
                                });
                                if (res.status === 401 || res.status === 403) {
                                    handleSessionExpired();
                                    return { data: [], error: { message: "Session expired" } };
                                }
                                return { data: await res.json(), error: null };
                            },

                            // 4. OR Filter (Team Loading - Client Side Filtering)
                            // Since backend fetchAll is secured, we fetch all and filter in memory for complex logic
                            or: async (filterStr) => {
                                try {
                                    // Reuse the robust fetchAllData logic if possible, or do a simplified fetch
                                    // For safety, we fetch the relevant rows. Ideally, fetchAllData() is used instead.
                                    // This implements a basic filter on the full dataset for compatibility.
                                    if (typeof allCompanyData === 'undefined' || allCompanyData.length === 0) {
                                        return { data: [], error: { message: "Data not synced" } };
                                    }

                                    // Parse conditions: "manager_id.ilike.%123%"
                                    const conditions = filterStr.split(',');

                                    const filtered = allCompanyData.filter(row => {
                                        return conditions.some(cond => {
                                            const parts = cond.split('.');
                                            if (parts.length < 3) return false;

                                            const col = parts[0];
                                            const val = parts[2].replace(/%/g, '').toLowerCase();
                                            const rowVal = (row[col] || '').toString().toLowerCase();

                                            return rowVal.includes(val);
                                        });
                                    });

                                    return { data: filtered, error: null };
                                } catch (e) { return { data: [], error: e }; }
                            }
                        };
                    },

                    // Handle Writes (Upsert)
                    upsert: async (payload) => {
                        const action = Array.isArray(payload) ? 'bulkUpsert' : (table === 'company_settings' ? 'saveSettings' : 'saveUser');
                        try {
                            const res = await fetch(`${API_URL}?action=${action}`, {
                                method: 'POST',
                                headers: API_HEADERS,
                                body: JSON.stringify({ payload: payload })
                            });
                            if (res.status === 401 || res.status === 403) {
                                handleSessionExpired();
                                return { error: { message: "Session expired" } };
                            }
                            if (!res.ok) {
                                const errText = await res.text();
                                return { error: { message: errText || "Save failed" } };
                            }
                            return { error: null };
                        } catch (e) { return { error: e }; }
                    },

                    // Handle Updates (Re-uses saveUser logic)
                    update: (payload) => {
                        return {
                            eq: async (col, val) => {
                                // For single update
                                try {
                                    const res = await fetch(`${API_URL}?action=saveUser`, {
                                        method: 'POST',
                                        headers: API_HEADERS,
                                        body: JSON.stringify({ id: val, payload: payload })
                                    });
                                    if (res.status === 401 || res.status === 403) {
                                        handleSessionExpired();
                                        return { error: { message: "Session expired" } };
                                    }
                                    if (!res.ok) {
                                        const txt = await res.text();
                                        return { error: { message: txt || "Update failed" } };
                                    }
                                    return { error: null };
                                } catch (e) { return { error: e }; }
                            },
                            in: async (col, valArray) => {
                                // For bulk status updates (Approve/Publish)
                                for (const id of valArray) {
                                    const res = await fetch(`${API_URL}?action=saveUser`, {
                                        method: 'POST',
                                        headers: API_HEADERS,
                                        body: JSON.stringify({ id: id, payload: payload })
                                    });
                                    if (res.status === 401 || res.status === 403) {
                                        handleSessionExpired();
                                        return { error: { message: "Session expired" } };
                                    }
                                }
                                return { error: null };
                            }
                        };
                    },

                    // Handle Deletes
                    delete: () => {
                        return {
                            eq: async (col, val) => {
                                try {
                                    // Determine action based on the table name
                                    const action = (table === 'company_settings') ? 'deleteSettings' : 'deleteUser';

                                    const res = await fetch(`${API_URL}?action=${action}`, {
                                        method: 'POST',
                                        headers: API_HEADERS,
                                        body: JSON.stringify({ id: val })
                                    });
                                    if (res.status === 401 || res.status === 403) {
                                        handleSessionExpired();
                                        return { error: { message: "Session expired" } };
                                    }
                                    return { error: res.ok ? null : { message: "Delete failed" } };
                                } catch (e) { return { error: e }; }
                            }
                        };
                    }
                };
            },
            // RPC Calls (Publishing Goals)
            rpc: async (name, params) => {
                if (name === 'publish_goals') {
                    try {
                        const res = await fetch(`${API_URL}?action=rpcPublish`, {
                            method: 'POST',
                            headers: API_HEADERS,
                            body: JSON.stringify({ payload: params })
                        });
                        if (res.status === 401 || res.status === 403) {
                            handleSessionExpired();
                            return { error: { message: "Session expired" } };
                        }
                        return { error: res.ok ? null : { message: "RPC failed" } };
                    } catch (e) { return { error: e }; }
                }
            }
        };
        // --- OTP AUTHENTICATION SYSTEM ---

        let generatedOTP = null;

        function focusNext(el) {
            if (el.value.length === 1) {
                const next = el.nextElementSibling;
                if (next) next.focus();
            }
        }

        async function triggerOTP() {
            // 1. Generate a mock code (In production, your backend sends this)
            generatedOTP = Math.floor(1000 + Math.random() * 9000).toString();
            // For testing purposes

            // 2. Simulate sending (Show loading)
            const btn = document.getElementById('btn-login');
            const originalText = btn.innerText;
            btn.innerText = "Sending Code...";
            btn.disabled = true;

            await new Promise(r => setTimeout(r, 1500)); // Fake network delay

            // 3. Show OTP Modal
            document.getElementById('otp-modal').style.display = 'flex';

            // 4. Focus first input
            setTimeout(() => document.querySelector('.otp-digit').focus(), 100);

            // Reset Login Button
            btn.innerText = originalText;
            btn.disabled = false;

            showToast(`Code sent to registered contact.`, 'info');
        }

        function verifyOTP() {
            // 1. Collect inputs
            const inputs = document.querySelectorAll('.otp-digit');
            let enteredCode = '';
            inputs.forEach(i => enteredCode += i.value);

            // 2. Validate
            if (enteredCode.length < 4) {
                showToast("Please enter the full 4-digit code.", "error");
                return;
            }

            if (enteredCode === generatedOTP) { // 0000 is a master backdoor for testing
                showToast("Identity Verified!", "success");
                document.getElementById('otp-modal').style.display = 'none';
                completeLoginProcess(); // Proceed to actual login
            } else {
                showToast("Invalid Code. Please try again.", "error");
                inputs.forEach(i => { i.value = ''; i.style.borderColor = '#ef4444'; });
                inputs[0].focus();
            }
        }

        function resendOTP() {
            triggerOTP();
            document.querySelectorAll('.otp-digit').forEach(i => i.value = '');
        }
        const IDLE_LIMIT = 3600000;
        const MASTER_ADMIN_TITLE = "Head of Employee Growth and Relation Department";
        const SHARED_GOALS_ID = 'shared_goals_v1';

        // --- DATA ---
        const defaultIndivGoals = [
            { title: "Functional Objective 1", weight: 0.40, desc: "", rating: 0, targets: ["", "", "", "", "", ""] },
            { title: "Functional Objective 2", weight: 0.30, desc: "", rating: 0, targets: ["", "", "", "", "", ""] },
            { title: "Development Objective", weight: 0.30, desc: "", rating: 0, targets: ["", "", "", "", "", ""] }
        ];
        
        // =====================================================
        // DYNAMIC RATING LEVELS SYSTEM
        // =====================================================
        
        // Rating Mode: 'level' or 'percentage'
        // - level: Manager rates 1, 2, 3, 4, 5, 6 (simple level selection)
        // - percentage: Manager enters 0-100%, system maps to level based on ranges
        
        // Default rating configuration (6 levels - current system)
        const DEFAULT_RATING_CONFIG = {
            cycle: '2025',
            ratingMode: 'level', // 'level' or 'percentage'
            levelsCount: 6,
            targetLevel: 4, // Which level is the "Target" level
            levels: [
                { level: 6, name: "ASTRONAUT", color: "#0f766e", bgColor: "#ccfbf1", minScore: 90, maxScore: 100, description: "Exceptional performance, exceeds all expectations" },
                { level: 5, name: "FLYER", color: "#10b981", bgColor: "#d1fae5", minScore: 75, maxScore: 89, description: "Exceeds expectations consistently" },
                { level: 4, name: "RUNNER", color: "#3b82f6", bgColor: "#dbeafe", minScore: 60, maxScore: 74, description: "Meets expectations fully (Target)" },
                { level: 3, name: "WALKER", color: "#f59e0b", bgColor: "#fef3c7", minScore: 45, maxScore: 59, description: "Partially meets expectations" },
                { level: 2, name: "STAGNANT", color: "#ef4444", bgColor: "#fee2e2", minScore: 25, maxScore: 44, description: "Below expectations" },
                { level: 1, name: "IDLE", color: "#94a3b8", bgColor: "#f1f5f9", minScore: 0, maxScore: 24, description: "Significantly below expectations" }
            ]
        };
        
        // Rating level templates
        const RATING_TEMPLATES = {
            '6-level-astronaut': {
                name: '6 Levels (Astronaut Scale)',
                ratingMode: 'level',
                levelsCount: 6,
                targetLevel: 4,
                levels: [
                    { level: 6, name: "ASTRONAUT", color: "#0f766e", bgColor: "#ccfbf1", minScore: 90, maxScore: 100, description: "Exceptional performance" },
                    { level: 5, name: "FLYER", color: "#10b981", bgColor: "#d1fae5", minScore: 75, maxScore: 89, description: "Exceeds expectations" },
                    { level: 4, name: "RUNNER", color: "#3b82f6", bgColor: "#dbeafe", minScore: 60, maxScore: 74, description: "Meets expectations (Target)" },
                    { level: 3, name: "WALKER", color: "#f59e0b", bgColor: "#fef3c7", minScore: 45, maxScore: 59, description: "Partially meets" },
                    { level: 2, name: "STAGNANT", color: "#ef4444", bgColor: "#fee2e2", minScore: 25, maxScore: 44, description: "Below expectations" },
                    { level: 1, name: "IDLE", color: "#94a3b8", bgColor: "#f1f5f9", minScore: 0, maxScore: 24, description: "Significantly below" }
                ]
            },
            '5-level-standard': {
                name: '5 Levels (Standard)',
                ratingMode: 'level',
                levelsCount: 5,
                targetLevel: 3,
                levels: [
                    { level: 5, name: "OUTSTANDING", color: "#0f766e", bgColor: "#ccfbf1", minScore: 85, maxScore: 100, description: "Exceptional performance" },
                    { level: 4, name: "EXCEEDS", color: "#10b981", bgColor: "#d1fae5", minScore: 70, maxScore: 84, description: "Exceeds expectations" },
                    { level: 3, name: "MEETS", color: "#3b82f6", bgColor: "#dbeafe", minScore: 50, maxScore: 69, description: "Meets expectations (Target)" },
                    { level: 2, name: "BELOW", color: "#f59e0b", bgColor: "#fef3c7", minScore: 25, maxScore: 49, description: "Below expectations" },
                    { level: 1, name: "UNSATISFACTORY", color: "#ef4444", bgColor: "#fee2e2", minScore: 0, maxScore: 24, description: "Unsatisfactory" }
                ]
            },
            '5-percentage': {
                name: '5 Levels (Percentage Mode)',
                ratingMode: 'percentage',
                levelsCount: 5,
                targetLevel: 3,
                levels: [
                    { level: 5, name: "EXCEPTIONAL", color: "#0f766e", bgColor: "#ccfbf1", minScore: 90, maxScore: 100, description: "90-100%" },
                    { level: 4, name: "EXCEEDS EXPECTATIONS", color: "#10b981", bgColor: "#d1fae5", minScore: 70, maxScore: 89, description: "70-89%" },
                    { level: 3, name: "MEETS EXPECTATIONS", color: "#3b82f6", bgColor: "#dbeafe", minScore: 50, maxScore: 69, description: "50-69% (Target)" },
                    { level: 2, name: "BELOW EXPECTATIONS", color: "#f59e0b", bgColor: "#fef3c7", minScore: 30, maxScore: 49, description: "30-49%" },
                    { level: 1, name: "NEEDS IMPROVEMENT", color: "#ef4444", bgColor: "#fee2e2", minScore: 0, maxScore: 29, description: "0-29%" }
                ]
            },
            '4-percentage': {
                name: '4 Levels (Percentage Mode)',
                ratingMode: 'percentage',
                levelsCount: 4,
                targetLevel: 2,
                levels: [
                    { level: 4, name: "OUTSTANDING", color: "#0f766e", bgColor: "#ccfbf1", minScore: 80, maxScore: 100, description: "80-100%" },
                    { level: 3, name: "PROFICIENT", color: "#10b981", bgColor: "#d1fae5", minScore: 55, maxScore: 79, description: "55-79%" },
                    { level: 2, name: "DEVELOPING", color: "#f59e0b", bgColor: "#fef3c7", minScore: 30, maxScore: 54, description: "30-54% (Target)" },
                    { level: 1, name: "NEEDS IMPROVEMENT", color: "#ef4444", bgColor: "#fee2e2", minScore: 0, maxScore: 29, description: "0-29%" }
                ]
            },
            '3-level-simple': {
                name: '3 Levels (Simple)',
                ratingMode: 'level',
                levelsCount: 3,
                targetLevel: 2,
                levels: [
                    { level: 3, name: "EXCEEDS", color: "#10b981", bgColor: "#d1fae5", minScore: 70, maxScore: 100, description: "Exceeds expectations" },
                    { level: 2, name: "MEETS", color: "#3b82f6", bgColor: "#dbeafe", minScore: 40, maxScore: 69, description: "Meets expectations (Target)" },
                    { level: 1, name: "BELOW", color: "#ef4444", bgColor: "#fee2e2", minScore: 0, maxScore: 39, description: "Below expectations" }
                ]
            }
        };
        
        // Current active rating configuration (loaded from DB or default)
        let ratingConfig = JSON.parse(JSON.stringify(DEFAULT_RATING_CONFIG));
        
        // Dynamic rating labels (generated from config)
        let ratingLabels = {};
        
        // Initialize rating labels from config
        function initRatingLabels() {
            ratingLabels = {};
            ratingConfig.levels.forEach(lvl => {
                ratingLabels[lvl.level] = lvl.name;
            });
        }
        
        // Get rating mode ('level' or 'percentage')
        function getRatingMode() {
            return ratingConfig.ratingMode || 'level';
        }
        
        // Get rating label by level number
        function getRatingLabel(level) {
            const lvl = ratingConfig.levels.find(l => l.level === level);
            return lvl ? lvl.name : 'N/A';
        }
        
        // Get rating color by level number
        function getRatingColor(level) {
            const lvl = ratingConfig.levels.find(l => l.level === level);
            return lvl ? lvl.color : '#94a3b8';
        }
        
        // Get rating background color by level number
        function getRatingBgColor(level) {
            const lvl = ratingConfig.levels.find(l => l.level === level);
            return lvl ? lvl.bgColor : '#f1f5f9';
        }
        
        // Get CSS class for rating level
        function getRatingClass(level) {
            return `lvl-${level}`;
        }
        
        // Get levels count
        function getLevelsCount() {
            return ratingConfig.levelsCount;
        }
        
        // Get target level (the "Target" benchmark level)
        function getTargetLevel() {
            return ratingConfig.targetLevel;
        }
        
        // Get all levels sorted from highest to lowest
        function getAllLevels() {
            return [...ratingConfig.levels].sort((a, b) => b.level - a.level);
        }
        
        // Get level headers for scorecard targets (from highest to lowest)
        function getLevelHeaders() {
            return getAllLevels().map(lvl => {
                const isTarget = lvl.level === ratingConfig.targetLevel;
                return isTarget ? `${lvl.name} (Target)` : lvl.name;
            });
        }
        
        // Generate empty targets array based on current levels count
        function getEmptyTargets() {
            return Array(ratingConfig.levelsCount).fill('');
        }
        
        // Convert percentage score to level (for percentage mode)
        function percentageToLevel(percentage) {
            const pct = parseFloat(percentage) || 0;
            // Find the level that matches this percentage range
            const matchedLevel = ratingConfig.levels.find(lvl => 
                pct >= lvl.minScore && pct <= lvl.maxScore
            );
            return matchedLevel ? matchedLevel.level : 1;
        }
        
        // Get level info from percentage (for percentage mode)
        function getLevelFromPercentage(percentage) {
            const pct = parseFloat(percentage) || 0;
            const matchedLevel = ratingConfig.levels.find(lvl => 
                pct >= lvl.minScore && pct <= lvl.maxScore
            );
            return matchedLevel || ratingConfig.levels[ratingConfig.levels.length - 1];
        }
        
        // Convert level to percentage midpoint (for display in percentage mode)
        function levelToPercentage(level) {
            const lvl = ratingConfig.levels.find(l => l.level === level);
            if (!lvl) return 0;
            return Math.round((lvl.minScore + lvl.maxScore) / 2);
        }
        
        // Get the score value for calculation based on mode
        function getRatingScoreValue(ratingValue) {
            if (getRatingMode() === 'percentage') {
                // In percentage mode, ratingValue is the actual percentage (0-100)
                return parseFloat(ratingValue) || 0;
            } else {
                // In level mode, convert level to a score (e.g., 1-6 becomes comparable score)
                // Use the midpoint of the level's score range
                const lvl = ratingConfig.levels.find(l => l.level === parseInt(ratingValue));
                if (lvl) {
                    return (lvl.minScore + lvl.maxScore) / 2;
                }
                return 0;
            }
        }
        
        // Format rating for display
        function formatRatingDisplay(ratingValue) {
            if (getRatingMode() === 'percentage') {
                const pct = parseFloat(ratingValue) || 0;
                const levelInfo = getLevelFromPercentage(pct);
                return `${pct}% (${levelInfo.name})`;
            } else {
                const lvl = parseInt(ratingValue) || 0;
                return `${lvl} - ${getRatingLabel(lvl)}`;
            }
        }
        
        // Load rating configuration from database
        async function loadRatingConfiguration() {
            try {
                const configId = `rating_config_${currentCycle}`;
                const { data, error } = await db.from('company_settings').select('data').eq('id', configId).single();
                
                if (data && data.data) {
                    const savedConfig = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                    ratingConfig = { ...DEFAULT_RATING_CONFIG, ...savedConfig };
                } else {
                    // Use default configuration
                    ratingConfig = JSON.parse(JSON.stringify(DEFAULT_RATING_CONFIG));
                    ratingConfig.cycle = currentCycle;
                }
                
                // Initialize labels
                initRatingLabels();
                
                // Generate dynamic CSS for rating levels
                generateRatingCSS();
                
                console.log(`Rating config loaded for cycle ${currentCycle}:`, ratingConfig.levelsCount, 'levels,', ratingConfig.ratingMode, 'mode');
            } catch (err) {
                console.error('Error loading rating configuration:', err);
                ratingConfig = JSON.parse(JSON.stringify(DEFAULT_RATING_CONFIG));
                initRatingLabels();
                generateRatingCSS();
            }
        }
        
        // Save rating configuration to database
        async function saveRatingConfiguration() {
            try {
                const configId = `rating_config_${currentCycle}`;
                const { error } = await db.from('company_settings').upsert({
                    id: configId,
                    data: ratingConfig
                });
                
                if (error) throw error;
                
                showToast('Rating configuration saved successfully!', 'success');
                return true;
            } catch (err) {
                console.error('Error saving rating configuration:', err);
                showToast('Failed to save rating configuration', 'error');
                return false;
            }
        }
        
        // Generate dynamic CSS for current rating levels
        function generateRatingCSS() {
            // Remove old dynamic styles
            const oldStyle = document.getElementById('dynamic-rating-styles');
            if (oldStyle) oldStyle.remove();
            
            // Create new styles
            let css = '';
            ratingConfig.levels.forEach(lvl => {
                css += `
                    .lvl-${lvl.level} { 
                        background: ${lvl.color}; 
                        color: white; 
                    }
                    .lvl-${lvl.level}-bg { 
                        background: ${lvl.bgColor}; 
                        color: ${lvl.color}; 
                    }
                `;
            });
            
            // Add lvl-0 for pending/not rated
            css += `
                .lvl-0 { 
                    background: #f1f5f9; 
                    color: #64748b; 
                }
            `;
            
            const style = document.createElement('style');
            style.id = 'dynamic-rating-styles';
            style.innerHTML = css;
            document.head.appendChild(style);
        }
        
        // Initialize rating labels from default config on load
        initRatingLabels();

        let user, targetUser, isManager, isDirectSupervisor, isRegistering, isAdminSearchMode;
        let masterData = { rating: 0, goals: [] };
        let hasDraft = false;
        let saveTimer;
        let chart1, chartAdmin, chartOrg;
        
        // --- CYCLE MANAGEMENT ---
        let currentCycle = '2025';
        let availableCycles = [];
        let cycleInitialized = false;
        
        const COL = {
            id: 'id',
            name: 'name',
            lvl: 'level',       // This fixes "undefined" in the sidebar
            job: 'job',
            div: 'division',
            dept: 'department',
            mgr: 'manager_id',  // This fixes the "-" Manager Name
            stat: 'status',
            goals: 'goals',
            role: 'access_role',
            email: 'email',
            phone: 'phone_number',
            pass: 'password',
            cycle: 'cycle'
        };
        let adminCache = [];
        let allCompanyData = [];
        let globalReports = [];
        // --- EXISTING VARIABLES ---
        let draftSaveTimer; // <--- ADD THIS NEW VARIABLE for Shared Goals
        
        // --- WEIGHT CONFIGURATION ---
        const WEIGHT_CONFIG_ID = 'weight_config_v1';
        let weightConfigurations = {}; // Will store per-company weight configs
        
        // --- PROGRESS WEIGHT CONFIGURATION ---
        const PROGRESS_CONFIG_ID = 'progress_config_v1';
        let progressConfigurations = {}; // Will store progress weight configs
        
        // Default progress configuration
        const DEFAULT_PROGRESS_CONFIG = {
            cascadeMode: 'direct', // 'direct' = direct reports only, 'full' = full cascade
            levelWeights: {
                // Individual vs Team weight per level
                'L1': { individual: 50, team: 50 },
                'L2': { individual: 60, team: 40 },
                'L3': { individual: 70, team: 30 },
                'L4': { individual: 80, team: 20 },
                'L5': { individual: 90, team: 10 },
                'L6': { individual: 100, team: 0 },
                'L7': { individual: 100, team: 0 },
                'default': { individual: 100, team: 0 }
            },
            teamMemberWeights: {
                // How much each team member level contributes to team progress
                'L1': 50,
                'L2': 40,
                'L3': 35,
                'L4': 30,
                'L5': 25,
                'L6': 20,
                'L7': 15,
                'default': 10
            },
            autoUpdateInterval: 0 // 0 = instant, or milliseconds for polling
        };
        
        // Load progress configurations from database
        async function loadProgressConfigurations() {
            try {
                const { data, error } = await db.from('company_settings').select('data').eq('id', PROGRESS_CONFIG_ID).single();
                if (data && data.data) {
                    progressConfigurations = data.data;
                    console.log('Progress configurations loaded from DB');
                } else {
                    progressConfigurations = JSON.parse(JSON.stringify(DEFAULT_PROGRESS_CONFIG));
                    console.log('Using default progress configurations');
                }
            } catch (e) {
                console.log('Progress config not found, using defaults');
                progressConfigurations = JSON.parse(JSON.stringify(DEFAULT_PROGRESS_CONFIG));
            }
        }
        
        // Save progress configurations to database
        async function saveProgressConfigurations() {
            try {
                const { error } = await db.from('company_settings').upsert({
                    id: PROGRESS_CONFIG_ID,
                    data: progressConfigurations
                });
                if (error) throw error;
                console.log('Progress configurations saved');
                return true;
            } catch (e) {
                console.error('Failed to save progress config:', e);
                return false;
            }
        }
        
        // Calculate manager's overall progress (Individual + Team)
        function calculateManagerProgress(managerId, managerLevel, teamMembers, cascadeMode = null) {
            const config = progressConfigurations || DEFAULT_PROGRESS_CONFIG;
            const mode = cascadeMode || config.cascadeMode || 'direct';
            
            // Get weights for this manager's level
            const levelKey = managerLevel || 'default';
            const weights = config.levelWeights[levelKey] || config.levelWeights['default'] || { individual: 100, team: 0 };
            
            // Get manager's own data from cache
            const managerData = getEmployeeFromCache(managerId);
            if (!managerData) return { individual: 0, team: 0, overall: 0, weights };
            
            // Calculate individual progress
            let managerGoals = managerData[COL.goals];
            if (typeof managerGoals === 'string') {
                try { managerGoals = JSON.parse(managerGoals); } catch (e) { managerGoals = []; }
            }
            if (!Array.isArray(managerGoals)) managerGoals = [];
            
            let individualProgress = 0;
            if (managerGoals.length > 0) {
                const totalProgress = managerGoals.reduce((sum, g) => sum + (g.progress || 0), 0);
                individualProgress = totalProgress / managerGoals.length;
            }
            
            // Calculate team progress
            let teamProgress = 0;
            if (weights.team > 0 && teamMembers && teamMembers.length > 0) {
                let totalTeamWeight = 0;
                let weightedTeamProgress = 0;
                
                teamMembers.forEach(member => {
                    const memberLevel = member[COL.lvl] || 'default';
                    const memberWeight = config.teamMemberWeights[memberLevel] || config.teamMemberWeights['default'] || 10;
                    
                    let memberGoals = member[COL.goals];
                    if (typeof memberGoals === 'string') {
                        try { memberGoals = JSON.parse(memberGoals); } catch (e) { memberGoals = []; }
                    }
                    if (!Array.isArray(memberGoals)) memberGoals = [];
                    
                    let memberProgress = 0;
                    if (memberGoals.length > 0) {
                        const totalMemberProgress = memberGoals.reduce((sum, g) => sum + (g.progress || 0), 0);
                        memberProgress = totalMemberProgress / memberGoals.length;
                    }
                    
                    // If full cascade mode, recursively calculate team member's progress
                    if (mode === 'full') {
                        const subTeam = getTeamFromCache(member[COL.id], member[COL.name]);
                        if (subTeam && subTeam.length > 0) {
                            const subProgress = calculateManagerProgress(member[COL.id], memberLevel, subTeam, mode);
                            memberProgress = subProgress.overall;
                        }
                    }
                    
                    weightedTeamProgress += memberProgress * memberWeight;
                    totalTeamWeight += memberWeight;
                });
                
                teamProgress = totalTeamWeight > 0 ? weightedTeamProgress / totalTeamWeight : 0;
            }
            
            // Calculate overall progress
            const overallProgress = (individualProgress * (weights.individual / 100)) + (teamProgress * (weights.team / 100));
            
            return {
                individual: Math.round(individualProgress * 10) / 10,
                team: Math.round(teamProgress * 10) / 10,
                overall: Math.round(overallProgress * 10) / 10,
                weights: weights
            };
        }
        
        // Real-time progress update subscription
        let progressUpdateSubscription = null;
        
        function setupProgressAutoUpdate() {
            // Clear existing subscription
            if (progressUpdateSubscription) {
                clearInterval(progressUpdateSubscription);
                progressUpdateSubscription = null;
            }
            
            // For instant updates, we'll use a short polling interval
            // In production, this could be replaced with WebSocket/Supabase realtime
            progressUpdateSubscription = setInterval(async () => {
                if (document.getElementById('progress-content')) {
                    // Refresh progress data silently
                    await refreshProgressData();
                }
            }, 30000); // Check every 30 seconds for updates
        }
        
        async function refreshProgressData() {
            const data = window.progressDashboardData;
            if (!data) return;
            
            // Fetch fresh team data
            const myId = user[COL.id];
            const myName = user[COL.name];
            
            let filter = `${COL.mgr}.ilike.%${myId}%`;
            if (myName) filter += `,${COL.mgr}.ilike.%${myName}%`;
            
            const { data: freshTeamData } = await db.from('active_list').select('*').or(filter);
            const { data: freshMyData } = await db.from('active_list').select('*').eq(COL.id, myId).single();
            
            if (freshTeamData && freshMyData) {
                // Update cache
                if (freshMyData[COL.id]) localDataIndex[freshMyData[COL.id]] = freshMyData;
                freshTeamData.forEach(m => { if (m[COL.id]) localDataIndex[m[COL.id]] = m; });
                
                // Update dashboard data
                let myGoals = freshMyData[COL.goals];
                if (typeof myGoals === 'string') {
                    try { myGoals = JSON.parse(myGoals); } catch (e) { myGoals = []; }
                }
                
                window.progressDashboardData = {
                    myGoals: myGoals || [],
                    myId: myId,
                    teamMembers: freshTeamData,
                    myLevel: freshMyData[COL.lvl]
                };
                
                // Update UI if on progress tab
                updateProgressDisplay();
            }
        }
        
        function updateProgressDisplay() {
            const data = window.progressDashboardData;
            if (!data) return;
            
            // Recalculate progress
            const progress = calculateManagerProgress(data.myId, data.myLevel, data.teamMembers);
            
            // Update progress bars if they exist
            const overallBar = document.getElementById('overall-progress-bar');
            const individualBar = document.getElementById('individual-progress-bar');
            const teamBar = document.getElementById('team-progress-bar');
            const overallVal = document.getElementById('overall-progress-value');
            const individualVal = document.getElementById('individual-progress-value');
            const teamVal = document.getElementById('team-progress-value');
            
            if (overallBar) overallBar.style.width = progress.overall + '%';
            if (individualBar) individualBar.style.width = progress.individual + '%';
            if (teamBar) teamBar.style.width = progress.team + '%';
            if (overallVal) overallVal.textContent = progress.overall + '%';
            if (individualVal) individualVal.textContent = progress.individual + '%';
            if (teamVal) teamVal.textContent = progress.team + '%';
        }
        
        // Default weight configuration (fallback)
        const DEFAULT_WEIGHT_CONFIG = {
            'Zain Iraq': {
                rules: [
                    { type: 'title', match: 'ceo', shared: 100, individual: 0, priority: 1 },
                    { type: 'title', match: 'chief executive officer', shared: 100, individual: 0, priority: 1 },
                    { type: 'title', match: 'cfo', shared: 50, individual: 50, priority: 2 },
                    { type: 'title', match: 'chief financial officer', shared: 50, individual: 50, priority: 2 },
                    { type: 'title', match: 'cco', shared: 30, individual: 70, priority: 3 },
                    { type: 'title', match: 'cto', shared: 30, individual: 70, priority: 3 },
                    { type: 'title', match: 'chief', shared: 20, individual: 80, priority: 4 },
                    { type: 'level', match: 'L1', shared: 20, individual: 80, priority: 5 },
                    { type: 'level', match: 'L2', shared: 15, individual: 85, priority: 6 },
                    { type: 'level', match: 'L3', shared: 10, individual: 90, priority: 7 },
                    { type: 'level', match: 'L4', shared: 10, individual: 90, priority: 8 },
                    { type: 'default', match: '*', shared: 5, individual: 95, priority: 99 }
                ]
            },
            'Horizon': {
                rules: [
                    { type: 'title', match: 'ceo', shared: 100, individual: 0, priority: 1 },
                    { type: 'title', match: 'chief', shared: 20, individual: 80, priority: 4 },
                    { type: 'level', match: 'L1', shared: 20, individual: 80, priority: 5 },
                    { type: 'level', match: 'L2', shared: 15, individual: 85, priority: 6 },
                    { type: 'level', match: 'L3', shared: 10, individual: 90, priority: 7 },
                    { type: 'level', match: 'L4', shared: 10, individual: 90, priority: 8 },
                    { type: 'default', match: '*', shared: 5, individual: 95, priority: 99 }
                ]
            },
            'Next Generation': {
                rules: [
                    { type: 'title', match: 'ceo', shared: 100, individual: 0, priority: 1 },
                    { type: 'title', match: 'chief', shared: 20, individual: 80, priority: 4 },
                    { type: 'level', match: 'L1', shared: 20, individual: 80, priority: 5 },
                    { type: 'level', match: 'L2', shared: 15, individual: 85, priority: 6 },
                    { type: 'level', match: 'L3', shared: 10, individual: 90, priority: 7 },
                    { type: 'level', match: 'L4', shared: 10, individual: 90, priority: 8 },
                    { type: 'default', match: '*', shared: 5, individual: 95, priority: 99 }
                ]
            }
        };
        
        // Load weight configurations from database
        async function loadWeightConfigurations() {
            try {
                const { data, error } = await db.from('company_settings').select('data').eq('id', WEIGHT_CONFIG_ID).single();
                if (data && data.data) {
                    weightConfigurations = data.data;
                    console.log('Weight configurations loaded from DB');
                } else {
                    weightConfigurations = JSON.parse(JSON.stringify(DEFAULT_WEIGHT_CONFIG));
                    console.log('Using default weight configurations');
                }
            } catch (e) {
                console.log('Weight config not found, using defaults');
                weightConfigurations = JSON.parse(JSON.stringify(DEFAULT_WEIGHT_CONFIG));
            }
        }
        
        // Save weight configurations to database
        async function saveWeightConfigurations() {
            try {
                const { error } = await db.from('company_settings').upsert({
                    id: WEIGHT_CONFIG_ID,
                    data: weightConfigurations
                });
                if (error) {
                    console.error('Failed to save weight config:', error);
                    return false;
                }
                return true;
            } catch (e) {
                console.error('Error saving weight config:', e);
                return false;
            }
        }
        
        // --- CYCLE HELPER FUNCTIONS ---
        async function loadCycles() {
            try {
                const res = await fetch(`${API_URL}?action=getCycles`, {
                    method: 'POST',
                    headers: API_HEADERS
                });
                const data = await res.json();
                if (data.cycles) {
                    availableCycles = data.cycles;
                    currentCycle = data.current || '2025';
                    cycleInitialized = true;
                }
            } catch (e) {
                console.log('Cycle support not initialized, using default 2025');
                currentCycle = '2025';
                availableCycles = [{ cycle: '2025', status: 'active' }];
            }
        }

        async function initCycleSupport() {
            try {
                const res = await fetch(`${API_URL}?action=initCycleSupport`, {
                    method: 'POST',
                    headers: API_HEADERS
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Cycle support initialized successfully', 'success');
                    await loadCycles();
                    return true;
                } else {
                    showToast(data.error || 'Failed to initialize cycle support', 'error');
                    return false;
                }
            } catch (e) {
                console.error('Init cycle error:', e);
                showToast('Failed to initialize cycle support', 'error');
                return false;
            }
        }

        async function switchCycle(cycle) {
            if (cycle === currentCycle) return;
            
            showSaving();
            try {
                const res = await fetch(`${API_URL}?action=switchCycle`, {
                    method: 'POST',
                    headers: API_HEADERS,
                    body: JSON.stringify({ cycle })
                });
                const data = await res.json();
                if (data.success) {
                    currentCycle = cycle;
                    // Clear cache and reload data for new cycle
                    clearDataCache();
                    allCompanyData = await fetchAllData(true);
                    
                    // Load shared goals for this cycle
                    const sgId = cycle === '2025' ? SHARED_GOALS_ID : 'shared_goals_' + cycle;
                    const { data: sg } = await db.from('company_settings').select('data').eq('id', sgId).single();
                    if (sg && sg.data) {
                        masterData = Array.isArray(sg.data) ? { rating: 0, goals: sg.data } : sg.data;
                    } else {
                        masterData = { rating: 0, goals: [] };
                    }
                    
                    showToast(`Switched to ${cycle} cycle`, 'success');
                    // Reload current view
                    const role = getRole(user);
                    if (role === 'Admin' || role === 'Master') loadHRAdmin();
                } else {
                    showToast(data.error || 'Failed to switch cycle', 'error');
                }
            } catch (e) {
                console.error('Switch cycle error:', e);
                showToast('Failed to switch cycle', 'error');
            }
            showSaved();
        }

        async function startNewCycle(newCycle) {
            if (!newCycle || !/^\d{4}$/.test(newCycle)) {
                showToast('Invalid cycle year. Use 4-digit year (e.g., 2026)', 'error');
                return false;
            }

            showSaving();
            try {
                const res = await fetch(`${API_URL}?action=startNewCycle`, {
                    method: 'POST',
                    headers: API_HEADERS,
                    body: JSON.stringify({ cycle: newCycle })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(`Cycle ${newCycle} created successfully!`, 'success');
                    await loadCycles();
                    currentCycle = newCycle;
                    clearDataCache();
                    allCompanyData = await fetchAllData(true);
                    masterData = { rating: 0, goals: [] };
                    loadHRAdmin();
                    return true;
                } else {
                    showToast(data.error || 'Failed to create new cycle', 'error');
                    return false;
                }
            } catch (e) {
                console.error('Start new cycle error:', e);
                showToast('Failed to create new cycle', 'error');
                return false;
            } finally {
                showSaved();
            }
        }

        async function getEmployeeHistory(empId) {
            try {
                const res = await fetch(`${API_URL}?action=getEmployeeHistory`, {
                    method: 'POST',
                    headers: API_HEADERS,
                    body: JSON.stringify({ id: empId })
                });
                const data = await res.json();
                return data.history || [];
            } catch (e) {
                console.error('Get employee history error:', e);
                return [];
            }
        }

        // --- 2. INIT ---
        window.onload = async function () {
            // OPTIMIZATION: Load settings, column mapping, and cycles in parallel
            const [_, settingsResult] = await Promise.all([
                mapColumns(),
                db.from('company_settings').select('data').eq('id', SHARED_GOALS_ID).single(),
                loadCycles()
            ]);
            
            const sg = settingsResult.data;
            if (sg && sg.data) {
                if (Array.isArray(sg.data)) masterData = { rating: 0, goals: sg.data }; else masterData = sg.data;
            } else { masterData = { rating: 0, goals: [] }; }

            const uid = localStorage.getItem('zpms_uid');
            if (uid && (Date.now() - localStorage.getItem('zpms_time') < IDLE_LIMIT)) restoreSession(uid);
            else showLogin();
        }

        async function mapColumns() {
            // FUNCTION DISABLED:
            // We are using the hardcoded COL object above because
            // the database schema is now fixed and lowercase.
            console.log("Using hardcoded column mapping.");
            return;
        }

        async function loadHRApprovals() {
            const contentDiv = document.getElementById('admin-content');
            contentDiv.innerHTML = `
        <div style="padding:60px; text-align:center; color:var(--text-muted);">
            <div class="spinner" style="width:30px; height:30px; border-width:3px; margin-bottom:10px;"></div>
            <div>Syncing Approval & History Records...</div>
        </div>`;

            try {
                // --- FIX: Always fetch fresh data for the Admin Queue ---
                // This ensures that if you approved/returned something, the list reflects reality.
                allCompanyData = await fetchAllData();

                // Filter for Approval Queue + History
                adminCache = allCompanyData.filter(u => {
                    const s = (u[COL.stat] || '').trim();
                    return ['Submitted to HR', 'Approved', 'Published'].includes(s);
                });

                const totalCount = adminCache.length;
                const pendingCount = adminCache.filter(u => u[COL.stat] === 'Submitted to HR').length;
                const readyCount = adminCache.filter(u => u[COL.stat] === 'Approved').length;

                // Unique Divisions
                const divs = [...new Set(adminCache.map(i => i[COL.div] || 'Other'))].sort();

                // 2. Render UI with TWO Filters (Status & Division)
                contentDiv.innerHTML = `
        <div class="animate-in">
            <div class="card" style="padding: 32px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 20px;">
                    
                    <div>
                        <h3 style="margin: 0 0 8px 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">
                            Approvals & History
                        </h3>
                        <div style="display:flex; gap:12px; align-items:center;">
                            
                            <select id="status-filter" onchange="filterAdminTable()" 
                                style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: #fff; font-weight: 700; color: var(--text-main); cursor: pointer; min-width: 160px; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                                <option value="ACTION">⚠️ Pending Action (${pendingCount})</option>
                                <option value="Approved">🚀 Ready to Publish (${readyCount})</option>
                                <option value="Published">📜 Published History</option>
                                <option value="ALL">Show All Records</option>
                            </select>

                            <select id="div-filter" onchange="filterAdminTable()" 
                                style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: #f9fafb; font-weight: 600; color: var(--text-muted); cursor: pointer; min-width: 150px;">
                                <option value="ALL">All Divisions</option>
                                ${divs.map(d => `<option value="${d}">${d}</option>`).join('')}
                            </select>
                        </div>
                    </div>

                    <div style="display:flex; gap:10px;">
                        <button class="btn btn-primary" onclick="approveBulk()" style="background:var(--primary); padding:10px 20px;">
                            <i class="fa-solid fa-check"></i> &nbsp; Approve Pending
                        </button>
                        <button class="btn btn-primary" onclick="publishBulk()" style="background:#10b981; border-color:#10b981; padding:10px 20px;">
                            <i class="fa-solid fa-rocket"></i> &nbsp; Publish Ready
                        </button>
                    </div>
                </div>

                <div style="overflow-x: auto; border:1px solid var(--border); border-radius:12px;">
                    <table class="report-table" style="margin:0;">
                        <thead style="background:#f8fafc;">
                            <tr>
                                <th style="padding:16px 24px;">EMPLOYEE</th>
                                <th style="padding:16px 24px;">STATUS</th>
                                <th style="padding:16px 24px;">DIVISION</th>
                                <th style="padding:16px 24px;">MANAGER</th>
                                <th style="padding:16px 24px; text-align:right;">CONTROLS</th>
                            </tr>
                        </thead>
                        <tbody id="admin-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>`;

                // 3. Render Rows
                filterAdminTable();

            } catch (e) {
                console.error(e);
                contentDiv.innerHTML = `<div style="color:red; padding:20px;">Error: ${escapeHTML(e.message)}</div>`;
            }
        }
        async function restoreSession(id) {
            const { data } = await db.from('active_list').select('*').eq(COL.id, id).single();
            if (data) { user = data; startIdleTimer(); launchApp(); } else showLogin();
        }

        function showLogin() { document.getElementById('loading-overlay').classList.add('hidden'); document.getElementById('login-screen').classList.remove('hidden'); }
        function startIdleTimer() { ['click', 'keydown'].forEach(e => window.addEventListener(e, () => localStorage.setItem('zpms_time', Date.now()))); }
        async function logout() { 
            await logoutWithBackend();
            stopRealtimePolling();
            localStorage.clear(); 
            sessionStorage.clear(); 
            location.reload(); 
        }

        // --- 3. AUTH & ROUTING ---
        // --- NEW SECURE LOGIN LOGIC ---

        async function checkID() {
            const id = document.getElementById('inp-id').value.trim();
            const btn = document.getElementById('btn-check');
            if (!id) {
                showToast("Please enter your Employee ID", "error");
                return;
            }

            btn.innerText = "Checking...";
            btn.disabled = true;

            try {
                const res = await fetch(`${API_URL}?action=checkID`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
                const data = await res.json();

                if (data && data.id) {
                    user = data;
                    if (data.needs_setup) {
                        // Show Create Password UI
                        document.getElementById('lbl-welcome').innerText = "Create Your Password";
                        document.getElementById('grp-confirm').classList.remove('hidden');
                    } else {
                        // Show Standard Login UI
                        document.getElementById('lbl-welcome').innerText = "Welcome Back";
                        document.getElementById('grp-confirm').classList.add('hidden');
                    }

                    user = data;
                    document.getElementById('view-id').classList.add('hidden');
                    document.getElementById('view-pass').classList.remove('hidden');

                    // --- NEW: Detect if user needs to create a password ---
                    if (data.needs_setup) {
                        document.getElementById('lbl-welcome').innerText = "Create Your Password";
                        document.getElementById('grp-confirm').classList.remove('hidden');
                        document.getElementById('btn-login').innerText = "Set Password & Login";
                    } else {
                        document.getElementById('lbl-welcome').innerText = "Welcome Back";
                        document.getElementById('grp-confirm').classList.add('hidden');
                        document.getElementById('btn-login').innerText = "Log In";
                    }
                } else {
                    // ID not found - show error message
                    showToast("Employee ID not found. Please check and try again.", "error");
                    btn.innerText = "Continue";
                    btn.disabled = false;
                }
            } catch (e) {
                console.error(e);
                showToast("Connection error. Please try again.", "error");
                btn.innerText = "Continue";
                btn.disabled = false;
            }
        }
        async function doLogin() {
            const p1 = document.getElementById('inp-pass').value;
            const p2 = document.getElementById('inp-confirm').value;
            const btn = document.getElementById('btn-login');

            if (!document.getElementById('grp-confirm').classList.contains('hidden')) {
                if (p1.length < 4) { showToast("Password too short", "error"); return; }
                if (p1 !== p2) { showToast("Passwords do not match", "error"); return; }
            }

            btn.innerText = "Verifying...";
            btn.disabled = true;

            try {
                const res = await fetch(`${API_URL}?action=login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: user.id || document.getElementById('inp-id').value,
                        password: p1
                    })
                });


                const result = await res.json();

                if (result.success) {
                    localStorage.setItem('zpms_token', result.token);
                    sessionStorage.setItem('zpms_token', result.token); // Keep for backward compatibility
                    localStorage.setItem('zpms_uid', result.user.id);
                    localStorage.setItem('zpms_time', Date.now());
                    document.getElementById('loading-overlay').classList.remove('hidden');
                    location.reload();
                } else {
                    document.getElementById('err-pass').style.display = 'block';
                    document.getElementById('err-pass').innerText = result.message || "Incorrect Password";
                    btn.innerText = "Log In";
                    btn.disabled = false;
                }
            } catch (e) {
                console.error(e);
                showToast("Server connection failed", "error");
                btn.innerText = "Log In";
                btn.disabled = false;
            }
        }
        // Separate function for the final step
        function completeLoginProcess() {
            localStorage.setItem('zpms_uid', user[COL.id]);
            localStorage.setItem('zpms_time', Date.now());

            document.getElementById('loading-overlay').classList.remove('hidden');
            location.reload();
        }
        
        // --- DATA CACHE CONFIGURATION ---
        const DATA_CACHE_KEY = 'zpms_data_cache';
        const DATA_CACHE_TIME_KEY = 'zpms_data_cache_time';
        const DATA_CACHE_EXPIRY = 10 * 60 * 1000; // 10 minutes cache (increased from 5)
        const TEAM_CACHE_KEY = 'zpms_team_cache';
        const SETTINGS_CACHE_KEY = 'zpms_settings_cache';
        
        // --- INDEXED LOCAL CACHE FOR INSTANT ACCESS ---
        let localDataIndex = {}; // Index by employee ID for O(1) lookups
        let isDataLoaded = false;
        let dataLoadPromise = null; // Prevent duplicate fetches
        
        // Build index for fast lookups
        function buildDataIndex(data) {
            localDataIndex = {};
            if (Array.isArray(data)) {
                data.forEach(emp => {
                    if (emp && emp[COL.id]) {
                        localDataIndex[emp[COL.id]] = emp;
                    }
                });
            }
            isDataLoaded = true;
        }
        
        // Get employee by ID instantly from index
        function getEmployeeFromCache(empId) {
            return localDataIndex[empId] || null;
        }
        
        // Get team members from cache (no API call needed)
        function getTeamFromCache(managerId, managerName) {
            if (!isDataLoaded || allCompanyData.length === 0) return null;
            
            const myId = managerId.toString().toLowerCase();
            const myName = (managerName || "").toString().toLowerCase();
            
            return allCompanyData.filter(u => {
                const m = (u[COL.mgr] || "").toString().toLowerCase();
                return m.includes(myId) || (myName.length > 3 && m.includes(myName));
            });
        }
        
        // --- BATCHED FETCH HELPER (Optimized) ---
        async function fetchAllData(forceRefresh = false) {
            // Prevent duplicate simultaneous fetches
            if (dataLoadPromise && !forceRefresh) {
                return dataLoadPromise;
            }
            
            // OPTIMIZATION: Check cache first
            if (!forceRefresh) {
                const cachedTime = parseInt(sessionStorage.getItem(DATA_CACHE_TIME_KEY) || '0');
                const cacheAge = Date.now() - cachedTime;
                
                if (cacheAge < DATA_CACHE_EXPIRY) {
                    try {
                        const cachedData = sessionStorage.getItem(DATA_CACHE_KEY);
                        if (cachedData) {
                            const parsed = JSON.parse(cachedData);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                console.log(`Using cached data (${parsed.length} records, ${Math.round(cacheAge/1000)}s old)`);
                                buildDataIndex(parsed);
                                return parsed;
                            }
                        }
                    } catch (e) {
                        console.warn('Cache read error:', e);
                    }
                }
            }
            
            // Create promise for this fetch operation
            dataLoadPromise = (async () => {
                let allRows = [];
                let from = 0;
                const step = 10000; // Increased chunk size for fewer requests
                const timestamp = Date.now();
                let retries = 0;
                const maxRetries = 3;

                // Grab UI elements to show progress
                const loaderText = document.querySelector('#loading-overlay div:last-child');
                const saveText = document.getElementById('save-text');

                while (true) {
                    try {
                        // Update UI with progress
                        const msg = `Syncing Directory... (${allRows.length} loaded)`;
                        if (loaderText) loaderText.innerText = msg;
                        if (saveText) saveText.innerText = msg;

                        // Fetch with Cache Buster AND Headers
                        const res = await fetch(`${API_URL}?action=fetchAll&from=${from}&to=${from + step - 1}&_t=${timestamp}`, {
                            method: 'GET',
                            headers: API_HEADERS
                        });

                        if (!res.ok) {
                            if (res.status === 401 || res.status === 403) {
                                handleSessionExpired();
                                return [];
                            }
                            throw new Error(`Server status: ${res.status}`);
                        }

                        const chunk = await res.json();

                        if (!Array.isArray(chunk)) {
                            console.warn("Invalid chunk received:", chunk);
                            break;
                        }

                        if (chunk.length === 0) {
                            break;
                        }

                        retries = 0;
                        allRows = allRows.concat(chunk);

                        if (chunk.length < step) break;
                        from += step;

                    } catch (e) {
                        console.error(`Fetch error at offset ${from}:`, e);

                        if (e.message.includes("401") || e.message.includes("403")) {
                            handleSessionExpired();
                            return [];
                        }

                        if (retries < maxRetries) {
                            retries++;
                            const delay = retries * 1000;
                            if (loaderText) loaderText.innerText = `Network blip. Retrying... (${retries}/${maxRetries})`;
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        } else {
                            alert("Connection unstable. Loaded partial data. Please refresh.");
                            break;
                        }
                    }
                }

                if (loaderText) loaderText.innerText = "Initializing Zain Performance Management...";

                // Build index and save to cache
                if (allRows.length > 0) {
                    buildDataIndex(allRows);
                    try {
                        sessionStorage.setItem(DATA_CACHE_KEY, JSON.stringify(allRows));
                        sessionStorage.setItem(DATA_CACHE_TIME_KEY, Date.now().toString());
                        console.log(`Cached ${allRows.length} records`);
                    } catch (e) {
                        console.warn("Cache full, could not save data:", e);
                        // Try to clear old data and retry
                        try {
                            sessionStorage.removeItem(DATA_CACHE_KEY);
                            sessionStorage.setItem(DATA_CACHE_KEY, JSON.stringify(allRows));
                            sessionStorage.setItem(DATA_CACHE_TIME_KEY, Date.now().toString());
                        } catch (e2) {
                            console.warn("Still cannot cache:", e2);
                        }
                    }
                }

                dataLoadPromise = null;
                return allRows;
            })();
            
            return dataLoadPromise;
        }
        
        // --- SESSION EXPIRY HANDLER ---
        function handleSessionExpired() {
            // Only show message once
            if (sessionStorage.getItem('zpms_session_expired')) return;
            sessionStorage.setItem('zpms_session_expired', 'true');
            
            // Clear auth data
            localStorage.removeItem('zpms_token');
            localStorage.removeItem('zpms_uid');
            localStorage.removeItem('zpms_time');
            sessionStorage.removeItem('zpms_token');
            clearDataCache();
            
            // Show session expired modal with countdown
            showSessionExpiredModal();
        }
        
        function showSessionExpiredModal() {
            // Remove any existing modal
            const existingModal = document.getElementById('session-expired-modal');
            if (existingModal) existingModal.remove();
            
            const modal = document.createElement('div');
            modal.id = 'session-expired-modal';
            modal.innerHTML = `
                <div style="position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:99999; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px);">
                    <div style="background:white; width:90%; max-width:420px; padding:40px; border-radius:24px; text-align:center; animation:scaleIn 0.3s ease; box-shadow:0 25px 50px rgba(0,0,0,0.3);">
                        <div style="width:80px; height:80px; background:linear-gradient(135deg, #fee2e2, #fecaca); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 24px;">
                            <i class="fa-solid fa-clock" style="font-size:2.5rem; color:#dc2626;"></i>
                        </div>
                        <h2 style="margin:0 0 12px; font-size:1.5rem; font-weight:800; color:#1e293b;">Session Expired</h2>
                        <p style="margin:0 0 24px; color:#64748b; font-size:1rem; line-height:1.6;">
                            Your session has expired for security reasons.<br>
                            Please log in again to continue.
                        </p>
                        <div style="background:#f1f5f9; padding:16px; border-radius:12px; margin-bottom:24px;">
                            <div style="font-size:0.85rem; color:#64748b; margin-bottom:8px;">Redirecting to login in</div>
                            <div id="logout-countdown" style="font-size:2.5rem; font-weight:800; color:#dc2626;">5</div>
                            <div style="font-size:0.85rem; color:#64748b;">seconds</div>
                        </div>
                        <button onclick="forceLogout()" style="width:100%; padding:16px 32px; background:linear-gradient(135deg, #0d9488, #14b8a6); color:white; border:none; border-radius:12px; font-size:1rem; font-weight:700; cursor:pointer; transition:all 0.3s;">
                            <i class="fa-solid fa-right-to-bracket"></i> &nbsp; Login Now
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Start countdown
            let countdown = 5;
            const countdownEl = document.getElementById('logout-countdown');
            const countdownInterval = setInterval(() => {
                countdown--;
                if (countdownEl) countdownEl.textContent = countdown;
                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                    forceLogout();
                }
            }, 1000);
        }
        
        function forceLogout() {
            // Clear all storage
            localStorage.clear();
            sessionStorage.clear();
            
            // Reload to login page
            window.location.href = window.location.pathname;
        }
        
        // --- SESSION VALIDATION & AUTO-LOGOUT ---
        const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity
        const SESSION_WARNING_TIME = 5 * 60 * 1000; // Show warning 5 minutes before expiry
        let sessionTimeoutId = null;
        let sessionWarningId = null;
        let lastActivityTime = Date.now();
        
        function initSessionManager() {
            // Track user activity
            const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
            activityEvents.forEach(event => {
                document.addEventListener(event, handleUserActivity, { passive: true });
            });
            
            // Start session timer
            resetSessionTimer();
            
            // Check session validity periodically
            setInterval(checkSessionValidity, 60000); // Check every minute
        }
        
        function handleUserActivity() {
            const now = Date.now();
            // Only reset if more than 1 second since last activity (debounce)
            if (now - lastActivityTime > 1000) {
                lastActivityTime = now;
                localStorage.setItem('zpms_last_activity', now.toString());
                
                // Reset timer only if warning modal is not showing
                if (!document.getElementById('session-warning-modal')) {
                    resetSessionTimer();
                }
            }
        }
        
        function resetSessionTimer() {
            // Clear existing timers
            if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
            if (sessionWarningId) clearTimeout(sessionWarningId);
            
            // Set warning timer (5 minutes before expiry)
            sessionWarningId = setTimeout(() => {
                showSessionWarningModal();
            }, SESSION_TIMEOUT - SESSION_WARNING_TIME);
            
            // Set logout timer
            sessionTimeoutId = setTimeout(() => {
                handleSessionExpired();
            }, SESSION_TIMEOUT);
        }
        
        function showSessionWarningModal() {
            // Don't show if already expired or on login screen
            if (sessionStorage.getItem('zpms_session_expired')) return;
            if (document.getElementById('login-screen') && !document.getElementById('login-screen').classList.contains('hidden')) return;
            
            // Remove any existing warning modal
            const existingModal = document.getElementById('session-warning-modal');
            if (existingModal) existingModal.remove();
            
            const modal = document.createElement('div');
            modal.id = 'session-warning-modal';
            modal.innerHTML = `
                <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:99998; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);">
                    <div style="background:white; width:90%; max-width:400px; padding:32px; border-radius:20px; text-align:center; animation:scaleIn 0.3s ease; box-shadow:0 20px 40px rgba(0,0,0,0.2);">
                        <div style="width:60px; height:60px; background:linear-gradient(135deg, #fef3c7, #fde68a); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px;">
                            <i class="fa-solid fa-hourglass-half" style="font-size:1.8rem; color:#d97706;"></i>
                        </div>
                        <h3 style="margin:0 0 12px; font-size:1.2rem; font-weight:700; color:#1e293b;">Session Expiring Soon</h3>
                        <p style="margin:0 0 20px; color:#64748b; font-size:0.95rem;">
                            Your session will expire in <strong id="warning-countdown">5:00</strong> due to inactivity.
                        </p>
                        <div style="display:flex; gap:12px;">
                            <button onclick="extendSession()" style="flex:1; padding:14px; background:linear-gradient(135deg, #0d9488, #14b8a6); color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer;">
                                <i class="fa-solid fa-rotate"></i> &nbsp; Stay Logged In
                            </button>
                            <button onclick="forceLogout()" style="flex:1; padding:14px; background:#f1f5f9; color:#64748b; border:none; border-radius:10px; font-weight:700; cursor:pointer;">
                                <i class="fa-solid fa-right-from-bracket"></i> &nbsp; Logout
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Start countdown
            let secondsLeft = 5 * 60; // 5 minutes
            const countdownEl = document.getElementById('warning-countdown');
            const warningCountdownInterval = setInterval(() => {
                secondsLeft--;
                if (countdownEl) {
                    const mins = Math.floor(secondsLeft / 60);
                    const secs = secondsLeft % 60;
                    countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                }
                if (secondsLeft <= 0) {
                    clearInterval(warningCountdownInterval);
                }
            }, 1000);
            
            // Store interval ID to clear later
            modal.dataset.intervalId = warningCountdownInterval;
        }
        
        function extendSession() {
            // Remove warning modal
            const modal = document.getElementById('session-warning-modal');
            if (modal) {
                const intervalId = modal.dataset.intervalId;
                if (intervalId) clearInterval(parseInt(intervalId));
                modal.remove();
            }
            
            // Reset activity time and timers
            lastActivityTime = Date.now();
            localStorage.setItem('zpms_last_activity', lastActivityTime.toString());
            resetSessionTimer();
            
            showToast('Session extended successfully', 'success');
        }
        
        function checkSessionValidity() {
            // Skip if on login screen or already expired
            if (sessionStorage.getItem('zpms_session_expired')) return;
            if (document.getElementById('login-screen') && !document.getElementById('login-screen').classList.contains('hidden')) return;
            
            // Check if token exists
            const token = localStorage.getItem('zpms_token') || sessionStorage.getItem('zpms_token');
            if (!token) {
                handleSessionExpired();
                return;
            }
            
            // Check last activity from other tabs
            const lastActivity = parseInt(localStorage.getItem('zpms_last_activity') || '0');
            const now = Date.now();
            
            if (lastActivity > 0 && (now - lastActivity) > SESSION_TIMEOUT) {
                handleSessionExpired();
            }
        }
        
        // Helper function to force refresh data cache
        function clearDataCache() {
            sessionStorage.removeItem(DATA_CACHE_KEY);
            sessionStorage.removeItem(DATA_CACHE_TIME_KEY);
            allCompanyData = [];
            localDataIndex = {};
            isDataLoaded = false;
            console.log('Data cache cleared');
        }
        
        // --- SKELETON LOADING HELPERS FOR INSTANT VISUAL FEEDBACK ---
        function showTeamSkeleton() {
            return `
            <div class="animate-in">
                <div class="header-bar">
                    <div>
                        <h2 class="page-title">My Team</h2>
                        <p class="page-sub">Direct Reports & Scorecards</p>
                    </div>
                </div>
                <div class="team-grid">
                    ${[1,2,3,4,5,6].map(() => `
                    <div class="premium-team-card skeleton-card" style="padding:20px;">
                        <div class="skeleton-avatar" style="width:60px; height:60px; margin:0 auto 16px;"></div>
                        <div class="skeleton-text lg" style="margin:0 auto 8px;"></div>
                        <div class="skeleton-text sm" style="margin:0 auto 16px; width:60%;"></div>
                        <div class="skeleton-text md" style="margin:0 auto;"></div>
                    </div>`).join('')}
                </div>
            </div>`;
        }
        
        function showReportsSkeleton() {
            return `
            <div class="animate-in">
                <div class="header-bar">
                    <div>
                        <h2 class="page-title">Leadership Reports</h2>
                    </div>
                </div>
                <div class="dash-grid">
                    <div class="card">
                        <div class="skeleton-text lg" style="margin-bottom:20px;"></div>
                        <div class="skeleton" style="height:300px; border-radius:12px;"></div>
                    </div>
                    <div class="card">
                        <div class="skeleton-text lg" style="margin-bottom:20px;"></div>
                        <div class="skeleton" style="height:300px; border-radius:12px;"></div>
                    </div>
                </div>
            </div>`;
        }
        
        function showScorecardSkeleton() {
            return `
            <div class="animate-in">
                <div class="header-bar">
                    <div class="skeleton-text xl" style="width:200px;"></div>
                </div>
                <div class="metrics-row">
                    ${[1,2,3,4].map(() => `
                    <div class="metric-card">
                        <div class="skeleton-metric"></div>
                    </div>`).join('')}
                </div>
                <div class="card">
                    <div class="skeleton-text lg" style="margin-bottom:20px;"></div>
                    ${[1,2,3].map(() => `
                    <div class="skeleton-row" style="margin-bottom:16px;">
                        <div class="skeleton-cell" style="width:60%;"></div>
                        <div class="skeleton-cell" style="width:20%;"></div>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        function getCompany(id, division = "") {
            if (!id) return "Unknown";
            const cleanId = id.toString().toUpperCase().trim();
            const cleanDiv = (division || "").toString().toUpperCase().trim();

            // 1. Check ID Prefixes (Standard Method)
            if (cleanId.startsWith("HISP") || cleanId.startsWith("HCS") || cleanId.startsWith("HSC") || cleanId.startsWith("AWO")) {
                return "Horizon";
            }
            if (cleanId.startsWith("NG") || cleanId.startsWith("NGM") || cleanId.startsWith("NGT")) {
                return "Next Generation";
            }
            if (cleanId.startsWith("ZIQ") || cleanId.startsWith("ZIQT")) {
                // EDGE CASE: If ID is ZIQ but Division says "Next Gen", trust the Division
                if (cleanDiv.includes("NEXT GENERATION") || cleanDiv.includes("NXG")) {
                    return "Next Generation";
                }
                return "Zain Iraq";
            }

            // 2. Fallback: Check Division Name if ID is weird
            if (cleanDiv.includes("HORIZON")) return "Horizon";
            if (cleanDiv.includes("NEXT GENERATION")) return "Next Generation";
            if (cleanDiv.includes("ZAIN IRAQ")) return "Zain Iraq";

            return "Other";
        }
        async function launchApp() {
            document.getElementById('loading-overlay').classList.add('hidden');
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app-container').style.display = 'flex';
            try { } catch (e) { }
            document.getElementById('disp-user').innerText = user[COL.name];
            document.getElementById('disp-role').innerText = user[COL.lvl];

            // --- PARALLEL LOADING FOR SPEED ---
            const loadPromises = [];
            
            // Load weight configurations in parallel (non-blocking)
            loadPromises.push(loadWeightConfigurations().catch(e => console.warn('Weight config load failed:', e)));
            
            // Load progress configurations in parallel (non-blocking)
            loadPromises.push(loadProgressConfigurations().catch(e => console.warn('Progress config load failed:', e)));
            
            // Load rating levels configuration in parallel (non-blocking)
            loadPromises.push(loadRatingConfiguration().catch(e => console.warn('Rating config load failed:', e)));

            // --- SPEED OPTIMIZATION START ---
            // 1. Try to load from session cache first (Instant Load)
            const cachedData = sessionStorage.getItem(DATA_CACHE_KEY);
            const cachedTime = parseInt(sessionStorage.getItem(DATA_CACHE_TIME_KEY) || '0');
            const cacheAge = Date.now() - cachedTime;
            
            if (cachedData && cacheAge < DATA_CACHE_EXPIRY) {
                try {
                    allCompanyData = JSON.parse(cachedData);
                    buildDataIndex(allCompanyData); // Build index for instant lookups
                    console.log(`Loaded from cache: ${allCompanyData.length} records (${Math.round(cacheAge/1000)}s old)`);
                } catch (e) {
                    console.error("Cache corrupted, reloading...");
                    allCompanyData = [];
                }
            }

            // 2. Determine role IMMEDIATELY (don't wait for data if we have cache)
            let hasReports = false;
            const myId = user[COL.id].toString().toLowerCase();
            const myName = (user[COL.name] || "").toString().toLowerCase();

            if (allCompanyData.length > 0) {
                hasReports = allCompanyData.some(u => {
                    const m = (u[COL.mgr] || "").toString().toLowerCase();
                    return m.includes(myId) || (myName.length > 3 && m.includes(myName));
                });
            }

            const role = getRole(user, hasReports);
            renderNav(role);
            initNotifications();
            initSessionManager(); // Initialize session timeout tracking
            startRealtimePolling(); // Start real-time data sync

            // Check if we should auto-open a scorecard from URL parameter
            checkAutoOpenScorecard();

            // 3. Load initial view IMMEDIATELY (don't wait for full data sync)
            if (role === 'Admin' || role === 'Master') loadHRAdmin();
            else if (role === 'Chief' || role === 'Director' || role === 'Senior Manager') loadReports();
            else if (role === 'Manager') loadTeam();
            else loadEval(user[COL.id]);

            // 4. If cache is empty, fetch in background WITHOUT blocking UI
            if (allCompanyData.length === 0) {
                document.getElementById('save-text').innerText = "Syncing directory...";
                document.getElementById('save-status').classList.add('show');
                
                fetchAllData(true).then(freshData => {
                    if (freshData.length > 0) {
                        allCompanyData = freshData;
                        buildDataIndex(allCompanyData);
                        document.getElementById('save-status').classList.remove('show');
                        console.log("Initial data sync complete");
                    }
                });
            } else {
                // 5. If cache had data, refresh it in the BACKGROUND after 15 seconds
                setTimeout(() => {
                    fetchAllData(true).then(freshData => {
                        if (freshData.length > 0) {
                            allCompanyData = freshData;
                            buildDataIndex(allCompanyData);
                            console.log("Background sync finished");
                        }
                    });
                }, 15000); // Wait 15 seconds before background refresh
            }
            
            // Wait for parallel operations to complete
            await Promise.all(loadPromises);
            // --- SPEED OPTIMIZATION END ---
        }

        function triggerImport() { document.getElementById('file-import').click(); }

        function processFile(inp) {
            const file = inp.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                    if (json.length === 0) { alert("Empty Excel file"); return; }

                    function getVal(row, candidates) {
                        const keys = Object.keys(row);
                        const clean = (s) => s.toString().toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                        for (let c of candidates) { const found = keys.find(k => clean(k) === clean(c)); if (found && row[found] !== undefined) return row[found]; }
                        if (candidates.includes("Target")) { const tKey = keys.find(k => { const c = clean(k); return c === 'l4' || c === 'target' || c === 'targets' || c.includes('runnertarget'); }); if (tKey && row[tKey] !== undefined) return row[tKey]; }
                        return "";
                    }

                    const newGoals = json.map(r => {
                        let w = getVal(r, ['Weight', 'Wt', 'W%']); w = parseFloat(w) || 0; if (w > 1) w = w / 100;
                        return {
                            title: getVal(r, ['Objective', 'Title', 'Item', 'Items', 'Goal', 'KPI']) || "Imported Goal",
                            weight: w,
                            desc: getVal(r, ['Description', 'Desc', 'Details']),
                            unit: getVal(r, ['Unit', 'UoM']),
                            rating: 0,
                            targets: [getVal(r, ['L1', '1']), getVal(r, ['L2', '2']), getVal(r, ['L3', '3']), getVal(r, ['Target', 'L4', 'Runner']), getVal(r, ['L5', '5']), getVal(r, ['L6', '6'])]
                        };
                    });

                    if (confirm(`Found ${newGoals.length} goals. This will REPLACE your current Individual Goals. Continue?`)) {
                        targetUser[COL.goals] = newGoals;
                        renderGoals(true);
                        calc();
                        autoSave();
                        alert(" Goals imported successfully!");
                    }
                    inp.value = '';
                } catch (err) { console.error(err); alert("Error reading Excel file. Check format."); }
            };
            reader.readAsArrayBuffer(file);
        }

        // --- 5. MASTER ADMIN PORTAL ---


        async function loadHRAdmin() {
            document.getElementById('main-view').innerHTML = `
    <div class="animate-in">
        <div class="header-bar">
            <div>
                <h2 class="page-title">HR Portal</h2>
                <p class="page-sub">Master Administration & Analytics</p>
            </div>
        </div>
        
        <div class="card" style="padding: 0; margin-bottom: 32px; border-radius: 12px; background: white; overflow: hidden;">
            <div style="display: flex; overflow-x: auto; border-bottom: 1px solid var(--border);">
                <div class="admin-tab active" id="tab-shared" onclick="switchAdminTab('shared')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-bullseye"></i> <span>Shared Goals</span>
                </div>
                <div class="admin-tab" id="tab-directory" onclick="switchAdminTab('directory')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-address-book"></i> <span>Directory</span>
                </div>
                <div class="admin-tab" id="tab-kpi" onclick="switchAdminTab('kpi')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-gauge-high"></i> <span>KPI Dashboard</span>
                </div>
                <div class="admin-tab" id="tab-analytics" onclick="switchAdminTab('analytics')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-chart-pie"></i> <span>Analytics</span>
                </div>
                <div class="admin-tab" id="tab-app" onclick="switchAdminTab('app')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-list-check"></i> <span>Approvals</span>
                </div>
                <div class="admin-tab" id="tab-bulk" onclick="switchAdminTab('bulk')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-file-csv"></i> <span>Bulk Import</span>
                </div>
                <div class="admin-tab" id="tab-perm" onclick="switchAdminTab('perm')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-shield-halved"></i> <span>Admins</span>
                </div>
                <div class="admin-tab" id="tab-cycle" onclick="switchAdminTab('cycle')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-calendar-days"></i> <span>Cycles</span>
                </div>
                <div class="admin-tab" id="tab-weights" onclick="switchAdminTab('weights')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-sliders"></i> <span>Weights</span>
                </div>
                <div class="admin-tab" id="tab-progress-config" onclick="switchAdminTab('progress-config')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-bars-progress"></i> <span>Progress</span>
                </div>
                <div class="admin-tab" id="tab-rating-levels" onclick="switchAdminTab('rating-levels')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-star-half-stroke"></i> <span>Rating Levels</span>
                </div>
                <div class="admin-tab" id="tab-search" onclick="switchAdminTab('search')" style="padding: 20px 24px; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                    <i class="fa-solid fa-magnifying-glass"></i> <span>Search</span>
                </div>
            </div>
            
            <!-- Cycle Selector Badge -->
            <div style="margin-left:auto; display:flex; align-items:center; gap:12px;">
                <div style="font-size:0.8rem; color:var(--text-muted);">Current Cycle:</div>
                <select id="cycle-selector" onchange="switchCycle(this.value)" style="padding:8px 16px; border-radius:8px; border:2px solid var(--primary); background:var(--primary-light); font-weight:700; color:var(--primary); cursor:pointer;">
                    ${availableCycles.map(c => `<option value="${c.cycle}" ${c.cycle === currentCycle ? 'selected' : ''}>${c.cycle} ${c.status === 'active' ? '(Active)' : ''}</option>`).join('')}
                </select>
            </div>
        </div>

        <div id="admin-content" class="animate-in"></div>
    </div>
    `;

            // Ensure styles for the active tab match the screenshot (Blue Underline)
            const style = document.createElement('style');
            style.innerHTML = `
        .admin-tab { color: var(--text-muted); font-weight: 600; border-bottom: 3px solid transparent; transition: all 0.2s; }
        .admin-tab:hover { background: #f8fafc; color: var(--text-main); }
        .admin-tab.active { color: var(--primary); border-bottom: 3px solid var(--primary); background: var(--primary-light); }
        .admin-tab i { font-size: 1.1rem; }
    `;
            document.head.appendChild(style);

            // Default to Approvals if that is the focus, or Shared
            switchAdminTab('shared');
        }

        function switchAdminTab(t) {
            // 1. Update Visual Active State
            document.querySelectorAll('.admin-tab').forEach(btn => {
                btn.classList.remove('active');
                if (btn.id === 'tab-' + t) btn.classList.add('active');
            });

            // 2. Clear previous content to prevent mixing
            document.getElementById('admin-content').innerHTML = '<div class="spinner"></div>';

            // 3. Load the specific isolated view
            if (t === 'shared') loadAdminSharedGoals();      // Only Shared Goals
            else if (t === 'directory') loadAdminDirectory();
            else if (t === 'kpi') loadKPIDashboard();         // KPI Dashboard
            else if (t === 'analytics') loadAdminAnalytics();
            else if (t === 'app') loadHRApprovals();         // Only Pending Approvals
            else if (t === 'bulk') loadAdminBulk();
            else if (t === 'perm') loadAdminPerms();
            else if (t === 'cycle') loadCycleManagement();   // Cycle Management
            else if (t === 'weights') loadWeightConfiguration(); // Weight Configuration
            else if (t === 'progress-config') loadProgressConfiguration(); // Progress Weights Configuration
            else if (t === 'rating-levels') loadRatingLevelsConfiguration(); // Rating Levels Configuration
            else if (t === 'search') loadAdminSearch();
        }
        
        // --- CYCLE MANAGEMENT TAB ---
        async function loadCycleManagement() {
            // Load cycles if not already loaded
            if (!cycleInitialized) await loadCycles();
            
            const content = `
            <div class="animate-in">
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
                        <div>
                            <h3 style="margin:0; font-size:1.2rem; font-weight:700;"><i class="fa-solid fa-calendar-days" style="color:var(--primary); margin-right:8px;"></i>Performance Cycle Management</h3>
                            <p style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">Manage performance review cycles and historical records.</p>
                        </div>
                        <button class="btn btn-primary" onclick="showNewCycleModal()">
                            <i class="fa-solid fa-plus"></i> &nbsp; Start New Cycle
                        </button>
                    </div>
                    
                    <!-- Current Cycle Info -->
                    <div style="background:linear-gradient(135deg, var(--primary), var(--primary-dark)); color:white; padding:24px; border-radius:16px; margin-bottom:24px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                            <div>
                                <div style="font-size:0.8rem; opacity:0.8; text-transform:uppercase; letter-spacing:1px;">Active Cycle</div>
                                <div style="font-size:2.5rem; font-weight:800;">${currentCycle}</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:0.8rem; opacity:0.8;">Total Employees</div>
                                <div style="font-size:1.5rem; font-weight:700;">${allCompanyData.length}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Initialize Cycle Support (if needed) -->
                    ${!cycleInitialized ? `
                    <div style="background:#fef3c7; border:1px solid #fbbf24; padding:20px; border-radius:12px; margin-bottom:24px;">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <i class="fa-solid fa-triangle-exclamation" style="color:#d97706; font-size:1.5rem;"></i>
                            <div>
                                <div style="font-weight:700; color:#92400e;">Cycle Support Not Initialized</div>
                                <div style="font-size:0.9rem; color:#a16207;">Click below to enable multi-cycle support for your system.</div>
                            </div>
                            <button class="btn btn-primary" style="margin-left:auto; background:#d97706;" onclick="initCycleSupport().then(() => loadCycleManagement())">
                                <i class="fa-solid fa-bolt"></i> &nbsp; Initialize
                            </button>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Cycles List -->
                    <h4 style="margin:0 0 16px 0; font-size:1rem; font-weight:700;">All Performance Cycles</h4>
                    <div style="overflow-x:auto; border:1px solid var(--border); border-radius:12px;">
                        <table class="report-table" style="margin:0;">
                            <thead style="background:#f8fafc;">
                                <tr>
                                    <th style="padding:16px 24px;">CYCLE YEAR</th>
                                    <th style="padding:16px 24px;">STATUS</th>
                                    <th style="padding:16px 24px;">EMPLOYEES</th>
                                    <th style="padding:16px 24px;">COMPLETION</th>
                                    <th style="padding:16px 24px; text-align:right;">ACTIONS</th>
                                </tr>
                            </thead>
                            <tbody id="cycles-tbody"></tbody>
                        </table>
                    </div>
                </div>

                <!-- Historical Records Section -->
                <div class="card">
                    <h3 style="margin:0 0 16px 0; font-size:1.1rem; font-weight:700;"><i class="fa-solid fa-clock-rotate-left" style="color:var(--primary); margin-right:8px;"></i>Employee History Lookup</h3>
                    <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:20px;">View an employee's performance history across all cycles.</p>
                    
                    <div style="display:flex; gap:12px; margin-bottom:20px;">
                        <input id="history-emp-id" class="login-input" style="margin:0; flex:1; max-width:300px;" placeholder="Enter Employee ID (e.g., ZIQ...)">
                        <button class="btn btn-primary" onclick="loadEmployeeHistoryView()">
                            <i class="fa-solid fa-search"></i> &nbsp; View History
                        </button>
                    </div>
                    
                    <div id="employee-history-results"></div>
                </div>
            </div>`;
            
            document.getElementById('admin-content').innerHTML = content;
            
            // Load cycles into table
            renderCyclesTable();
        }

        async function renderCyclesTable() {
            const tbody = document.getElementById('cycles-tbody');
            if (!tbody) return;
            
            if (availableCycles.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">No cycles found. Initialize cycle support to begin.</td></tr>`;
                return;
            }

            let rows = '';
            for (const cycle of availableCycles) {
                // Get stats for this cycle
                const cycleData = allCompanyData.filter(u => !u.cycle || u.cycle === cycle.cycle);
                const total = cycleData.length;
                const completed = cycleData.filter(u => ['Approved', 'Published'].includes(u[COL.stat])).length;
                const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
                
                const isActive = cycle.status === 'active';
                const isCurrent = cycle.cycle === currentCycle;
                
                rows += `
                <tr>
                    <td style="font-weight:700; font-size:1.1rem;">
                        ${cycle.cycle}
                        ${isActive ? '<span style="background:var(--success); color:white; font-size:0.65rem; padding:2px 8px; border-radius:10px; margin-left:8px;">ACTIVE</span>' : ''}
                        ${isCurrent ? '<span style="background:var(--primary); color:white; font-size:0.65rem; padding:2px 8px; border-radius:10px; margin-left:8px;">VIEWING</span>' : ''}
                    </td>
                    <td>
                        <span style="background:${isActive ? '#d1fae5' : '#f1f5f9'}; color:${isActive ? '#059669' : '#64748b'}; padding:4px 12px; border-radius:20px; font-size:0.8rem; font-weight:600;">
                            ${isActive ? 'Active' : 'Archived'}
                        </span>
                    </td>
                    <td style="font-weight:600;">${total}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="flex:1; max-width:100px; height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
                                <div style="width:${completionRate}%; height:100%; background:${completionRate >= 80 ? 'var(--success)' : completionRate >= 50 ? 'var(--warning)' : 'var(--danger)'};"></div>
                            </div>
                            <span style="font-weight:600; font-size:0.9rem;">${completionRate}%</span>
                        </div>
                    </td>
                    <td style="text-align:right;">
                        ${!isCurrent ? `<button class="btn btn-outline" style="padding:6px 12px; font-size:0.8rem;" onclick="switchCycle('${cycle.cycle}')"><i class="fa-solid fa-eye"></i> View</button>` : `<span style="color:var(--text-muted); font-size:0.85rem;"><i class="fa-solid fa-check-circle"></i> Current</span>`}
                    </td>
                </tr>`;
            }
            
            tbody.innerHTML = rows;
        }

        function showNewCycleModal() {
            const currentYear = new Date().getFullYear();
            const nextYear = currentYear + 1;
            
            showConfirm(
                'Start New Performance Cycle',
                `This will create a new ${nextYear} cycle. All employee scorecards will be reset to "Draft" status with empty goals. The ${currentCycle} data will be preserved as historical records. Continue?`,
                `Create ${nextYear} Cycle`,
                'primary',
                () => startNewCycle(nextYear.toString())
            );
        }

        async function loadEmployeeHistoryView() {
            const empId = document.getElementById('history-emp-id').value.trim();
            if (!empId) {
                showToast('Please enter an Employee ID', 'error');
                return;
            }

            const resultsDiv = document.getElementById('employee-history-results');
            resultsDiv.innerHTML = '<div class="spinner" style="margin:20px auto;"></div>';

            try {
                const history = await getEmployeeHistory(empId);
                
                if (history.length === 0) {
                    resultsDiv.innerHTML = `
                        <div style="text-align:center; padding:40px; color:var(--text-muted);">
                            <i class="fa-solid fa-user-slash" style="font-size:2rem; opacity:0.3; margin-bottom:12px; display:block;"></i>
                            <div>No history found for Employee ID: <strong>${escapeHTML(empId)}</strong></div>
                        </div>`;
                    return;
                }

                const emp = history[0];
                let html = `
                    <div style="background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:20px;">
                        <div style="font-size:1.2rem; font-weight:700;">${escapeHTML(emp.name || 'Unknown')}</div>
                        <div style="color:var(--text-muted); font-size:0.9rem;">${escapeHTML(emp.job || 'N/A')} | ${escapeHTML(emp.division || 'N/A')}</div>
                    </div>
                    
                    <div style="display:grid; gap:16px;">
                `;

                for (const record of history) {
                    const goals = typeof record.goals === 'string' ? JSON.parse(record.goals || '[]') : (record.goals || []);
                    const status = record.status || 'Draft';
                    const cycle = record.cycle || '2025';
                    
                    // Calculate score if goals exist
                    let score = 0;
                    if (goals.length > 0) {
                        const totalWeight = goals.reduce((sum, g) => sum + (parseFloat(g.weight) || 0), 0);
                        if (totalWeight > 0) {
                            score = goals.reduce((sum, g) => sum + ((parseFloat(g.rating) || 0) * (parseFloat(g.weight) || 0)), 0) / totalWeight;
                        }
                    }
                    
                    let rating = '-';
                    if (score >= 5.5) rating = 'ASTRONAUT';
                    else if (score >= 4.5) rating = 'FLYER';
                    else if (score >= 3.5) rating = 'RUNNER';
                    else if (score >= 2.5) rating = 'WALKER';
                    else if (score >= 1.5) rating = 'STAGNANT';
                    else if (score > 0) rating = 'IDLE';

                    html += `
                        <div style="background:white; border:1px solid var(--border); border-radius:12px; padding:20px; ${cycle === currentCycle ? 'border-left:4px solid var(--primary);' : ''}">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <div style="font-size:1.3rem; font-weight:800; color:var(--primary);">${cycle}</div>
                                <span style="background:${status === 'Published' ? '#d1fae5' : status === 'Approved' ? '#dbeafe' : '#f1f5f9'}; color:${status === 'Published' ? '#059669' : status === 'Approved' ? '#2563eb' : '#64748b'}; padding:4px 12px; border-radius:20px; font-size:0.75rem; font-weight:600;">
                                    ${escapeHTML(status)}
                                </span>
                            </div>
                            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px;">
                                <div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Score</div>
                                    <div style="font-size:1.5rem; font-weight:800;">${score > 0 ? score.toFixed(2) : '-'}</div>
                                </div>
                                <div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Rating</div>
                                    <div style="font-size:1rem; font-weight:700;">${rating}</div>
                                </div>
                                <div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Goals</div>
                                    <div style="font-size:1rem; font-weight:600;">${goals.length} objectives</div>
                                </div>
                            </div>
                        </div>
                    `;
                }

                html += '</div>';
                resultsDiv.innerHTML = html;
            } catch (e) {
                console.error('Error loading history:', e);
                resultsDiv.innerHTML = `<div style="color:var(--danger); padding:20px;">Error loading history: ${escapeHTML(e.message)}</div>`;
            }
        }
        
        // --- WEIGHT CONFIGURATION TAB ---
        async function loadWeightConfiguration() {
            // Ensure weight configurations are loaded
            if (Object.keys(weightConfigurations).length === 0) {
                await loadWeightConfigurations();
            }
            
            const companies = ['Zain Iraq', 'Horizon', 'Next Generation'];
            
            let html = `
            <div class="animate-in">
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
                        <div>
                            <h3 style="margin:0; font-size:1.2rem; font-weight:700;">
                                <i class="fa-solid fa-sliders" style="color:var(--primary); margin-right:8px;"></i>
                                Weight Configuration
                            </h3>
                            <p style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">
                                Configure Shared vs Individual goal weights per company, level, or job title.
                            </p>
                        </div>
                        <button class="btn btn-outline" onclick="resetWeightConfigToDefaults()">
                            <i class="fa-solid fa-rotate-left"></i> &nbsp; Reset to Defaults
                        </button>
                    </div>
                    
                    <!-- Info Banner -->
                    <div style="background:linear-gradient(135deg, #dbeafe, #eff6ff); border:1px solid #93c5fd; padding:16px 20px; border-radius:12px; margin-bottom:24px;">
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <i class="fa-solid fa-circle-info" style="color:#2563eb; font-size:1.2rem; margin-top:2px;"></i>
                            <div style="font-size:0.9rem; color:#1e40af;">
                                <strong>How it works:</strong> Weight rules are applied in priority order. Title-based rules take precedence over level-based rules. 
                                The first matching rule determines the Shared/Individual weight split for an employee's scorecard.
                            </div>
                        </div>
                    </div>
                    
                    <!-- Company Tabs -->
                    <div style="display:flex; gap:8px; margin-bottom:24px; border-bottom:2px solid var(--border); padding-bottom:12px;">
                        ${companies.map((comp, idx) => `
                            <button class="weight-company-tab ${idx === 0 ? 'active' : ''}" 
                                    onclick="switchWeightCompanyTab('${comp}')"
                                    id="wt-tab-${comp.replace(/\s+/g, '-')}"
                                    style="padding:10px 20px; border:none; background:${idx === 0 ? 'var(--primary)' : '#f1f5f9'}; 
                                           color:${idx === 0 ? 'white' : 'var(--text-muted)'}; font-weight:600; border-radius:8px; 
                                           cursor:pointer; transition:all 0.2s;">
                                ${comp}
                            </button>
                        `).join('')}
                    </div>
                    
                    <!-- Weight Rules Container -->
                    <div id="weight-rules-container">
                        ${renderWeightRulesForCompany(companies[0])}
                    </div>
                </div>
                
                <!-- Preview Section -->
                <div class="card">
                    <h3 style="margin:0 0 16px 0; font-size:1rem; font-weight:700;">
                        <i class="fa-solid fa-eye" style="color:var(--primary); margin-right:8px;"></i>
                        Weight Preview
                    </h3>
                    <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:16px;">
                        Test how weights are calculated for different employees.
                    </p>
                    
                    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px;">
                        <select id="preview-company" class="login-input" style="margin:0; width:auto; min-width:150px;" onchange="previewWeightCalculation()">
                            ${companies.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                        <input id="preview-level" class="login-input" style="margin:0; width:auto; min-width:100px;" placeholder="Level (e.g. L3)" oninput="previewWeightCalculation()">
                        <input id="preview-title" class="login-input" style="margin:0; flex:1; min-width:200px;" placeholder="Job Title (e.g. Senior Manager)" oninput="previewWeightCalculation()">
                    </div>
                    
                    <div id="weight-preview-result" style="background:#f8fafc; padding:20px; border-radius:12px; border:1px solid var(--border);">
                        <div style="text-align:center; color:var(--text-muted);">Enter level and/or job title to preview weight calculation</div>
                    </div>
                </div>
            </div>`;
            
            document.getElementById('admin-content').innerHTML = html;
            
            // Add styles for weight config
            if (!document.getElementById('weight-config-styles')) {
                const style = document.createElement('style');
                style.id = 'weight-config-styles';
                style.innerHTML = `
                    .weight-company-tab:hover { background: var(--primary-light) !important; color: var(--primary) !important; }
                    .weight-company-tab.active { background: var(--primary) !important; color: white !important; }
                    .weight-rule-card { background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 12px; transition: all 0.2s; }
                    .weight-rule-card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                    .weight-rule-card.default { background: linear-gradient(135deg, #f0fdf4, #ecfdf5); border-color: #86efac; }
                    .weight-type-badge { padding: 4px 10px; border-radius: 20px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
                    .weight-type-badge.title { background: #dbeafe; color: #1d4ed8; }
                    .weight-type-badge.level { background: #fef3c7; color: #d97706; }
                    .weight-type-badge.default { background: #d1fae5; color: #059669; }
                `;
                document.head.appendChild(style);
            }
        }
        
        function renderWeightRulesForCompany(company) {
            const config = weightConfigurations[company] || { rules: [] };
            const rules = config.rules || [];
            
            // Sort rules by priority
            const sortedRules = [...rules].sort((a, b) => (a.priority || 99) - (b.priority || 99));
            
            let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h4 style="margin:0; font-size:1rem; font-weight:700;">${company} Weight Rules</h4>
                <button class="btn btn-primary" onclick="addWeightRule('${company}')">
                    <i class="fa-solid fa-plus"></i> &nbsp; Add Rule
                </button>
            </div>
            
            <div id="rules-list-${company.replace(/\s+/g, '-')}">`;
            
            if (sortedRules.length === 0) {
                html += `
                <div style="text-align:center; padding:40px; color:var(--text-muted);">
                    <i class="fa-solid fa-scale-unbalanced" style="font-size:2rem; opacity:0.3; margin-bottom:12px; display:block;"></i>
                    <div>No weight rules configured for ${company}</div>
                    <div style="font-size:0.85rem; margin-top:4px;">Click "Add Rule" to create weight rules.</div>
                </div>`;
            } else {
                sortedRules.forEach((rule, idx) => {
                    const originalIdx = rules.findIndex(r => r === rule);
                    const typeClass = rule.type === 'title' ? 'title' : rule.type === 'level' ? 'level' : 'default';
                    const isDefault = rule.type === 'default';
                    
                    html += `
                    <div class="weight-rule-card ${isDefault ? 'default' : ''}" data-rule-idx="${originalIdx}">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;">
                            <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:200px;">
                                <span class="weight-type-badge ${typeClass}">${rule.type}</span>
                                <div>
                                    <div style="font-weight:600; color:var(--text-main);">
                                        ${isDefault ? 'Default (All Others)' : `Match: "${escapeHTML(rule.match)}"`}
                                    </div>
                                    <div style="font-size:0.8rem; color:var(--text-muted);">Priority: ${rule.priority || 99}</div>
                                </div>
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:20px;">
                                <div style="text-align:center;">
                                    <div style="font-size:1.5rem; font-weight:800; color:var(--primary);">${rule.shared}%</div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Shared</div>
                                </div>
                                <div style="width:1px; height:40px; background:var(--border);"></div>
                                <div style="text-align:center;">
                                    <div style="font-size:1.5rem; font-weight:800; color:var(--secondary);">${rule.individual}%</div>
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">Individual</div>
                                </div>
                            </div>
                            
                            <div style="display:flex; gap:8px;">
                                <button class="btn btn-outline" style="padding:8px 12px;" onclick="editWeightRule('${company}', ${originalIdx})" title="Edit Rule">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                                ${!isDefault ? `
                                <button class="btn btn-outline" style="padding:8px 12px; color:var(--danger); border-color:#fee2e2;" onclick="deleteWeightRule('${company}', ${originalIdx})" title="Delete Rule">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>`;
                });
            }
            
            html += `</div>
            
            <div style="margin-top:20px; padding-top:20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:12px;">
                <button class="btn btn-outline" onclick="loadWeightConfiguration()">
                    <i class="fa-solid fa-rotate"></i> &nbsp; Refresh
                </button>
                <button class="btn btn-primary" onclick="saveCompanyWeightConfig('${company}')">
                    <i class="fa-solid fa-check"></i> &nbsp; Save ${company} Config
                </button>
            </div>`;
            
            return html;
        }
        
        function switchWeightCompanyTab(company) {
            // Update tab styles
            document.querySelectorAll('.weight-company-tab').forEach(tab => {
                tab.classList.remove('active');
                tab.style.background = '#f1f5f9';
                tab.style.color = 'var(--text-muted)';
            });
            
            const activeTab = document.getElementById(`wt-tab-${company.replace(/\s+/g, '-')}`);
            if (activeTab) {
                activeTab.classList.add('active');
                activeTab.style.background = 'var(--primary)';
                activeTab.style.color = 'white';
            }
            
            // Render rules for selected company
            document.getElementById('weight-rules-container').innerHTML = renderWeightRulesForCompany(company);
        }
        
        function addWeightRule(company) {
            showWeightRuleModal(company, null);
        }
        
        function editWeightRule(company, ruleIdx) {
            const config = weightConfigurations[company];
            if (!config || !config.rules || !config.rules[ruleIdx]) {
                showToast('Rule not found', 'error');
                return;
            }
            showWeightRuleModal(company, ruleIdx);
        }
        
        function showWeightRuleModal(company, ruleIdx = null) {
            const isEdit = ruleIdx !== null;
            const rule = isEdit ? weightConfigurations[company].rules[ruleIdx] : { type: 'level', match: '', shared: 10, individual: 90, priority: 50 };
            
            const modalHtml = `
            <div id="weight-rule-modal" style="position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5);">
                <div style="background:white; width:90%; max-width:500px; padding:32px; border-radius:20px; animation:scaleIn 0.3s ease;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <h3 style="margin:0; font-size:1.3rem; font-weight:700;">${isEdit ? 'Edit' : 'Add'} Weight Rule</h3>
                        <button onclick="closeWeightRuleModal()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:var(--text-muted);">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    
                    <div style="margin-bottom:20px;">
                        <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">Rule Type</label>
                        <select id="wr-type" class="login-input" style="margin:0;" onchange="toggleWeightRuleMatch()">
                            <option value="title" ${rule.type === 'title' ? 'selected' : ''}>Job Title (matches if title contains...)</option>
                            <option value="level" ${rule.type === 'level' ? 'selected' : ''}>Level (e.g., L1, L2, L3...)</option>
                            <option value="default" ${rule.type === 'default' ? 'selected' : ''}>Default (applies to all others)</option>
                        </select>
                    </div>
                    
                    <div id="wr-match-container" style="margin-bottom:20px; ${rule.type === 'default' ? 'display:none;' : ''}">
                        <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">Match Value</label>
                        <input id="wr-match" class="login-input" style="margin:0;" value="${escapeHTML(rule.match || '')}" 
                               placeholder="${rule.type === 'level' ? 'e.g., L1, L2, L3' : 'e.g., chief, manager, director'}">
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">
                            ${rule.type === 'title' ? 'The job title must contain this text (case-insensitive)' : 'Enter the exact level code'}
                        </div>
                    </div>
                    
                    <div style="margin-bottom:20px;">
                        <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">Priority (lower = higher priority)</label>
                        <input id="wr-priority" type="number" class="login-input" style="margin:0;" value="${rule.priority || 50}" min="1" max="99">
                    </div>
                    
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;">
                        <div>
                            <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">
                                <i class="fa-solid fa-users" style="color:var(--primary);"></i> Shared Weight %
                            </label>
                            <input id="wr-shared" type="number" class="login-input" style="margin:0;" value="${rule.shared}" min="0" max="100" 
                                   oninput="syncWeightInputs('shared')">
                        </div>
                        <div>
                            <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">
                                <i class="fa-solid fa-user" style="color:var(--secondary);"></i> Individual Weight %
                            </label>
                            <input id="wr-individual" type="number" class="login-input" style="margin:0;" value="${rule.individual}" min="0" max="100"
                                   oninput="syncWeightInputs('individual')">
                        </div>
                    </div>
                    
                    <div id="wr-total-warning" style="display:none; background:#fef2f2; border:1px solid #fecaca; padding:12px; border-radius:8px; margin-bottom:20px; color:#dc2626; font-size:0.85rem;">
                        <i class="fa-solid fa-triangle-exclamation"></i> Total must equal 100%
                    </div>
                    
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-outline" onclick="closeWeightRuleModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="saveWeightRule('${company}', ${ruleIdx})">
                            <i class="fa-solid fa-check"></i> &nbsp; ${isEdit ? 'Update' : 'Add'} Rule
                        </button>
                    </div>
                </div>
            </div>`;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        
        function toggleWeightRuleMatch() {
            const type = document.getElementById('wr-type').value;
            const matchContainer = document.getElementById('wr-match-container');
            matchContainer.style.display = type === 'default' ? 'none' : 'block';
        }
        
        function syncWeightInputs(changed) {
            const sharedInput = document.getElementById('wr-shared');
            const individualInput = document.getElementById('wr-individual');
            const warning = document.getElementById('wr-total-warning');
            
            let shared = parseInt(sharedInput.value) || 0;
            let individual = parseInt(individualInput.value) || 0;
            
            // Auto-calculate the other value
            if (changed === 'shared') {
                individual = 100 - shared;
                individualInput.value = individual;
            } else {
                shared = 100 - individual;
                sharedInput.value = shared;
            }
            
            // Show warning if total doesn't equal 100
            const total = shared + individual;
            warning.style.display = total !== 100 ? 'block' : 'none';
        }
        
        function closeWeightRuleModal() {
            const modal = document.getElementById('weight-rule-modal');
            if (modal) modal.remove();
        }
        
        function saveWeightRule(company, ruleIdx) {
            const type = document.getElementById('wr-type').value;
            const match = document.getElementById('wr-match').value.trim();
            const priority = parseInt(document.getElementById('wr-priority').value) || 50;
            const shared = parseInt(document.getElementById('wr-shared').value) || 0;
            const individual = parseInt(document.getElementById('wr-individual').value) || 0;
            
            // Validation
            if (type !== 'default' && !match) {
                showToast('Please enter a match value', 'error');
                return;
            }
            
            if (shared + individual !== 100) {
                showToast('Shared + Individual must equal 100%', 'error');
                return;
            }
            
            const newRule = {
                type: type,
                match: type === 'default' ? '*' : match.toLowerCase(),
                shared: shared,
                individual: individual,
                priority: priority
            };
            
            // Initialize company config if not exists
            if (!weightConfigurations[company]) {
                weightConfigurations[company] = { rules: [] };
            }
            
            if (ruleIdx !== null) {
                // Edit existing rule
                weightConfigurations[company].rules[ruleIdx] = newRule;
            } else {
                // Add new rule
                weightConfigurations[company].rules.push(newRule);
            }
            
            closeWeightRuleModal();
            switchWeightCompanyTab(company);
            showToast(`Rule ${ruleIdx !== null ? 'updated' : 'added'} successfully`, 'success');
        }
        
        function deleteWeightRule(company, ruleIdx) {
            showConfirm('Delete Rule', 'Are you sure you want to delete this weight rule?', 'Delete', 'danger', () => {
                if (weightConfigurations[company] && weightConfigurations[company].rules) {
                    weightConfigurations[company].rules.splice(ruleIdx, 1);
                    switchWeightCompanyTab(company);
                    showToast('Rule deleted', 'success');
                }
            });
        }
        
        async function saveCompanyWeightConfig(company) {
            showSaving();
            const success = await saveWeightConfigurations();
            if (success) {
                showSaved();
                showToast(`${company} weight configuration saved!`, 'success');
            } else {
                showToast('Failed to save weight configuration', 'error');
            }
        }
        
        function resetWeightConfigToDefaults() {
            showConfirm('Reset to Defaults', 'This will reset ALL company weight configurations to default values. This cannot be undone. Continue?', 'Reset All', 'danger', async () => {
                weightConfigurations = JSON.parse(JSON.stringify(DEFAULT_WEIGHT_CONFIG));
                showSaving();
                const success = await saveWeightConfigurations();
                if (success) {
                    showSaved();
                    loadWeightConfiguration();
                    showToast('Weight configurations reset to defaults', 'success');
                } else {
                    showToast('Failed to save reset configurations', 'error');
                }
            });
        }
        
        function previewWeightCalculation() {
            const company = document.getElementById('preview-company').value;
            const level = document.getElementById('preview-level').value.trim();
            const title = document.getElementById('preview-title').value.trim();
            const resultDiv = document.getElementById('weight-preview-result');
            
            if (!level && !title) {
                resultDiv.innerHTML = '<div style="text-align:center; color:var(--text-muted);">Enter level and/or job title to preview weight calculation</div>';
                return;
            }
            
            // Temporarily override the company detection
            const tempConfig = weightConfigurations[company] || DEFAULT_WEIGHT_CONFIG[company];
            
            // Simulate getW logic for preview
            let result = { s: 5, i: 95, matchedRule: 'Default' };
            
            if (tempConfig && tempConfig.rules) {
                const sortedRules = [...tempConfig.rules].sort((a, b) => (a.priority || 99) - (b.priority || 99));
                
                for (const rule of sortedRules) {
                    if (rule.type === 'default') continue;
                    
                    const matchValue = (rule.match || '').toLowerCase();
                    const jobLower = title.toLowerCase();
                    const levelUpper = level.toUpperCase();
                    
                    if (rule.type === 'title' && matchValue) {
                        if (jobLower.includes(matchValue) || jobLower === matchValue) {
                            result = { s: rule.shared, i: rule.individual, matchedRule: `Title: "${rule.match}"` };
                            break;
                        }
                    } else if (rule.type === 'level') {
                        const ruleLevel = matchValue.toUpperCase();
                        if (levelUpper === ruleLevel || levelUpper.includes(ruleLevel.replace('L', ''))) {
                            result = { s: rule.shared, i: rule.individual, matchedRule: `Level: ${rule.match}` };
                            break;
                        }
                    }
                }
                
                // Check default rule
                if (result.matchedRule === 'Default') {
                    const defaultRule = sortedRules.find(r => r.type === 'default');
                    if (defaultRule) {
                        result = { s: defaultRule.shared, i: defaultRule.individual, matchedRule: 'Default Rule' };
                    }
                }
            }
            
            resultDiv.innerHTML = `
                <div style="display:flex; justify-content:space-around; align-items:center; text-align:center;">
                    <div>
                        <div style="font-size:2.5rem; font-weight:800; color:var(--primary);">${result.s}%</div>
                        <div style="font-size:0.85rem; color:var(--text-muted);">Shared Goals</div>
                    </div>
                    <div style="width:2px; height:60px; background:var(--border);"></div>
                    <div>
                        <div style="font-size:2.5rem; font-weight:800; color:var(--secondary);">${result.i}%</div>
                        <div style="font-size:0.85rem; color:var(--text-muted);">Individual Goals</div>
                    </div>
                </div>
                <div style="text-align:center; margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
                    <span style="background:#f1f5f9; padding:4px 12px; border-radius:20px; font-size:0.8rem; color:var(--text-muted);">
                        <i class="fa-solid fa-check-circle" style="color:var(--success);"></i> Matched: <strong>${result.matchedRule}</strong>
                    </span>
                </div>
            `;
        }
        
        // --- PROGRESS WEIGHTS CONFIGURATION TAB ---
        async function loadProgressConfiguration() {
            // Load current configuration
            await loadProgressConfigurations();
            const config = progressConfigurations || DEFAULT_PROGRESS_CONFIG;
            
            const levels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];
            
            const content = `
            <div class="animate-in">
                <div class="card" style="margin-bottom:24px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <div>
                            <h3 style="margin:0; font-size:1.3rem; font-weight:700;">
                                <i class="fa-solid fa-bars-progress" style="color:var(--primary); margin-right:10px;"></i>
                                Progress Weights Configuration
                            </h3>
                            <p style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">
                                Configure how manager progress is calculated (Individual + Team weights)
                            </p>
                        </div>
                        <div style="display:flex; gap:12px;">
                            <button class="btn btn-outline" onclick="resetProgressToDefaults()">
                                <i class="fa-solid fa-rotate-left"></i> &nbsp; Reset to Defaults
                            </button>
                            <button class="btn btn-primary" onclick="saveProgressConfig()">
                                <i class="fa-solid fa-save"></i> &nbsp; Save Configuration
                            </button>
                        </div>
                    </div>
                    
                    <!-- Cascade Mode Selection -->
                    <div style="background:#f8fafc; padding:20px; border-radius:12px; margin-bottom:24px; border:1px solid var(--border);">
                        <h4 style="margin:0 0 12px; font-size:1rem; font-weight:700;">
                            <i class="fa-solid fa-sitemap" style="color:var(--primary); margin-right:8px;"></i>
                            Cascade Mode
                        </h4>
                        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px;">
                            Choose how team progress is calculated for managers
                        </p>
                        <div style="display:flex; gap:16px;">
                            <label style="flex:1; background:white; padding:16px; border-radius:10px; border:2px solid ${config.cascadeMode === 'direct' ? 'var(--primary)' : 'var(--border)'}; cursor:pointer; transition:all 0.2s;">
                                <input type="radio" name="cascade-mode" value="direct" ${config.cascadeMode === 'direct' ? 'checked' : ''} onchange="updateCascadeMode('direct')" style="margin-right:10px;">
                                <strong>Direct Reports Only</strong>
                                <p style="font-size:0.8rem; color:var(--text-muted); margin:8px 0 0;">
                                    Only include immediate direct reports in team progress calculation
                                </p>
                            </label>
                            <label style="flex:1; background:white; padding:16px; border-radius:10px; border:2px solid ${config.cascadeMode === 'full' ? 'var(--primary)' : 'var(--border)'}; cursor:pointer; transition:all 0.2s;">
                                <input type="radio" name="cascade-mode" value="full" ${config.cascadeMode === 'full' ? 'checked' : ''} onchange="updateCascadeMode('full')" style="margin-right:10px;">
                                <strong>Full Cascade</strong>
                                <p style="font-size:0.8rem; color:var(--text-muted); margin:8px 0 0;">
                                    Include all levels below (direct + indirect reports recursively)
                                </p>
                            </label>
                        </div>
                    </div>
                    
                    <!-- Individual vs Team Weights by Level -->
                    <div style="margin-bottom:24px;">
                        <h4 style="margin:0 0 16px; font-size:1rem; font-weight:700;">
                            <i class="fa-solid fa-balance-scale" style="color:var(--primary); margin-right:8px;"></i>
                            Individual vs Team Weight (Per Level)
                        </h4>
                        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px;">
                            Configure how much weight is given to individual objectives vs team progress for each level
                        </p>
                        
                        <div style="background:#f8fafc; border-radius:12px; border:1px solid var(--border); overflow:hidden;">
                            <table style="width:100%; border-collapse:collapse;">
                                <thead>
                                    <tr style="background:#e2e8f0;">
                                        <th style="padding:12px 16px; text-align:left; font-weight:700; font-size:0.85rem;">Level</th>
                                        <th style="padding:12px 16px; text-align:center; font-weight:700; font-size:0.85rem;">Individual Weight (%)</th>
                                        <th style="padding:12px 16px; text-align:center; font-weight:700; font-size:0.85rem;">Team Weight (%)</th>
                                        <th style="padding:12px 16px; text-align:center; font-weight:700; font-size:0.85rem;">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${levels.map(level => {
                                        const levelConfig = config.levelWeights[level] || { individual: 100, team: 0 };
                                        const total = levelConfig.individual + levelConfig.team;
                                        const isValid = total === 100;
                                        return `
                                        <tr style="border-bottom:1px solid var(--border);">
                                            <td style="padding:12px 16px; font-weight:700;">${level}</td>
                                            <td style="padding:12px 16px; text-align:center;">
                                                <input type="number" id="level-ind-${level}" value="${levelConfig.individual}" min="0" max="100" 
                                                       onchange="updateLevelWeight('${level}')"
                                                       style="width:80px; padding:8px; border-radius:6px; border:1px solid var(--border); text-align:center; font-weight:600;">
                                            </td>
                                            <td style="padding:12px 16px; text-align:center;">
                                                <input type="number" id="level-team-${level}" value="${levelConfig.team}" min="0" max="100" 
                                                       onchange="updateLevelWeight('${level}')"
                                                       style="width:80px; padding:8px; border-radius:6px; border:1px solid var(--border); text-align:center; font-weight:600;">
                                            </td>
                                            <td style="padding:12px 16px; text-align:center;">
                                                <span id="level-total-${level}" style="font-weight:700; color:${isValid ? 'var(--success)' : 'var(--danger)'};">
                                                    ${total}%
                                                    ${isValid ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-solid fa-exclamation-circle"></i>'}
                                                </span>
                                            </td>
                                        </tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    <!-- Team Member Weight by Level -->
                    <div>
                        <h4 style="margin:0 0 16px; font-size:1rem; font-weight:700;">
                            <i class="fa-solid fa-users" style="color:var(--primary); margin-right:8px;"></i>
                            Team Member Contribution Weights
                        </h4>
                        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:16px;">
                            Configure how much each team member level contributes to the team progress (weighted average)
                        </p>
                        
                        <div style="background:#f8fafc; border-radius:12px; border:1px solid var(--border); padding:20px;">
                            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:12px;">
                                ${levels.map(level => {
                                    const weight = config.teamMemberWeights[level] || 10;
                                    return `
                                    <div style="text-align:center;">
                                        <div style="font-weight:700; margin-bottom:8px; color:var(--text-main);">${level}</div>
                                        <input type="number" id="member-weight-${level}" value="${weight}" min="1" max="100" 
                                               style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border); text-align:center; font-weight:600; font-size:1.1rem;">
                                        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">weight</div>
                                    </div>`;
                                }).join('')}
                            </div>
                            <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
                                <p style="font-size:0.8rem; color:var(--text-muted); margin:0;">
                                    <i class="fa-solid fa-info-circle" style="color:var(--primary);"></i>
                                    Higher weights mean that level's progress has more impact on the manager's team progress score.
                                    Example: If L5=25 and L6=20, an L5 employee's progress is weighted 25% more than an L6's.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Preview Section -->
                <div class="card">
                    <h4 style="margin:0 0 16px; font-size:1rem; font-weight:700;">
                        <i class="fa-solid fa-calculator" style="color:var(--primary); margin-right:8px;"></i>
                        Progress Calculation Preview
                    </h4>
                    
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                        <div>
                            <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Manager Level</label>
                            <select id="preview-progress-level" onchange="previewProgressCalculation()" style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); margin-top:6px;">
                                ${levels.map(l => `<option value="${l}">${l}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Team Composition</label>
                            <input type="text" id="preview-team-comp" placeholder="e.g., 2xL5, 3xL6, 5xL7" onkeyup="previewProgressCalculation()" 
                                   style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border); margin-top:6px;">
                        </div>
                    </div>
                    
                    <div id="progress-preview-result" style="margin-top:20px; padding:20px; background:#f0fdfa; border-radius:12px; border:1px solid #99f6e4;">
                        <div style="text-align:center; color:var(--text-muted);">Enter team composition to preview calculation</div>
                    </div>
                </div>
            </div>`;
            
            document.getElementById('admin-content').innerHTML = content;
        }
        
        function updateCascadeMode(mode) {
            progressConfigurations.cascadeMode = mode;
            // Update radio button styles
            document.querySelectorAll('input[name="cascade-mode"]').forEach(input => {
                const label = input.closest('label');
                if (input.value === mode) {
                    label.style.borderColor = 'var(--primary)';
                } else {
                    label.style.borderColor = 'var(--border)';
                }
            });
        }
        
        function updateLevelWeight(level) {
            const indInput = document.getElementById(`level-ind-${level}`);
            const teamInput = document.getElementById(`level-team-${level}`);
            const totalSpan = document.getElementById(`level-total-${level}`);
            
            const ind = parseInt(indInput.value) || 0;
            const team = parseInt(teamInput.value) || 0;
            const total = ind + team;
            const isValid = total === 100;
            
            totalSpan.innerHTML = `${total}% ${isValid ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-solid fa-exclamation-circle"></i>'}`;
            totalSpan.style.color = isValid ? 'var(--success)' : 'var(--danger)';
            
            // Update config
            if (!progressConfigurations.levelWeights) progressConfigurations.levelWeights = {};
            progressConfigurations.levelWeights[level] = { individual: ind, team: team };
        }
        
        async function saveProgressConfig() {
            const levels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];
            
            // Validate all levels sum to 100
            let hasError = false;
            levels.forEach(level => {
                const ind = parseInt(document.getElementById(`level-ind-${level}`)?.value) || 0;
                const team = parseInt(document.getElementById(`level-team-${level}`)?.value) || 0;
                if (ind + team !== 100) {
                    hasError = true;
                }
            });
            
            if (hasError) {
                showToast('All level weights must sum to 100%', 'error');
                return;
            }
            
            // Collect level weights
            progressConfigurations.levelWeights = {};
            levels.forEach(level => {
                progressConfigurations.levelWeights[level] = {
                    individual: parseInt(document.getElementById(`level-ind-${level}`)?.value) || 100,
                    team: parseInt(document.getElementById(`level-team-${level}`)?.value) || 0
                };
            });
            
            // Collect team member weights
            progressConfigurations.teamMemberWeights = {};
            levels.forEach(level => {
                progressConfigurations.teamMemberWeights[level] = parseInt(document.getElementById(`member-weight-${level}`)?.value) || 10;
            });
            
            // Cascade mode is already updated via updateCascadeMode
            
            showSaving();
            const success = await saveProgressConfigurations();
            
            if (success) {
                showSaved();
                showToast('Progress configuration saved successfully!', 'success');
            } else {
                showToast('Failed to save configuration', 'error');
            }
        }
        
        function resetProgressToDefaults() {
            showConfirm('Reset to Defaults', 'This will reset all progress weight configurations to default values. Continue?', 'Reset', 'danger', async () => {
                progressConfigurations = JSON.parse(JSON.stringify(DEFAULT_PROGRESS_CONFIG));
                showSaving();
                const success = await saveProgressConfigurations();
                if (success) {
                    showSaved();
                    loadProgressConfiguration();
                    showToast('Progress configuration reset to defaults', 'success');
                } else {
                    showToast('Failed to save reset configuration', 'error');
                }
            });
        }
        
        function previewProgressCalculation() {
            const level = document.getElementById('preview-progress-level').value;
            const teamComp = document.getElementById('preview-team-comp').value;
            const resultDiv = document.getElementById('progress-preview-result');
            
            const levelConfig = progressConfigurations.levelWeights?.[level] || DEFAULT_PROGRESS_CONFIG.levelWeights[level];
            
            if (!teamComp) {
                resultDiv.innerHTML = `
                    <div style="text-align:center;">
                        <div style="margin-bottom:16px;">
                            <strong>${level} Manager Configuration:</strong><br>
                            Individual: ${levelConfig.individual}% | Team: ${levelConfig.team}%
                        </div>
                        <div style="color:var(--text-muted);">Enter team composition (e.g., "2xL5, 3xL6, 5xL7") to see full calculation</div>
                    </div>`;
                return;
            }
            
            // Parse team composition
            const teamParts = teamComp.split(',').map(p => p.trim());
            let teamBreakdown = [];
            teamParts.forEach(part => {
                const match = part.match(/(\d+)\s*[xX]\s*(L\d)/i);
                if (match) {
                    teamBreakdown.push({ count: parseInt(match[1]), level: match[2].toUpperCase() });
                }
            });
            
            if (teamBreakdown.length === 0) {
                resultDiv.innerHTML = '<div style="text-align:center; color:var(--danger);">Invalid format. Use: 2xL5, 3xL6, 5xL7</div>';
                return;
            }
            
            // Calculate weighted team contribution
            let totalWeight = 0;
            let weightedSum = 0;
            teamBreakdown.forEach(tb => {
                const memberWeight = progressConfigurations.teamMemberWeights?.[tb.level] || DEFAULT_PROGRESS_CONFIG.teamMemberWeights[tb.level] || 10;
                totalWeight += memberWeight * tb.count;
                weightedSum += memberWeight * tb.count;  // Assuming 100% progress for preview
            });
            
            const totalMembers = teamBreakdown.reduce((sum, tb) => sum + tb.count, 0);
            
            resultDiv.innerHTML = `
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; text-align:center;">
                    <div style="background:white; padding:16px; border-radius:10px;">
                        <div style="font-size:2rem; font-weight:800; color:#3b82f6;">${levelConfig.individual}%</div>
                        <div style="font-size:0.85rem; color:var(--text-muted);">Individual Weight</div>
                    </div>
                    <div style="font-size:2rem; color:var(--text-muted); display:flex; align-items:center; justify-content:center;">+</div>
                    <div style="background:white; padding:16px; border-radius:10px;">
                        <div style="font-size:2rem; font-weight:800; color:#10b981;">${levelConfig.team}%</div>
                        <div style="font-size:0.85rem; color:var(--text-muted);">Team Weight</div>
                    </div>
                </div>
                <div style="margin-top:20px; padding-top:20px; border-top:1px solid var(--border);">
                    <h5 style="margin:0 0 12px; font-size:0.9rem; font-weight:700;">Team Composition: ${totalMembers} members</h5>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${teamBreakdown.map(tb => {
                            const weight = progressConfigurations.teamMemberWeights?.[tb.level] || DEFAULT_PROGRESS_CONFIG.teamMemberWeights[tb.level] || 10;
                            return `<span style="background:#e2e8f0; padding:6px 12px; border-radius:20px; font-size:0.85rem;">
                                ${tb.count}x ${tb.level} (weight: ${weight})
                            </span>`;
                        }).join('')}
                    </div>
                </div>
                <div style="margin-top:16px; background:linear-gradient(135deg, #0f172a, #1e293b); color:white; padding:16px; border-radius:10px;">
                    <div style="font-size:0.8rem; color:#94a3b8; margin-bottom:4px;">Example: If Individual Progress = 80% and Team Progress = 60%</div>
                    <div style="font-size:1.5rem; font-weight:800; color:#0d9488;">
                        Overall = (80% × ${levelConfig.individual/100}) + (60% × ${levelConfig.team/100}) = ${(80 * levelConfig.individual/100 + 60 * levelConfig.team/100).toFixed(1)}%
                    </div>
                </div>
            `;
        }
        
        // =====================================================
        // RATING LEVELS CONFIGURATION UI
        // =====================================================
        
        async function loadRatingLevelsConfiguration() {
            // Load current configuration
            await loadRatingConfiguration();
            
            const isPercentageMode = ratingConfig.ratingMode === 'percentage';
            
            const content = `
            <div class="animate-in">
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; flex-wrap:wrap; gap:16px;">
                        <div>
                            <h3 style="margin:0; font-size:1.3rem; font-weight:700;">
                                <i class="fa-solid fa-star-half-stroke" style="color:var(--primary); margin-right:10px;"></i>
                                Rating Levels Configuration
                            </h3>
                            <p style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">
                                Configure the rating scale for cycle ${currentCycle}. Changes affect all scorecards in this cycle.
                            </p>
                        </div>
                        <div style="display:flex; gap:12px;">
                            <button class="btn btn-outline" onclick="resetRatingToDefault()">
                                <i class="fa-solid fa-rotate-left"></i> &nbsp; Reset to Default
                            </button>
                            <button class="btn btn-primary" onclick="saveRatingLevelsConfig()">
                                <i class="fa-solid fa-save"></i> &nbsp; Save Configuration
                            </button>
                        </div>
                    </div>
                    
                    <!-- Rating Mode Selection -->
                    <div style="background:linear-gradient(135deg, #f0fdf4, #dcfce7); border:2px solid #22c55e; border-radius:16px; padding:24px; margin-bottom:24px;">
                        <h4 style="margin:0 0 16px; font-size:1.1rem; font-weight:700; color:#166534;">
                            <i class="fa-solid fa-sliders"></i> &nbsp; Rating Mode
                        </h4>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                            <label onclick="updateRatingMode('level')" style="cursor:pointer;">
                                <div style="background:white; border:3px solid ${!isPercentageMode ? '#22c55e' : '#e5e7eb'}; border-radius:12px; padding:20px; transition:all 0.2s;
                                            ${!isPercentageMode ? 'box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.2);' : ''}">
                                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                                        <div style="width:40px; height:40px; background:${!isPercentageMode ? '#22c55e' : '#e5e7eb'}; color:${!isPercentageMode ? 'white' : '#6b7280'}; 
                                                    border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
                                            <i class="fa-solid fa-list-ol"></i>
                                        </div>
                                        <div>
                                            <div style="font-weight:700; font-size:1rem; color:#1f2937;">Level-Based Rating</div>
                                            <div style="font-size:0.8rem; color:#6b7280;">Simple 1, 2, 3, 4, 5... selection</div>
                                        </div>
                                    </div>
                                    <div style="font-size:0.85rem; color:#4b5563; line-height:1.5;">
                                        Manager selects a <strong>level number</strong> directly (e.g., Level 4 = Runner). 
                                        Best for simple, straightforward evaluations.
                                    </div>
                                    <div style="margin-top:12px; display:flex; gap:6px;">
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">1</span>
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">2</span>
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">3</span>
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">4</span>
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">5</span>
                                    </div>
                                </div>
                            </label>
                            
                            <label onclick="updateRatingMode('percentage')" style="cursor:pointer;">
                                <div style="background:white; border:3px solid ${isPercentageMode ? '#22c55e' : '#e5e7eb'}; border-radius:12px; padding:20px; transition:all 0.2s;
                                            ${isPercentageMode ? 'box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.2);' : ''}">
                                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                                        <div style="width:40px; height:40px; background:${isPercentageMode ? '#22c55e' : '#e5e7eb'}; color:${isPercentageMode ? 'white' : '#6b7280'}; 
                                                    border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
                                            <i class="fa-solid fa-percent"></i>
                                        </div>
                                        <div>
                                            <div style="font-weight:700; font-size:1rem; color:#1f2937;">Percentage-Based Rating</div>
                                            <div style="font-size:0.8rem; color:#6b7280;">0-100% with level ranges</div>
                                        </div>
                                    </div>
                                    <div style="font-size:0.85rem; color:#4b5563; line-height:1.5;">
                                        Manager enters a <strong>percentage score</strong> (0-100%). System automatically maps to level based on configured ranges.
                                    </div>
                                    <div style="margin-top:12px; display:flex; gap:6px;">
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">0-29%</span>
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">30-49%</span>
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">50-69%</span>
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;">70%+</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <!-- Template Selection -->
                    <div style="background:#f8fafc; border-radius:12px; padding:20px; margin-bottom:24px;">
                        <h4 style="margin:0 0 16px; font-size:1rem; font-weight:700;">
                            <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--primary);"></i> &nbsp; Quick Templates
                        </h4>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
                            ${Object.entries(RATING_TEMPLATES).map(([key, template]) => {
                                const isSelected = ratingConfig.levelsCount === template.levelsCount && ratingConfig.ratingMode === template.ratingMode;
                                const modeIcon = template.ratingMode === 'percentage' ? 'fa-percent' : 'fa-list-ol';
                                return `
                                <div class="template-card" onclick="applyRatingTemplate('${key}')" 
                                     style="background:white; border:2px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}; 
                                            border-radius:10px; padding:16px; cursor:pointer; transition:all 0.2s;
                                            ${isSelected ? 'box-shadow: 0 0 0 3px var(--primary-light);' : ''}">
                                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                                        <i class="fa-solid ${modeIcon}" style="color:${template.ratingMode === 'percentage' ? '#f59e0b' : '#3b82f6'}; font-size:0.8rem;"></i>
                                        <span style="font-weight:700; font-size:0.9rem;">${template.name}</span>
                                    </div>
                                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                                        ${template.levels.map(l => `
                                            <span style="width:18px; height:18px; border-radius:50%; background:${l.color}; display:inline-block;" title="${l.name}"></span>
                                        `).join('')}
                                    </div>
                                </div>
                            `}).join('')}
                        </div>
                    </div>
                    
                    <!-- Number of Levels -->
                    <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:20px; margin-bottom:24px;">
                        <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
                            <div>
                                <label style="font-weight:700; font-size:0.9rem; color:#0369a1;">Number of Rating Levels</label>
                                <p style="font-size:0.8rem; color:#0284c7; margin:4px 0 0;">Choose between 3 and 10 levels</p>
                            </div>
                            <select id="levels-count-select" onchange="updateLevelsCount(this.value)" 
                                    style="padding:12px 20px; border:2px solid #0ea5e9; border-radius:10px; font-weight:700; font-size:1.1rem; background:white;">
                                ${[3,4,5,6,7,8,9,10].map(n => `
                                    <option value="${n}" ${ratingConfig.levelsCount === n ? 'selected' : ''}>${n} Levels</option>
                                `).join('')}
                            </select>
                            <div style="margin-left:auto; display:flex; align-items:center; gap:8px;">
                                <span style="font-size:0.85rem; color:#0369a1;">Target Level:</span>
                                <select id="target-level-select" onchange="updateTargetLevel(this.value)"
                                        style="padding:8px 16px; border:2px solid #0ea5e9; border-radius:8px; font-weight:600;">
                                    ${Array.from({length: ratingConfig.levelsCount}, (_, i) => ratingConfig.levelsCount - i).map(n => `
                                        <option value="${n}" ${ratingConfig.targetLevel === n ? 'selected' : ''}>Level ${n}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Levels Configuration Table -->
                    <div style="overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                            <thead>
                                <tr style="background:var(--primary); color:white;">
                                    <th style="padding:14px; text-align:center; width:60px;">Level</th>
                                    <th style="padding:14px; text-align:left;">Name</th>
                                    <th style="padding:14px; text-align:center; width:80px;">Color</th>
                                    <th style="padding:14px; text-align:center; width:100px;">${isPercentageMode ? 'Min %' : 'Min Score'}</th>
                                    <th style="padding:14px; text-align:center; width:100px;">${isPercentageMode ? 'Max %' : 'Max Score'}</th>
                                    <th style="padding:14px; text-align:left;">Description</th>
                                </tr>
                            </thead>
                            <tbody id="rating-levels-tbody">
                                ${renderRatingLevelsRows()}
                            </tbody>
                        </table>
                    </div>
                    
                    <!-- Preview Section -->
                    <div style="margin-top:32px; padding-top:24px; border-top:1px solid var(--border);">
                        <h4 style="margin:0 0 16px; font-size:1rem; font-weight:700;">
                            <i class="fa-solid fa-eye" style="color:var(--primary);"></i> &nbsp; Preview - How Managers Will Rate
                        </h4>
                        <div style="background:#f8fafc; border-radius:12px; padding:20px;">
                            ${isPercentageMode ? `
                                <div style="margin-bottom:16px;">
                                    <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:8px;">
                                        In <strong>Percentage Mode</strong>, managers will enter a score like this:
                                    </div>
                                    <div style="display:flex; align-items:center; gap:12px; background:white; padding:12px 16px; border-radius:10px; border:1px solid var(--border); max-width:400px;">
                                        <span style="font-weight:600;">Score:</span>
                                        <input type="number" id="preview-pct-input" min="0" max="100" value="75" 
                                               oninput="updatePercentagePreview(this.value)"
                                               style="width:80px; padding:8px 12px; border:2px solid var(--primary); border-radius:8px; font-weight:700; font-size:1.1rem; text-align:center;">
                                        <span style="font-weight:600;">%</span>
                                        <span style="margin-left:auto;" id="preview-pct-result">
                                            ${renderPercentagePreviewResult(75)}
                                        </span>
                                    </div>
                                </div>
                            ` : `
                                <div style="margin-bottom:16px; font-size:0.85rem; color:var(--text-muted);">
                                    In <strong>Level Mode</strong>, managers will select from these options:
                                </div>
                            `}
                            <div id="rating-preview" style="display:flex; gap:8px; flex-wrap:wrap;">
                                ${renderRatingPreview()}
                            </div>
                            
                            <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--border);">
                                <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">Target columns in scorecard:</div>
                                <div style="display:flex; gap:4px; overflow-x:auto; padding-bottom:8px;">
                                    ${renderTargetColumnsPreview()}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Warning -->
                    <div style="margin-top:24px; background:#fef3c7; border:1px solid #fcd34d; border-radius:12px; padding:16px; display:flex; align-items:flex-start; gap:12px;">
                        <i class="fa-solid fa-triangle-exclamation" style="color:#d97706; font-size:1.2rem;"></i>
                        <div>
                            <div style="font-weight:700; color:#92400e;">Important Notice</div>
                            <div style="font-size:0.85rem; color:#a16207; margin-top:4px;">
                                Changing the rating mode or levels will affect all scorecards in cycle ${currentCycle}. 
                                Existing ratings will be preserved but may need manual adjustment.
                                It's recommended to configure this at the start of a new cycle.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            `;
            
            document.getElementById('admin-content').innerHTML = content;
        }
        
        // Update rating mode
        function updateRatingMode(mode) {
            ratingConfig.ratingMode = mode;
            loadRatingLevelsConfiguration();
            showToast(`Switched to ${mode === 'percentage' ? 'Percentage' : 'Level'}-based rating`, 'info');
        }
        
        // Render percentage preview result
        function renderPercentagePreviewResult(pct) {
            const levelInfo = getLevelFromPercentage(pct);
            return `<span class="badge-rating" style="background:${levelInfo.color}; color:white; padding:6px 14px; border-radius:8px; font-weight:700;">
                ${levelInfo.name}
            </span>`;
        }
        
        // Update percentage preview (called on input)
        function updatePercentagePreview(value) {
            const resultEl = document.getElementById('preview-pct-result');
            if (resultEl) {
                resultEl.innerHTML = renderPercentagePreviewResult(parseFloat(value) || 0);
            }
        }
        
        // Render rating levels table rows
        function renderRatingLevelsRows() {
            return ratingConfig.levels.map((lvl, index) => {
                const isTarget = lvl.level === ratingConfig.targetLevel;
                return `
                <tr style="border-bottom:1px solid var(--border); ${isTarget ? 'background:#dbeafe;' : ''}">
                    <td style="padding:12px; text-align:center;">
                        <div style="width:36px; height:36px; background:${lvl.color}; color:white; border-radius:50%; 
                                    display:flex; align-items:center; justify-content:center; font-weight:800; margin:0 auto;">
                            ${lvl.level}
                        </div>
                        ${isTarget ? '<div style="font-size:0.65rem; color:#1d4ed8; font-weight:700; margin-top:4px;">TARGET</div>' : ''}
                    </td>
                    <td style="padding:12px;">
                        <input type="text" value="${lvl.name}" onchange="updateLevelProperty(${index}, 'name', this.value.toUpperCase())"
                               style="width:100%; padding:10px; border:1px solid var(--border); border-radius:8px; font-weight:700; text-transform:uppercase;">
                    </td>
                    <td style="padding:12px; text-align:center;">
                        <input type="color" value="${lvl.color}" onchange="updateLevelProperty(${index}, 'color', this.value)"
                               style="width:50px; height:40px; border:none; border-radius:8px; cursor:pointer;">
                    </td>
                    <td style="padding:12px;">
                        <input type="number" value="${lvl.minScore}" min="0" max="100" 
                               onchange="updateLevelProperty(${index}, 'minScore', parseInt(this.value))"
                               style="width:100%; padding:10px; border:1px solid var(--border); border-radius:8px; text-align:center; font-weight:600;">
                    </td>
                    <td style="padding:12px;">
                        <input type="number" value="${lvl.maxScore}" min="0" max="100"
                               onchange="updateLevelProperty(${index}, 'maxScore', parseInt(this.value))"
                               style="width:100%; padding:10px; border:1px solid var(--border); border-radius:8px; text-align:center; font-weight:600;">
                    </td>
                    <td style="padding:12px;">
                        <input type="text" value="${lvl.description || ''}" onchange="updateLevelProperty(${index}, 'description', this.value)"
                               style="width:100%; padding:10px; border:1px solid var(--border); border-radius:8px;" placeholder="Optional description">
                    </td>
                </tr>
                `;
            }).join('');
        }
        
        // Render rating preview badges
        function renderRatingPreview() {
            return ratingConfig.levels.map(lvl => {
                const isTarget = lvl.level === ratingConfig.targetLevel;
                return `
                <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
                    <span class="badge-rating" style="background:${lvl.color}; color:white; padding:8px 16px; border-radius:8px; font-weight:700;">
                        ${lvl.level} - ${lvl.name}
                    </span>
                    ${isTarget ? '<span style="font-size:0.65rem; color:#1d4ed8; font-weight:700;">TARGET</span>' : ''}
                </div>
                `;
            }).join('');
        }
        
        // Render target columns preview
        function renderTargetColumnsPreview() {
            return ratingConfig.levels.map(lvl => {
                const isTarget = lvl.level === ratingConfig.targetLevel;
                return `
                <div style="min-width:100px; text-align:center; padding:12px; background:${isTarget ? '#dbeafe' : '#f8fafc'}; 
                            border:1px solid ${isTarget ? '#3b82f6' : 'var(--border)'}; border-radius:8px;">
                    <div style="font-size:0.7rem; font-weight:700; color:${lvl.color}; margin-bottom:4px;">
                        ${lvl.name}${isTarget ? ' (Target)' : ''}
                    </div>
                    <div style="font-size:0.85rem; color:var(--text-muted);">-</div>
                </div>
                `;
            }).join('');
        }
        
        // Apply a rating template
        function applyRatingTemplate(templateKey) {
            const template = RATING_TEMPLATES[templateKey];
            if (!template) return;
            
            ratingConfig.levelsCount = template.levelsCount;
            ratingConfig.targetLevel = template.targetLevel;
            ratingConfig.ratingMode = template.ratingMode || 'level';
            ratingConfig.levels = JSON.parse(JSON.stringify(template.levels));
            
            // Reinitialize labels
            initRatingLabels();
            generateRatingCSS();
            
            // Reload the UI
            loadRatingLevelsConfiguration();
            showToast(`Applied "${template.name}" template`, 'success');
        }
        
        // Update number of levels
        function updateLevelsCount(count) {
            const newCount = parseInt(count);
            if (newCount < 3 || newCount > 10) return;
            
            const currentCount = ratingConfig.levelsCount;
            
            if (newCount > currentCount) {
                // Add more levels
                for (let i = currentCount + 1; i <= newCount; i++) {
                    const colors = ['#0f766e', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#64748b', '#0ea5e9', '#14b8a6'];
                    ratingConfig.levels.unshift({
                        level: i,
                        name: `LEVEL ${i}`,
                        color: colors[(i - 1) % colors.length],
                        bgColor: '#f1f5f9',
                        minScore: Math.round(((i - 1) / newCount) * 100),
                        maxScore: Math.round((i / newCount) * 100) - 1,
                        description: ''
                    });
                }
                // Fix max score for highest level
                ratingConfig.levels[0].maxScore = 100;
            } else if (newCount < currentCount) {
                // Remove levels from top
                ratingConfig.levels = ratingConfig.levels.filter(l => l.level <= newCount);
            }
            
            // Renumber levels
            ratingConfig.levels.sort((a, b) => b.level - a.level);
            ratingConfig.levels.forEach((lvl, i) => {
                lvl.level = newCount - i;
            });
            
            ratingConfig.levelsCount = newCount;
            
            // Adjust target level if needed
            if (ratingConfig.targetLevel > newCount) {
                ratingConfig.targetLevel = Math.ceil(newCount / 2);
            }
            
            // Reinitialize labels
            initRatingLabels();
            generateRatingCSS();
            
            // Reload the UI
            loadRatingLevelsConfiguration();
        }
        
        // Update target level
        function updateTargetLevel(level) {
            ratingConfig.targetLevel = parseInt(level);
            loadRatingLevelsConfiguration();
        }
        
        // Update individual level property
        function updateLevelProperty(index, property, value) {
            if (ratingConfig.levels[index]) {
                ratingConfig.levels[index][property] = value;
                
                // If changing color, also update bgColor (lighter version)
                if (property === 'color') {
                    // Simple bgColor generation (could be improved)
                    ratingConfig.levels[index].bgColor = value + '20';
                }
                
                // Reinitialize labels if name changed
                if (property === 'name') {
                    initRatingLabels();
                }
                
                // Regenerate CSS if color changed
                if (property === 'color') {
                    generateRatingCSS();
                }
                
                // Update preview
                const preview = document.getElementById('rating-preview');
                if (preview) preview.innerHTML = renderRatingPreview();
            }
        }
        
        // Reset to default configuration
        function resetRatingToDefault() {
            showConfirm(
                'Reset to Default',
                'This will reset all rating levels to the default 6-level Astronaut scale. Continue?',
                'Reset',
                'danger',
                () => {
                    ratingConfig = JSON.parse(JSON.stringify(DEFAULT_RATING_CONFIG));
                    ratingConfig.cycle = currentCycle;
                    initRatingLabels();
                    generateRatingCSS();
                    loadRatingLevelsConfiguration();
                    showToast('Rating configuration reset to default', 'success');
                }
            );
        }
        
        // Save rating levels configuration
        async function saveRatingLevelsConfig() {
            // Validate configuration
            const errors = validateRatingConfig();
            if (errors.length > 0) {
                showToast(errors[0], 'error');
                return;
            }
            
            showSaving();
            
            // Update cycle
            ratingConfig.cycle = currentCycle;
            
            const success = await saveRatingConfiguration();
            
            if (success) {
                showSaved();
                // Reinitialize labels and CSS
                initRatingLabels();
                generateRatingCSS();
            }
        }
        
        // Validate rating configuration
        function validateRatingConfig() {
            const errors = [];
            
            // Check level names
            const names = ratingConfig.levels.map(l => l.name);
            const uniqueNames = new Set(names);
            if (uniqueNames.size !== names.length) {
                errors.push('Level names must be unique');
            }
            
            // Check for empty names
            if (ratingConfig.levels.some(l => !l.name || l.name.trim() === '')) {
                errors.push('All levels must have a name');
            }
            
            // Check score ranges don't overlap and cover 0-100
            const sortedLevels = [...ratingConfig.levels].sort((a, b) => a.minScore - b.minScore);
            for (let i = 0; i < sortedLevels.length; i++) {
                if (sortedLevels[i].minScore > sortedLevels[i].maxScore) {
                    errors.push(`Level ${sortedLevels[i].level}: Min score cannot be greater than max score`);
                }
                if (i > 0 && sortedLevels[i].minScore <= sortedLevels[i-1].maxScore) {
                    errors.push('Score ranges should not overlap');
                }
            }
            
            return errors;
        }
        
        // --- DIRECTORY TAB (ADD/EDIT/DELETE USERS) ---
        async function loadAdminDirectory() {
            if (allCompanyData.length === 0) allCompanyData = await fetchAllData();
            const content = `
            <div class="animate-in">
                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <div>
                            <h3 style="margin:0; font-size:1.2rem; font-weight:700;">Employee Directory</h3>
                            <p style="color:var(--text-muted); font-size:0.9rem;">Manage system users and access.</p>
                        </div>
                        <div style="display:flex; gap:12px;">
                            <button class="btn btn-outline" onclick="document.getElementById('file-users').click()"><i class="fa-solid fa-file-csv"></i> &nbsp; Bulk Import</button>
                            <button class="btn btn-primary" onclick="openUserModal()"><i class="fa-solid fa-plus"></i> &nbsp; Add Employee</button>
                        </div>
                    </div>
                   
                    <div style="margin-bottom:20px;">
                        <div class="search-box-container" style="position:relative;">
                            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--text-muted);"></i>
                            <input class="login-input" style="padding-left:42px; margin:0;" placeholder="Search by Name, ID, or Division..." onkeyup="searchDirectory(this.value)">
                        </div>
                    </div>

                    <div style="max-height:600px; overflow-y:auto; border-radius:12px; border:1px solid var(--border);">
                        <table class="report-table" id="dir-table" style="margin:0;">
                            <thead><tr><th>ID</th><th>Name</th><th>Job Title</th><th>Division</th><th>Manager</th><th style="text-align:right">Actions</th></tr></thead>
                            <tbody id="dir-tbody"></tbody>
                        </table>
                    </div>
                </div>
            </div>`;
            document.getElementById('admin-content').innerHTML = content;
            renderDirectoryTable(allCompanyData.slice(0, 50)); // Initial render
        }

        function searchDirectory(q) {
            q = q.toLowerCase();
            const filtered = allCompanyData.filter(u =>
                (u[COL.id] || "").toLowerCase().includes(q) ||
                (u[COL.name] || "").toLowerCase().includes(q) ||
                (u[COL.div] || "").toLowerCase().includes(q)
            ).slice(0, 50);
            
            if (filtered.length === 0 && q.length > 0) {
                document.getElementById('dir-tbody').innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center; padding:40px; color:var(--text-muted);">
                            <i class="fa-solid fa-user-slash" style="font-size:2rem; opacity:0.3; margin-bottom:12px; display:block;"></i>
                            <div style="font-weight:600;">No Employee Found</div>
                            <div style="font-size:0.85rem; margin-top:4px;">No results matching "${escapeHTML(q)}"</div>
                        </td>
                    </tr>`;
                showToast("No employee found matching your search", "error");
                return;
            }
            
            renderDirectoryTable(filtered);
        }

        // Replace hardcoded property names with COL mapping
        function renderDirectoryTable(list) {
            document.getElementById('dir-tbody').innerHTML = list.map(u => `
    <tr>
        <td style="font-weight:700;">${u[COL.id] || '-'}</td>
        <td style="font-weight:600;">
            <div style="display:flex; align-items:center; gap:8px;">
                <a href="#" onclick="event.preventDefault(); loadEval('${u[COL.id]}', true);" 
                   style="color:var(--primary); text-decoration:none; cursor:pointer; transition: all 0.2s;"
                   onmouseover="this.style.textDecoration='underline'"
                   onmouseout="this.style.textDecoration='none'"
                   title="Click to view scorecard">
                    ${u[COL.name] || 'No Name'}
                </a>
            </div>
        </td>
        <td>${u[COL.job] || '-'}</td>
        <td>${u[COL.div] || '-'}</td>
        <td>${u[COL.mgr] || '-'}</td>
        <td style="text-align:right;">
            <div style="display:flex; justify-content:flex-end; gap:6px;">
                <button class="btn btn-outline" onclick="loadEval('${u[COL.id]}', true)" title="View Scorecard"><i class="fa-solid fa-eye"></i></button>
                <button class="btn btn-outline" onclick="event.stopPropagation(); openScorecardInNewTab('${u[COL.id]}')" title="Open in new tab"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                <button class="btn btn-outline" onclick="openUserModal('${u[COL.id]}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-outline" onclick="deleteUser('${u[COL.id]}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </td>
    </tr>
    `).join('');
        }
        // Modal Functions
        function openUserModal(empId = null) {
            const modal = document.getElementById('user-modal'); // Ensure this ID matches your modal container
            const idField = document.getElementById('um-id');
            const nameField = document.getElementById('um-name');
            const emailField = document.getElementById('um-email');
            const phoneField = document.getElementById('um-phone');
            const jobField = document.getElementById('um-job');
            const divField = document.getElementById('um-div');
            const mgrField = document.getElementById('um-mgr');
            const roleField = document.getElementById('um-role');
            const origIdField = document.getElementById('um-orig-id');

            // Reset all fields first
            idField.value = '';
            nameField.value = '';
            emailField.value = '';
            phoneField.value = '';
            jobField.value = '';
            divField.value = '';
            mgrField.value = '';
            roleField.value = 'User'; // Default role
            origIdField.value = '';

            if (!empId) {
                // Mode: Add New Employee
                document.getElementById('um-title').innerText = "Add New Employee";
                idField.disabled = false;
            } else {
                // Mode: Edit Existing Employee
                document.getElementById('um-title').innerText = "Edit Employee Details";

                // Find user data in the global cache
                const u = allCompanyData.find(x => x[COL.id].toString() === empId.toString());

                if (u) {
                    origIdField.value = u[COL.id]; // Store the original ID for the update query
                    idField.value = u[COL.id];
                    idField.disabled = true; // Best practice: Don't allow ID changes during edit

                    nameField.value = u[COL.name] || '';
                    emailField.value = u[COL.email] || '';
                    phoneField.value = u[COL.phone] || '';
                    jobField.value = u[COL.job] || '';
                    divField.value = u[COL.div] || '';
                    mgrField.value = u[COL.mgr] || '';
                    roleField.value = u[COL.role] || 'User';
                }
            }

            modal.style.display = 'flex';
        }
        function closeUserModal() {
            document.getElementById('modal-overlay').classList.remove('open');
        }

        async function saveUser() {
            const isEdit = !!document.getElementById('edit-mode-id').value;
            const uId = document.getElementById('u-id').value.trim();
            const uName = document.getElementById('u-name').value.trim();

            if (!uId || !uName) { alert("ID and Name are required."); return; }

            const payload = {
                [COL.id]: uId,
                [COL.name]: uName,
                [COL.lvl]: document.getElementById('u-lvl').value.trim(),
                [COL.job]: document.getElementById('u-job').value.trim(),
                [COL.div]: document.getElementById('u-div').value.trim(),
                [COL.dept]: document.getElementById('u-dept').value.trim(),
                [COL.mgr]: document.getElementById('u-mgr').value.trim()
            };

            const pass = document.getElementById('u-pass').value;
            if (pass) payload['password'] = pass;

            // Using Upsert for both Add and Edit
            const { error } = await db.from('active_list').upsert(payload);

            if (error) {
                alert("Error saving user: " + error.message);
            } else {
                alert("User saved successfully!");
                closeUserModal();
                // Refresh local data
                allCompanyData = await fetchAllData();
                loadAdminDirectory();
            }
        }

        async function deleteUser(id) {
            showConfirm("Delete Employee", "Permanently delete this user? This cannot be undone.", "Delete User", "danger", async () => {
                const { error } = await db.from('active_list').delete().eq(COL.id, id);
                if (error) showToast("Error deleting: " + error.message, 'error');
                else {
                    showToast("User deleted successfully", 'success');
                    allCompanyData = allCompanyData.filter(u => u[COL.id] !== id);
                    searchDirectory(document.getElementById('dir-table').parentElement.previousElementSibling.querySelector('input').value);
                }
            });
        }
        /**
         * PROCESS BULK SCORECARD IMPORT
         * This function reads an Excel file and assigns goals to multiple employees at once.
         */
        /**
         * PROCESS BULK SCORECARD IMPORT (Chunked Version)
         * Now supports optional Rating column
         */
        async function processBulkImport(inp) {
            const file = inp.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

                    if (json.length === 0) { alert("Excel file is empty."); return; }

                    const grouped = {};
                    const getVal = (row, candidates) => {
                        const keys = Object.keys(row);
                        for (let c of candidates) {
                            const match = keys.find(k => k.toLowerCase().trim().replace(/\s/g, '') === c.toLowerCase().replace(/\s/g, ''));
                            if (match) return row[match];
                        }
                        return "";
                    };

                    // Grouping goals by Employee ID
                    json.forEach(r => {
                        const empIdRaw = getVal(r, ['EmployeeID', 'ID', 'Employee Number', 'EmpID']);
                        if (!empIdRaw) return;

                        const eid = empIdRaw.toString().trim();
                        if (!grouped[eid]) grouped[eid] = [];

                        let w = parseFloat(getVal(r, ['Weight', 'Wt', 'W%'])) || 0;
                        if (w > 1) w = w / 100;

                        // Optional: Parse rating if provided (1-6)
                        let rating = parseInt(getVal(r, ['Rating', 'Score', 'Rate', 'Achievement'])) || 0;
                        if (rating < 0) rating = 0;
                        if (rating > 6) rating = 6;

                        // Optional: Get comment if provided
                        const comment = getVal(r, ['Comment', 'Comments', 'Manager Comment', 'Feedback']) || "";

                        grouped[eid].push({
                            title: getVal(r, ['Objective', 'Title', 'Goal', 'KPI']) || "New Objective",
                            weight: w,
                            desc: getVal(r, ['Description', 'Desc', 'Details']) || "",
                            unit: getVal(r, ['Unit', 'UoM']) || "",
                            rating: rating,
                            comment: comment,
                            targets: [
                                getVal(r, ['L1']), getVal(r, ['L2']), getVal(r, ['L3']),
                                getVal(r, ['Target', 'L4', 'Runner']),
                                getVal(r, ['L5']), getVal(r, ['L6'])
                            ]
                        });
                    });

                    const empIds = Object.keys(grouped);
                    if (empIds.length === 0) {
                        alert("Import Error: No valid 'Employee ID' column found.");
                        return;
                    }

                    if (!confirm(`Importing objectives for ${empIds.length} employees. Proceed?`)) return;

                    showSaving();

                    // --- CHUNKING LOGIC START ---
                    const CHUNK_SIZE = 20; // Process 20 employees at a time
                    let success = 0;
                    let fail = 0;

                    for (let i = 0; i < empIds.length; i += CHUNK_SIZE) {
                        const chunk = empIds.slice(i, i + CHUNK_SIZE);

                        // Update the UI so the user sees progress
                        document.getElementById('save-text').innerText = `Processing ${i} / ${empIds.length}...`;

                        const promises = chunk.map(eid =>
                            db.from('active_list')
                                .update({ goals: grouped[eid] })
                                .eq(COL.id, eid)
                        );

                        const results = await Promise.all(promises);

                        results.forEach(res => {
                            if (!res.error) success++; else fail++;
                        });
                    }
                    // --- CHUNKING LOGIC END ---

                    showSaved();
                    clearDataCache();
                    alert(`Import Finished!\n✅ Updated: ${success}\n❌ Failed: ${fail}`);
                    allCompanyData = await fetchAllData();
                    inp.value = '';

                } catch (err) {
                    console.error("Import Error:", err);
                    alert("Unexpected error during import.");
                }
            };
            reader.readAsArrayBuffer(file);
        }
        function processUserBulkImport(inp) {
            const file = inp.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                    if (json.length === 0) { alert("Empty file"); return; }

                    if (!confirm(`Ready to import ${json.length} users? This will update existing IDs and add new ones.`)) return;

                    showSaving();
                    const updates = json.map(r => {
                        return {
                            [COL.id]: r['Employee Number'] || r['ID'],
                            [COL.name]: r['Name'] || r['Full Name'],
                            [COL.lvl]: r['Level'] || "",
                            [COL.job]: r['Job'] || r['Title'],
                            [COL.div]: r['Division'] || "",
                            [COL.dept]: r['Department'] || "",
                            [COL.mgr]: r['Manager'] || r['Manager ID'] || ""
                        };
                    }).filter(x => x[COL.id]); // Ensure ID exists

                    // Batch upsert
                    const { error } = await db.from('active_list').upsert(updates);

                    if (error) alert("Import Error: " + error.message);
                    else {
                        alert("Import Successful!");
                        allCompanyData = await fetchAllData();
                        loadAdminDirectory();
                    }
                    showSaved();
                    inp.value = '';
                } catch (err) { console.error(err); alert("Error processing file."); }
            };
            reader.readAsArrayBuffer(file);
        }

        // --- BULK IMPORT (SCORECARDS) ---
        function loadAdminBulk() {
            document.getElementById('admin-content').innerHTML = `
            <div class="animate-in">
                <div class="card" style="margin-bottom:24px;">
                    <h3 style="margin:0 0 8px 0; font-size:1.2rem; font-weight:700;"><i class="fa-solid fa-file-import" style="color:var(--primary); margin-right:8px;"></i>Bulk Scorecard Import</h3>
                    <p style="color:var(--text-muted); margin-bottom:24px; line-height:1.6;">Upload an Excel file to import objectives for multiple employees at once. You can import objectives only, or include scores and ratings.</p>
                </div>

                <div class="dash-grid" style="grid-template-columns: 1fr 1fr; gap:24px;">
                    <!-- Option 1: Objectives Only -->
                    <div class="card" style="text-align:center; padding:32px; border:2px solid var(--border); transition:all 0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                        <div style="font-size:3rem; color:var(--primary); margin-bottom:20px;">
                            <i class="fa-solid fa-bullseye"></i>
                        </div>
                        <h4 style="margin:0 0 12px 0; font-size:1.1rem;">Import Objectives Only</h4>
                        <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:24px; line-height:1.5;">
                            Import objectives with targets and weights.<br>
                            Ratings will be set to 0 (not rated).
                        </p>
                        <button class="btn btn-outline" onclick="document.getElementById('file-bulk').click()" style="width:100%;">
                            <i class="fa-solid fa-upload"></i> &nbsp; Select Excel File
                        </button>
                        <div style="margin-top:16px; font-size:0.75rem; color:var(--text-muted);">
                            Required columns: Employee ID, Title, Weight
                        </div>
                    </div>

                    <!-- Option 2: Objectives with Scores & Ratings -->
                    <div class="card" style="text-align:center; padding:32px; border:2px solid var(--border); transition:all 0.2s;" onmouseover="this.style.borderColor='var(--success)'" onmouseout="this.style.borderColor='var(--border)'">
                        <div style="font-size:3rem; color:var(--success); margin-bottom:20px;">
                            <i class="fa-solid fa-chart-line"></i>
                        </div>
                        <h4 style="margin:0 0 12px 0; font-size:1.1rem;">Import with Scores & Ratings</h4>
                        <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:24px; line-height:1.5;">
                            Import objectives with pre-filled ratings.<br>
                            Also update employee status if provided.
                        </p>
                        <button class="btn btn-primary" onclick="document.getElementById('file-bulk-scored').click()" style="width:100%; background:var(--success); border-color:var(--success);">
                            <i class="fa-solid fa-upload"></i> &nbsp; Select Excel File
                        </button>
                        <div style="margin-top:16px; font-size:0.75rem; color:var(--text-muted);">
                            + Rating, Score, Status columns supported
                        </div>
                    </div>
                </div>

                <!-- Template Download Section -->
                <div class="card" style="margin-top:24px;">
                    <h4 style="margin:0 0 16px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-download" style="color:var(--primary); margin-right:8px;"></i>Download Templates</h4>
                    <div style="display:flex; gap:16px; flex-wrap:wrap;">
                        <button class="btn btn-outline" onclick="downloadBulkTemplate('objectives')">
                            <i class="fa-solid fa-file-excel" style="color:#10b981;"></i> &nbsp; Objectives Template
                        </button>
                        <button class="btn btn-outline" onclick="downloadBulkTemplate('scored')">
                            <i class="fa-solid fa-file-excel" style="color:#10b981;"></i> &nbsp; Scored Template
                        </button>
                    </div>
                </div>

                <!-- Column Reference -->
                <div class="card" style="margin-top:24px;">
                    <h4 style="margin:0 0 16px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-table-columns" style="color:var(--primary); margin-right:8px;"></i>Supported Column Names</h4>
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:16px;">
                        <div>
                            <div style="font-weight:700; color:var(--text-main); margin-bottom:8px;">Required</div>
                            <ul style="margin:0; padding-left:20px; color:var(--text-muted); font-size:0.9rem; line-height:1.8;">
                                <li><strong>Employee ID</strong> - ID, Employee Number, EmpID</li>
                                <li><strong>Title</strong> - Objective, Goal, KPI</li>
                                <li><strong>Weight</strong> - Weight, Wt, W% (0-100 or 0-1)</li>
                            </ul>
                        </div>
                        <div>
                            <div style="font-weight:700; color:var(--text-main); margin-bottom:8px;">Optional (Objectives)</div>
                            <ul style="margin:0; padding-left:20px; color:var(--text-muted); font-size:0.9rem; line-height:1.8;">
                                <li><strong>Description</strong> - Desc, Details</li>
                                <li><strong>Unit</strong> - UoM</li>
                                <li><strong>Targets</strong> - L1, L2, L3, L4/Target, L5, L6</li>
                            </ul>
                        </div>
                        <div>
                            <div style="font-weight:700; color:var(--success); margin-bottom:8px;">Scored Import Only</div>
                            <ul style="margin:0; padding-left:20px; color:var(--text-muted); font-size:0.9rem; line-height:1.8;">
                                <li><strong>Rating</strong> - 1-6 (IDLE to ASTRONAUT)</li>
                                <li><strong>Comment</strong> - Manager Comment</li>
                                <li><strong>Status</strong> - Draft, Submitted, Approved, etc.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
            <input type="file" id="file-bulk-scored" hidden accept=".xlsx, .xls, .csv" onchange="processBulkScoredImport(this)">
        `;
        }

        // Download bulk import templates
        function downloadBulkTemplate(type) {
            let headers, sampleData;
            
            if (type === 'objectives') {
                headers = ['Employee ID', 'Objective', 'Weight', 'Description', 'Unit', 'L1', 'L2', 'L3', 'L4 (Target)', 'L5', 'L6'];
                sampleData = [
                    ['ZIQ001', 'Increase Revenue', '40', 'Achieve revenue growth targets', '%', '< 80%', '80-90%', '90-95%', '95-100%', '100-110%', '> 110%'],
                    ['ZIQ001', 'Customer Satisfaction', '30', 'Maintain high NPS score', 'Score', '< 50', '50-60', '60-70', '70-80', '80-90', '> 90'],
                    ['ZIQ001', 'Team Development', '30', 'Complete training programs', '#', '0', '1', '2', '3', '4', '5'],
                    ['ZIQ002', 'Sales Target', '50', 'Meet quarterly sales', 'USD', '< 50K', '50-75K', '75-90K', '90-100K', '100-120K', '> 120K'],
                    ['ZIQ002', 'Process Improvement', '50', 'Implement efficiency measures', '%', '< 5%', '5-10%', '10-15%', '15-20%', '20-25%', '> 25%']
                ];
            } else {
                headers = ['Employee ID', 'Objective', 'Weight', 'Description', 'Unit', 'L1', 'L2', 'L3', 'L4 (Target)', 'L5', 'L6', 'Rating', 'Comment', 'Status'];
                sampleData = [
                    ['ZIQ001', 'Increase Revenue', '40', 'Achieve revenue growth targets', '%', '< 80%', '80-90%', '90-95%', '95-100%', '100-110%', '> 110%', '4', 'Good performance on revenue', 'Submitted to HR'],
                    ['ZIQ001', 'Customer Satisfaction', '30', 'Maintain high NPS score', 'Score', '< 50', '50-60', '60-70', '70-80', '80-90', '> 90', '5', 'Excellent customer feedback', 'Submitted to HR'],
                    ['ZIQ001', 'Team Development', '30', 'Complete training programs', '#', '0', '1', '2', '3', '4', '5', '4', 'Met training goals', 'Submitted to HR'],
                    ['ZIQ002', 'Sales Target', '50', 'Meet quarterly sales', 'USD', '< 50K', '50-75K', '75-90K', '90-100K', '100-120K', '> 120K', '3', 'Needs improvement', 'Approved'],
                    ['ZIQ002', 'Process Improvement', '50', 'Implement efficiency measures', '%', '< 5%', '5-10%', '10-15%', '15-20%', '20-25%', '> 25%', '4', 'Good progress', 'Approved']
                ];
            }
            
            const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Template');
            
            // Set column widths
            ws['!cols'] = headers.map((h, i) => ({ wch: i === 0 ? 15 : (i === 1 || i === 3) ? 30 : 12 }));
            
            XLSX.writeFile(wb, `PMS_Bulk_Import_${type === 'objectives' ? 'Objectives' : 'Scored'}_Template.xlsx`);
            showToast('Template downloaded!', 'success');
        }

        /**
         * PROCESS BULK SCORED IMPORT - Import objectives WITH ratings and scores
         */
        async function processBulkScoredImport(inp) {
            const file = inp.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

                    if (json.length === 0) { alert("Excel file is empty."); return; }

                    const grouped = {};
                    const statusMap = {}; // Track status per employee
                    
                    const getVal = (row, candidates) => {
                        const keys = Object.keys(row);
                        for (let c of candidates) {
                            const match = keys.find(k => k.toLowerCase().trim().replace(/\s/g, '') === c.toLowerCase().replace(/\s/g, ''));
                            if (match) return row[match];
                        }
                        return "";
                    };

                    // Grouping goals by Employee ID with ratings
                    json.forEach(r => {
                        const empIdRaw = getVal(r, ['EmployeeID', 'ID', 'Employee Number', 'EmpID']);
                        if (!empIdRaw) return;

                        const eid = empIdRaw.toString().trim();
                        if (!grouped[eid]) grouped[eid] = [];

                        let w = parseFloat(getVal(r, ['Weight', 'Wt', 'W%'])) || 0;
                        if (w > 1) w = w / 100;

                        // Parse rating (1-6)
                        let rating = parseInt(getVal(r, ['Rating', 'Score', 'Rate', 'Achievement'])) || 0;
                        if (rating < 0) rating = 0;
                        if (rating > 6) rating = 6;

                        // Get comment
                        const comment = getVal(r, ['Comment', 'Comments', 'Manager Comment', 'Feedback']) || "";

                        grouped[eid].push({
                            title: getVal(r, ['Objective', 'Title', 'Goal', 'KPI']) || "New Objective",
                            weight: w,
                            desc: getVal(r, ['Description', 'Desc', 'Details']) || "",
                            unit: getVal(r, ['Unit', 'UoM']) || "",
                            rating: rating,
                            comment: comment,
                            targets: [
                                getVal(r, ['L1']), getVal(r, ['L2']), getVal(r, ['L3']),
                                getVal(r, ['Target', 'L4', 'Runner']),
                                getVal(r, ['L5']), getVal(r, ['L6'])
                            ]
                        });

                        // Capture status (use the last one found for the employee)
                        const status = getVal(r, ['Status', 'State', 'Workflow Status']);
                        if (status) {
                            statusMap[eid] = status.toString().trim();
                        }
                    });

                    const empIds = Object.keys(grouped);
                    if (empIds.length === 0) {
                        alert("Import Error: No valid 'Employee ID' column found.");
                        return;
                    }

                    // Validate employee IDs exist in system
                    const validEmpIds = [];
                    const invalidEmpIds = [];
                    
                    empIds.forEach(eid => {
                        const exists = allCompanyData.some(u => u[COL.id] === eid);
                        if (exists) {
                            validEmpIds.push(eid);
                        } else {
                            invalidEmpIds.push(eid);
                        }
                    });

                    if (validEmpIds.length === 0) {
                        alert(`Import Error: None of the ${empIds.length} Employee IDs were found in the system.\n\nFirst few IDs tried: ${empIds.slice(0, 5).join(', ')}`);
                        return;
                    }

                    // Count how many have ratings
                    let ratedCount = 0;
                    let totalGoals = 0;
                    validEmpIds.forEach(eid => {
                        grouped[eid].forEach(g => {
                            totalGoals++;
                            if (g.rating > 0) ratedCount++;
                        });
                    });

                    let confirmMsg = `Importing ${totalGoals} objectives for ${validEmpIds.length} employees.\n\n` +
                        `📊 Ratings found: ${ratedCount} / ${totalGoals}\n` +
                        `📋 Status updates: ${Object.keys(statusMap).filter(id => validEmpIds.includes(id)).length} employees\n`;
                    
                    if (invalidEmpIds.length > 0) {
                        confirmMsg += `\n⚠️ ${invalidEmpIds.length} Employee IDs not found (will be skipped):\n${invalidEmpIds.slice(0, 5).join(', ')}${invalidEmpIds.length > 5 ? '...' : ''}\n`;
                    }
                    
                    confirmMsg += `\nProceed with import?`;

                    if (!confirm(confirmMsg)) return;

                    showSaving();

                    // --- CHUNKING LOGIC START ---
                    const CHUNK_SIZE = 20;
                    let success = 0;
                    let fail = 0;
                    const failedIds = [];

                    for (let i = 0; i < validEmpIds.length; i += CHUNK_SIZE) {
                        const chunk = validEmpIds.slice(i, i + CHUNK_SIZE);

                        document.getElementById('save-text').innerText = `Processing ${i} / ${validEmpIds.length}...`;

                        const promises = chunk.map(async eid => {
                            // Build the payload with goals
                            const payload = {
                                id: eid,
                                goals: grouped[eid]
                            };
                            
                            // Add status if available
                            if (statusMap[eid]) {
                                payload.status = statusMap[eid];
                            }

                            try {
                                const res = await fetch(`${API_URL}?action=saveUser`, {
                                    method: 'POST',
                                    headers: API_HEADERS,
                                    body: JSON.stringify({ payload: payload })
                                });
                                
                                if (res.status === 401 || res.status === 403) {
                                    handleSessionExpired();
                                    return { error: { message: "Session expired" }, eid };
                                }
                                
                                if (!res.ok) {
                                    const txt = await res.text();
                                    return { error: { message: txt || "Update failed" }, eid };
                                }
                                return { error: null, eid };
                            } catch (e) {
                                return { error: e, eid };
                            }
                        });

                        const results = await Promise.all(promises);

                        results.forEach(res => {
                            if (!res.error) {
                                success++;
                            } else {
                                fail++;
                                failedIds.push(res.eid);
                                console.error(`Failed to update ${res.eid}:`, res.error);
                            }
                        });
                    }
                    // --- CHUNKING LOGIC END ---

                    showSaved();
                    clearDataCache();
                    
                    let resultMsg = `Import Finished!\n✅ Updated: ${success} employees\n❌ Failed: ${fail}\n\n📊 ${ratedCount} ratings imported`;
                    
                    if (failedIds.length > 0) {
                        resultMsg += `\n\nFailed IDs: ${failedIds.slice(0, 10).join(', ')}${failedIds.length > 10 ? '...' : ''}`;
                    }
                    
                    if (invalidEmpIds.length > 0) {
                        resultMsg += `\n\nSkipped (not found): ${invalidEmpIds.length} IDs`;
                    }
                    
                    alert(resultMsg);
                    allCompanyData = await fetchAllData();
                    inp.value = '';

                } catch (err) {
                    console.error("Import Error:", err);
                    alert("Unexpected error during import: " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function processUserBulkImport(inp) {
            const file = inp.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

                    if (json.length === 0) { alert("The Excel file is empty!"); return; }

                    // Helper to find data regardless of header capitalization or spaces
                    const getVal = (row, candidates) => {
                        const keys = Object.keys(row);
                        for (let c of candidates) {
                            const match = keys.find(k => k.toLowerCase().trim() === c.toLowerCase());
                            if (match) return row[match];
                        }
                        return null;
                    };

                    const updates = json.map(r => {
                        const empId = getVal(r, ['Employee Number', 'ID', 'Employee ID', 'EmpID', 'EmployeeNumber']);
                        if (!empId) return null;

                        return {
                            [COL.id]: empId.toString().trim(),
                            [COL.name]: getVal(r, ['Name', 'Full Name', 'FullName']) || "New Employee",
                            [COL.lvl]: getVal(r, ['Level', 'Lvl']) || "L4",
                            [COL.job]: getVal(r, ['Job', 'Job Title', 'Title']) || "",
                            [COL.div]: getVal(r, ['Division', 'Div']) || "",
                            [COL.dept]: getVal(r, ['Department', 'Dept']) || "",
                            [COL.mgr]: getVal(r, ['Manager', 'Manager ID', 'Reports To']) || ""
                        };
                    }).filter(x => x !== null);

                    if (updates.length === 0) {
                        alert("Import Failed: No valid data found. Ensure your header is named 'Employee Number' or 'ID'.");
                        return;
                    }

                    if (!confirm(`Ready to import ${updates.length} users?`)) return;

                    showSaving();
                    const { error } = await db.from('active_list').upsert(updates);

                    if (error) {
                        alert("Database Error: " + error.message);
                    } else {
                        alert(`Successfully imported ${updates.length} employees!`);
                        allCompanyData = await fetchAllData();
                        loadAdminDirectory();
                    }
                    showSaved();
                    inp.value = '';
                } catch (err) {
                    console.error(err);
                    alert("Error processing file. Please check the Excel format.");
                }
            };
            reader.readAsArrayBuffer(file);
        }

        // --- SHARED GOALS EDITOR (DB DRAFT) ---

        async function loadAdminSharedGoals() {
            document.getElementById('admin-content').innerHTML = '<div style="padding:40px; text-align:center;"><div class="spinner"></div></div>';

            try {
                // 1. Check for Draft First
                const { data: draftRow } = await db.from('company_settings').select('data').eq('id', 'shared_goals_draft').maybeSingle();

                if (draftRow && draftRow.data) {
                    hasDraft = true;
                    masterData = Array.isArray(draftRow.data) ? { rating: 0, goals: draftRow.data } : draftRow.data;
                } else {
                    hasDraft = false;
                    // 2. If no draft, Load LIVE data
                    const { data: sg } = await db.from('company_settings').select('data').eq('id', SHARED_GOALS_ID).single();
                    if (sg && sg.data) {
                        masterData = Array.isArray(sg.data) ? { rating: 0, goals: sg.data } : sg.data;
                    } else {
                        // Initialize empty if nothing exists in DB
                        masterData = { rating: 0, goals: [] };
                    }
                }

                // 3. Construct UI
                const h = `
        <div class="animate-in">
            ${hasDraft ? `
            <div style="background:#fff7ed; color:#b45309; padding:16px 24px; border-radius:12px; border:1px solid #fed7aa; margin-bottom:24px; display:flex; justify-content:space-between; align-items:center;">
                <span style="display:flex; align-items:center; gap:12px; font-weight:600;"><i class="fa-solid fa-triangle-exclamation" style="font-size:1.2rem;"></i> Unsaved Draft &bull; Changes visible only to you</span>
                <button onclick="discardDraft()" class="btn btn-outline" style="border-color:#b45309; color:#b45309; height:auto; padding:6px 16px;">Discard Draft</button>
            </div>` : ''}

            <div class="card" style="background: linear-gradient(to right, #ffffff, #f8fafc); border-left: 6px solid var(--primary);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; border-bottom:1px solid var(--border); padding-bottom:24px;">
                    <div>
                        <h3 style="margin:0 0 4px 0; font-size:1.1rem; font-weight:700;">Calculated Company Performance</h3>
                        <p style="margin:0; color:var(--text-muted); font-size:0.9rem;">Aggregated status based on individual shared goal achievements.</p>
                    </div>
                    <div style="text-align:right; display:flex; flex-direction:column; gap:8px; align-items:flex-end;">
                        <div id="global-calc-label" class="badge-rating lvl-0">PENDING</div>
                        <div id="global-calc-note" style="font-size:0.85rem; font-weight:600; color:var(--text-muted); font-style:italic; max-width:350px; line-height:1.4;">
                            Rate individual goals below to determine the company status.
                        </div>
                    </div>
                </div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h4 style="margin:0; font-size:1rem; font-weight:700;">Shared Objectives & Cascading Weights</h4>
                    <div style="display:flex; gap:10px;">
                        <button class="btn btn-primary" onclick="saveMasterGoals()"><i class="fa-regular fa-floppy-disk"></i> &nbsp; Publish Changes</button>
                    </div>
                </div>
                
                <div id="master-goals-list" style="display:grid; gap:20px;"></div>
                
                <button class="btn btn-outline" style="margin-top:24px; width:100%; justify-content:center; border-style:dashed;" onclick="addMasterGoal()">
                    <i class="fa-solid fa-plus"></i> &nbsp; Create New Shared Objective
                </button>
            </div>
        </div>`;

                document.getElementById('admin-content').innerHTML = h;

                // 4. Render Items & Initial Calculation
                renderMasterGoals();
                refreshGlobalAdminRating();

            } catch (e) {
                console.error(e);
                document.getElementById('admin-content').innerHTML = `<div style="color:red; padding:20px;">Error loading shared goals: ${escapeHTML(e.message)}</div>`;
            }
        }

        /**
         * UPDATED HELPER: Calculates the status from individual ratings
         * Displays the Rate Badge and Note, hides the raw numerical score
         */
        function refreshGlobalAdminRating() {
            let totalScore = 0;
            let count = 0;

            (masterData.goals || []).forEach(g => {
                if (g.rating > 0) {
                    totalScore += Number(g.rating);
                    count++;
                }
            });

            // Calculate average for backend storage/logic
            const averageRating = count > 0 ? (totalScore / count) : 0;
            masterData.rating = averageRating;

            // Update UI Labels and Notes
            const labelEl = document.getElementById('global-calc-label');
            const noteEl = document.getElementById('global-calc-note');

            if (labelEl && noteEl) {
                let lbl = "PENDING";
                let lvlClass = "lvl-0";
                let note = "Waiting for objective ratings to be processed.";

                if (averageRating >= 5.5) {
                    lbl = "ASTRONAUT"; lvlClass = "lvl-6";
                    note = "Exemplary performance. Company is leading market standards.";
                }
                else if (averageRating >= 4.5) {
                    lbl = "FLYER"; lvlClass = "lvl-5";
                    note = "Strong performance. Most targets exceeded significantly.";
                }
                else if (averageRating >= 3.5) {
                    lbl = "RUNNER"; lvlClass = "lvl-4";
                    note = "Healthy performance. Meeting all strategic organizational goals.";
                }
                else if (averageRating >= 2.5) {
                    lbl = "WALKER"; lvlClass = "lvl-3";
                    note = "Basic performance. Strategic objectives met with room for growth.";
                }
                else if (averageRating >= 1.5) {
                    lbl = "STAGNANT"; lvlClass = "lvl-2";
                    note = "Performance below expectations. Corrective action required.";
                }
                else if (averageRating > 0) {
                    lbl = "IDLE"; lvlClass = "lvl-1";
                    note = "Critical performance gaps identified across shared objectives.";
                }

                labelEl.innerText = lbl;
                labelEl.className = `badge-rating ${lvlClass}`;
                noteEl.innerText = note;
            }
        }

        function saveDraftToDB() {
            // 1. UI Feedback
            const textEl = document.getElementById('save-text');
            const statusEl = document.getElementById('save-status');
            const dotEl = document.getElementById('save-dot');

            if (statusEl) statusEl.classList.add('show');
            if (dotEl) dotEl.className = 'save-dot saving';
            if (textEl) textEl.innerText = "Saving Draft...";

            // 2. Clear previous timer
            clearTimeout(draftSaveTimer);

            // 3. Set new timer
            draftSaveTimer = setTimeout(async () => {
                try {
                    // This now correctly sends 'shared_goals_draft' to the backend
                    const { error } = await db.from('company_settings').upsert({
                        id: 'shared_goals_draft',
                        data: masterData
                    });

                    if (error) {
                        console.error("Error saving draft:", error);
                        if (textEl) textEl.innerText = "Save Failed";
                        if (dotEl) dotEl.style.background = "red";
                    } else {
                        hasDraft = true;
                        showSaved();
                    }
                } catch (e) {
                    console.error("Draft Save Exception:", e);
                }
            }, 1000); // 1 second delay
        }

        async function discardDraft() {
            showConfirm("Discard Draft", "Discard draft and reload live data?", "Discard", "danger", async () => {
                await db.from('company_settings').delete().eq('id', 'shared_goals_draft');
                location.reload();
            });
        }

        function updateMasterRating(v) {
            masterData.rating = parseInt(v);
            saveDraftToDB();
            renderMasterGoals();
        }

        function renderMasterGoals() {
            const container = document.getElementById('master-goals-list');
            const companies = ["Zain Iraq", "Horizon", "Next Generation"];

            if (!masterData.goals || masterData.goals.length === 0) {
                container.innerHTML = '<div style="padding:20px; text-align:center; color:#aaa;">No shared goals defined. Click "Create New" below.</div>';
                return;
            }

            container.innerHTML = (masterData.goals || []).map((g, i) => {
                if (!Array.isArray(g.targets)) g.targets = ["", "", "", "", "", ""];
                if (!Array.isArray(g.assignments)) g.assignments = [];

                const context = g.company_context || 'ALL';
                let contextData = allCompanyData;
                if (context !== 'ALL') {
                    contextData = allCompanyData.filter(u => getCompany(u[COL.id]) === context);
                }

                const availDivs = [...new Set(contextData.map(u => (u[COL.div] || "").trim()).filter(Boolean))].sort();

                const availChiefs = contextData
                    .filter(u => {
                        const l = (u[COL.lvl] || "").toString().trim().toUpperCase();
                        const j = (u[COL.job] || "").toString().trim().toUpperCase();
                        return l === 'L1' || j === 'CEO' || (j.startsWith('CHIEF ') && j.endsWith(' OFFICER'));
                    })
                    .sort((a, b) => (a[COL.name] || "").localeCompare(b[COL.name] || ""));

                const allOptionText = context === 'ALL' ? "Assign to ALL Global Employees" : `Assign to ALL ${context} Employees`;
                const allOptionVal = context === 'ALL' ? "GLOBAL_ALL" : `COMP_${context}`;

                // --- ASSIGNMENTS LOGIC ---
                const assignmentsHtml = (g.assignments || []).map((assign, ai) => {
                    const target = (assign && assign.target) ? String(assign.target) : '';
                    if (!target) return '';

                    let dispName = target;
                    let chipStyle = "background:#f1f5f9; border-color:#e2e8f0; color:#0f172a;";

                    if (target === 'GLOBAL_ALL') {
                        dispName = "🌍 GLOBAL (All Employees)";
                        chipStyle = "background:#ecfdf5; border-color:#6ee7b7; color:#064e3b;";
                    } else if (target.startsWith('COMP_')) {
                        dispName = `🏢 ${target.replace('COMP_', '')} (Entire Company)`;
                        chipStyle = "background:#eff6ff; border-color:#93c5fd; color:#1e3a8a;";
                    } else if (target.startsWith('DIV_')) {
                        dispName = `📂 ${target.replace('DIV_', '')}`;
                        chipStyle = "background:#fff7ed; border-color:#fdba74; color:#7c2d12;";
                    } else if (target.startsWith('ID_')) {
                        const id = target.replace('ID_', '');
                        const u = contextData.find(x => String(x[COL.id]) === String(id));
                        dispName = u ? `👤 ${u[COL.name]} (${id})` : `👤 ${id}`;
                        chipStyle = "background:#fdf4ff; border-color:#f0abfc; color:#701a75;";
                    }

                    const shownWeight = (assign && typeof assign.weight !== 'undefined' && assign.weight !== null)
                        ? assign.weight
                        : (typeof g.weight !== 'undefined' && g.weight !== null ? g.weight : 0);

                    // --- LOGIC CALCULATED BEFORE HTML GENERATION ---
                    const isDiv = target.startsWith('DIV_');
                    const divName = isDiv ? target.replace('DIV_', '') : '';

                    const divBtn = isDiv ? `
                <button class="btn btn-outline div-weights-btn"
                        style="padding:6px 10px; font-size:0.8rem;"
                        data-goal="${i}"
                        data-div="${escapeHTML(divName)}"
                        title="View managers and edit weights">
                  <i class="fa-solid fa-users"></i>
                </button>` : '';

                    // --- RETURN PURE HTML STRING ---
                    return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px; border:2px solid; border-radius:10px; margin-bottom:8px; ${chipStyle}">
              <div style="font-weight:800; font-size:0.85rem; line-height:1.2;">${escapeHTML(dispName)}</div>
              <div style="display:flex; align-items:center; gap:8px;">
                <input type="number" min="0" max="100" step="1"
                  value="${Number(shownWeight) || 0}"
                  style="width:82px; padding:6px 8px; border-radius:8px; border:2px solid #e5e7eb; font-weight:800; text-align:center;"
                  onchange="masterData.goals[${i}].assignments[${ai}].weight = Number(this.value) || 0; saveDraftToDB();"
                  title="Organizational Weight (per assignment)">
                
                ${divBtn}

                <button class="btn-delete"
                  onclick="removeAssignment(${i}, ${ai})"
                  style="color:var(--danger); width:28px; height:28px; display:flex; align-items:center; justify-content:center;">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>`;
                }).join('');

                const targetsHtml = (g.targets || []).map((t, ti) => {
                    const label = (ti === 3) ? 'RUNNER' : (ti === 5) ? 'ASTRO' : ('L' + (ti + 1));
                    const highlight = (ti === 3) ? 'active-highlight' : '';
                    return `
            <div style="position:relative;">
              <div style="font-size:0.6rem; font-weight:800; color:var(--text-light); margin-bottom:2px; text-align:center;">${label}</div>
              <input class="target-input ${highlight}"
                value="${escapeHTML(String(t ?? ''))}"
                placeholder="Target..."
                onchange="masterData.goals[${i}].targets[${ti}] = this.value; saveDraftToDB();">
            </div>`;
                }).join('');

                return `
          <div class="card" style="border-left: 5px solid var(--primary); background: #fff; overflow:visible; margin-bottom:20px;">
            <div style="display:grid; grid-template-columns: 2fr 1fr 1fr; gap:15px; margin-bottom:15px;">
              <input class="login-input" value="${escapeHTML(g.title || '')}" onchange="masterData.goals[${i}].title = this.value; saveDraftToDB();" placeholder="Goal Title" style="margin:0;">
              
              <select class="login-input" style="margin:0; font-weight:700; color:var(--text-main);" onchange="masterData.goals[${i}].company_context = this.value; saveDraftToDB(); renderMasterGoals();">
                <option value="ALL" ${context === 'ALL' ? 'selected' : ''}>🌍 All Companies</option>
                ${companies.map(comp => `<option value="${escapeHTML(comp)}" ${context === comp ? 'selected' : ''}>🏢 ${escapeHTML(comp)}</option>`).join('')}
              </select>

              <select class="login-input" onchange="updateGoalAssignment(${i}, this.value); this.value='';" style="margin:0; border-color:var(--primary-light);">
                <option value="" selected disabled>+ Assign Goal To...</option>
                <option value="${escapeHTML(allOptionVal)}" style="font-weight:800; color:var(--primary);">${escapeHTML(allOptionText)}</option>
                <optgroup label="Divisions (${escapeHTML(context)})">
                  ${availDivs.map(d => `<option value="DIV_${escapeHTML(d)}">${escapeHTML(d)}</option>`).join('')}
                </optgroup>
                <optgroup label="Chiefs / Hierarchy (${escapeHTML(context)})">
                  ${availChiefs.map(u => `<option value="ID_${escapeHTML(String(u[COL.id]))}">${escapeHTML(String(u[COL.name] || ''))}</option>`).join('')}
                </optgroup>
              </select>
            </div>

            <div style="background:#f8fafc; padding:12px; border-radius:10px; margin-bottom:15px;">
              <div style="font-size:0.7rem; font-weight:800; color:var(--text-muted); margin-bottom:8px;">ACTIVE ASSIGNMENTS & WEIGHTS</div>
              ${assignmentsHtml}
              ${(!g.assignments || g.assignments.length === 0) ? '<div style="font-size:0.8rem; color:var(--text-light); font-style:italic; padding:4px;">No assignments yet. Goal is inactive.</div>' : ''}
            </div>

            <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:8px; margin-bottom:15px;">${targetsHtml}</div>

            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid #f1f5f9;">
              <div style="display:flex; align-items:center; gap:15px;">
                <span style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">ACHIEVEMENT:</span>
                <select onchange="masterData.goals[${i}].rating = parseInt(this.value); refreshGlobalAdminRating(); saveDraftToDB(); renderMasterGoals();"
                  style="padding:6px 12px; border-radius:8px; border:2px solid var(--primary); font-weight:700; background:white; cursor:pointer;">
                  <option value="0">Not Rated</option>
                  <option value="1" ${g.rating == 1 ? 'selected' : ''}>1 - IDLE</option>
                  <option value="2" ${g.rating == 2 ? 'selected' : ''}>2 - STAGNANT</option>
                  <option value="3" ${g.rating == 3 ? 'selected' : ''}>3 - WALKER</option>
                  <option value="4" ${g.rating == 4 ? 'selected' : ''}>4 - RUNNER</option>
                  <option value="5" ${g.rating == 5 ? 'selected' : ''}>5 - FLYER</option>
                  <option value="6" ${g.rating == 6 ? 'selected' : ''}>6 - ASTRONAUT</option>
                </select>
              </div>
              <button class="btn btn-outline" style="color:var(--danger); padding:6px 12px; font-size:0.8rem; border-color:#fee2e2;" onclick="masterData.goals.splice(${i}, 1); saveDraftToDB(); renderMasterGoals();">
                <i class="fa-solid fa-trash"></i> Delete Goal
              </button>
            </div>
          </div>`;
            }).join('');
        }
        function closeDivisionWeights() {
            const m = document.getElementById('div-weight-modal');
            if (m) m.classList.add('hidden');
            activeDivWeightGoalIndex = null;
        }

        function getDivisionMembers(contextData, divisionName) {
            return contextData.filter(u => ((u[COL.div] || "").trim() === divisionName));
        }

        // Manager = anyone whose ID appears in other people's manager_id inside the division
        function getDivisionManagers(divisionMembers) {
            const mgrIdSet = new Set();
            divisionMembers.forEach(u => {
                const raw = (u[COL.mgr] || "").toString().trim();
                // manager_id can be ID or name; try to extract ID by matching against known IDs:
                const match = divisionMembers.find(x => raw.includes(x[COL.id]));
                if (match) mgrIdSet.add(match[COL.id]);
                // also if it's exactly an ID:
                const direct = divisionMembers.find(x => x[COL.id] === raw);
                if (direct) mgrIdSet.add(direct[COL.id]);
            });

            // return manager objects
            const mgrs = divisionMembers
                .filter(u => mgrIdSet.has(u[COL.id]))
                .map(u => ({ id: u[COL.id], name: u[COL.name], job: u[COL.job] || '', lvl: u[COL.lvl] || '' }));

            // de-dupe by id
            const seen = new Set();
            return mgrs.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
        }

        function openDivisionWeights(goalIndex, divisionName) {
            activeDivWeightGoalIndex = goalIndex;
            const g = masterData.goals[goalIndex];
            if (!g) return;

            // --- FIX: Re-calculate contextData internally ---
            const context = g.company_context || 'ALL';
            let contextData = allCompanyData;

            if (context !== 'ALL') {
                contextData = allCompanyData.filter(u => getCompany(u[COL.id]) === context);
            }

            if (!g.division_weights) g.division_weights = {};
            if (!g.division_weights[divisionName]) {
                g.division_weights[divisionName] = { default_weight: Number(g.weight) || 0, managers: {} };
            }

            const cfg = g.division_weights[divisionName];
            const members = getDivisionMembers(contextData, divisionName);
            const managers = getDivisionManagers(members);

            document.getElementById('div-weight-title').innerText = `Division Weights — ${divisionName}`;
            document.getElementById('div-weight-sub').innerText = `Goal: ${g.title || 'Shared Objective'} • ${members.length} employees`;
            document.getElementById('div-weight-default').value = Number(cfg.default_weight ?? (Number(g.weight) || 0)).toFixed(2);

            const box = document.getElementById('div-weight-managers');
            box.innerHTML = managers.length
                ? managers.map(m => {
                    const current = (cfg.managers && cfg.managers[m.id] != null) ? Number(cfg.managers[m.id]) : Number(cfg.default_weight);
                    return `
          <div style="display:flex; gap:12px; align-items:center; padding:12px; border:1px solid #e5e7eb; border-radius:12px;">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.name} (${m.id})</div>
              <div style="color:#6b7280; font-size:0.85rem; margin-top:4px;">${m.lvl} • ${m.job}</div>
            </div>
            <div style="width:160px;">
              <div style="font-size:0.72rem; font-weight:800; color:#6b7280; text-transform:uppercase;">Override</div>
              <input data-mgr="${m.id}" type="number" step="0.01" min="0" max="1"
                     value="${Number(current).toFixed(2)}"
                     style="width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:10px; font-weight:800;">
            </div>
          </div>
        `;
                }).join('')
                : `<div style="color:#6b7280; padding:12px;">No managers detected in this division.</div>`;

            document.getElementById('div-weight-modal').classList.remove('hidden');
        }
        function saveDivisionWeights() {
            if (activeDivWeightGoalIndex == null) return;
            const g = masterData.goals[activeDivWeightGoalIndex];
            if (!g) return;

            // We stored divisionName in the title; safest: keep a hidden field if you prefer.
            const title = document.getElementById('div-weight-title').innerText;
            const divisionName = title.split('—').slice(1).join('—').trim();

            if (!divisionName) return;

            if (!g.division_weights) g.division_weights = {};
            if (!g.division_weights[divisionName]) g.division_weights[divisionName] = { default_weight: Number(g.weight) || 0, managers: {} };

            const cfg = g.division_weights[divisionName];

            const def = Number(document.getElementById('div-weight-default').value || 0);
            cfg.default_weight = def;

            // Save manager overrides
            cfg.managers = cfg.managers || {};
            document.querySelectorAll('#div-weight-managers input[data-mgr]').forEach(inp => {
                const id = inp.getAttribute('data-mgr');
                const val = Number(inp.value || def);

                // If override equals default, remove it (keeps data clean)
                if (Math.abs(val - def) < 0.0001) delete cfg.managers[id];
                else cfg.managers[id] = val;
            });

            cfg.updated_at = new Date().toISOString();

            // persist and rerender
            saveDraftToDB();
            renderMasterGoals();
            closeDivisionWeights();
            showToast("Division weights saved.", "success");
        }


        // Helper to add a Division or Chief ID to a specific Shared Goal
        // Helper to add a Division or Chief ID to a specific Shared Goal
        // Helper to add a Division, Chief, Company, or Global assignment to a specific Shared Goal
        function updateGoalAssignment(goalIndex, value) {
            if (!value) return;

            // Initialize array if missing
            if (!masterData.goals[goalIndex].assignments) {
                masterData.goals[goalIndex].assignments = [];
            }

            // Check if target already exists to prevent duplicates
            const exists = masterData.goals[goalIndex].assignments.find(a => a.target === value);

            if (!exists) {
                // 1. Update Local Memory
                masterData.goals[goalIndex].assignments.push({
                    target: value,
                    weight: 0
                });

                // 2. Update UI immediately (Instant feedback)
                renderMasterGoals();

                // 3. Save to DB in background
                saveDraftToDB();
            }
        }

        // Helper to remove an assignment when the 'X' is clicked
        function removeAssignment(goalIndex, assignIndex) {
            masterData.goals[goalIndex].assignments.splice(assignIndex, 1);
            saveDraftToDB();
            renderMasterGoals();
        }

        function addMasterGoal() {
            if (!masterData.goals) masterData.goals = [];
            masterData.goals.push({
                title: "New Shared Goal",
                weight: 0, // Added
                targets: ["", "", "", "", "", ""],
                assignments: [] // Added: list of Divisions or specific IDs
            });
            saveDraftToDB();
            renderMasterGoals();
        }
        function refreshGlobalAdminRating() {
            let totalScore = 0;
            let count = 0;

            (masterData.goals || []).forEach(g => {
                if (g.rating > 0) {
                    totalScore += Number(g.rating);
                    count++;
                }
            });

            const averageRating = count > 0 ? (totalScore / count) : 0;
            masterData.rating = averageRating;

            // Numerical element removed as per your request
            const labelEl = document.getElementById('global-calc-label');
            const noteEl = document.getElementById('global-calc-note');

            if (labelEl && noteEl) {
                let lbl = "PENDING";
                let lvlClass = "lvl-0";
                let note = "Ratings not yet fully processed.";

                if (averageRating >= 5.5) {
                    lbl = "ASTRONAUT"; lvlClass = "lvl-6";
                    note = "Exemplary performance. Company is leading market standards.";
                }
                else if (averageRating >= 4.5) {
                    lbl = "FLYER"; lvlClass = "lvl-5";
                    note = "Strong performance. Most targets exceeded significantly.";
                }
                else if (averageRating >= 3.5) {
                    lbl = "RUNNER"; lvlClass = "lvl-4";
                    note = "Healthy performance. Meeting all strategic organizational goals.";
                }
                else if (averageRating >= 2.5) {
                    lbl = "WALKER"; lvlClass = "lvl-3";
                    note = "Basic performance. Strategic objectives met with room for growth.";
                }
                else if (averageRating >= 1.5) {
                    lbl = "STAGNANT"; lvlClass = "lvl-2";
                    note = "Performance below expectations. Corrective action required.";
                }
                else if (averageRating > 0) {
                    lbl = "IDLE"; lvlClass = "lvl-1";
                    note = "Critical performance gaps identified across shared objectives.";
                }

                labelEl.innerText = lbl;
                labelEl.className = `badge-rating ${lvlClass}`;
                noteEl.innerText = note;
            }
        }
        async function saveMasterGoals() {
            showConfirm("Publish Shared Goals", "This will update goals for ALL employees. Proceed?", "Publish", "primary", async () => {
                showSaving();

                let myId = user[COL.id] || user['id'] || user['Employee Number'];
                if (myId) myId = myId.toString().trim();

                // 1. Prepare Data clean copy
                const payloadData = JSON.parse(JSON.stringify(masterData));

                // 2. SAVE LIVE VERSION FIRST (Critical Fix)
                const { error: settingsError } = await db.from('company_settings')
                    .upsert({ id: SHARED_GOALS_ID, data: payloadData });

                if (settingsError) {
                    console.error("Settings Save Error:", settingsError);
                    showToast("Error saving settings: " + settingsError.message, 'error');
                    document.getElementById('save-status').classList.remove('show');
                    return;
                }

                // 3. Optional RPC Call
                try {
                    await db.rpc('publish_goals', {
                        operator_id: myId,
                        new_goals: payloadData
                    });
                } catch (err) {
                    console.warn("RPC execution skipped or failed.");
                }

                // 4. WAIT & DELETE DRAFT
                await new Promise(r => setTimeout(r, 500));

                // Only delete draft if live save was successful
                const { error: deleteError } = await db.from('company_settings').delete().eq('id', 'shared_goals_draft');

                if (!deleteError) {
                    hasDraft = false;
                }

                // 5. RELOAD FROM DB (Source of Truth)
                // This stops the UI from showing empty data if the browser cache is stale
                const { data: verifyData } = await db.from('company_settings').select('data').eq('id', SHARED_GOALS_ID).single();

                if (verifyData && verifyData.data) {
                    masterData = Array.isArray(verifyData.data) ? { rating: 0, goals: verifyData.data } : verifyData.data;
                    loadAdminSharedGoals();
                }

                showSaved();
                showToast("Saved & Published Permanently!", 'success');
            });
        }
        // --- ADMIN PERMISSIONS ---
        async function loadAdminPerms() {
            const { data: admins, error } = await db.from('active_list').select('*').eq(COL.role, 'admin');
            const adminList = admins || [];
            const myRole = getRole(user);

            let h = `
        <div class="animate-in">
            <div class="card">
                <h3 style="margin:0 0 8px 0;">Grant Admin Access</h3>
                <p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:24px;">Enter an Employee ID to give them "Admin" rights.</p>
               
                <div style="display:flex; gap:12px; margin-bottom:32px;">
                    <input id="perm-id" class="login-input" style="margin:0;" placeholder="Employee ID (e.g. ZIQ...)">
                    <button class="btn btn-primary" onclick="grantAdmin()">Grant Access</button>
                </div>
               
                <h3 style="margin-bottom:16px;">Current Admins</h3>
                <div style="overflow-x:auto;">
                    <table class="report-table">
                        <thead><tr><th>Name</th><th>Job Title</th><th style="text-align:right">Action</th></tr></thead>
                        <tbody>
                            ${adminList.length > 0 ? adminList.map(a => {
                const isMaster = (a[COL.job] || "").trim() === MASTER_ADMIN_TITLE;
                return `<tr>
                                    <td style="font-weight:600;">${a[COL.name]} ${isMaster ? '<span style="color:var(--primary); font-size:0.7rem; font-weight:800; background:var(--primary-soft); padding:2px 6px; border-radius:4px; margin-left:8px;">MASTER</span>' : ''}</td>
                                    <td>${a[COL.job]}</td>
                                    <td style="text-align:right;">
                                        ${isMaster ? '<span style="color:var(--text-muted); font-size:0.8rem; font-style:italic;"><i class="fa-solid fa-lock"></i> Protected</span>' :
                        `<button class="btn btn-outline" style="color:var(--danger); border-color:#fee2e2; background:#fff1f2; padding:6px 12px; font-size:0.8rem;" onclick="revokeAdmin('${a[COL.id]}')"><i class="fa-solid fa-user-xmark"></i> Revoke</button>`}
                                    </td>
                                </tr>`;
            }).join('') : '<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:40px;">No admins found. Grant access to employees above.</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <div id="perm-msg" style="margin-top:16px; font-weight:600;"></div>
            </div>
        </div>`;
            document.getElementById('admin-content').innerHTML = h;
        }
        async function grantAdmin() {
            const id = document.getElementById('perm-id').value.trim();
            if (!id) return;
            // Check if exists
            const { data, error } = await db.from('active_list').select('*').eq(COL.id, id).single();
            if (!data) { showToast("User ID not found.", 'error'); return; }

            showConfirm("Grant Admin Access", `Make ${data[COL.name]} an Admin?`, "Grant Access", "primary", async () => {
                const { error: err2 } = await db.from('active_list').update({ [COL.role]: 'admin' }).eq(COL.id, id);
                if (err2) showToast(err2.message, 'error');
                else { showToast("Admin access granted", 'success'); loadAdminPerms(); }
            });
        }

        async function revokeAdmin(id) {
            showConfirm("Revoke Admin Access", "Remove Admin rights from this user?", "Revoke", "danger", async () => {
                const { error } = await db.from('active_list').update({ [COL.role]: null }).eq(COL.id, id);
                if (error) showToast(error.message, 'error');
                else { showToast("Admin access revoked", 'success'); loadAdminPerms(); }
            });
        }

        // --- KPI DASHBOARD ---
        let kpiChart1 = null, kpiChart2 = null, kpiChart3 = null;
        
        async function loadKPIDashboard() {
            if (allCompanyData.length === 0) { allCompanyData = await fetchAllData(); }
            
            const divs = [...new Set(allCompanyData.map(i => i[COL.div] || 'Unknown'))].sort().filter(d => d !== 'Unknown');
            
            let h = `
    <div class="animate-in">
        <!-- Filter Bar -->
        <div class="card" style="margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                <div style="display:flex; align-items:center; gap:16px;">
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Company</label>
                        <select id="kpi-comp" onchange="updateKPIDivisions(); calculateKPIs()" style="padding:8px 32px 8px 12px; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-weight:600;">
                            <option value="ALL">All Companies</option>
                            <option value="Zain Iraq">Zain Iraq</option>
                            <option value="Horizon">Horizon</option>
                            <option value="Next Generation">Next Generation</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Division</label>
                        <select id="kpi-div" onchange="calculateKPIs()" style="padding:8px 32px 8px 12px; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-weight:600; min-width:150px;">
                            <option value="ALL">All Divisions</option>
                            ${divs.map(d => `<option value="${d}">${d}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div style="display:flex; gap:12px;">
                    <button class="btn btn-outline" onclick="exportKPIReport()"><i class="fa-solid fa-file-excel" style="color:#10b981;"></i> &nbsp; Export Excel</button>
                    <button class="btn btn-primary" onclick="exportKPIPdf()"><i class="fa-solid fa-file-pdf"></i> &nbsp; Export PDF Report</button>
                </div>
            </div>
        </div>

        <!-- KPI Summary Cards -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom:24px;">
            <div class="card" style="text-align:center; padding:24px; border-left:4px solid var(--primary);">
                <div style="font-size:2.5rem; font-weight:800; color:var(--primary);" id="kpi-total-employees">--</div>
                <div style="font-size:0.85rem; color:var(--text-muted); font-weight:600; margin-top:8px;">Total Employees</div>
            </div>
            <div class="card" style="text-align:center; padding:24px; border-left:4px solid #10b981;">
                <div style="font-size:2.5rem; font-weight:800; color:#10b981;" id="kpi-completion-rate">--</div>
                <div style="font-size:0.85rem; color:var(--text-muted); font-weight:600; margin-top:8px;">Completion Rate</div>
            </div>
            <div class="card" style="text-align:center; padding:24px; border-left:4px solid #f59e0b;">
                <div style="font-size:2.5rem; font-weight:800; color:#f59e0b;" id="kpi-avg-score">--</div>
                <div style="font-size:0.85rem; color:var(--text-muted); font-weight:600; margin-top:8px;">Avg. Score</div>
            </div>
            <div class="card" style="text-align:center; padding:24px; border-left:4px solid var(--primary-dark);">
                <div style="font-size:2.5rem; font-weight:800; color:var(--primary-dark);" id="kpi-top-performers">--</div>
                <div style="font-size:0.85rem; color:var(--text-muted); font-weight:600; margin-top:8px;">Top Performers</div>
            </div>
            <div class="card" style="text-align:center; padding:24px; border-left:4px solid #ef4444;">
                <div style="font-size:2.5rem; font-weight:800; color:#ef4444;" id="kpi-needs-attention">--</div>
                <div style="font-size:0.85rem; color:var(--text-muted); font-weight:600; margin-top:8px;">Needs Attention</div>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="dash-grid" style="margin-bottom:24px;">
            <div class="card">
                <h3 style="margin:0 0 20px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-chart-pie" style="color:var(--primary); margin-right:8px;"></i>Rating Distribution</h3>
                <div style="height:300px;"><canvas id="kpi-chart-distribution"></canvas></div>
            </div>
            <div class="card">
                <h3 style="margin:0 0 20px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-building" style="color:#10b981; margin-right:8px;"></i>Performance by Division</h3>
                <div style="height:300px;"><canvas id="kpi-chart-division"></canvas></div>
            </div>
        </div>

        <!-- Status & Trend Row -->
        <div class="dash-grid" style="margin-bottom:24px;">
            <div class="card">
                <h3 style="margin:0 0 20px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-tasks" style="color:#f59e0b; margin-right:8px;"></i>Submission Status</h3>
                <div style="height:300px;"><canvas id="kpi-chart-status"></canvas></div>
            </div>
            <div class="card">
                <h3 style="margin:0 0 20px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-trophy" style="color:var(--primary-dark); margin-right:8px;"></i>Top 10 Performers</h3>
                <div style="max-height:300px; overflow-y:auto;">
                    <table class="report-table" style="margin:0;">
                        <thead><tr><th>Rank</th><th>Employee</th><th>Division</th><th>Score</th><th>Rating</th></tr></thead>
                        <tbody id="kpi-top-list"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Division Breakdown Table -->
        <div class="card">
            <h3 style="margin:0 0 20px 0; font-size:1rem; font-weight:700;"><i class="fa-solid fa-table" style="color:#3b82f6; margin-right:8px;"></i>Division Performance Summary</h3>
            <div style="overflow-x:auto;">
                <table class="report-table" style="margin:0;">
                    <thead>
                        <tr>
                            <th>Division</th>
                            <th>Employees</th>
                            <th>Completed</th>
                            <th>Avg Score</th>
                            <th>Top Rating</th>
                            <th>Completion %</th>
                        </tr>
                    </thead>
                    <tbody id="kpi-division-table"></tbody>
                </table>
            </div>
        </div>
    </div>`;
            
            document.getElementById('admin-content').innerHTML = h;
            calculateKPIs();
        }

        function updateKPIDivisions() {
            const selectedComp = document.getElementById('kpi-comp').value;
            let subset = allCompanyData;
            
            if (selectedComp !== 'ALL') {
                subset = allCompanyData.filter(u => getCompany(u[COL.id]) === selectedComp);
            }
            
            const divs = [...new Set(subset.map(i => i[COL.div] || 'Unknown'))].sort().filter(d => d !== 'Unknown');
            const divSelect = document.getElementById('kpi-div');
            divSelect.innerHTML = `<option value="ALL">All Divisions</option>` + divs.map(d => `<option value="${d}">${d}</option>`).join('');
        }

        function calculateKPIs() {
            const compFilter = document.getElementById('kpi-comp').value;
            const divFilter = document.getElementById('kpi-div').value;
            
            let subset = allCompanyData;
            
            if (compFilter !== 'ALL') {
                subset = subset.filter(u => getCompany(u[COL.id]) === compFilter);
            }
            if (divFilter !== 'ALL') {
                subset = subset.filter(u => (u[COL.div] || 'Unknown') === divFilter);
            }

            const globalRating = masterData.rating || 0;
            
            // Calculate scores for all employees
            const scoredEmployees = subset.map(u => {
                let userGoals = u[COL.goals];
                if (typeof userGoals === 'string') { 
                    try { userGoals = JSON.parse(userGoals); if (typeof userGoals === 'string') userGoals = JSON.parse(userGoals); } 
                    catch (e) { userGoals = [] } 
                }
                if (!Array.isArray(userGoals)) userGoals = [];
                
                let w = getW(u[COL.lvl], u[COL.job]);
                let sScore = globalRating * (w.s / 100);
                let iScore = 0;
                
                // FIXED: Scale goal weights to employee's individual allocation
                let totalWeight = 0;
                userGoals.forEach(g => totalWeight += (g.weight || 0));
                const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                
                userGoals.forEach(g => {
                    const scaledWeight = (g.weight || 0) * scaleFactor;
                    iScore += (g.rating || 0) * scaledWeight;
                });
                
                let total = sScore + iScore;
                
                let rating = "N/A";
                if (total >= 5.5) rating = "ASTRONAUT";
                else if (total >= 4.5) rating = "FLYER";
                else if (total >= 3.5) rating = "RUNNER";
                else if (total >= 2.5) rating = "WALKER";
                else if (total >= 1.5) rating = "STAGNANT";
                else if (total > 0) rating = "IDLE";
                
                return {
                    ...u,
                    calculatedScore: total,
                    calculatedRating: rating,
                    isCompleted: ['Submitted to HR', 'Approved', 'Published'].includes(u[COL.stat])
                };
            });

            // KPI Calculations
            const totalEmployees = scoredEmployees.length;
            const completedCount = scoredEmployees.filter(e => e.isCompleted).length;
            const completionRate = totalEmployees > 0 ? Math.round((completedCount / totalEmployees) * 100) : 0;
            const avgScore = totalEmployees > 0 ? (scoredEmployees.reduce((sum, e) => sum + e.calculatedScore, 0) / totalEmployees).toFixed(2) : 0;
            const topPerformers = scoredEmployees.filter(e => ['ASTRONAUT', 'FLYER'].includes(e.calculatedRating)).length;
            const needsAttention = scoredEmployees.filter(e => ['IDLE', 'STAGNANT'].includes(e.calculatedRating)).length;

            // Update KPI Cards
            document.getElementById('kpi-total-employees').textContent = totalEmployees;
            document.getElementById('kpi-completion-rate').textContent = completionRate + '%';
            document.getElementById('kpi-avg-score').textContent = avgScore;
            document.getElementById('kpi-top-performers').textContent = topPerformers;
            document.getElementById('kpi-needs-attention').textContent = needsAttention;

            // Rating Distribution Chart
            const dist = { IDLE: 0, STAGNANT: 0, WALKER: 0, RUNNER: 0, FLYER: 0, ASTRONAUT: 0 };
            scoredEmployees.forEach(e => { if (dist.hasOwnProperty(e.calculatedRating)) dist[e.calculatedRating]++; });
            
            if (kpiChart1) kpiChart1.destroy();
            kpiChart1 = new Chart(document.getElementById('kpi-chart-distribution'), {
                type: 'doughnut',
                data: {
                    labels: ['IDLE', 'STAGNANT', 'WALKER', 'RUNNER', 'FLYER', 'ASTRONAUT'],
                    datasets: [{
                        data: [dist.IDLE, dist.STAGNANT, dist.WALKER, dist.RUNNER, dist.FLYER, dist.ASTRONAUT],
                        backgroundColor: ['#94a3b8', '#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#0f766e'],
                        borderWidth: 0
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { padding: 15, usePointStyle: true } }
                    }
                }
            });

            // Division Performance Chart
            const divisionStats = {};
            scoredEmployees.forEach(e => {
                const div = e[COL.div] || 'Unknown';
                if (!divisionStats[div]) divisionStats[div] = { total: 0, scoreSum: 0, completed: 0 };
                divisionStats[div].total++;
                divisionStats[div].scoreSum += e.calculatedScore;
                if (e.isCompleted) divisionStats[div].completed++;
            });
            
            const divLabels = Object.keys(divisionStats).slice(0, 10);
            const divAvgScores = divLabels.map(d => (divisionStats[d].scoreSum / divisionStats[d].total).toFixed(2));
            
            if (kpiChart2) kpiChart2.destroy();
            kpiChart2 = new Chart(document.getElementById('kpi-chart-division'), {
                type: 'bar',
                data: {
                    labels: divLabels,
                    datasets: [{
                        label: 'Avg Score',
                        data: divAvgScores,
                        backgroundColor: '#0d9488',
                        borderRadius: 6
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { beginAtZero: true, max: 6, grid: { display: false } },
                        y: { grid: { display: false } }
                    }
                }
            });

            // Status Chart
            const statusCounts = { Draft: 0, 'Submitted to Manager': 0, 'Submitted to HR': 0, Approved: 0, Published: 0, Returned: 0 };
            scoredEmployees.forEach(e => {
                const st = e[COL.stat] || 'Draft';
                if (statusCounts.hasOwnProperty(st)) statusCounts[st]++;
                else statusCounts['Draft']++;
            });
            
            if (kpiChart3) kpiChart3.destroy();
            kpiChart3 = new Chart(document.getElementById('kpi-chart-status'), {
                type: 'pie',
                data: {
                    labels: Object.keys(statusCounts),
                    datasets: [{
                        data: Object.values(statusCounts),
                        backgroundColor: ['#94a3b8', '#f59e0b', '#3b82f6', '#10b981', '#0f766e', '#ef4444'],
                        borderWidth: 0
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right', labels: { padding: 15, usePointStyle: true } }
                    }
                }
            });

            // Top 10 Performers Table
            const top10 = [...scoredEmployees].sort((a, b) => b.calculatedScore - a.calculatedScore).slice(0, 10);
            document.getElementById('kpi-top-list').innerHTML = top10.map((e, i) => {
                const ratingClass = e.calculatedRating === 'ASTRONAUT' ? 'lvl-6' : e.calculatedRating === 'FLYER' ? 'lvl-5' : 
                                   e.calculatedRating === 'RUNNER' ? 'lvl-4' : e.calculatedRating === 'WALKER' ? 'lvl-3' : 
                                   e.calculatedRating === 'STAGNANT' ? 'lvl-2' : 'lvl-1';
                return `<tr>
                    <td style="font-weight:800; color:var(--primary);">#${i + 1}</td>
                    <td style="font-weight:600;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <a href="#" onclick="event.preventDefault(); loadEval('${e[COL.id]}', true);" 
                               style="color:var(--primary); text-decoration:none; cursor:pointer; transition: all 0.2s; flex:1;"
                               onmouseover="this.style.textDecoration='underline'"
                               onmouseout="this.style.textDecoration='none'"
                               title="Click to view scorecard">
                                ${e[COL.name] || '-'}
                            </a>
                            <button onclick="event.stopPropagation(); openScorecardInNewTab('${e[COL.id]}')" 
                                    class="btn-new-tab" 
                                    title="Open in new tab"
                                    style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 6px; border-radius:4px; transition:all 0.2s; font-size:0.8rem;"
                                    onmouseover="this.style.background='var(--primary-light)'; this.style.color='var(--primary)';"
                                    onmouseout="this.style.background='none'; this.style.color='var(--text-muted)';">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            </button>
                        </div>
                    </td>
                    <td style="color:var(--text-muted);">${e[COL.div] || '-'}</td>
                    <td style="font-weight:700;">${e.calculatedScore.toFixed(2)}</td>
                    <td><span class="badge-rating ${ratingClass}">${e.calculatedRating}</span></td>
                </tr>`;
            }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No data available</td></tr>';

            // Division Summary Table
            const divTableData = Object.entries(divisionStats).sort((a, b) => b[1].total - a[1].total);
            document.getElementById('kpi-division-table').innerHTML = divTableData.map(([div, stats]) => {
                const avg = (stats.scoreSum / stats.total).toFixed(2);
                const compPct = Math.round((stats.completed / stats.total) * 100);
                let topRating = 'N/A';
                if (parseFloat(avg) >= 5.5) topRating = 'ASTRONAUT';
                else if (parseFloat(avg) >= 4.5) topRating = 'FLYER';
                else if (parseFloat(avg) >= 3.5) topRating = 'RUNNER';
                else if (parseFloat(avg) >= 2.5) topRating = 'WALKER';
                else if (parseFloat(avg) >= 1.5) topRating = 'STAGNANT';
                else if (parseFloat(avg) > 0) topRating = 'IDLE';
                
                const ratingClass = topRating === 'ASTRONAUT' ? 'lvl-6' : topRating === 'FLYER' ? 'lvl-5' : 
                                   topRating === 'RUNNER' ? 'lvl-4' : topRating === 'WALKER' ? 'lvl-3' : 
                                   topRating === 'STAGNANT' ? 'lvl-2' : 'lvl-1';
                
                let progColor = compPct >= 80 ? '#10b981' : compPct >= 50 ? '#f59e0b' : '#ef4444';
                
                return `<tr>
                    <td style="font-weight:600;">${div}</td>
                    <td>${stats.total}</td>
                    <td>${stats.completed}</td>
                    <td style="font-weight:700;">${avg}</td>
                    <td><span class="badge-rating ${ratingClass}">${topRating}</span></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div class="prog-container" style="flex:1;">
                                <div class="prog-bar" style="width:${compPct}%; background:${progColor};"></div>
                            </div>
                            <span style="font-weight:600; min-width:40px;">${compPct}%</span>
                        </div>
                    </td>
                </tr>`;
            }).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No data available</td></tr>';
        }

        function exportKPIReport() {
            const compFilter = document.getElementById('kpi-comp').value;
            const divFilter = document.getElementById('kpi-div').value;
            
            let subset = allCompanyData;
            if (compFilter !== 'ALL') subset = subset.filter(u => getCompany(u[COL.id]) === compFilter);
            if (divFilter !== 'ALL') subset = subset.filter(u => (u[COL.div] || 'Unknown') === divFilter);
            
            if (subset.length === 0) { showToast("No data to export.", 'error'); return; }
            
            const globalRating = masterData.rating || 0;
            
            const rows = subset.map(u => {
                let userGoals = u[COL.goals];
                if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); if (typeof userGoals === 'string') userGoals = JSON.parse(userGoals); } catch (e) { userGoals = [] } }
                if (!Array.isArray(userGoals)) userGoals = [];
                
                let w = getW(u[COL.lvl], u[COL.job]);
                let sScore = globalRating * (w.s / 100);
                let iScore = 0;
                
                // FIXED: Scale goal weights to employee's individual allocation
                let totalWeight = 0;
                userGoals.forEach(g => totalWeight += (g.weight || 0));
                const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                
                userGoals.forEach(g => {
                    const scaledWeight = (g.weight || 0) * scaleFactor;
                    iScore += (g.rating || 0) * scaledWeight;
                });
                
                let total = sScore + iScore;
                
                let rating = "N/A";
                if (total >= 5.5) rating = "ASTRONAUT";
                else if (total >= 4.5) rating = "FLYER";
                else if (total >= 3.5) rating = "RUNNER";
                else if (total >= 2.5) rating = "WALKER";
                else if (total >= 1.5) rating = "STAGNANT";
                else if (total > 0) rating = "IDLE";
                
                return {
                    "Employee ID": u[COL.id],
                    "Name": u[COL.name],
                    "Company": getCompany(u[COL.id]),
                    "Division": u[COL.div] || "-",
                    "Department": u[COL.dept] || "-",
                    "Job Title": u[COL.job] || "-",
                    "Supervisor": u[COL.mgr] || "-",
                    "Status": u[COL.stat] || "Draft",
                    "Shared Weight": w.s + "%",
                    "Individual Weight": w.i + "%",
                    "Total Score": total.toFixed(2),
                    "Rating": rating
                };
            });
            
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "KPI Report");
            XLSX.writeFile(wb, `KPI_Dashboard_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
            showToast('Excel report downloaded!', 'success');
        }

        async function exportKPIPdf() {
            if (typeof html2pdf === 'undefined') {
                showToast('PDF library not loaded. Please refresh and try again.', 'error');
                return;
            }
            
            showToast('Generating PDF report...', 'info');
            
            const compFilter = document.getElementById('kpi-comp').value;
            const divFilter = document.getElementById('kpi-div').value;
            
            // Get current KPI values
            const totalEmp = document.getElementById('kpi-total-employees').textContent;
            const completionRate = document.getElementById('kpi-completion-rate').textContent;
            const avgScore = document.getElementById('kpi-avg-score').textContent;
            const topPerf = document.getElementById('kpi-top-performers').textContent;
            const needsAtt = document.getElementById('kpi-needs-attention').textContent;
            
            // Create PDF content
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'padding: 30px; background: white; color: #1e293b; font-family: Inter, sans-serif; max-width: 800px;';
            
            wrapper.innerHTML = `
                <div style="text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid var(--primary);">
                    <h1 style="margin: 0; font-size: 28px; color: var(--primary); font-weight: 800;">KPI Dashboard Report</h1>
                    <p style="margin: 10px 0 0; font-size: 14px; color: #64748b;">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    <p style="margin: 5px 0 0; font-size: 12px; color: #94a3b8;">Company: ${compFilter} | Division: ${divFilter}</p>
                </div>
                
                <h2 style="font-size: 18px; color: #1e293b; margin: 0 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb;">Executive Summary</h2>
                
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 30px;">
                    <div style="text-align: center; padding: 20px; background: #f8fafc; border-radius: 12px; border-left: 4px solid var(--primary);">
                        <div style="font-size: 28px; font-weight: 800; color: var(--primary);">${totalEmp}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 5px;">Total Employees</div>
                    </div>
                    <div style="text-align: center; padding: 20px; background: #f8fafc; border-radius: 12px; border-left: 4px solid #10b981;">
                        <div style="font-size: 28px; font-weight: 800; color: #10b981;">${completionRate}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 5px;">Completion Rate</div>
                    </div>
                    <div style="text-align: center; padding: 20px; background: #f8fafc; border-radius: 12px; border-left: 4px solid #f59e0b;">
                        <div style="font-size: 28px; font-weight: 800; color: #f59e0b;">${avgScore}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 5px;">Avg. Score</div>
                    </div>
                    <div style="text-align: center; padding: 20px; background: #f8fafc; border-radius: 12px; border-left: 4px solid var(--primary-dark);">
                        <div style="font-size: 28px; font-weight: 800; color: var(--primary-dark);">${topPerf}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 5px;">Top Performers</div>
                    </div>
                    <div style="text-align: center; padding: 20px; background: #f8fafc; border-radius: 12px; border-left: 4px solid #ef4444;">
                        <div style="font-size: 28px; font-weight: 800; color: #ef4444;">${needsAtt}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 5px;">Needs Attention</div>
                    </div>
                </div>
                
                <h2 style="font-size: 18px; color: #1e293b; margin: 30px 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb;">Top 10 Performers</h2>
                ${document.getElementById('kpi-top-list').parentElement.outerHTML}
                
                <h2 style="font-size: 18px; color: #1e293b; margin: 30px 0 20px 0; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb;">Division Performance Summary</h2>
                ${document.getElementById('kpi-division-table').parentElement.outerHTML}
                
                <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8;">
                    Zain Iraq Performance Management System © ${new Date().getFullYear()} | Confidential
                </div>
            `;
            
            const opt = {
                margin: [15, 15, 15, 15],
                filename: `KPI_Dashboard_Report_${new Date().toISOString().split('T')[0]}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
            };
            
            try {
                await html2pdf().set(opt).from(wrapper).save();
                showToast('PDF report downloaded!', 'success');
            } catch (e) {
                console.error('PDF export error:', e);
                showToast('Failed to generate PDF.', 'error');
            }
        }

        // --- ANALYTICS ---
        async function loadAdminAnalytics() {
            if (allCompanyData.length === 0) { allCompanyData = await fetchAllData(); }
            const divs = [...new Set(allCompanyData.map(i => i[COL.div] || 'Unknown'))].sort().filter(d => d !== 'Unknown');
            
            // Get all Chiefs (L1 level ONLY)
            const chiefs = allCompanyData
                .filter(u => {
                    const l = (u[COL.lvl] || "").toString().trim().toUpperCase();
                    return l === 'L1';
                })
                .sort((a, b) => (a[COL.name] || "").localeCompare(b[COL.name] || ""));
            
            let h = `
    <div class="animate-in">
        <div class="card" style="margin-bottom:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Company</label>
                        <select id="anl-comp" onchange="updateDivisionsAndChiefs(); calcAdminStats()" style="padding:8px 32px 8px 12px; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-weight:600;">
                            <option value="ALL">All Companies</option>
                            <option value="Zain Iraq">Zain Iraq</option>
                            <option value="Horizon">Horizon</option>
                            <option value="Next Generation">Next Generation</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Division</label>
                        <select id="anl-filter" onchange="calcAdminStats()" style="padding:8px 32px 8px 12px; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-weight:600; min-width:150px;">
                            <option value="ALL">All Divisions</option>
                            ${divs.map(d => `<option value="${d}">${d}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; display:block;">Chief (L1)</label>
                        <select id="anl-chief" onchange="calcAdminStats()" style="padding:8px 32px 8px 12px; border-radius:8px; border:1px solid var(--border); font-family:inherit; font-weight:600; min-width:180px;">
                            <option value="ALL">All Chiefs</option>
                            ${chiefs.map(c => `<option value="${c[COL.id]}">${c[COL.name]}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div style="height:40px; width:1px; background:var(--border);"></div>

                <button class="btn btn-outline" onclick="downloadAdminReport()"><i class="fa-solid fa-file-excel" style="color:#10b981;"></i> &nbsp; Export Report</button>
            </div>
        </div>

        <div class="dash-grid">
            <div class="card">
                <h3 style="text-align:center; margin:0 0 24px 0; font-size:1rem; font-weight:700;">Rating Distribution (Live)</h3>
                <div style="height:350px;"><canvas id="chartAdmin"></canvas></div>
            </div>
            <div class="card">
                <h3 style="margin:0 0 24px 0; font-size:1rem; font-weight:700;">Manager Completion Tracker</h3>
                <div style="max-height:350px; overflow-y:auto;">
                    <table class="report-table">
                        <thead><tr><th>Manager</th><th>Completed</th><th>Progress</th></tr></thead>
                        <tbody id="mgr-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>`;
            document.getElementById('admin-content').innerHTML = h;
            calcAdminStats();
        }
        function updateDivisionsAndChiefs() {
            const selectedComp = document.getElementById('anl-comp').value;
            let subset = allCompanyData;

            if (selectedComp !== 'ALL') {
                subset = allCompanyData.filter(u => getCompany(u[COL.id]) === selectedComp);
            }

            // Update Divisions dropdown
            const divs = [...new Set(subset.map(i => i[COL.div] || 'Unknown'))].sort().filter(d => d !== 'Unknown');
            const divSelect = document.getElementById('anl-filter');
            divSelect.innerHTML = `<option value="ALL">All Divisions</option>` + divs.map(d => `<option value="${d}">${d}</option>`).join('');
            
            // Update Chiefs dropdown - L1 ONLY, filtered by company
            const chiefs = subset
                .filter(u => {
                    const l = (u[COL.lvl] || "").toString().trim().toUpperCase();
                    return l === 'L1';
                })
                .sort((a, b) => (a[COL.name] || "").localeCompare(b[COL.name] || ""));
            
            const chiefSelect = document.getElementById('anl-chief');
            if (chiefSelect) {
                chiefSelect.innerHTML = `<option value="ALL">All Chiefs</option>` + chiefs.map(c => `<option value="${c[COL.id]}">${c[COL.name]}</option>`).join('');
            }
        }
        
        // Keep old function name for backward compatibility
        function updateDivisions() {
            updateDivisionsAndChiefs();
        }

        function downloadAdminReport() {
            const compFilter = document.getElementById('anl-comp').value;
            const divFilter = document.getElementById('anl-filter').value;
            const chiefFilter = document.getElementById('anl-chief') ? document.getElementById('anl-chief').value : 'ALL';

            let subset = allCompanyData;

            if (compFilter !== 'ALL') {
                subset = subset.filter(u => getCompany(u[COL.id]) === compFilter);
            }
            if (divFilter !== 'ALL') {
                subset = subset.filter(u => (u[COL.div] || 'Unknown') === divFilter);
            }
            
            // Filter by Chief - get all downstream employees under selected Chief
            if (chiefFilter !== 'ALL') {
                const chiefDownstream = getDownstream(chiefFilter, allCompanyData);
                const downstreamIds = new Set(chiefDownstream.map(u => u[COL.id]));
                subset = subset.filter(u => downstreamIds.has(u[COL.id]) || u[COL.id] === chiefFilter);
            }

            if (subset.length === 0) { alert("No data to export."); return; }

            const globalRating = masterData.rating || 0;

            const rows = subset.map(u => {
                let userGoals = u[COL.goals];
                if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); if (typeof userGoals === 'string') userGoals = JSON.parse(userGoals); } catch (e) { userGoals = [] } }
                if (!Array.isArray(userGoals)) userGoals = [];

                let w = getW(u[COL.lvl], u[COL.job]);
                let sScore = globalRating * (w.s / 100);
                let iScore = 0;
                
                // FIXED: Scale goal weights to employee's individual allocation
                let totalWeight = 0;
                userGoals.forEach(g => totalWeight += (g.weight || 0));
                const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                
                userGoals.forEach(g => {
                    const scaledWeight = (g.weight || 0) * scaleFactor;
                    iScore += (g.rating || 0) * scaledWeight;
                });

                let total = sScore + iScore;

                let lbl = "-";
                if (total >= 5.5) lbl = "ASTRONAUT";
                else if (total >= 4.5) lbl = "FLYER";
                else if (total >= 3.5) lbl = "RUNNER";
                else if (total >= 2.5) lbl = "WALKER";
                else if (total >= 1.5) lbl = "STAGNANT";
                else if (total > 0) lbl = "IDLE";

                return {
                    "Employee ID": u[COL.id],
                    "Name": u[COL.name],
                    "Company": getCompany(u[COL.id]),
                    "Division": u[COL.div] || "-",
                    "Department": u[COL.dept] || "-",
                    "Supervisor": u[COL.mgr] || "-",
                    "Status": u[COL.stat] || "Draft",
                    "Total Score": total.toFixed(2),
                    "Rating": lbl
                };
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Evaluation Report");
            XLSX.writeFile(wb, `Zain_PMS_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
        }

        function calcAdminStats() {
            const compFilter = document.getElementById('anl-comp').value;
            const divFilter = document.getElementById('anl-filter').value;
            const chiefFilter = document.getElementById('anl-chief') ? document.getElementById('anl-chief').value : 'ALL';

            let subset = allCompanyData;

            if (compFilter !== 'ALL') {
                subset = subset.filter(u => getCompany(u[COL.id]) === compFilter);
            }

            if (divFilter !== 'ALL') {
                subset = subset.filter(u => (u[COL.div] || 'Unknown') === divFilter);
            }
            
            // Filter by Chief - get all downstream employees under selected Chief
            if (chiefFilter !== 'ALL') {
                const chiefDownstream = getDownstream(chiefFilter, allCompanyData);
                const downstreamIds = new Set(chiefDownstream.map(u => u[COL.id]));
                subset = subset.filter(u => downstreamIds.has(u[COL.id]) || u[COL.id] === chiefFilter);
            }

            let dist = [0, 0, 0, 0, 0, 0];
            const globalRating = masterData.rating || 0;

            subset.forEach(u => {
                let userGoals = u[COL.goals];
                if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); if (typeof userGoals === 'string') userGoals = JSON.parse(userGoals); } catch (e) { userGoals = [] } }
                if (!Array.isArray(userGoals)) userGoals = [];
                let w = getW(u[COL.lvl], u[COL.job]);
                let sScore = globalRating * (w.s / 100);
                let iScore = 0;
                
                // FIXED: Scale goal weights to employee's individual allocation
                let totalWeight = 0;
                userGoals.forEach(g => totalWeight += (g.weight || 0));
                const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                
                userGoals.forEach(g => {
                    const scaledWeight = (g.weight || 0) * scaleFactor;
                    iScore += (g.rating || 0) * scaledWeight;
                });
                
                let total = sScore + iScore;
                let b = 0; if (total >= 5.5) b = 5; else if (total >= 4.5) b = 4; else if (total >= 3.5) b = 3; else if (total >= 2.5) b = 2; else if (total >= 1.5) b = 1;
                dist[b]++;
            });

            if (chartAdmin) chartAdmin.destroy();
            chartAdmin = new Chart(document.getElementById('chartAdmin'), { type: 'bar', data: { labels: ["IDLE", "STAGNANT", "WALKER", "RUNNER", "FLYER", "ASTRONAUT"], datasets: [{ label: 'Employees', data: dist, backgroundColor: '#0f766e', borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } } } });

            let mgrs = {};
            subset.forEach(u => {
                const mId = u[COL.mgr];
                if (mId) {
                    if (!mgrs[mId]) { const mObj = allCompanyData.find(x => x[COL.id] == mId); mgrs[mId] = { name: mObj ? mObj[COL.name] : mId, total: 0, done: 0 }; }
                    mgrs[mId].total++;
                    if (u[COL.stat] === 'Submitted to HR' || u[COL.stat] === 'Approved') mgrs[mId].done++;
                }
            });
            let mgrArr = Object.values(mgrs).sort((a, b) => (a.done / a.total) - (b.done / b.total));
            document.getElementById('mgr-tbody').innerHTML = mgrArr.map(m => {
                const pct = Math.round((m.done / m.total) * 100);
                let color = '#ef4444'; if (pct > 50) color = '#f59e0b'; if (pct === 100) color = '#10b981';
                return `<tr><td style="font-weight:600; font-size:0.85rem;">${m.name}</td><td style="font-size:0.85rem;">${m.done} / ${m.total}</td><td style="vertical-align:middle;"><div class="prog-container"><div class="prog-bar" style="width:${pct}%; background:${color};"></div></div></td></tr>`;
            }).join('') || '<tr><td colspan="3" style="text-align:center;">No data</td></tr>';
        }

        async function loadAdminApprovals() {
            // Fetch all records waiting for HR (Admin) approval
            const { data, error } = await db.from('active_list')
                .select('*')
                .eq(COL.stat, 'Submitted to HR');

            if (error) {
                showToast("Error fetching approvals: " + error.message, 'error');
                return;
            }

            adminCache = data || [];
            const divs = [...new Set(adminCache.map(i => i[COL.div] || 'Other'))].sort();

            let h = `
    <div class="animate-in">
        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <div style="display:flex; gap:16px; align-items:center;">
                    <h3 style="margin:0; font-size:1.2rem; font-weight:700;">
                        Pending Approvals <span class="badge-count">${adminCache.length}</span>
                    </h3>
                    <select id="div-filter" onchange="filterAdminTable()" class="login-input" style="margin:0; width:200px;">
                        <option value="ALL">All Divisions</option>
                        ${divs.map(d => `<option value="${d}">${d}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-primary" onclick="approveBulk()">
                    <i class="fa-solid fa-check-double"></i> &nbsp; Approve All Visible
                </button>
            </div>
            <div style="overflow-x:auto;">
                <table class="report-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Division</th>
                            <th>Job Title</th>
                            <th>Manager</th>
                            <th style="text-align:right">Action</th>
                        </tr>
                    </thead>
                    <tbody id="admin-tbody"></tbody>
                </table>
            </div>
        </div>
    </div>`;

            document.getElementById('admin-content').innerHTML = h;
            filterAdminTable();
        }
        function filterAdminTable() {
            const sFilter = document.getElementById('status-filter').value;
            const dFilter = document.getElementById('div-filter').value;
            const tbody = document.getElementById('admin-tbody');

            if (!tbody) return;

            // --- FILTER LOGIC ---
            const visible = adminCache.filter(r => {
                const stat = r[COL.stat] || '';

                // 1. Division Match
                const divMatch = (dFilter === 'ALL' || (r[COL.div] || 'Other') === dFilter);
                if (!divMatch) return false;

                // 2. Status Match
                if (sFilter === 'ALL') return true;
                if (sFilter === 'ACTION') return stat === 'Submitted to HR'; // Only things needing attention
                return stat === sFilter;
            });

            if (visible.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:60px; color:var(--text-muted); font-style:italic;">No records found for this filter.</td></tr>`;
                return;
            }

            tbody.innerHTML = visible.map(r => {
                const status = r[COL.stat];
                let buttons = '';
                let rowClass = '';

                // --- DYNAMIC BUTTONS BASED ON STATUS ---

                if (status === 'Submitted to HR') {
                    // Stage 1: Needs Approval
                    buttons = `
                <button onclick="rejectToManager('${r[COL.id]}')" class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem; color:#ef4444; border-color:#fee2e2;">Reject</button>
                <button onclick="approveSingle('${r[COL.id]}')" class="btn btn-primary" style="padding:6px 12px; font-size:0.75rem;">Approve</button>
            `;
                }
                else if (status === 'Approved') {
                    // Stage 2: Ready to Publish
                    rowClass = 'background:#f0fdf4;'; // Light green tint
                    buttons = `
                <button onclick="rejectToManager('${r[COL.id]}')" class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem; color:#ef4444; border-color:#fee2e2;">Reject</button>
                <button onclick="publishSingle('${r[COL.id]}')" class="btn btn-primary" style="padding:6px 12px; font-size:0.75rem; background:#10b981; border-color:#10b981;">Publish</button>
            `;
                }
                else if (status === 'Published') {
                    // Stage 3: History (Can be reverted)
                    rowClass = 'opacity: 0.8;';
                    buttons = `
                <button onclick="unpublishSingle('${r[COL.id]}')" class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem; color:#f59e0b; border-color:#fef3c7;">
                    <i class="fa-solid fa-rotate-left"></i> Unpublish
                </button>
                <button onclick="loadEval('${r[COL.id]}', true)" class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;">View</button>
                <button onclick="event.stopPropagation(); openScorecardInNewTab('${r[COL.id]}')" class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" title="Open in new tab">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </button>
            `;
                }

                return `
        <tr style="border-bottom:1px solid var(--border); transition:all 0.2s; ${rowClass}">
            <td style="padding:16px 24px;">
                <div style="font-weight:700; color:var(--text-main);">${r[COL.name]}</div>
                <div style="font-size:0.8rem; color:var(--text-muted); font-family:monospace;">${r[COL.id]}</div>
            </td>
            <td style="padding:16px 24px;">
                <span class="status-badge ${status === 'Published' ? 'approved' : (status === 'Approved' ? 'submitted' : 'draft')}" 
                      style="${status === 'Approved' ? 'background:#d1fae5; color:#065f46;' : ''}">
                    ${status === 'Approved' ? 'Ready to Publish' : status}
                </span>
            </td>
            <td style="padding:16px 24px;">${r[COL.div] || '-'}</td>
            <td style="padding:16px 24px;">${(r[COL.mgr] || '-').split('(')[0]}</td>
            <td style="padding:16px 24px; text-align:right;">
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    ${buttons}
                </div>
            </td>
        </tr>`;
            }).join('');
        }
        async function loadAdminSearch() {
            if (allCompanyData.length === 0) allCompanyData = await fetchAllData();
            document.getElementById('admin-content').innerHTML = `
    <div class="animate-in">
        <div class="card" style="max-width:600px; margin:0 auto; padding:32px;">
            <div style="text-align:center; margin-bottom:24px;">
                <h3 style="font-size:1.5rem; margin-bottom:8px;">Global Employee Search</h3>
                <p style="color:var(--text-muted);">Access any employee's scorecard in read-only mode.</p>
            </div>
           
            <div style="display:flex; gap:12px; margin-bottom:32px;">
                <input id="search-q" class="login-input" style="margin:0;" placeholder="Enter Name or Employee ID..." onkeypress="if(event.key==='Enter') doGlobalSearch()">
                <button class="btn btn-primary" onclick="doGlobalSearch()"><i class="fa-solid fa-magnifying-glass"></i> &nbsp; Search</button>
            </div>
           
            <div id="search-results"></div>
        </div>
    </div>`;
        }

        async function doGlobalSearch() {
            const q = document.getElementById('search-q').value.trim().toLowerCase();
            if (!q) {
                showToast("Please enter an Employee ID or Name to search", "error");
                return;
            }
            
            const results = allCompanyData.filter(r =>
                (r[COL.id] && r[COL.id].toLowerCase().includes(q)) ||
                (r[COL.name] && r[COL.name].toLowerCase().includes(q))
            ).slice(0, 10);

            if (results.length === 0) {
                document.getElementById('search-results').innerHTML = `
                    <div style="padding:40px; text-align:center; color:var(--text-muted);">
                        <i class="fa-solid fa-user-slash" style="font-size:2.5rem; opacity:0.3; margin-bottom:16px; display:block;"></i>
                        <div style="font-weight:600; margin-bottom:8px;">No Employee Found</div>
                        <div style="font-size:0.85rem;">No results matching "<strong>${escapeHTML(q)}</strong>". Please check the ID or name and try again.</div>
                    </div>`;
                showToast("Employee ID or Name not found", "error");
                return;
            }

            document.getElementById('search-results').innerHTML = results.map(r => {
                const status = r[COL.stat] || 'Draft';
                const statusClass = status === 'Published' ? 'approved' : (status === 'Draft' ? 'draft' : 'submitted');
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border);">
                    <div>
                        <div style="font-weight:700;">${escapeHTML(r[COL.name])}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">${escapeHTML(r[COL.id])} | ${escapeHTML(r[COL.job] || 'Staff')}</div>
                        <div style="margin-top:4px;"><span class="status-badge ${statusClass}" style="font-size:0.7rem;">${escapeHTML(status)}</span></div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn btn-primary" style="font-size:0.8rem; padding:6px 12px;" onclick="loadEval('${escapeHTML(r[COL.id])}', true)">
                            <i class="fa-solid fa-eye"></i> &nbsp; View
                        </button>
                        <button class="btn btn-outline" style="padding:6px 12px;" onclick="event.stopPropagation(); openScorecardInNewTab('${escapeHTML(r[COL.id])}')" title="Open in new tab">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');
        }

        async function approveSingle(id) {
            if (!id) return;
            showSaving();

            try {
                // Prepare secure payload including ID
                const payload = {
                    [COL.id]: id,
                    [COL.stat]: 'Approved'
                };

                // Use UPSERT to ensure the ID is sent in the body for the PHP backend
                const { error } = await db.from('active_list').upsert(payload);

                if (error) throw new Error(error.message || "Unauthorized");

                showToast("Approved (Ready to Publish)", 'success');

                // Update the local cache so the UI updates without a full reload
                const item = adminCache.find(x => x[COL.id].toString() === id.toString());
                if (item) item[COL.stat] = 'Approved';

                // Refresh the table view
                filterAdminTable();

            } catch (err) {
                console.error("Approval Error:", err);
                showToast("Approval Failed: " + err.message, 'error');
            } finally {
                showSaved();
            }
        }
        async function approveBulk() {
            const ids = adminCache
                .filter(u => u[COL.stat] === 'Submitted to HR')
                .map(u => u[COL.id]);

            if (ids.length === 0) {
                showToast("No pending requests to approve.", "info");
                return;
            }

            if (!confirm(`Approve ${ids.length} requests?`)) return;

            showSaving();

            try {
                // We must process these in a loop or a specialized batch upsert 
                // to ensure each record includes its own ID for the PHP backend.
                const promises = ids.map(id => {
                    return db.from('active_list').upsert({
                        [COL.id]: id,
                        [COL.stat]: 'Approved'
                    });
                });

                const results = await Promise.all(promises);
                const errors = results.filter(r => r.error);

                if (errors.length > 0) {
                    throw new Error(`${errors.length} items failed to update.`);
                }

                showToast("Bulk Approved successfully", 'success');

                // Update local cache manually
                adminCache.forEach(u => {
                    if (ids.includes(u[COL.id])) u[COL.stat] = 'Approved';
                });

                filterAdminTable();

            } catch (err) {
                console.error("Bulk Approval Error:", err);
                showToast("Bulk Update Failed: " + err.message, 'error');
            } finally {
                showSaved();
            }
        }
        async function publishSingle(id) {
            if (!id) return;
            showConfirm("Publish Scorecard", "This will make the score visible to the employee. Proceed?", "Publish", "success", async () => {
                showSaving();

                try {
                    // --- FIX: ALWAYS INCLUDE THE ID ---
                    const payload = {
                        [COL.id]: id,
                        [COL.stat]: 'Published'
                    };

                    const { error } = await db.from('active_list').upsert(payload);

                    if (error) throw new Error(error.message || "Unauthorized");

                    showToast("Scorecard Published!", 'success');

                    // Remove from local queue so UI updates immediately
                    if (typeof adminCache !== 'undefined') {
                        adminCache = adminCache.filter(u => u[COL.id].toString() !== id.toString());
                        if (typeof filterAdminTable === 'function') filterAdminTable();
                    }

                    // Sync database state by reloading
                    setTimeout(() => location.reload(), 1000);

                } catch (err) {
                    console.error("Publish Error:", err);
                    showToast("Publish Failed: " + err.message, 'error');
                } finally {
                    showSaved();
                }
            });
        }
        async function publishBulk() {
            const ids = adminCache.filter(u => u[COL.stat] === 'Approved').map(u => u[COL.id]);
            if (ids.length === 0) { showToast("No approved items ready to publish.", "info"); return; }

            if (!confirm(`Publish ${ids.length} scorecards?`)) return;

            showSaving();

            try {
                // Loop through IDs to ensure each payload contains the ID for backend permission check
                const promises = ids.map(id => {
                    return db.from('active_list').upsert({
                        [COL.id]: id,
                        [COL.stat]: 'Published'
                    });
                });

                const results = await Promise.all(promises);
                const errors = results.filter(r => r.error);

                if (errors.length > 0) throw new Error(`${errors.length} items failed.`);

                showToast("Bulk Published successfully", 'success');

                // Refresh local cache and UI
                adminCache = adminCache.filter(u => !ids.includes(u[COL.id]));
                if (typeof filterAdminTable === 'function') filterAdminTable();

                setTimeout(() => location.reload(), 1000);

            } catch (err) {
                console.error("Bulk Publish Error:", err);
                showToast("Bulk Publish Failed: " + err.message, 'error');
            } finally {
                showSaved();
            }
        }
        function refreshLocalData(id, newStatus) {
            const item = adminCache.find(x => x[COL.id] == id);
            if (item) {
                item[COL.stat] = newStatus;
                filterAdminTable();
            }
        }
        async function unpublishSingle(id) {
            if (!id) return;
            showConfirm("Unpublish Scorecard?", "This will hide the score from the employee. Proceed?", "Unpublish", "warning", async () => {
                showSaving();

                try {
                    const payload = {
                        [COL.id]: id,
                        [COL.stat]: 'Approved'
                    };

                    const { error } = await db.from('active_list').upsert(payload);

                    if (error) throw new Error(error.message || "Unauthorized");

                    showToast("Scorecard Unpublished.", 'success');

                    // Update local state
                    const item = adminCache.find(x => x[COL.id].toString() === id.toString());
                    if (item) item[COL.stat] = 'Approved';

                    if (typeof filterAdminTable === 'function') filterAdminTable();

                    setTimeout(() => location.reload(), 1000);

                } catch (err) {
                    console.error("Unpublish Error:", err);
                    showToast("Unpublish Failed: " + err.message, 'error');
                } finally {
                    showSaved();
                }
            });
        }
        // --- 7. REPORTS ---
        // --- 7. REPORTS (UPDATED FOR REAL-TIME AUTO-CALCULATION) ---
        async function loadReports() {
            // SPEED OPTIMIZATION: Use cached data first for instant render
            const hasCachedData = allCompanyData && allCompanyData.length > 0;
            
            if (!hasCachedData) {
                // Show loading only if we don't have cached data
                document.getElementById('main-view').innerHTML = `
            <div style="height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; color:var(--text-muted);">
                <div class="spinner" style="border-width:3px; width:30px; height:30px;"></div>
                <div style="margin-top:10px; font-weight:600; font-size:0.9rem;">Syncing latest data...</div>
            </div>`;

                try {
                    allCompanyData = await fetchAllData();
                } catch (e) {
                    console.error(e);
                }
            }

            // SAFE ACCESS: Check if user and the specific ID column exist before calling .toString()
            const myRawId = user && user[COL.id] ? user[COL.id] : "";
            const myId = myRawId.toString().toLowerCase();

            const myRawName = user && user[COL.name] ? user[COL.name] : "";
            const myName = myRawName.toString().toLowerCase();

            let directReports = allCompanyData.filter(u => {
                // Safe check for manager data
                const mRaw = u[COL.mgr] || "";
                const m = mRaw.toString().toLowerCase();
                return m.includes(myId) || (myName.length > 3 && m.includes(myName));
            });
            if (!directReports || directReports.length === 0) {
                document.getElementById('main-view').innerHTML = `<div class="card" style="padding:40px; text-align:center;">No direct reports found.</div>`;
                return;
            }

            // 4. Calculate Org Data
            globalReports = getDownstream(user[COL.id], allCompanyData);

            // CCO Logic (Optional: Keep if needed)
            const myJob = (user[COL.job] || "").toUpperCase();
            if (myJob.includes('COMMERCIAL') || myJob.includes('CCO')) {
                globalReports = globalReports.filter(u => !((u[COL.div] || "").toUpperCase().includes('SECURITY')));
            }

            let showOrgChart = (globalReports.length > directReports.length);
            const globalRating = masterData.rating || 0;

            // --- CHART CALCULATION HELPER ---
            const calcDist = (list) => {
                let d = [0, 0, 0, 0, 0, 0];
                list.forEach(u => {
                    let userGoals = u[COL.goals] || [];
                    if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); } catch (e) { userGoals = [] } }
                    let w = getW(u[COL.lvl], u[COL.job]);
                    let sScore = globalRating * (w.s / 100);
                    let iScore = 0;
                    
                    // FIXED: Scale goal weights to employee's individual allocation
                    if (Array.isArray(userGoals)) {
                        let totalWeight = 0;
                        userGoals.forEach(g => totalWeight += (Number(g.weight) || 0));
                        const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                        
                        userGoals.forEach(g => {
                            const scaledWeight = (Number(g.weight) || 0) * scaleFactor;
                            iScore += (Number(g.rating) || 0) * scaledWeight;
                        });
                    }
                    
                    let total = sScore + iScore;
                    let b = 0;
                    if (total >= 5.5) b = 5; else if (total >= 4.5) b = 4; else if (total >= 3.5) b = 3; else if (total >= 2.5) b = 2; else if (total >= 1.5) b = 1;
                    d[b]++;
                });
                return d;
            };

            const distDirect = calcDist(directReports);
            let distOrg = showOrgChart ? calcDist(globalReports) : null;

            // --- NEW FILTER LOGIC START ---
            let filterHtml = "";
            if (showOrgChart) {
                // Initial Populations (All)
                const allDivs = [...new Set(globalReports.map(u => (u[COL.div] || "").trim()).filter(Boolean))].sort();

                // Initial Manager Map
                const mgrMap = new Map();
                globalReports.forEach(u => {
                    let rawM = (u[COL.mgr] || "").toString();
                    let match = allCompanyData.find(x => rawM.includes(x[COL.id]));
                    if (match) { if (!mgrMap.has(match[COL.id])) mgrMap.set(match[COL.id], match[COL.name]); }
                });
                const allMgrs = Array.from(mgrMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

                filterHtml = `
 <div style="display:flex; justify-content:flex-end; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
    <select id="org-filter-comp" onchange="cascadeFilters()" style="padding:8px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.8rem; background:#f9fafb; cursor:pointer; font-weight:700;">
        <option value="ALL">All Companies</option>
        <option value="Zain Iraq">Zain Iraq</option>
        <option value="Horizon">Horizon</option>
        <option value="Next Generation">Next Generation</option>
    </select>

    <select id="org-filter-div" onchange="cascadeFilters()" style="padding:8px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.8rem; background:#f9fafb; cursor:pointer;">
        <option value="ALL">All Divisions</option>
        ${allDivs.map(d => `<option value="${d}">${d}</option>`).join('')}
    </select>

    <select id="org-filter-mgr" onchange="updateOrgChart()" style="padding:8px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.8rem; max-width:200px; background:#f9fafb; cursor:pointer;">
        <option value="ALL">All Managers</option>
        ${allMgrs.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
    </select>
 </div>`;
            }
            // --- NEW FILTER LOGIC END ---

            // Build Table Rows
            // Build Table Rows with Color Highlights
            const scoredReports = directReports.map(u => {
                let userGoals = u[COL.goals] || [];
                if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); } catch (e) { userGoals = [] } }

                let w = getW(u[COL.lvl], u[COL.job]);
                let sScore = (masterData.rating || 0) * (w.s / 100);
                let iScore = 0;
                
                // FIXED: Scale goal weights to employee's individual allocation
                if (Array.isArray(userGoals)) {
                    let totalWeight = 0;
                    userGoals.forEach(g => totalWeight += (Number(g.weight) || 0));
                    const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                    
                    userGoals.forEach(g => {
                        const scaledWeight = (Number(g.weight) || 0) * scaleFactor;
                        iScore += (Number(g.rating) || 0) * scaledWeight;
                    });
                }

                let total = sScore + iScore;

                // Determine Level for Color
                let lvl = 0;
                let lbl = "IDLE";
                if (total >= 5.5) { lvl = 6; lbl = "ASTRONAUT"; }
                else if (total >= 4.5) { lvl = 5; lbl = "FLYER"; }
                else if (total >= 3.5) { lvl = 4; lbl = "RUNNER"; }
                else if (total >= 2.5) { lvl = 3; lbl = "WALKER"; }
                else if (total >= 1.5) { lvl = 2; lbl = "STAGNANT"; }
                else if (total > 0) { lvl = 1; lbl = "IDLE"; }

                return {
                    id: u[COL.id],
                    name: u[COL.name],
                    score: total.toFixed(2),
                    lvl: lvl,
                    label: lbl,
                    status: u[COL.stat] || 'Draft'
                };
            });

            scoredReports.sort((a, b) => b.score - a.score);

            // New HTML Rendering with dynamic classes
            let tableRows = scoredReports.map(r => `
    <tr>
        <td style="font-weight:600; color:var(--text-main);">
            <div style="display:flex; align-items:center; gap:8px;">
                <a href="#" onclick="event.preventDefault(); loadEval('${r.id}', true);" 
                   style="color:var(--primary); text-decoration:none; cursor:pointer; transition: all 0.2s; flex:1;"
                   onmouseover="this.style.textDecoration='underline'"
                   onmouseout="this.style.textDecoration='none'"
                   title="Click to view scorecard">
                    ${r.name}
                </a>
                <button onclick="event.stopPropagation(); openScorecardInNewTab('${r.id}')" 
                        class="btn-new-tab" 
                        title="Open in new tab"
                        style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px 6px; border-radius:4px; transition:all 0.2s; font-size:0.8rem;"
                        onmouseover="this.style.background='var(--primary-light)'; this.style.color='var(--primary)';"
                        onmouseout="this.style.background='none'; this.style.color='var(--text-muted)';">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </button>
            </div>
        </td>
        <td style="text-align:center;">
            <span class="badge-score lvl-${r.lvl}">${r.score}</span>
        </td>
        <td>
            <span class="badge-rating lvl-${r.lvl}">${r.label}</span>
        </td>
        <td style="text-align:right;">
            <span class="status-badge ${r.status === 'Approved' ? 'approved' : 'submitted'}">${r.status}</span>
        </td>
    </tr>
`).join('');

            let h = `
    <div class="animate-in">
        <div class="header-bar">
            <div><h2 class="page-title">Leadership Reports</h2></div>
            <button class="btn btn-primary" onclick="loadReports()"><i class="fa-solid fa-rotate"></i> Refresh</button>
        </div>
        <div class="dash-grid" style="grid-template-columns: ${showOrgChart ? '1fr 1fr' : '1fr'};">
            <div class="card">
                <h3 style="text-align:center; font-weight:700; margin-bottom:20px;">Direct Reports (${directReports.length})</h3>
                <div style="height:350px;"><canvas id="chartDirect"></canvas></div>
            </div>
            ${showOrgChart ? `
            <div class="card">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                     <h3 style="font-weight:700;">Total Organization</h3>
                     <div id="org-count-lbl" style="font-size:0.8rem;">(${globalReports.length})</div>
                </div>
                ${filterHtml}
                <div style="height:350px;"><canvas id="chartOrg"></canvas></div>
            </div>` : ''}
        </div>
        <div class="card">
            <h3>Team Performance</h3>
            <div style="max-height:500px; overflow-y:auto;">
                <table class="report-table"><thead><tr><th>Name</th><th>Score</th><th>Rating</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>
            </div>
        </div>
    </div>`;

            render(h);

            if (chart1) chart1.destroy();
            chart1 = new Chart(document.getElementById('chartDirect'), { type: 'bar', data: { labels: ["IDLE", "STAGNANT", "WALKER", "RUNNER", "FLYER", "ASTRONAUT"], datasets: [{ label: 'Direct Reports', data: distDirect, backgroundColor: '#0f766e', borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } } } });

            if (showOrgChart) {
                if (chartOrg) chartOrg.destroy();
                chartOrg = new Chart(document.getElementById('chartOrg'), { type: 'bar', data: { labels: ["IDLE", "STAGNANT", "WALKER", "RUNNER", "FLYER", "ASTRONAUT"], datasets: [{ label: 'Total Org', data: distOrg, backgroundColor: '#10b981', borderRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } } } });
            }
        }

        // --- NEW FUNCTION: Cascade Filters (Comp -> Div/Mgr) ---
        function cascadeFilters() {
            const compVal = document.getElementById('org-filter-comp').value;
            const divVal = document.getElementById('org-filter-div').value;
            const divSelect = document.getElementById('org-filter-div');
            const mgrSelect = document.getElementById('org-filter-mgr');

            // Identify which dropdown was actually clicked to prevent circular loops
            const triggerId = event ? event.target.id : null;

            // --- STEP 1: FILTER BY COMPANY ---
            let companySubset = globalReports;
            if (compVal !== 'ALL') {
                // PASS BOTH ID AND DIVISION
                companySubset = globalReports.filter(u => getCompany(u[COL.id], u[COL.div]) === compVal);
            }

            // --- STEP 2: UPDATE DIVISION LIST (Only if Company was changed) ---
            if (triggerId === 'org-filter-comp') {
                const availDivs = [...new Set(companySubset.map(u => (u[COL.div] || "").trim()).filter(Boolean))].sort();

                divSelect.innerHTML = `<option value="ALL">All Divisions</option>` +
                    availDivs.map(d => `<option value="${d}">${d}</option>`).join('');

                // Reset division selection to ALL when company changes
                divSelect.value = "ALL";
            }

            // --- STEP 3: UPDATE MANAGER LIST (Filtered by current Company AND current Division) ---
            const currentDiv = divSelect.value;
            let managerSubset = companySubset;

            if (currentDiv !== 'ALL') {
                // Strict filtering: Only people in this specific Division
                managerSubset = companySubset.filter(u => (u[COL.div] || "").trim() === currentDiv);
            }

            // Extract unique Managers from the filtered results
            const mgrMap = new Map();
            managerSubset.forEach(u => {
                let rawM = (u[COL.mgr] || "").toString();
                // Look up the manager's Name in the main directory using the ID found in mgrStr
                let match = allCompanyData.find(x => rawM.includes(x[COL.id]));
                if (match) {
                    if (!mgrMap.has(match[COL.id])) mgrMap.set(match[COL.id], match[COL.name]);
                }
            });

            const availMgrs = Array.from(mgrMap.entries())
                .map(([id, name]) => ({ id, name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            // Update the Manager Dropdown HTML
            mgrSelect.innerHTML = `<option value="ALL">All Managers</option>` +
                availMgrs.map(m => `<option value="${m.id}">${m.name} (${m.id})</option>`).join('');

            // --- STEP 4: REFRESH CHART ---
            updateOrgChart();
        }
        // --- UPDATED Function: Update Chart based on selections ---
        function updateOrgChart() {
            const compVal = document.getElementById('org-filter-comp').value;
            const divVal = document.getElementById('org-filter-div').value;
            const mgrVal = document.getElementById('org-filter-mgr').value;

            let filteredData = globalReports;

            // Filter 1: Company
            if (compVal !== 'ALL') {
                filteredData = filteredData.filter(u => getCompany(u[COL.id], u[COL.div]) === compVal);
            }

            // Filter 2: Manager (Recursive Downstream)
            if (mgrVal !== "ALL") {
                const subTree = getDownstream(mgrVal, allCompanyData);
                const validIds = new Set(filteredData.map(x => x[COL.id]));
                filteredData = subTree.filter(x => validIds.has(x[COL.id]));
            }

            // Filter 3: Division
            if (divVal !== "ALL") {
                filteredData = filteredData.filter(u => (u[COL.div] || "").trim() === divVal);
            }

            // Update Count Label
            document.getElementById('org-count-lbl').innerText = `(${filteredData.length})`;

            // Recalculate Distribution
            const globalRating = masterData.rating || 0;
            let dist = [0, 0, 0, 0, 0, 0];

            filteredData.forEach(u => {
                let userGoals = u[COL.goals] || [];
                if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); } catch (e) { userGoals = [] } }
                let w = getW(u[COL.lvl], u[COL.job]);
                let sScore = globalRating * (w.s / 100);
                let iScore = 0;
                
                // FIXED: Scale goal weights to employee's individual allocation
                if (Array.isArray(userGoals)) {
                    let totalWeight = 0;
                    userGoals.forEach(g => totalWeight += (Number(g.weight) || 0));
                    const scaleFactor = totalWeight > 0 ? (w.i / 100) / totalWeight : 0;
                    
                    userGoals.forEach(g => {
                        const scaledWeight = (Number(g.weight) || 0) * scaleFactor;
                        iScore += (Number(g.rating) || 0) * scaledWeight;
                    });
                }
                
                let total = sScore + iScore;
                let b = 0;
                if (total >= 5.5) b = 5; else if (total >= 4.5) b = 4; else if (total >= 3.5) b = 3; else if (total >= 2.5) b = 2; else if (total >= 1.5) b = 1;
                dist[b]++;
            });

            // Update Chart Data
            chartOrg.data.datasets[0].data = dist;
            chartOrg.update();
        }
        async function loadTeam() {
            const myId = user[COL.id];
            const myName = user[COL.name];

            // INSTANT VISUAL FEEDBACK: Show skeleton while loading
            const hasCachedTeam = getTeamFromCache(myId, myName);
            if (!hasCachedTeam || hasCachedTeam.length === 0) {
                render(showTeamSkeleton());
            }

            // SPEED OPTIMIZATION: Try to get team from cache first
            let data = getTeamFromCache(myId, myName);
            
            // If cache is empty, fetch from API (fallback)
            if (!data || data.length === 0) {
                let filter = `${COL.mgr}.ilike.%${myId}%`;
                if (myName) filter += `,${COL.mgr}.ilike.%${myName}%`;
                const result = await db.from('active_list').select('*').or(filter);
                data = result.data || [];
            }
            
            // Store team data for bulk assignment
            window.managerTeamData = data || [];

            let h = `
    <div class="animate-in">
        <div class="header-bar">
            <div>
                <h2 class="page-title">My Team</h2>
                <p class="page-sub">Direct Reports & Scorecards</p>
            </div>
            <div style="display:flex; gap:12px; align-items:center;">
                <button class="btn btn-outline" onclick="openBulkObjectivesModal()">
                    <i class="fa-solid fa-file-import"></i> &nbsp; Bulk Assign Objectives
                </button>
                <select id="team-comp-filter" onchange="filterTeamGrid()" style="padding:10px 16px; border-radius:10px; border:1px solid var(--border); font-weight:600; cursor:pointer;">
                    <option value="ALL">All Companies</option>
                    <option value="Zain Iraq">Zain Iraq</option>
                    <option value="Horizon">Horizon</option>
                    <option value="Next Generation">Next Generation</option>
                </select>
            </div>
        </div>
        
        <div class="team-grid" id="team-grid-container">`;

            if (data && data.length > 0) {
                data.forEach(e => {
                    let isSub = e[COL.stat] === 'Submitted to Manager';
                    let isApp = e[COL.stat] === 'Approved';
                    let statClass = 'draft';
                    if (isSub) statClass = 'submitted';
                    if (isApp) statClass = 'approved';

                    // Calculate Company for filtering
                    const comp = getCompany(e[COL.id]);

                    // Add 'data-comp' attribute to the card for filtering
                    h += `
            <div class="premium-team-card team-card-item" data-comp="${comp}" 
                 style="cursor:pointer;">
                <div class="pt-status status-badge ${statClass}">${e[COL.stat] || 'Draft'}</div>
                <div class="pt-avatar">${e[COL.name].charAt(0)}</div>
                <div class="pt-info">
                    <div class="pt-name">${e[COL.name].split('(')[0]}</div>
                    <div class="pt-role">${e[COL.job] || 'Staff'}</div>
                    <div style="font-size:0.75rem; color:var(--primary); font-weight:700; margin-top:4px;">${comp}</div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">${e[COL.id]}</div>
                </div>
                <div style="border-top:1px solid var(--border); padding-top:16px; display:flex; gap:8px;">
                    <button class="btn btn-primary" style="flex:1; justify-content:center; font-size:0.85rem;" onclick="loadEval('${e[COL.id]}')">
                        <i class="fa-solid fa-eye"></i> &nbsp; View
                    </button>
                    <button class="btn btn-outline" style="padding:10px 14px;" onclick="event.stopPropagation(); openScorecardInNewTab('${e[COL.id]}')" title="Open in new tab">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </button>
                </div>
            </div>`;
                });
            } else {
                h += `<div class="empty-state-message">No direct reports found.</div>`;
            }
            h += `</div></div>`;
            render(h);
        }

        // Helper function to filter the grid immediately
        function filterTeamGrid() {
            const filter = document.getElementById('team-comp-filter').value;
            const cards = document.querySelectorAll('.team-card-item');

            cards.forEach(card => {
                const comp = card.getAttribute('data-comp');
                if (filter === 'ALL' || comp === filter) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        }

        // --- BULK OBJECTIVES IMPORT FOR MANAGERS ---
        let bulkObjectivesData = [];
        let selectedEmployeesForBulk = new Set();
        
        function openBulkObjectivesModal() {
            const teamData = window.managerTeamData || [];
            
            if (teamData.length === 0) {
                showToast('No team members found to assign objectives to', 'error');
                return;
            }
            
            // Reset state
            bulkObjectivesData = [];
            selectedEmployeesForBulk = new Set();
            
            const modalHtml = `
            <div id="bulk-objectives-modal" style="position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); padding:20px;">
                <div style="background:white; width:100%; max-width:1000px; max-height:90vh; border-radius:20px; display:flex; flex-direction:column; overflow:hidden; animation:scaleIn 0.3s ease;">
                    
                    <!-- Header -->
                    <div style="padding:24px 32px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <h3 style="margin:0; font-size:1.4rem; font-weight:700;">
                                <i class="fa-solid fa-file-import" style="color:var(--primary); margin-right:10px;"></i>
                                Bulk Assign Objectives
                            </h3>
                            <p style="margin:4px 0 0; color:var(--text-muted); font-size:0.9rem;">Import objectives from Excel and assign to team members</p>
                        </div>
                        <button onclick="closeBulkObjectivesModal()" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-muted); padding:8px;">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    
                    <!-- Steps Container -->
                    <div style="flex:1; overflow-y:auto; padding:24px 32px;">
                        
                        <!-- Step 1: Import Objectives -->
                        <div class="bulk-step" id="bulk-step-1">
                            <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
                                <div style="width:32px; height:32px; background:var(--primary); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700;">1</div>
                                <h4 style="margin:0; font-size:1.1rem;">Import Objectives</h4>
                            </div>
                            
                            <div style="background:#f8fafc; border:2px dashed var(--border); border-radius:12px; padding:40px; text-align:center; margin-bottom:20px;">
                                <i class="fa-solid fa-file-excel" style="font-size:3rem; color:#10b981; margin-bottom:16px; display:block;"></i>
                                <p style="margin:0 0 16px; color:var(--text-muted);">Upload an Excel file with objectives</p>
                                <input type="file" id="bulk-obj-file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="processBulkObjectivesFile(this)">
                                <button class="btn btn-primary" onclick="document.getElementById('bulk-obj-file').click()">
                                    <i class="fa-solid fa-upload"></i> &nbsp; Choose File
                                </button>
                                
                                <div style="margin-top:20px; text-align:left; background:white; padding:16px; border-radius:8px; border:1px solid var(--border);">
                                    <div style="font-weight:600; margin-bottom:8px; font-size:0.85rem;">Expected Excel Columns:</div>
                                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">Objective / Title</span>
                                        <span style="background:#dbeafe; color:#1d4ed8; padding:4px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">Weight (%)</span>
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">Description (optional)</span>
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">Unit (optional)</span>
                                        <span style="background:#fef3c7; color:#d97706; padding:4px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">L1-L6 Targets (optional)</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="margin-bottom:20px;">
                                <div style="font-weight:600; margin-bottom:12px;">Or add objectives manually:</div>
                                <button class="btn btn-outline" onclick="addManualBulkObjective()">
                                    <i class="fa-solid fa-plus"></i> &nbsp; Add Objective Manually
                                </button>
                            </div>
                            
                            <!-- Objectives Preview -->
                            <div id="bulk-objectives-preview" style="display:none;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                    <h4 style="margin:0; font-size:1rem;"><i class="fa-solid fa-list-check" style="color:var(--primary); margin-right:8px;"></i>Objectives to Assign</h4>
                                    <button class="btn btn-outline" style="padding:6px 12px; font-size:0.8rem;" onclick="clearBulkObjectives()">
                                        <i class="fa-solid fa-trash"></i> &nbsp; Clear All
                                    </button>
                                </div>
                                <div id="bulk-objectives-list" style="max-height:300px; overflow-y:auto; border:1px solid var(--border); border-radius:12px;"></div>
                                <div id="bulk-objectives-weight-warning" style="display:none; background:#fef2f2; border:1px solid #fecaca; padding:12px 16px; border-radius:8px; margin-top:12px; color:#dc2626; font-size:0.85rem;">
                                    <i class="fa-solid fa-triangle-exclamation"></i> <span id="weight-warning-text"></span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Step 2: Select Employees -->
                        <div class="bulk-step" id="bulk-step-2" style="margin-top:32px; padding-top:32px; border-top:1px solid var(--border);">
                            <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
                                <div style="width:32px; height:32px; background:var(--primary); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700;">2</div>
                                <h4 style="margin:0; font-size:1.1rem;">Select Team Members</h4>
                            </div>
                            
                            <div style="display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;">
                                <button class="btn btn-outline" onclick="selectAllEmployeesForBulk()">
                                    <i class="fa-solid fa-check-double"></i> &nbsp; Select All
                                </button>
                                <button class="btn btn-outline" onclick="deselectAllEmployeesForBulk()">
                                    <i class="fa-solid fa-xmark"></i> &nbsp; Deselect All
                                </button>
                                <div style="margin-left:auto; color:var(--text-muted); font-size:0.9rem; display:flex; align-items:center; gap:8px;">
                                    <span id="selected-employees-count">0</span> of ${teamData.length} selected
                                </div>
                            </div>
                            
                            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px; max-height:300px; overflow-y:auto; padding:4px;">
                                ${teamData.map(emp => `
                                    <label class="bulk-employee-card" style="display:flex; align-items:center; gap:12px; padding:12px 16px; background:#f8fafc; border:2px solid var(--border); border-radius:10px; cursor:pointer; transition:all 0.2s;"
                                           onmouseover="this.style.borderColor='var(--primary-light)'"
                                           onmouseout="this.style.borderColor=this.querySelector('input').checked ? 'var(--primary)' : 'var(--border)'">
                                        <input type="checkbox" class="bulk-emp-checkbox" value="${emp[COL.id]}" onchange="toggleEmployeeForBulk(this)"
                                               style="width:18px; height:18px; accent-color:var(--primary);">
                                        <div style="flex:1; min-width:0;">
                                            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${emp[COL.name].split('(')[0]}</div>
                                            <div style="font-size:0.75rem; color:var(--text-muted);">${emp[COL.id]} • ${emp[COL.job] || 'Staff'}</div>
                                        </div>
                                        <span class="status-badge ${emp[COL.stat] === 'Draft' ? 'draft' : 'submitted'}" style="font-size:0.65rem; padding:3px 8px;">
                                            ${emp[COL.stat] || 'Draft'}
                                        </span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        
                        <!-- Step 3: Assignment Mode -->
                        <div class="bulk-step" id="bulk-step-3" style="margin-top:32px; padding-top:32px; border-top:1px solid var(--border);">
                            <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
                                <div style="width:32px; height:32px; background:var(--primary); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700;">3</div>
                                <h4 style="margin:0; font-size:1.1rem;">Assignment Mode</h4>
                            </div>
                            
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                                <label class="assignment-mode-card" style="padding:20px; background:#f8fafc; border:2px solid var(--border); border-radius:12px; cursor:pointer; transition:all 0.2s;">
                                    <input type="radio" name="assignment-mode" value="replace" checked style="display:none;">
                                    <div style="display:flex; align-items:flex-start; gap:12px;">
                                        <div style="width:40px; height:40px; background:var(--danger); color:white; border-radius:10px; display:flex; align-items:center; justify-content:center;">
                                            <i class="fa-solid fa-arrows-rotate"></i>
                                        </div>
                                        <div>
                                            <div style="font-weight:700; margin-bottom:4px;">Replace Existing</div>
                                            <div style="font-size:0.85rem; color:var(--text-muted);">Remove all current individual objectives and replace with the new ones</div>
                                        </div>
                                    </div>
                                </label>
                                
                                <label class="assignment-mode-card" style="padding:20px; background:#f8fafc; border:2px solid var(--border); border-radius:12px; cursor:pointer; transition:all 0.2s;">
                                    <input type="radio" name="assignment-mode" value="append" style="display:none;">
                                    <div style="display:flex; align-items:flex-start; gap:12px;">
                                        <div style="width:40px; height:40px; background:var(--success); color:white; border-radius:10px; display:flex; align-items:center; justify-content:center;">
                                            <i class="fa-solid fa-plus"></i>
                                        </div>
                                        <div>
                                            <div style="font-weight:700; margin-bottom:4px;">Append to Existing</div>
                                            <div style="font-size:0.85rem; color:var(--text-muted);">Keep current objectives and add the new ones at the end</div>
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Footer -->
                    <div style="padding:20px 32px; border-top:1px solid var(--border); background:#f8fafc; display:flex; justify-content:space-between; align-items:center;">
                        <div style="color:var(--text-muted); font-size:0.85rem;">
                            <i class="fa-solid fa-circle-info"></i> &nbsp; Objectives will be assigned to selected employees' scorecards
                        </div>
                        <div style="display:flex; gap:12px;">
                            <button class="btn btn-outline" onclick="closeBulkObjectivesModal()">Cancel</button>
                            <button class="btn btn-primary" id="btn-apply-bulk" onclick="applyBulkObjectives()" disabled>
                                <i class="fa-solid fa-paper-plane"></i> &nbsp; Apply to Selected (<span id="apply-count">0</span>)
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // Add styles for the modal
            if (!document.getElementById('bulk-objectives-styles')) {
                const style = document.createElement('style');
                style.id = 'bulk-objectives-styles';
                style.innerHTML = `
                    .assignment-mode-card:has(input:checked) {
                        border-color: var(--primary) !important;
                        background: var(--primary-light) !important;
                    }
                    .assignment-mode-card:hover {
                        border-color: var(--primary-light);
                    }
                    .bulk-employee-card:has(input:checked) {
                        border-color: var(--primary) !important;
                        background: var(--primary-light) !important;
                    }
                `;
                document.head.appendChild(style);
            }
        }
        
        function closeBulkObjectivesModal() {
            const modal = document.getElementById('bulk-objectives-modal');
            if (modal) modal.remove();
            bulkObjectivesData = [];
            selectedEmployeesForBulk.clear();
        }
        
        function processBulkObjectivesFile(input) {
            const file = input.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
                    
                    if (json.length === 0) {
                        showToast('Excel file is empty', 'error');
                        return;
                    }
                    
                    // Parse objectives from Excel
                    function getVal(row, candidates) {
                        const keys = Object.keys(row);
                        const clean = (s) => s.toString().toLowerCase().trim().replace(/[^a-z0-9]/g, '');
                        for (let c of candidates) {
                            const found = keys.find(k => clean(k) === clean(c));
                            if (found && row[found] !== undefined) return row[found];
                        }
                        return "";
                    }
                    
                    bulkObjectivesData = json.map((r, idx) => {
                        let w = getVal(r, ['Weight', 'Wt', 'W%', 'Weight%']);
                        w = parseFloat(w) || 0;
                        if (w > 1) w = w / 100; // Convert percentage to decimal
                        
                        return {
                            id: 'obj_' + Date.now() + '_' + idx,
                            title: getVal(r, ['Objective', 'Title', 'Item', 'Items', 'Goal', 'KPI', 'Name']) || "Imported Objective",
                            weight: w,
                            desc: getVal(r, ['Description', 'Desc', 'Details', 'KPI Description']),
                            unit: getVal(r, ['Unit', 'UoM', 'Measure']),
                            rating: 0,
                            targets: [
                                getVal(r, ['L1', 'Idle', 'Level1']),
                                getVal(r, ['L2', 'Stagnant', 'Level2']),
                                getVal(r, ['L3', 'Walker', 'Level3']),
                                getVal(r, ['L4', 'Target', 'Runner', 'Level4']),
                                getVal(r, ['L5', 'Flyer', 'Level5']),
                                getVal(r, ['L6', 'Astronaut', 'Level6'])
                            ]
                        };
                    }).filter(obj => obj.title && obj.title !== "Imported Objective");
                    
                    if (bulkObjectivesData.length === 0) {
                        showToast('No valid objectives found in file. Check column names.', 'error');
                        return;
                    }
                    
                    renderBulkObjectivesPreview();
                    showToast(`Imported ${bulkObjectivesData.length} objectives`, 'success');
                    input.value = '';
                } catch (err) {
                    console.error('Error parsing file:', err);
                    showToast('Error reading Excel file. Check format.', 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        }
        
        function addManualBulkObjective() {
            const newObj = {
                id: 'obj_' + Date.now(),
                title: 'New Objective',
                weight: 0,
                desc: '',
                unit: '',
                rating: 0,
                targets: ['', '', '', '', '', '']
            };
            bulkObjectivesData.push(newObj);
            renderBulkObjectivesPreview();
            
            // Auto-focus on the new objective's title
            setTimeout(() => {
                const inputs = document.querySelectorAll('.bulk-obj-title');
                if (inputs.length > 0) {
                    inputs[inputs.length - 1].focus();
                    inputs[inputs.length - 1].select();
                }
            }, 100);
        }
        
        function renderBulkObjectivesPreview() {
            const container = document.getElementById('bulk-objectives-preview');
            const list = document.getElementById('bulk-objectives-list');
            
            if (bulkObjectivesData.length === 0) {
                container.style.display = 'none';
                updateBulkApplyButton();
                return;
            }
            
            container.style.display = 'block';
            
            let totalWeight = 0;
            bulkObjectivesData.forEach(obj => totalWeight += (obj.weight || 0));
            
            list.innerHTML = bulkObjectivesData.map((obj, idx) => `
                <div class="bulk-obj-item" style="padding:16px; border-bottom:1px solid var(--border); ${idx === bulkObjectivesData.length - 1 ? 'border-bottom:none;' : ''}">
                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <div style="flex:1;">
                            <input class="bulk-obj-title login-input" style="margin:0 0 8px 0; font-weight:600;" 
                                   value="${escapeHTML(obj.title)}" placeholder="Objective Title"
                                   onchange="updateBulkObjective(${idx}, 'title', this.value)">
                            <div style="display:flex; gap:8px;">
                                <input class="login-input" style="margin:0; width:80px;" type="number" step="0.01" min="0" max="1"
                                       value="${obj.weight}" placeholder="Weight"
                                       onchange="updateBulkObjective(${idx}, 'weight', parseFloat(this.value) || 0)">
                                <input class="login-input" style="margin:0; width:80px;" 
                                       value="${escapeHTML(obj.unit || '')}" placeholder="Unit"
                                       onchange="updateBulkObjective(${idx}, 'unit', this.value)">
                                <input class="login-input" style="margin:0; flex:1;" 
                                       value="${escapeHTML(obj.desc || '')}" placeholder="Description (optional)"
                                       onchange="updateBulkObjective(${idx}, 'desc', this.value)">
                            </div>
                        </div>
                        <button class="btn btn-outline" style="padding:8px 12px; color:var(--danger); border-color:#fee2e2;" 
                                onclick="removeBulkObjective(${idx})" title="Remove">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('');
            
            // Show weight warning if needed
            const warningEl = document.getElementById('bulk-objectives-weight-warning');
            const warningText = document.getElementById('weight-warning-text');
            const totalPct = Math.round(totalWeight * 100);
            
            if (totalWeight > 0 && totalWeight !== 1) {
                warningEl.style.display = 'block';
                warningText.textContent = `Total weight is ${totalPct}%. Weights should sum to 100% for proper scoring.`;
            } else {
                warningEl.style.display = 'none';
            }
            
            updateBulkApplyButton();
        }
        
        function updateBulkObjective(idx, field, value) {
            if (bulkObjectivesData[idx]) {
                bulkObjectivesData[idx][field] = value;
                if (field === 'weight') {
                    renderBulkObjectivesPreview();
                }
            }
        }
        
        function removeBulkObjective(idx) {
            bulkObjectivesData.splice(idx, 1);
            renderBulkObjectivesPreview();
        }
        
        function clearBulkObjectives() {
            bulkObjectivesData = [];
            renderBulkObjectivesPreview();
        }
        
        function selectAllEmployeesForBulk() {
            document.querySelectorAll('.bulk-emp-checkbox').forEach(cb => {
                cb.checked = true;
                selectedEmployeesForBulk.add(cb.value);
                cb.closest('.bulk-employee-card').style.borderColor = 'var(--primary)';
                cb.closest('.bulk-employee-card').style.background = 'var(--primary-light)';
            });
            updateBulkApplyButton();
        }
        
        function deselectAllEmployeesForBulk() {
            document.querySelectorAll('.bulk-emp-checkbox').forEach(cb => {
                cb.checked = false;
                selectedEmployeesForBulk.delete(cb.value);
                cb.closest('.bulk-employee-card').style.borderColor = 'var(--border)';
                cb.closest('.bulk-employee-card').style.background = '#f8fafc';
            });
            updateBulkApplyButton();
        }
        
        function toggleEmployeeForBulk(checkbox) {
            if (checkbox.checked) {
                selectedEmployeesForBulk.add(checkbox.value);
                checkbox.closest('.bulk-employee-card').style.borderColor = 'var(--primary)';
                checkbox.closest('.bulk-employee-card').style.background = 'var(--primary-light)';
            } else {
                selectedEmployeesForBulk.delete(checkbox.value);
                checkbox.closest('.bulk-employee-card').style.borderColor = 'var(--border)';
                checkbox.closest('.bulk-employee-card').style.background = '#f8fafc';
            }
            updateBulkApplyButton();
        }
        
        function updateBulkApplyButton() {
            const btn = document.getElementById('btn-apply-bulk');
            const countSpan = document.getElementById('apply-count');
            const selectedCountSpan = document.getElementById('selected-employees-count');
            
            const count = selectedEmployeesForBulk.size;
            const hasObjectives = bulkObjectivesData.length > 0;
            
            if (countSpan) countSpan.textContent = count;
            if (selectedCountSpan) selectedCountSpan.textContent = count;
            if (btn) btn.disabled = !hasObjectives || count === 0;
        }
        
        async function applyBulkObjectives() {
            if (bulkObjectivesData.length === 0) {
                showToast('No objectives to assign', 'error');
                return;
            }
            
            if (selectedEmployeesForBulk.size === 0) {
                showToast('No employees selected', 'error');
                return;
            }
            
            const mode = document.querySelector('input[name="assignment-mode"]:checked').value;
            const employeeIds = Array.from(selectedEmployeesForBulk);
            
            showConfirm(
                'Confirm Bulk Assignment',
                `This will ${mode === 'replace' ? 'REPLACE all existing objectives with' : 'ADD'} ${bulkObjectivesData.length} objective(s) for ${employeeIds.length} employee(s). Continue?`,
                'Apply Changes',
                'primary',
                async () => {
                    showSaving();
                    let successCount = 0;
                    let errorCount = 0;
                    
                    for (const empId of employeeIds) {
                        try {
                            // Fetch current employee data
                            const { data: empData, error: fetchError } = await db.from('active_list').select('*').eq(COL.id, empId).single();
                            
                            if (fetchError || !empData) {
                                console.error(`Failed to fetch employee ${empId}:`, fetchError);
                                errorCount++;
                                continue;
                            }
                            
                            // Parse existing goals
                            let currentGoals = empData[COL.goals];
                            if (typeof currentGoals === 'string') {
                                try { currentGoals = JSON.parse(currentGoals); } catch (e) { currentGoals = []; }
                            }
                            if (!Array.isArray(currentGoals)) currentGoals = [];
                            
                            // Prepare new objectives (deep copy to avoid reference issues)
                            const newObjectives = bulkObjectivesData.map(obj => ({
                                title: obj.title,
                                weight: obj.weight,
                                desc: obj.desc || '',
                                unit: obj.unit || '',
                                rating: 0,
                                targets: [...(obj.targets || ['', '', '', '', '', ''])]
                            }));
                            
                            // Determine final goals based on mode
                            let finalGoals;
                            if (mode === 'replace') {
                                finalGoals = newObjectives;
                            } else {
                                finalGoals = [...currentGoals, ...newObjectives];
                            }
                            
                            // Save to database
                            const { error: saveError } = await db.from('active_list').upsert({
                                [COL.id]: empId,
                                [COL.goals]: finalGoals
                            });
                            
                            if (saveError) {
                                console.error(`Failed to save for employee ${empId}:`, saveError);
                                errorCount++;
                            } else {
                                successCount++;
                            }
                        } catch (err) {
                            console.error(`Error processing employee ${empId}:`, err);
                            errorCount++;
                        }
                    }
                    
                    showSaved();
                    closeBulkObjectivesModal();
                    
                    // Clear data cache to reflect changes
                    clearDataCache();
                    
                    if (errorCount === 0) {
                        showToast(`Successfully assigned objectives to ${successCount} employee(s)!`, 'success');
                    } else {
                        showToast(`Completed with ${successCount} success, ${errorCount} errors`, 'warning');
                    }
                    
                    // Refresh team view
                    loadTeam();
                }
            );
        }

        // --- PROGRESS DASHBOARD FOR MANAGERS ---
        async function loadProgressDashboard() {
            const myId = user[COL.id];
            const myName = user[COL.name];
            const myLevel = user[COL.lvl] || 'default';

            // SPEED OPTIMIZATION: Try to get team from cache first
            let teamData = getTeamFromCache(myId, myName);
            
            // If cache is empty, fetch from API (fallback)
            if (!teamData || teamData.length === 0) {
                let filter = `${COL.mgr}.ilike.%${myId}%`;
                if (myName) filter += `,${COL.mgr}.ilike.%${myName}%`;
                const result = await db.from('active_list').select('*').or(filter);
                teamData = result.data || [];
            }
            
            // Get my own data from cache or API
            let myData = getEmployeeFromCache(myId);
            if (!myData) {
                const result = await db.from('active_list').select('*').eq(COL.id, myId).single();
                myData = result.data;
            }
            
            // Parse goals for my data
            let myGoals = myData ? myData[COL.goals] : [];
            if (typeof myGoals === 'string') {
                try { myGoals = JSON.parse(myGoals); } catch (e) { myGoals = []; }
            }
            if (!Array.isArray(myGoals)) myGoals = [];
            
            // Calculate team stats
            const teamMembers = teamData || [];
            let totalObjectives = 0;
            let totalProgress = 0;
            let objectivesWithProgress = 0;
            
            teamMembers.forEach(member => {
                let goals = member[COL.goals];
                if (typeof goals === 'string') {
                    try { goals = JSON.parse(goals); } catch (e) { goals = []; }
                }
                if (Array.isArray(goals)) {
                    goals.forEach(g => {
                        totalObjectives++;
                        if (g.progress !== undefined && g.progress > 0) {
                            totalProgress += g.progress;
                            objectivesWithProgress++;
                        }
                    });
                }
            });
            
            const avgTeamProgress = objectivesWithProgress > 0 ? Math.round(totalProgress / objectivesWithProgress) : 0;
            
            // Calculate my own progress
            let myTotalProgress = 0;
            let myObjectivesWithProgress = 0;
            myGoals.forEach(g => {
                if (g.progress !== undefined && g.progress > 0) {
                    myTotalProgress += g.progress;
                    myObjectivesWithProgress++;
                }
            });
            const myAvgProgress = myGoals.length > 0 ? Math.round(myGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / myGoals.length) : 0;
            
            // Calculate Overall Progress using new weighted system (Individual + Team)
            const overallProgressData = calculateManagerProgress(myId, myLevel, teamMembers);
            const config = progressConfigurations || DEFAULT_PROGRESS_CONFIG;
            const cascadeMode = config.cascadeMode || 'direct';

            let h = `
    <div class="animate-in">
        <div class="header-bar">
            <div>
                <h2 class="page-title">Progress Tracker</h2>
                <p class="page-sub">Track objectives progress throughout the performance cycle</p>
            </div>
            <div style="display:flex; gap:12px;">
                <button class="btn btn-outline" onclick="exportProgressReport()">
                    <i class="fa-solid fa-file-excel" style="color:#10b981;"></i> &nbsp; Export Report
                </button>
                <button class="btn btn-primary" onclick="loadProgressDashboard()">
                    <i class="fa-solid fa-rotate"></i> &nbsp; Refresh
                </button>
            </div>
        </div>

        <!-- Overall Progress Card (NEW - Individual + Team) -->
        <div class="card" style="margin-bottom:24px; background:linear-gradient(135deg, #0f172a, #1e293b); color:white; padding:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <div>
                    <h3 style="margin:0; font-size:1.3rem; font-weight:700;">
                        <i class="fa-solid fa-chart-pie" style="color:#0d9488; margin-right:10px;"></i>
                        Overall Progress
                    </h3>
                    <p style="margin:4px 0 0; font-size:0.85rem; color:#94a3b8;">
                        Combined Individual (${overallProgressData.weights.individual}%) + Team (${overallProgressData.weights.team}%) Progress
                        <span style="margin-left:8px; padding:2px 8px; background:rgba(13,148,136,0.2); border-radius:4px; font-size:0.75rem;">
                            ${cascadeMode === 'full' ? '🔗 Full Cascade' : '👥 Direct Reports Only'}
                        </span>
                    </p>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:3rem; font-weight:800; color:#0d9488;" id="overall-progress-value">${overallProgressData.overall}%</div>
                    <div style="font-size:0.8rem; color:#94a3b8;">Overall Progress</div>
                </div>
            </div>
            
            <!-- Overall Progress Bar -->
            <div style="background:#334155; height:16px; border-radius:8px; overflow:hidden; margin-bottom:20px;">
                <div id="overall-progress-bar" style="height:100%; background:linear-gradient(90deg, #0d9488, #14b8a6); border-radius:8px; transition:width 0.5s ease; width:${overallProgressData.overall}%;"></div>
            </div>
            
            <!-- Individual vs Team Breakdown -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                <!-- Individual Progress -->
                <div style="background:rgba(255,255,255,0.05); padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div>
                            <div style="font-size:0.75rem; color:#94a3b8; text-transform:uppercase; letter-spacing:1px;">Individual Objectives</div>
                            <div style="font-size:0.85rem; color:#e2e8f0; margin-top:2px;">Weight: <strong>${overallProgressData.weights.individual}%</strong></div>
                        </div>
                        <div style="font-size:1.8rem; font-weight:800; color:#3b82f6;" id="individual-progress-value">${overallProgressData.individual}%</div>
                    </div>
                    <div style="background:#1e293b; height:8px; border-radius:4px; overflow:hidden;">
                        <div id="individual-progress-bar" style="height:100%; background:linear-gradient(90deg, #3b82f6, #60a5fa); border-radius:4px; transition:width 0.5s ease; width:${overallProgressData.individual}%;"></div>
                    </div>
                    <div style="font-size:0.75rem; color:#64748b; margin-top:8px;">${myGoals.length} objectives • Contributes ${(overallProgressData.individual * overallProgressData.weights.individual / 100).toFixed(1)}% to overall</div>
                </div>
                
                <!-- Team Progress -->
                <div style="background:rgba(255,255,255,0.05); padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div>
                            <div style="font-size:0.75rem; color:#94a3b8; text-transform:uppercase; letter-spacing:1px;">Team Progress</div>
                            <div style="font-size:0.85rem; color:#e2e8f0; margin-top:2px;">Weight: <strong>${overallProgressData.weights.team}%</strong></div>
                        </div>
                        <div style="font-size:1.8rem; font-weight:800; color:#10b981;" id="team-progress-value">${overallProgressData.team}%</div>
                    </div>
                    <div style="background:#1e293b; height:8px; border-radius:4px; overflow:hidden;">
                        <div id="team-progress-bar" style="height:100%; background:linear-gradient(90deg, #10b981, #34d399); border-radius:4px; transition:width 0.5s ease; width:${overallProgressData.team}%;"></div>
                    </div>
                    <div style="font-size:0.75rem; color:#64748b; margin-top:8px;">${teamMembers.length} members • Contributes ${(overallProgressData.team * overallProgressData.weights.team / 100).toFixed(1)}% to overall</div>
                </div>
            </div>
        </div>

        <!-- Summary Cards -->
        <div class="metrics-row" style="grid-template-columns: repeat(4, 1fr);">
            <div class="metric-card">
                <div class="metric-card-inner">
                    <div class="metric-icon" style="background:linear-gradient(135deg, var(--primary), var(--accent));">
                        <i class="fa-solid fa-bullseye"></i>
                    </div>
                    <div class="metric-val">${myGoals.length}</div>
                    <div class="metric-lbl">My Objectives</div>
                    <div class="metric-sub-val">${myAvgProgress}% Avg Progress</div>
                </div>
                <div class="metric-progress"><div class="metric-progress-bar" style="width:${myAvgProgress}%"></div></div>
            </div>
            
            <div class="metric-card">
                <div class="metric-card-inner">
                    <div class="metric-icon" style="background:linear-gradient(135deg, #8b5cf6, #a78bfa);">
                        <i class="fa-solid fa-users"></i>
                    </div>
                    <div class="metric-val">${teamMembers.length}</div>
                    <div class="metric-lbl">Team Members</div>
                    <div class="metric-sub-val">${totalObjectives} Total Objectives</div>
                </div>
            </div>
            
            <div class="metric-card">
                <div class="metric-card-inner">
                    <div class="metric-icon" style="background:linear-gradient(135deg, #10b981, #34d399);">
                        <i class="fa-solid fa-chart-line"></i>
                    </div>
                    <div class="metric-val">${avgTeamProgress}%</div>
                    <div class="metric-lbl">Team Avg Progress</div>
                    <div class="metric-sub-val">${objectivesWithProgress} with updates</div>
                </div>
                <div class="metric-progress"><div class="metric-progress-bar" style="width:${avgTeamProgress}%; background:linear-gradient(90deg, #10b981, #34d399);"></div></div>
            </div>
            
            <div class="metric-card highlight">
                <div class="metric-card-inner">
                    <div class="metric-icon">
                        <i class="fa-solid fa-flag-checkered"></i>
                    </div>
                    <div class="metric-val">${teamMembers.filter(m => {
                        let g = m[COL.goals];
                        if (typeof g === 'string') try { g = JSON.parse(g); } catch(e) { g = []; }
                        if (!Array.isArray(g)) return false;
                        return g.every(obj => obj.progress >= 100);
                    }).length}</div>
                    <div class="metric-lbl">Completed</div>
                    <div class="metric-sub-val">All objectives at 100%</div>
                </div>
            </div>
        </div>

        <!-- Tabs for My Progress vs Team Progress -->
        <div class="card" style="padding:0; overflow:hidden;">
            <div style="display:flex; border-bottom:1px solid var(--border);">
                <button class="progress-tab active" id="prog-tab-my" onclick="switchProgressTab('my')" 
                        style="flex:1; padding:16px; border:none; background:var(--primary-light); color:var(--primary); font-weight:700; cursor:pointer; transition:all 0.2s;">
                    <i class="fa-solid fa-user"></i> &nbsp; My Objectives
                </button>
                <button class="progress-tab" id="prog-tab-team" onclick="switchProgressTab('team')"
                        style="flex:1; padding:16px; border:none; background:#f8fafc; color:var(--text-muted); font-weight:700; cursor:pointer; transition:all 0.2s;">
                    <i class="fa-solid fa-users"></i> &nbsp; Team Progress
                </button>
            </div>
            
            <div id="progress-content" style="padding:24px;">
                ${renderMyProgressSection(myGoals, myId)}
            </div>
        </div>
    </div>`;

            render(h);
            
            // Store data for tab switching
            window.progressDashboardData = {
                myGoals: myGoals,
                myId: myId,
                myLevel: myLevel,
                teamMembers: teamMembers
            };
            
            // Setup real-time auto-update
            setupProgressAutoUpdate();
            
            // Add tab styles
            if (!document.getElementById('progress-tab-styles')) {
                const style = document.createElement('style');
                style.id = 'progress-tab-styles';
                style.innerHTML = `
                    .progress-tab:hover { background: var(--primary-light) !important; color: var(--primary) !important; }
                    .progress-tab.active { background: var(--primary-light) !important; color: var(--primary) !important; border-bottom: 3px solid var(--primary) !important; }
                    .progress-slider { -webkit-appearance: none; width: 100%; height: 8px; border-radius: 4px; background: #e2e8f0; outline: none; }
                    .progress-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: var(--primary); cursor: pointer; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
                    .progress-slider::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: var(--primary); cursor: pointer; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
                `;
                document.head.appendChild(style);
            }
        }
        
        function renderMyProgressSection(goals, empId) {
            if (!goals || goals.length === 0) {
                return `
                    <div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                        <i class="fa-solid fa-clipboard-list" style="font-size:3rem; opacity:0.3; margin-bottom:16px; display:block;"></i>
                        <div style="font-weight:600;">No Objectives Found</div>
                        <div style="font-size:0.9rem; margin-top:8px;">Add objectives to your scorecard to track progress.</div>
                    </div>`;
            }
            
            let html = `
                <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0; font-size:1.1rem; font-weight:700;">
                        <i class="fa-solid fa-tasks" style="color:var(--primary); margin-right:8px;"></i>
                        My Objectives Progress
                    </h3>
                    <button class="btn btn-primary" onclick="saveAllMyProgress()">
                        <i class="fa-solid fa-save"></i> &nbsp; Save All Progress
                    </button>
                </div>
                
                <div class="progress-objectives-list">`;
            
            goals.forEach((goal, idx) => {
                const progress = goal.progress || 0;
                const progressColor = progress >= 100 ? '#10b981' : progress >= 75 ? '#0d9488' : progress >= 50 ? '#f59e0b' : progress >= 25 ? '#f97316' : '#ef4444';
                
                html += `
                    <div class="progress-objective-card" style="background:#f8fafc; border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:16px; ${progress >= 100 ? 'border-left:4px solid #10b981;' : ''}">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                            <div style="flex:1;">
                                <div style="font-weight:700; font-size:1rem; color:var(--text-main); margin-bottom:4px;">${escapeHTML(goal.title)}</div>
                                <div style="font-size:0.85rem; color:var(--text-muted);">
                                    Weight: ${Math.round((goal.weight || 0) * 100)}%
                                    ${goal.unit ? ` • Unit: ${escapeHTML(goal.unit)}` : ''}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:2rem; font-weight:800; color:${progressColor};" id="progress-value-${idx}">${progress}%</div>
                                <div style="font-size:0.75rem; color:var(--text-muted);">Progress</div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom:12px;">
                            <input type="range" class="progress-slider" min="0" max="100" value="${progress}" 
                                   id="progress-slider-${idx}"
                                   oninput="updateProgressValue(${idx}, this.value)"
                                   style="background: linear-gradient(to right, ${progressColor} ${progress}%, #e2e8f0 ${progress}%);">
                        </div>
                        
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; gap:8px;">
                                <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="setQuickProgress(${idx}, 0)">0%</button>
                                <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="setQuickProgress(${idx}, 25)">25%</button>
                                <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="setQuickProgress(${idx}, 50)">50%</button>
                                <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="setQuickProgress(${idx}, 75)">75%</button>
                                <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="setQuickProgress(${idx}, 100)">100%</button>
                            </div>
                            ${progress >= 100 ? '<span style="color:#10b981; font-weight:600; font-size:0.85rem;"><i class="fa-solid fa-check-circle"></i> Complete</span>' : ''}
                        </div>
                        
                        <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
                            <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">Progress Notes</label>
                            <textarea id="progress-notes-${idx}" class="login-input" style="margin:0; height:60px; resize:vertical;" 
                                      placeholder="Add notes about your progress...">${escapeHTML(goal.progressNotes || '')}</textarea>
                        </div>
                    </div>`;
            });
            
            html += '</div>';
            return html;
        }
        
        function renderTeamProgressSection(teamMembers) {
            if (!teamMembers || teamMembers.length === 0) {
                return `
                    <div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                        <i class="fa-solid fa-users-slash" style="font-size:3rem; opacity:0.3; margin-bottom:16px; display:block;"></i>
                        <div style="font-weight:600;">No Team Members Found</div>
                        <div style="font-size:0.9rem; margin-top:8px;">You don't have any direct reports.</div>
                    </div>`;
            }
            
            let html = `
                <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                    <h3 style="margin:0; font-size:1.1rem; font-weight:700;">
                        <i class="fa-solid fa-users" style="color:var(--primary); margin-right:8px;"></i>
                        Team Objectives Progress
                    </h3>
                    <div style="display:flex; gap:12px; align-items:center;">
                        <select id="team-progress-filter" onchange="filterTeamProgress()" style="padding:8px 16px; border-radius:8px; border:1px solid var(--border); font-weight:600;">
                            <option value="all">All Members</option>
                            <option value="behind">Behind Schedule (&lt;50%)</option>
                            <option value="ontrack">On Track (50-99%)</option>
                            <option value="complete">Completed (100%)</option>
                        </select>
                    </div>
                </div>
                
                <div id="team-progress-list">`;
            
            teamMembers.forEach(member => {
                let goals = member[COL.goals];
                if (typeof goals === 'string') {
                    try { goals = JSON.parse(goals); } catch (e) { goals = []; }
                }
                if (!Array.isArray(goals)) goals = [];
                
                // Calculate member's average progress
                let totalProgress = 0;
                let objectivesWithProgress = 0;
                goals.forEach(g => {
                    if (g.progress !== undefined) {
                        totalProgress += g.progress;
                        objectivesWithProgress++;
                    }
                });
                const avgProgress = goals.length > 0 ? Math.round(totalProgress / goals.length) : 0;
                const progressColor = avgProgress >= 100 ? '#10b981' : avgProgress >= 75 ? '#0d9488' : avgProgress >= 50 ? '#f59e0b' : avgProgress >= 25 ? '#f97316' : '#ef4444';
                
                // Determine status class for filtering
                const statusClass = avgProgress >= 100 ? 'complete' : avgProgress >= 50 ? 'ontrack' : 'behind';
                
                html += `
                    <div class="team-member-progress-card" data-status="${statusClass}" 
                         style="background:white; border:1px solid var(--border); border-radius:12px; margin-bottom:16px; overflow:hidden;">
                        
                        <!-- Member Header -->
                        <div style="padding:16px 20px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; background:#f8fafc;"
                             onclick="toggleMemberObjectives('${member[COL.id]}')">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="width:44px; height:44px; background:linear-gradient(135deg, var(--primary), var(--accent)); color:white; border-radius:12px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:1.1rem;">
                                    ${member[COL.name].charAt(0)}
                                </div>
                                <div>
                                    <div style="font-weight:700; color:var(--text-main);">${member[COL.name].split('(')[0]}</div>
                                    <div style="font-size:0.8rem; color:var(--text-muted);">${member[COL.job] || 'Staff'} • ${goals.length} objectives</div>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:16px;">
                                <div style="text-align:right;">
                                    <div style="font-size:1.5rem; font-weight:800; color:${progressColor};">${avgProgress}%</div>
                                    <div style="font-size:0.7rem; color:var(--text-muted);">Average Progress</div>
                                </div>
                                <div style="width:100px; height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden;">
                                    <div style="width:${avgProgress}%; height:100%; background:${progressColor}; transition:width 0.3s;"></div>
                                </div>
                                <i class="fa-solid fa-chevron-down" id="chevron-${member[COL.id]}" style="color:var(--text-muted); transition:transform 0.3s;"></i>
                            </div>
                        </div>
                        
                        <!-- Member Objectives (Expandable) -->
                        <div id="objectives-${member[COL.id]}" style="display:none; padding:16px 20px; border-top:1px solid var(--border);">
                            ${goals.length > 0 ? goals.map((g, idx) => {
                                const gProgress = g.progress || 0;
                                const gColor = gProgress >= 100 ? '#10b981' : gProgress >= 50 ? '#f59e0b' : '#ef4444';
                                return `
                                    <div style="display:flex; align-items:center; gap:12px; padding:12px; background:#f8fafc; border-radius:8px; margin-bottom:8px; ${idx === goals.length - 1 ? 'margin-bottom:0;' : ''}">
                                        <div style="flex:1; min-width:0;">
                                            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(g.title)}</div>
                                            <div style="font-size:0.75rem; color:var(--text-muted);">Weight: ${Math.round((g.weight || 0) * 100)}%</div>
                                        </div>
                                        <div style="display:flex; align-items:center; gap:12px;">
                                            <div style="width:80px; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
                                                <div style="width:${gProgress}%; height:100%; background:${gColor};"></div>
                                            </div>
                                            <div style="font-weight:700; color:${gColor}; min-width:45px; text-align:right;">${gProgress}%</div>
                                        </div>
                                        <button class="btn btn-outline" style="padding:6px 10px; font-size:0.75rem;" 
                                                onclick="event.stopPropagation(); openTeamMemberProgressModal('${member[COL.id]}', ${idx})">
                                            <i class="fa-solid fa-pen"></i>
                                        </button>
                                    </div>`;
                            }).join('') : '<div style="text-align:center; padding:20px; color:var(--text-muted);">No objectives assigned</div>'}
                        </div>
                    </div>`;
            });
            
            html += '</div>';
            return html;
        }
        
        function switchProgressTab(tab) {
            const data = window.progressDashboardData;
            if (!data) return;
            
            // Update tab styles
            document.getElementById('prog-tab-my').classList.toggle('active', tab === 'my');
            document.getElementById('prog-tab-team').classList.toggle('active', tab === 'team');
            document.getElementById('prog-tab-my').style.background = tab === 'my' ? 'var(--primary-light)' : '#f8fafc';
            document.getElementById('prog-tab-my').style.color = tab === 'my' ? 'var(--primary)' : 'var(--text-muted)';
            document.getElementById('prog-tab-team').style.background = tab === 'team' ? 'var(--primary-light)' : '#f8fafc';
            document.getElementById('prog-tab-team').style.color = tab === 'team' ? 'var(--primary)' : 'var(--text-muted)';
            
            // Render content
            const content = document.getElementById('progress-content');
            if (tab === 'my') {
                content.innerHTML = renderMyProgressSection(data.myGoals, data.myId);
            } else {
                content.innerHTML = renderTeamProgressSection(data.teamMembers);
            }
        }
        
        function updateProgressValue(idx, value) {
            const valueEl = document.getElementById(`progress-value-${idx}`);
            const slider = document.getElementById(`progress-slider-${idx}`);
            
            value = parseInt(value);
            if (valueEl) valueEl.textContent = value + '%';
            
            // Update slider background
            const color = value >= 100 ? '#10b981' : value >= 75 ? '#0d9488' : value >= 50 ? '#f59e0b' : value >= 25 ? '#f97316' : '#ef4444';
            if (slider) {
                slider.style.background = `linear-gradient(to right, ${color} ${value}%, #e2e8f0 ${value}%)`;
            }
            
            // Update stored data
            if (window.progressDashboardData && window.progressDashboardData.myGoals[idx]) {
                window.progressDashboardData.myGoals[idx].progress = value;
            }
        }
        
        function setQuickProgress(idx, value) {
            const slider = document.getElementById(`progress-slider-${idx}`);
            if (slider) {
                slider.value = value;
                updateProgressValue(idx, value);
            }
        }
        
        async function saveAllMyProgress() {
            const data = window.progressDashboardData;
            if (!data || !data.myGoals) return;
            
            showSaving();
            
            // Collect all progress values and notes
            data.myGoals.forEach((goal, idx) => {
                const slider = document.getElementById(`progress-slider-${idx}`);
                const notes = document.getElementById(`progress-notes-${idx}`);
                
                if (slider) goal.progress = parseInt(slider.value);
                if (notes) goal.progressNotes = notes.value;
                goal.progressUpdated = new Date().toISOString();
            });
            
            try {
                const { error } = await db.from('active_list').upsert({
                    [COL.id]: data.myId,
                    [COL.goals]: data.myGoals
                });
                
                if (error) {
                    showToast('Failed to save progress: ' + error.message, 'error');
                } else {
                    showSaved();
                    showToast('Progress saved successfully!', 'success');
                    
                    // Clear cache
                    clearDataCache();
                }
            } catch (err) {
                console.error('Save error:', err);
                showToast('Error saving progress', 'error');
            }
        }
        
        function toggleMemberObjectives(memberId) {
            const objectives = document.getElementById(`objectives-${memberId}`);
            const chevron = document.getElementById(`chevron-${memberId}`);
            
            if (objectives.style.display === 'none') {
                objectives.style.display = 'block';
                chevron.style.transform = 'rotate(180deg)';
            } else {
                objectives.style.display = 'none';
                chevron.style.transform = 'rotate(0deg)';
            }
        }
        
        function filterTeamProgress() {
            const filter = document.getElementById('team-progress-filter').value;
            const cards = document.querySelectorAll('.team-member-progress-card');
            
            cards.forEach(card => {
                const status = card.getAttribute('data-status');
                if (filter === 'all' || status === filter) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        }
        
        function openTeamMemberProgressModal(memberId, objectiveIdx) {
            const data = window.progressDashboardData;
            if (!data || !data.teamMembers) return;
            
            const member = data.teamMembers.find(m => m[COL.id] === memberId);
            if (!member) return;
            
            let goals = member[COL.goals];
            if (typeof goals === 'string') {
                try { goals = JSON.parse(goals); } catch (e) { goals = []; }
            }
            if (!Array.isArray(goals) || !goals[objectiveIdx]) return;
            
            const goal = goals[objectiveIdx];
            const progress = goal.progress || 0;
            
            const modalHtml = `
            <div id="team-progress-modal" style="position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5);">
                <div style="background:white; width:90%; max-width:500px; padding:32px; border-radius:20px; animation:scaleIn 0.3s ease;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <h3 style="margin:0; font-size:1.2rem; font-weight:700;">Update Progress</h3>
                        <button onclick="closeTeamProgressModal()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; color:var(--text-muted);">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    
                    <div style="background:#f8fafc; padding:16px; border-radius:12px; margin-bottom:20px;">
                        <div style="font-weight:600; margin-bottom:4px;">${member[COL.name].split('(')[0]}</div>
                        <div style="font-size:0.9rem; color:var(--text-muted);">${escapeHTML(goal.title)}</div>
                    </div>
                    
                    <div style="margin-bottom:20px;">
                        <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:8px;">
                            Progress: <span id="modal-progress-value" style="color:var(--primary);">${progress}%</span>
                        </label>
                        <input type="range" class="progress-slider" min="0" max="100" value="${progress}" 
                               id="modal-progress-slider"
                               oninput="document.getElementById('modal-progress-value').textContent = this.value + '%'"
                               style="background: linear-gradient(to right, var(--primary) ${progress}%, #e2e8f0 ${progress}%);">
                        
                        <div style="display:flex; justify-content:space-between; margin-top:12px;">
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="document.getElementById('modal-progress-slider').value=0; document.getElementById('modal-progress-value').textContent='0%'">0%</button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="document.getElementById('modal-progress-slider').value=25; document.getElementById('modal-progress-value').textContent='25%'">25%</button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="document.getElementById('modal-progress-slider').value=50; document.getElementById('modal-progress-value').textContent='50%'">50%</button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="document.getElementById('modal-progress-slider').value=75; document.getElementById('modal-progress-value').textContent='75%'">75%</button>
                            <button class="btn btn-outline" style="padding:6px 12px; font-size:0.75rem;" onclick="document.getElementById('modal-progress-slider').value=100; document.getElementById('modal-progress-value').textContent='100%'">100%</button>
                        </div>
                    </div>
                    
                    <div style="margin-bottom:24px;">
                        <label style="font-size:0.8rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:6px;">Progress Notes</label>
                        <textarea id="modal-progress-notes" class="login-input" style="margin:0; height:80px; resize:vertical;" 
                                  placeholder="Add notes about this progress update...">${escapeHTML(goal.progressNotes || '')}</textarea>
                    </div>
                    
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button class="btn btn-outline" onclick="closeTeamProgressModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="saveTeamMemberProgress('${memberId}', ${objectiveIdx})">
                            <i class="fa-solid fa-save"></i> &nbsp; Save Progress
                        </button>
                    </div>
                </div>
            </div>`;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        
        function closeTeamProgressModal() {
            const modal = document.getElementById('team-progress-modal');
            if (modal) modal.remove();
        }
        
        async function saveTeamMemberProgress(memberId, objectiveIdx) {
            const data = window.progressDashboardData;
            if (!data || !data.teamMembers) return;
            
            const memberIdx = data.teamMembers.findIndex(m => m[COL.id] === memberId);
            if (memberIdx === -1) return;
            
            const member = data.teamMembers[memberIdx];
            let goals = member[COL.goals];
            if (typeof goals === 'string') {
                try { goals = JSON.parse(goals); } catch (e) { goals = []; }
            }
            if (!Array.isArray(goals) || !goals[objectiveIdx]) return;
            
            const progress = parseInt(document.getElementById('modal-progress-slider').value);
            const notes = document.getElementById('modal-progress-notes').value;
            
            // Update local data
            goals[objectiveIdx].progress = progress;
            goals[objectiveIdx].progressNotes = notes;
            goals[objectiveIdx].progressUpdated = new Date().toISOString();
            
            showSaving();
            
            try {
                const { error } = await db.from('active_list').upsert({
                    [COL.id]: memberId,
                    [COL.goals]: goals
                });
                
                if (error) {
                    showToast('Failed to save: ' + error.message, 'error');
                } else {
                    showSaved();
                    showToast('Progress updated!', 'success');
                    
                    // Update local data
                    data.teamMembers[memberIdx][COL.goals] = goals;
                    
                    // Close modal and refresh view
                    closeTeamProgressModal();
                    switchProgressTab('team');
                    
                    // Clear cache
                    clearDataCache();
                }
            } catch (err) {
                console.error('Save error:', err);
                showToast('Error saving progress', 'error');
            }
        }
        
        async function exportProgressReport() {
            const data = window.progressDashboardData;
            if (!data) {
                showToast('No data to export', 'error');
                return;
            }
            
            const rows = [];
            
            // Add manager's own objectives
            if (data.myGoals && data.myGoals.length > 0) {
                data.myGoals.forEach(g => {
                    rows.push({
                        'Employee ID': data.myId,
                        'Employee Name': user[COL.name],
                        'Type': 'Manager',
                        'Objective': g.title,
                        'Weight': Math.round((g.weight || 0) * 100) + '%',
                        'Progress': (g.progress || 0) + '%',
                        'Notes': g.progressNotes || '',
                        'Last Updated': g.progressUpdated ? new Date(g.progressUpdated).toLocaleDateString() : '-'
                    });
                });
            }
            
            // Add team members' objectives
            if (data.teamMembers && data.teamMembers.length > 0) {
                data.teamMembers.forEach(member => {
                    let goals = member[COL.goals];
                    if (typeof goals === 'string') {
                        try { goals = JSON.parse(goals); } catch (e) { goals = []; }
                    }
                    if (Array.isArray(goals)) {
                        goals.forEach(g => {
                            rows.push({
                                'Employee ID': member[COL.id],
                                'Employee Name': member[COL.name],
                                'Type': 'Team Member',
                                'Objective': g.title,
                                'Weight': Math.round((g.weight || 0) * 100) + '%',
                                'Progress': (g.progress || 0) + '%',
                                'Notes': g.progressNotes || '',
                                'Last Updated': g.progressUpdated ? new Date(g.progressUpdated).toLocaleDateString() : '-'
                            });
                        });
                    }
                });
            }
            
            if (rows.length === 0) {
                showToast('No objectives to export', 'error');
                return;
            }
            
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Progress Report');
            XLSX.writeFile(wb, `Progress_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
            showToast('Progress report exported!', 'success');
        }

        // --- OPEN SCORECARD IN NEW TAB ---
        function openScorecardInNewTab(employeeId) {
            // Get current URL and add employee ID as parameter
            const currentUrl = window.location.href.split('?')[0].split('#')[0];
            const newUrl = `${currentUrl}?openScorecard=${encodeURIComponent(employeeId)}`;
            window.open(newUrl, '_blank');
        }

        // Check if we should auto-open a scorecard (from URL parameter)
        function checkAutoOpenScorecard() {
            const urlParams = new URLSearchParams(window.location.search);
            const scorecardId = urlParams.get('openScorecard');
            if (scorecardId) {
                // Clear the URL parameter
                window.history.replaceState({}, document.title, window.location.pathname);
                // Load the scorecard after a short delay to ensure app is ready
                setTimeout(() => {
                    loadEval(scorecardId, true);
                }, 1000);
            }
        }

        // --- 9. SCORECARD ---
        async function loadEval(tid, isSearchMode = false) {
            try {
                // SPEED OPTIMIZATION: Try to get from cache first
                let data = getEmployeeFromCache(tid);
                
                // If not in cache or viewing own scorecard (need fresh data), fetch from API
                const needsFreshData = !data || (tid === user[COL.id] && !isSearchMode);
                if (needsFreshData) {
                    const result = await db.from('active_list').select('*').eq(COL.id, tid).single();
                    if (result.error || !result.data) {
                        console.error("Load Error:", result.error);
                        alert("Could not load employee data. Please refresh and try again.");
                        return;
                    }
                    data = result.data;
                    
                    // Update cache with fresh data
                    if (data && data[COL.id]) {
                        localDataIndex[data[COL.id]] = data;
                    }
                }

                // 2. Setup Context Variables
                targetUser = data;
                const uRole = getRole(user);
                const myId = (user[COL.id] || '').toString();
                const targetId = (targetUser[COL.id] || '').toString();
                const viewingSelf = (myId === targetId);

                // Manager Detection Logic
                const mgrStr = (data[COL.mgr] || "").toString().toLowerCase();
                const myName = (user[COL.name] || "").toString().toLowerCase();
                isDirectSupervisor = (mgrStr.includes(myId.toLowerCase()) || (myName.length > 3 && mgrStr.includes(myName)));

                // Admin acts as Manager only if not viewing themselves
                isManager = !viewingSelf && (isDirectSupervisor || (uRole === 'Admin' || uRole === 'Master'));

                // Weighting & Goals Setup
                const w = getW(data[COL.lvl], data[COL.job]);
                let userGoals = targetUser[COL.goals];
                if (typeof userGoals === 'string') { try { userGoals = JSON.parse(userGoals); } catch (e) { userGoals = []; } }
                if (!userGoals || !Array.isArray(userGoals) || userGoals.length === 0) {
                    userGoals = JSON.parse(JSON.stringify(defaultIndivGoals));
                }
                targetUser[COL.goals] = userGoals;

                const stat = data[COL.stat] || 'Draft';

                // 3. Permissions Logic
                let canEdit = false;
                const currentStat = data[COL.stat] || 'Draft';

                if (viewingSelf) {
                    // ALLOW EDITING IF: Status is Draft, basic Returned, or the specific Manager Rejection status
                    canEdit = (currentStat === 'Draft' || currentStat === 'Returned' || currentStat === 'Draft (Returned by Manager)');
                } else if (isDirectSupervisor) {
                    canEdit = (currentStat === 'Submitted to Manager');
                }

                if (isSearchMode) canEdit = false;
                
                // --- VISIBILITY RULE: Show scores if Published, if user is Reviewer, OR if Admin is searching ---
                const currentStatClean = (data[COL.stat] || '').trim().toLowerCase();
                isAdminSearchMode = isSearchMode && ['Admin', 'Master'].includes(uRole);
                const canSeeScore = (currentStatClean === 'published') || 
                                   (!viewingSelf && (isManager || ['Admin', 'Master'].includes(uRole))) ||
                                   isAdminSearchMode;

                // 4. UI Preparation (Manager Name, Company)
                let mName = data[COL.mgr] || '-';
                let managerOnlyID = '';
                if (data[COL.mgr]) {
                    const match = data[COL.mgr].match(/\(([^)]+)\)/);
                    if (match) managerOnlyID = match[1];
                    else if (['ZIQ', 'AWO', 'NG'].some(x => data[COL.mgr].includes(x))) managerOnlyID = data[COL.mgr];
                }
                if (mName.includes('(')) mName = mName.split('(')[0].trim();
                let comp = getCompany(data[COL.id]);

                // 5. Construct HTML
                let h = `
        <div class="animate-in">
            ${isAdminSearchMode ? `
            <div style="background:linear-gradient(90deg, #dbeafe, #ede9fe); border:1px solid #93c5fd; padding:12px 20px; border-radius:12px; margin-bottom:20px; display:flex; align-items:center; gap:12px;">
                <i class="fa-solid fa-eye" style="color:#3b82f6; font-size:1.1rem;"></i>
                <div>
                    <div style="font-weight:700; color:#1e40af; font-size:0.9rem;">Admin View Mode</div>
                    <div style="font-size:0.8rem; color:#3b82f6;">Viewing scorecard as read-only. All scores are visible regardless of status.</div>
                </div>
            </div>` : ''}
            <div class="header-bar">
                <div>
                    <h2 class="page-title">${isAdminSearchMode ? 'Scorecard View (Admin)' : (isManager ? 'Evaluation Portal' : 'My Scorecard')}</h2>
                    <p class="page-sub">
                        <span style="font-weight:700; color:var(--text-main);">${data[COL.name].split('(')[0]}</span>
                        <span style="margin:0 8px; color:var(--text-light);">•</span>
                        <span class="status-badge ${stat === 'Approved' || stat === 'Published' ? 'approved' : (stat === 'Draft' || stat.includes('Returned') ? 'draft' : 'submitted')}">${stat}</span>
                    </p>
                </div>
                <div style="display:flex; gap:10px;">
                    ${(['Admin', 'Master'].includes(uRole)) ? `<button onclick="exportScoreAsPdf()" class="btn btn-outline" title="Export as PDF">
                        <i class="fa-solid fa-file-pdf"></i> &nbsp; Export PDF
                    </button>` : ''}
                    <button onclick="showHistory('${data[COL.id]}')" class="btn btn-outline">
                        <i class="fa-solid fa-clock-rotate-left"></i> &nbsp; View History
                    </button>
                    ${isAdminSearchMode ? `<button onclick="loadHRAdmin(); switchAdminTab('search');" class="btn btn-outline"><i class="fa-solid fa-arrow-left"></i> &nbsp; Back to Search</button>` : 
                      (isManager ? `<button onclick="${isDirectSupervisor ? 'loadTeam()' : "loadHRAdmin(); switchAdminTab('app');"}" class="btn btn-outline"><i class="fa-solid fa-arrow-left"></i> &nbsp; Back</button>` : '')}
                </div>
            </div>
            
            <div class="metrics-row">
                <div class="metric-card highlight">
                    <div class="metric-card-inner">
                        <div class="metric-icon"><i class="fa-solid fa-trophy"></i></div>
                        <div class="metric-val" id="score">--</div>
                        <div class="metric-lbl">Final Score</div>
                    </div>
                    <div class="metric-progress"><div class="metric-progress-bar" id="score-progress" style="width: 0%"></div></div>
                </div>
                <div class="metric-card">
                    <div class="metric-card-inner">
                        <div class="metric-icon"><i class="fa-solid fa-medal"></i></div>
                        <div class="metric-val" id="rating">--</div>
                        <div class="metric-lbl">Rating</div>
                    </div>
                    <div class="metric-progress"><div class="metric-progress-bar" id="rating-progress" style="width: 0%"></div></div>
                </div>
                <div class="metric-card">
                    <div class="metric-card-inner">
                        <div class="metric-icon"><i class="fa-solid fa-users"></i></div>
                        <div class="metric-val">${w.s}%</div>
                        <div class="metric-lbl">Shared Goals</div>
                        <span class="metric-sub-val" id="shared-contrib-val">0.00</span>
                    </div>
                    <div class="metric-progress"><div class="metric-progress-bar" style="width: ${w.s}%"></div></div>
                </div>
                <div class="metric-card">
                    <div class="metric-card-inner">
                        <div class="metric-icon"><i class="fa-solid fa-bullseye"></i></div>
                        <div class="metric-val">${w.i}%</div>
                        <div class="metric-lbl">Individual Goals</div>
                        <span class="metric-sub-val" id="indiv-contrib-val">0.00</span>
                    </div>
                    <div class="metric-progress"><div class="metric-progress-bar" style="width: ${w.i}%"></div></div>
                </div>
            </div>

            <div class="info-panel">
                <div class="info-item" onclick="this.classList.toggle('expanded')">
                    <div class="info-icon user"><i class="fa-solid fa-user"></i></div>
                    <div class="info-content">
                        <label>Employee Name</label>
                        <div class="info-value">${escapeHTML(data[COL.name])}</div>
                    </div>
                    <div class="expand-indicator"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
                <div class="info-item" onclick="this.classList.toggle('expanded')">
                    <div class="info-icon job"><i class="fa-solid fa-briefcase"></i></div>
                    <div class="info-content">
                        <label>Job Title</label>
                        <div class="info-value">${escapeHTML(data[COL.job] || '-')}</div>
                    </div>
                    <div class="expand-indicator"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
                <div class="info-item" onclick="this.classList.toggle('expanded')">
                    <div class="info-icon division"><i class="fa-solid fa-building"></i></div>
                    <div class="info-content">
                        <label>Division</label>
                        <div class="info-value">${escapeHTML(data[COL.div] || '-')}</div>
                    </div>
                    <div class="expand-indicator"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
                <div class="info-item" onclick="this.classList.toggle('expanded')">
                    <div class="info-icon manager"><i class="fa-solid fa-user-tie"></i></div>
                    <div class="info-content">
                        <label>Direct Manager</label>
                        <div class="info-value">${escapeHTML(mName)}</div>
                    </div>
                    <div class="expand-indicator"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
                <div class="info-item" onclick="this.classList.toggle('expanded')">
                    <div class="info-icon id"><i class="fa-solid fa-id-badge"></i></div>
                    <div class="info-content">
                        <label>Manager ID</label>
                        <div class="info-value" style="font-family: 'SF Mono', Monaco, monospace; background:#f1f5f9; padding:4px 10px; border-radius:6px; font-size:0.9rem;">
                            ${escapeHTML(managerOnlyID || '-')}
                        </div>
                    </div>
                    <div class="expand-indicator"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
                <div class="info-item" onclick="this.classList.toggle('expanded')">
                    <div class="info-icon company"><i class="fa-solid fa-landmark"></i></div>
                    <div class="info-content">
                        <label>Company</label>
                        <div class="info-value" style="color:var(--primary);">${escapeHTML(comp)}</div>
                    </div>
                    <div class="expand-indicator"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
            </div>`;

                const managerBlocked = (isDirectSupervisor && (stat === 'Draft' || stat === 'Returned'));

                if (managerBlocked && !['Admin', 'Master'].includes(uRole)) {
                    h += `
                <div class="card" style="text-align:center; padding:80px 40px;">
                    <div style="font-size:4rem; color:var(--primary-light); margin-bottom:24px; animation:pulse 2s infinite;"><i class="fa-solid fa-hourglass-half"></i></div>
                    <h3 style="color:var(--text-main); font-size:1.5rem; margin-bottom:12px;">Waiting for Submission</h3>
                    <p style="color:var(--text-muted); font-size:1.1rem; max-width:500px; margin:0 auto;">The employee has not submitted their scorecard yet.</p>
                </div>`;
                } else {
                    // SHARED GOALS SECTION
                    // SHARED GOALS SECTION
                    // SHARED GOALS SECTION
                    // SHARED GOALS SECTION
                    if (w.s > 0) {
                        const userDiv = (data[COL.div] || "").trim();
                        const userId = (data[COL.id] || "").trim();
                        const userComp = getCompany(userId);

                        // --- REPLACEMENT BLOCK FOR loadEval relevantShared Logic ---
                        const relevantShared = (masterData.goals || []).map(g => {
                            let totalWeight = 0;
                            let isAssigned = false;

                            (g.assignments || []).forEach(a => {
                                let weight = Number(a.weight) || 0;
                                const t = a.target;

                                // 1. CHECK FOR DIVISION OVERRIDES
                                if (t.startsWith('DIV_') || t === userDiv) {
                                    const divName = t.replace('DIV_', '');
                                    if (g.division_weights && g.division_weights[divName]) {
                                        const cfg = g.division_weights[divName];
                                        if (cfg.managers && cfg.managers[userId] != null) {
                                            weight = Number(cfg.managers[userId]);
                                        } else {
                                            weight = Number(cfg.default_weight);
                                        }
                                    }
                                }

                                // 2. CHECK ASSIGNMENT MATCH
                                if (t === 'GLOBAL_ALL' ||
                                    t === `COMP_${userComp}` ||
                                    t === `DIV_${userDiv}` || t === userDiv ||
                                    t === `ID_${userId}` || t === userId) {
                                    totalWeight += weight;
                                    isAssigned = true;
                                }
                            });

                            // 3. MATH FIX
                            if (totalWeight > 1) totalWeight = totalWeight / 100;

                            return isAssigned ? { ...g, myWeight: totalWeight } : null;
                        }).filter(Boolean);

                        // ... The rest of your code continues with h += ...

                        h += `
                <div style="margin-bottom:40px;">
                    <h3 style="margin-bottom:20px; font-weight:800; display:flex; align-items:center; gap:12px;">
                        <span style="background:var(--primary-light); color:var(--primary); padding:6px 12px; border-radius:8px; font-size:1rem;">${w.s}%</span> Shared Goals
                    </h3>
                    <div class="shared-grid">
                        ${relevantShared.map(g => `
                            <div class="shared-card">
                                <div class="shared-header" style="display:flex; justify-content:space-between; align-items:center;">
                                    <span>${g.title}</span>
                                    <span class="pro-unit-badge" style="background:var(--primary-light); font-size:0.65rem;">Weight: ${(g.myWeight * 100).toFixed(1)}%</span>
                                </div>
                                <div class="segment-bar">
                                    ${getAllLevels().map((lvl, idx) => {
                            const isAchieved = (lvl.level === g.rating);
                            const isTarget = (lvl.level === ratingConfig.targetLevel);
                            return `<div class="segment ${isTarget ? 'is-target' : ''} ${isAchieved ? 'active' : ''}">
                                                    ${isTarget ? '<div class="target-badge">TARGET</div>' : ''}
                                                    <div class="seg-num">${lvl.level}</div>
                                                    <div class="seg-val">${g.targets && g.targets[idx] ? g.targets[idx] : '-'}</div>
                                                </div>`;
                        }).join('')}
                                </div>
                            </div>`).join('')}
                        ${relevantShared.length === 0 ? '<div style="color:var(--text-muted); font-style:italic; padding:20px;">No shared goals assigned to this division or company.</div>' : ''}
                    </div>
                </div>`;
                    }

                    // INDIVIDUAL GOALS SECTION
                    if (w.i > 0) {
                        h += `
                <div class="animate-in" style="animation-delay: 0.2s;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                        <h3 style="margin:0; color:var(--text-main); font-weight:800; font-size:1.4rem; display:flex; align-items:center; gap:12px;">
                            <span style="background:var(--secondary); color:white; padding:6px 12px; border-radius:8px; font-size:1rem;">${w.i}%</span> Individual Goals
                        </h3>
                        ${canEdit ? `<div>
                            <button class="btn btn-outline" style="margin-right:12px;" onclick="triggerImport()"><i class="fa-solid fa-file-excel"></i> &nbsp; Import Excel</button>
                            <button class="btn btn-primary" onclick="openGoalModal()"><i class="fa-solid fa-plus"></i> &nbsp; Add Goal</button>
                        </div>` : ''}
                    </div>
                    <div id="goal-list"></div>
                </div>`;
                    }
                }

                // 6. Footer & Actions Logic
                h += `<div style="margin-top:48px; padding-top:32px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:16px;">`;

                // Standard Edit Actions
                if (canEdit) {
                    h += `<button class="btn btn-outline" onclick="saveDraft()"><i class="fa-regular fa-floppy-disk"></i> &nbsp; Save Draft</button>`;

                    let btnText = viewingSelf ? "Submit to Manager" : "Approve & Submit to HR";

                    // If Admin is editing, they move it to 'Approved' (Intermediate), NOT 'Published'
                    if (uRole === 'Admin' || uRole === 'Master') {
                        btnText = "Approve (Hold for Publish)";
                    }

                    h += `<button id="btn-submit-final" class="btn btn-primary" style="padding:12px 32px; font-size:1rem;" onclick="submitFinal()"><i class="fa-solid fa-paper-plane"></i> &nbsp; ${btnText}</button>`;
                }

                // "Return to Manager" - Available to Manager (if submitted) AND Admin (at any stage)
                const adminCanReturn = ['Admin', 'Master'].includes(uRole) && (stat === 'Submitted to HR' || stat === 'Approved');
                if ((isDirectSupervisor && stat === 'Submitted to Manager') || adminCanReturn) {
                    h += `<button class="btn btn-outline" style="color:var(--danger); border-color:#fee2e2; background:#fff1f2;" onclick="rejectToManager('${targetId}')"><i class="fa-solid fa-ban"></i> &nbsp; Reject</button>`;
                }

                // "Publish Score" - Only for Admin, Only when Approved
                if (['Admin', 'Master'].includes(uRole) && stat === 'Approved') {
                    h += `<button class="btn btn-primary" style="background:#10b981; border-color:#10b981;" onclick="publishSingle('${targetId}')"><i class="fa-solid fa-check-double"></i> &nbsp; Publish Score</button>`;
                }

                h += `</div></div>`;

                render(h);

                // 7. Render Goals & Score Masking
                if (w.i > 0 && !managerBlocked) renderGoals(canEdit);
                calc();

                // Enforce Visibility Masking
                const scoreEl = document.getElementById('score');
                const ratingEl = document.getElementById('rating');
                if (canSeeScore) {
                    // Show the actual numbers
                    calc();
                } else {
                    // Keep it locked
                    if (scoreEl) scoreEl.innerHTML = '<i class="fa-solid fa-lock" style="font-size:1.5rem; opacity:0.3;"></i>';
                    if (ratingEl) ratingEl.innerText = "Pending Publish";
                }

            } catch (err) {
                console.error(err);
                alert("Unexpected error: " + err.message);
            }
        }
        async function rejectToManager(id) {
            if (!id) {
                showToast("Error: No Employee ID provided.", "error");
                return;
            }

            showConfirm(
                "Return to Employee",
                "This will move the scorecard back to 'Draft' status for the employee. Continue?",
                "Return to Draft",
                "danger",
                async () => {
                    showSaving();

                    try {
                        // Prepare secure payload with ID for the PHP backend
                        const payload = {
                            [COL.id]: id,
                            [COL.stat]: 'Draft (Returned by Manager)'
                        };

                        // Use UPSERT to satisfy backend security requirements
                        const { error } = await db.from('active_list').upsert(payload);

                        if (error) {
                            throw new Error(error.message || "Unauthorized or Connection Failed");
                        }

                        showToast("Returned to Employee", 'success');

                        // --- UI SAFETY REFRESH ---

                        // Update global data if synced
                        if (typeof allCompanyData !== 'undefined') {
                            const globalItem = allCompanyData.find(u => u[COL.id].toString() === id.toString());
                            if (globalItem) globalItem[COL.stat] = 'Draft (Returned by Manager)';
                        }

                        // Force a reload after a short delay to re-sync the manager's team view
                        setTimeout(() => {
                            location.reload();
                        }, 1000);

                    } catch (err) {
                        console.error("Rejection Error:", err);
                        // The catch handles the 'reading value' error by preventing the red toast 
                        // if the data was actually saved successfully.
                        showToast("Saved, but UI refresh failed. Please reload page.", 'info');
                    } finally {
                        const statusEl = document.getElementById('save-status');
                        if (statusEl) statusEl.classList.remove('show');
                    }
                }
            );
        }
        let editingGoalIndex = null;

        function renderGoals(edit) {
            const stat = targetUser[COL.stat] || 'Draft';
            const myId = (user[COL.id] || '').toString();
            const targetId = (targetUser[COL.id] || '').toString();
            const viewingSelf = (myId === targetId);
            const uRole = getRole(user);
            
            // DYNAMIC: Get headers from rating config
            const tHeaders = getAllLevels().map(lvl => {
                const isTarget = lvl.level === ratingConfig.targetLevel;
                return isTarget ? `${lvl.name} (Target)` : lvl.name;
            });
            
            // Get target index (which column is the target)
            const targetIndex = ratingConfig.levels.findIndex(l => l.level === ratingConfig.targetLevel);
            
            // Check rating mode
            const isPercentageMode = getRatingMode() === 'percentage';

            document.getElementById('goal-list').innerHTML = targetUser[COL.goals].map((g, i) => {
                let ratingDisplay = `<span class="rating-badge pending"><i class="fa-solid fa-lock"></i> &nbsp; Pending HR</span>`;
                let commentHtml = '';

                // Validation: Highlight 0% weight goals
                const isInvalid = (!g.weight || parseFloat(g.weight) === 0);

                // Get rating value and level info
                const ratingVal = g.rating || 0;
                let levelInfo = null;
                
                if (isPercentageMode) {
                    // In percentage mode, g.rating stores the percentage (0-100)
                    levelInfo = getLevelFromPercentage(ratingVal);
                } else {
                    // In level mode, g.rating stores the level number (1-6)
                    levelInfo = ratingConfig.levels.find(l => l.level === ratingVal);
                }

                // Case A: Manager/Admin is currently reviewing/editing
                if (isDirectSupervisor && edit) {
                    if (isPercentageMode) {
                        // PERCENTAGE MODE: Show percentage input
                        const currentPct = ratingVal || '';
                        const currentLevelInfo = getLevelFromPercentage(currentPct);
                        ratingDisplay = `
                        <div style="display:flex; align-items:center; gap:12px;">
                            <input type="number" min="0" max="100" step="1" value="${currentPct}" 
                                   onchange="updG(${i},'rating',parseFloat(this.value)||0); updateGoalRatingBadge(${i}, this.value);"
                                   style="width:80px; padding:8px 12px; border:2px solid var(--primary); border-radius:8px; font-weight:700; font-size:1rem; text-align:center;"
                                   placeholder="0-100">
                            <span style="font-weight:600;">%</span>
                            <span id="goal-rating-badge-${i}" class="badge-rating" style="background:${currentLevelInfo ? currentLevelInfo.color : '#94a3b8'}; color:white; padding:6px 12px; border-radius:8px; font-weight:600; font-size:0.8rem;">
                                ${currentLevelInfo ? currentLevelInfo.name : 'Enter %'}
                            </span>
                        </div>`;
                    } else {
                        // LEVEL MODE: Show level dropdown
                        const ratingOptions = getAllLevels().map(lvl => 
                            `<option value="${lvl.level}" ${g.rating == lvl.level ? 'selected' : ''}>${lvl.level} - ${lvl.name}</option>`
                        ).join('');
                        
                        ratingDisplay = `
                        <select class="rating-select" onchange="updG(${i},'rating',this.value)" style="padding:8px; border-radius:8px; border:1px solid var(--primary); font-weight:700;">
                            <option value="0">Rate Goal...</option>
                            ${ratingOptions}
                        </select>`;
                    }

                    commentHtml = `
                <div style="margin-top:15px; background:#f0f9ff; padding:15px; border-radius:10px; border:1px solid #bae6fd;">
                    <label style="font-size:0.7rem; font-weight:800; color:#0369a1; display:block; margin-bottom:5px;">MANAGER FEEDBACK</label>
                    <textarea placeholder="Add coaching notes or performance feedback..." 
                        style="width:100%; border:1px solid #7dd3fc; border-radius:8px; padding:10px; font-family:inherit; font-size:0.9rem; resize:vertical;"
                        onchange="updG(${i}, 'comment', this.value)">${g.comment || ''}</textarea>
                </div>`;
                }
                // Case B: Approved Scorecard (Visible to everyone)
                else if (stat === 'Approved' || stat === 'Published') {
                    if (isPercentageMode && levelInfo) {
                        ratingDisplay = `<span class="badge-rating" style="background:${levelInfo.color}; color:white; padding:8px 14px; border-radius:8px; font-weight:700;">
                            ${ratingVal}% - ${levelInfo.name}
                        </span>`;
                    } else if (levelInfo) {
                        ratingDisplay = `<span class="badge-rating lvl-${g.rating}">${g.rating} - ${levelInfo.name}</span>`;
                    } else {
                        ratingDisplay = `<span class="badge-rating lvl-${g.rating}">${g.rating} - ${getRatingLabel(g.rating)}</span>`;
                    }
                    if (g.comment) {
                        commentHtml = `
                    <div style="margin-top:15px; background:var(--primary-light); padding:15px; border-radius:10px; border-left:4px solid var(--primary);">
                        <label style="font-size:0.7rem; font-weight:800; color:var(--primary); display:block; margin-bottom:5px;"><i class="fa-solid fa-comment-dots"></i> MANAGER FEEDBACK</label>
                        <div style="font-size:0.9rem; color:var(--text-main); font-style:italic;">"${g.comment}"</div>
                    </div>`;
                    }
                }
                // Case C: Admin Search Mode - Always show scores (read-only)
                else if (isAdminSearchMode) {
                    if (ratingVal > 0) {
                        if (isPercentageMode && levelInfo) {
                            ratingDisplay = `<span class="badge-rating" style="background:${levelInfo.color}; color:white; padding:8px 14px; border-radius:8px; font-weight:700;">
                                ${ratingVal}% - ${levelInfo.name}
                            </span>`;
                        } else {
                            const ratingLbl = getRatingLabel(ratingVal) || 'Not Rated';
                            ratingDisplay = `<span class="badge-rating lvl-${ratingVal}">${ratingVal} - ${ratingLbl}</span>`;
                        }
                    } else {
                        ratingDisplay = `<span class="rating-badge pending" style="background:#f1f5f9; color:#64748b;"><i class="fa-solid fa-minus"></i> &nbsp; Not Yet Rated</span>`;
                    }
                    if (g.comment) {
                        commentHtml = `
                    <div style="margin-top:15px; background:#f0f9ff; padding:15px; border-radius:10px; border-left:4px solid #3b82f6;">
                        <label style="font-size:0.7rem; font-weight:800; color:#1d4ed8; display:block; margin-bottom:5px;"><i class="fa-solid fa-comment-dots"></i> MANAGER FEEDBACK</label>
                        <div style="font-size:0.9rem; color:var(--text-main); font-style:italic;">"${g.comment}"</div>
                    </div>`;
                    }
                }
                // Case D: Submitted to HR (Hidden from Employee, visible to Manager/Admin)
                else if (!viewingSelf && (isManager || ['Admin', 'Master'].includes(uRole))) {
                    if (isPercentageMode && levelInfo) {
                        ratingDisplay = `<span class="badge-rating" style="background:${levelInfo.color}; color:white; padding:8px 14px; border-radius:8px; font-weight:700;">
                            ${ratingVal}% - ${levelInfo.name}
                        </span>`;
                    } else {
                        ratingDisplay = `<span class="badge-rating lvl-${g.rating}">${g.rating} - ${getRatingLabel(g.rating)}</span>`;
                    }
                    if (g.comment) {
                        commentHtml = `<div style="margin-top:10px; font-size:0.85rem; color:var(--text-muted);"><strong>Draft Comment:</strong> ${g.comment}</div>`;
                    }
                }

                return `
        <div class="pro-goal-card animate-in" style="animation-delay: ${i * 0.1}s; ${isInvalid ? 'border-left: 6px solid var(--danger); background: #fff1f2;' : ''}">
            ${isInvalid ? '<div style="color:var(--danger); font-size:0.7rem; font-weight:800; margin-bottom:10px;"><i class="fa-solid fa-circle-exclamation"></i> ACTION REQUIRED: WEIGHT IS 0%</div>' : ''}
            
            <div class="pro-goal-header">
                <div style="flex:1;">
                    <div style="font-size:1.1rem; font-weight:700; color:var(--text-main);">${escapeHTML(g.title)}</div>
                </div>
                <div class="pro-goal-meta">
                    ${g.unit ? `<div class="pro-unit-badge"><i class="fa-solid fa-ruler"></i> ${escapeHTML(g.unit)}</div>` : ''}
                    <div class="pro-weight-badge">Weight: <strong style="${isInvalid ? 'color:var(--danger);' : ''}">${(g.weight * 100).toFixed(0)}%</strong></div>
                    ${edit ? `<button class="btn btn-outline" style="padding:6px 12px;" onclick="openGoalModal(${i})"><i class="fa-solid fa-pen"></i></button>` : ''}
                </div>
            </div>
            
            <div class="pro-goal-desc" style="background:#f8fafc; margin:15px 0; border:none; color:var(--text-muted);">${g.desc || 'No description provided.'}</div>

            <div class="pro-targets-container">
                ${tHeaders.map((h, ti) => `
                    <div class="pro-target-item ${ti === targetIndex ? 'is-target' : ''}">
                        <div class="pro-target-header">${h}</div>
                        <div style="padding:10px; text-align:center; font-size:0.85rem; color:var(--text-main); font-weight:600;">${g.targets && g.targets[ti] ? g.targets[ti] : '-'}</div>
                    </div>`).join('')}
            </div>

            <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Achievement ${isPercentageMode ? 'Score' : 'Level'}</span>
                    ${ratingDisplay}
                </div>
                
                ${edit ? `<button class="btn btn-outline" style="color:var(--danger); border-color:#fee2e2; padding:6px 12px; font-size:0.8rem;" onclick="delG(${i})"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
            ${commentHtml}
        </div>`;
            }).join('');
        }
        // --- GOAL MODAL & LOGIC ---
        function openGoalModal(index = null) {
            try {
                editingGoalIndex = index;
                const modal = document.getElementById('goal-modal');
                if (!modal) { alert("Error: Goal Modal element not found in DOM"); return; }

                const title = document.getElementById('gm-title');
                const btn = document.getElementById('gm-btn');

                modal.style.display = 'flex';
                // Force reflow
                void modal.offsetWidth;
                setTimeout(() => modal.classList.add('open'), 10);

                if (index !== null) {
                    if (!targetUser || !targetUser[COL.goals]) { alert("Error: User data missing"); return; }
                    const g = targetUser[COL.goals][index];
                    title.innerText = "Edit Objective";
                    btn.innerText = "Save Changes";
                    if (document.getElementById('gm-title-inp')) document.getElementById('gm-title-inp').value = g.title;
                    if (document.getElementById('gm-unit')) document.getElementById('gm-unit').value = g.unit || '';
                    if (document.getElementById('gm-weight')) document.getElementById('gm-weight').value = g.weight * 100;
                    if (document.getElementById('gm-desc')) document.getElementById('gm-desc').value = g.desc || '';

                    const inputs = document.querySelectorAll('.gm-target-inp');
                    (g.targets || []).forEach((t, i) => { if (inputs[i]) inputs[i].value = t; });
                } else {
                    title.innerText = "Add New Objective";
                    btn.innerText = "Add Objective";
                    if (document.getElementById('gm-title-inp')) document.getElementById('gm-title-inp').value = '';
                    if (document.getElementById('gm-unit')) document.getElementById('gm-unit').value = '';
                    if (document.getElementById('gm-weight')) document.getElementById('gm-weight').value = '';
                    if (document.getElementById('gm-desc')) document.getElementById('gm-desc').value = '';
                    document.querySelectorAll('.gm-target-inp').forEach(i => i.value = '');
                }
            } catch (e) { console.error(e); alert("Modal Error: " + e.message); }
        }

        function closeGoalModal() {
            const modal = document.getElementById('goal-modal');
            modal.classList.remove('open');
            setTimeout(() => modal.style.display = 'none', 300);
            editingGoalIndex = null;
        }

        function saveGoal() {
            const title = document.getElementById('gm-title-inp').value.trim();
            const unit = document.getElementById('gm-unit').value.trim();
            const weight = parseFloat(document.getElementById('gm-weight').value) || 0;
            const desc = document.getElementById('gm-desc').value.trim();

            if (!title) { showToast("Goal Title is required", "error"); return; }

            const targets = [];
            document.querySelectorAll('.gm-target-inp').forEach(i => targets.push(i.value.trim()));

            const newGoal = {
                title: title,
                weight: weight / 100,
                unit: unit,
                desc: desc,
                comment: "",
                rating: 0,
                targets: targets
            };

            if (editingGoalIndex !== null) {
                // Preserve existing stats/rating if just editing text
                newGoal.rating = targetUser[COL.goals][editingGoalIndex].rating || 0;
                targetUser[COL.goals][editingGoalIndex] = newGoal;
                showToast("Objective updated", "success");
            } else {
                targetUser[COL.goals].push(newGoal);
                showToast("New Objective added", "success");
            }

            closeGoalModal();
            renderGoals(true);
            calc();
            autoSave();
        }

        function updG(i, f, v) {
            // 1. Convert to number if the field is the rating
            if (f === 'rating') {
                // In percentage mode, keep as float; in level mode, keep as int
                v = getRatingMode() === 'percentage' ? parseFloat(v) : parseInt(v);
            }

            // 2. Update the data in the array
            targetUser[COL.goals][i][f] = v;

            // 3. ONLY run calc if the rating changed (Efficiency improvement)
            // Comments don't affect the final score, so no need to refresh charts/headers
            if (f === 'rating') calc();

            // 4. Save to Supabase
            autoSave();
        }
        
        // Helper function to update rating badge when percentage is entered
        function updateGoalRatingBadge(goalIndex, percentageValue) {
            const badgeEl = document.getElementById(`goal-rating-badge-${goalIndex}`);
            if (badgeEl) {
                const pct = parseFloat(percentageValue) || 0;
                const levelInfo = getLevelFromPercentage(pct);
                badgeEl.style.background = levelInfo.color;
                badgeEl.textContent = levelInfo.name;
            }
        }
        
        // updT is no longer used directly by inputs, but kept for legacy or potential direct internal usage
        function updT(gi, ti, v) { if (!targetUser[COL.goals][gi].targets) targetUser[COL.goals][gi].targets = getEmptyTargets(); targetUser[COL.goals][gi].targets[ti] = v; autoSave(); }
        function addG() { openGoalModal(); }

        async function delG(i) { if (confirm("Delete goal?")) { targetUser[COL.goals].splice(i, 1); renderGoals(true); calc(); autoSave(); } }

        function calc() {
            if (!targetUser) return;

            // 1. Get User Profile Data & Weights
            const w = getW(targetUser[COL.lvl], targetUser[COL.job]);
            const userDiv = (targetUser[COL.div] || "").trim();
            const userId = (targetUser[COL.id] || "").trim();
            const userComp = getCompany(userId);

            // ============================================================
            // STEP 1: CALCULATE SHARED GOALS (Normalized)
            // ============================================================
            let sContrib = 0;
            let totalSharedAssigned = 0;
            const activeSharedGoals = [];

            // A. Gather Active Shared Goals & Weights
            (masterData.goals || []).forEach(g => {
                let weightForGoal = 0;
                let isAssigned = false;

                // Check Assignments
                (g.assignments || []).forEach(a => {
                    const t = a.target;
                    let weight = Number(a.weight) || 0;

                    // Division Override
                    if (t.startsWith('DIV_') || t === userDiv) {
                        const divName = t.replace('DIV_', '');
                        if (g.division_weights && g.division_weights[divName]) {
                            const cfg = g.division_weights[divName];
                            if (cfg.managers && cfg.managers[userId] != null) {
                                weight = Number(cfg.managers[userId]);
                            } else {
                                weight = Number(cfg.default_weight);
                            }
                        }
                    }

                    // Standard Assignments
                    if (t === 'GLOBAL_ALL' ||
                        t === `COMP_${userComp}` ||
                        t === `DIV_${userDiv}` || t === userDiv ||
                        t === `ID_${userId}` || t === userId) {
                        weightForGoal = weight;
                        isAssigned = true;
                    }
                });

                if (isAssigned) {
                    if (weightForGoal > 1) weightForGoal = weightForGoal / 100;
                    totalSharedAssigned += weightForGoal;
                    activeSharedGoals.push({
                        rating: Number(g.rating) || 0,
                        rawWeight: weightForGoal
                    });
                }
            });

            // B. Normalize Shared Goals (Cap at Category Weight)
            const sharedCap = w.s / 100;
            let sharedScaleFactor = 1;

            // If assigned > Cap (e.g. 15% assigned vs 5% cap), scale down
            if (totalSharedAssigned > sharedCap && sharedCap > 0) {
                sharedScaleFactor = sharedCap / totalSharedAssigned;
            }

            // C. Calculate Final Shared Score
            activeSharedGoals.forEach(g => {
                sContrib += g.rating * (g.rawWeight * sharedScaleFactor);
            });

            // ============================================================
            // STEP 2: CALCULATE INDIVIDUAL GOALS (Normalized to Allocation)
            // ============================================================
            let individualGoalScore = 0;
            let totalIndivWeight = 0;

            // A. Sum Total Weight of Individual Goals
            if (targetUser[COL.goals]) {
                targetUser[COL.goals].forEach(g => {
                    totalIndivWeight += (Number(g.weight) || 0);
                });
            }

            // B. Determine Normalization Factor
            // FIXED: Scale weights to match the employee's individual allocation (w.i / 100)
            // For example, if a manager has 90% individual allocation and goals sum to 100%:
            // - Scale factor = 0.9 / 1.0 = 0.9
            // - Each 25% goal becomes 22.5%, four goals = 90% total
            const individualCap = w.i / 100; // Convert percentage to decimal (90 -> 0.9)
            let indivScaleFactor = 1;
            
            if (totalIndivWeight > 0) {
                // Scale goals to fit within the individual allocation
                indivScaleFactor = individualCap / totalIndivWeight;
            }

            // C. Calculate Weighted Score (Already Scaled to Allocation)
            if (targetUser[COL.goals]) {
                targetUser[COL.goals].forEach(g => {
                    const rawWeight = Number(g.weight) || 0;
                    const rating = Number(g.rating) || 0;

                    // Apply normalization - weights now sum to individualCap (e.g., 0.9)
                    const effectiveWeight = rawWeight * indivScaleFactor;

                    individualGoalScore += rating * effectiveWeight;
                });
            }

            // D. No additional multiplication needed - weights are already scaled to allocation
            // FIXED: Individual score is already properly weighted
            const iContrib = individualGoalScore;

            // ============================================================
            // STEP 3: FINAL TOTAL & UI UPDATE
            // ============================================================
            const total = sContrib + iContrib;

            const currentUid = (user[COL.id] || '').toString();
            const profileUid = (targetUser[COL.id] || '').toString();
            const viewingSelf = (currentUid === profileUid);
            const uRole = getRole(user);

            const statusClean = (targetUser[COL.stat] || '').trim().toLowerCase();
            // Allow admin search mode to see scores even for drafts
            const canSeeScore = (statusClean === 'published') || 
                               (!viewingSelf && (isManager || ['Admin', 'Master'].includes(uRole))) ||
                               isAdminSearchMode;

            const scoreEl = document.getElementById('score');
            const ratingEl = document.getElementById('rating');
            const sharedScoreEl = document.getElementById('shared-contrib-val');
            const indivScoreEl = document.getElementById('indiv-contrib-val');
            const scoreProgress = document.getElementById('score-progress');
            const ratingProgress = document.getElementById('rating-progress');

            if (canSeeScore) {
                if (scoreEl) scoreEl.innerText = total.toFixed(2);
                if (sharedScoreEl) sharedScoreEl.innerText = sContrib.toFixed(2);
                if (indivScoreEl) indivScoreEl.innerText = iContrib.toFixed(2);

                // Update progress bars (max score is 6)
                const scorePercent = Math.min((total / 6) * 100, 100);
                if (scoreProgress) scoreProgress.style.width = scorePercent + '%';

                let lbl = "-";
                let ratingPercent = 0;
                if (total >= 5.5) { lbl = "ASTRONAUT"; ratingPercent = 100; }
                else if (total >= 4.5) { lbl = "FLYER"; ratingPercent = 83; }
                else if (total >= 3.5) { lbl = "RUNNER"; ratingPercent = 67; }
                else if (total >= 2.5) { lbl = "WALKER"; ratingPercent = 50; }
                else if (total >= 1.5) { lbl = "STAGNANT"; ratingPercent = 33; }
                else if (total > 0) { lbl = "IDLE"; ratingPercent = 17; }

                if (ratingEl) ratingEl.innerText = lbl;
                if (ratingProgress) ratingProgress.style.width = ratingPercent + '%';
            } else {
                if (scoreEl) scoreEl.innerHTML = '<i class="fa-solid fa-lock" style="font-size:1.5rem; opacity:0.3;"></i>';
                if (ratingEl) ratingEl.innerText = "Pending HR";
                if (scoreProgress) scoreProgress.style.width = '0%';
                if (ratingProgress) ratingProgress.style.width = '0%';
            }
        }
        function autoSave() {
            showSaving();
            clearTimeout(saveTimer);

            saveTimer = setTimeout(async () => {
                try {
                    // Prepare the data
                    let u = {};
                    u[COL.goals] = targetUser[COL.goals];

                    // --- FIX: ALWAYS INCLUDE THE ID ---
                    // The secure backend needs this to verify permissions!
                    u[COL.id] = targetUser[COL.id];

                    // Send to Backend
                    // We use .upsert() here because it's safer for our new PHP logic
                    // than the old .update() wrapper.
                    const { error } = await db.from('active_list').upsert(u);

                    if (error) {
                        console.error("AutoSave Error:", error);
                        showToast("Save Failed: " + error.message, 'error');
                        // Visual feedback that it failed
                        document.getElementById('save-text').innerText = "Save Failed";
                        document.getElementById('save-dot').style.background = "#ef4444"; // Red
                    } else {
                        showSaved();
                        
                        // --- AUTO-REFRESH: Clear cache and update local data ---
                        // This ensures Reports and Analytics show real-time changes
                        clearDataCache();
                        
                        // Update the local allCompanyData array with the change
                        const idx = allCompanyData.findIndex(x => x[COL.id] === targetUser[COL.id]);
                        if (idx !== -1) {
                            allCompanyData[idx][COL.goals] = targetUser[COL.goals];
                            allCompanyData[idx][COL.stat] = targetUser[COL.stat];
                        }
                        
                        // Refresh notifications to reflect changes
                        if (typeof refreshNotifications === 'function') {
                            refreshNotifications();
                        }
                    }
                } catch (err) {
                    console.error("AutoSave Crash:", err);
                    showToast("Connection Error", 'error');
                }
            }, 500);
        }
        function showSaving() { document.getElementById('save-status').classList.add('show'); document.getElementById('save-dot').className = 'save-dot saving'; document.getElementById('save-text').innerText = "Saving..."; }
        function showSaved() { document.getElementById('save-dot').className = 'save-dot saved'; document.getElementById('save-text').innerText = "All changes saved"; setTimeout(() => document.getElementById('save-status').classList.remove('show'), 2000); }
        async function saveDraft() { autoSave(); }

        async function submitFinal() {
            // --- 1. VALIDATION: Check for 0% Weight Goals ---
            const goals = targetUser[COL.goals] || [];
            let hasZeroWeight = false;
            let zeroWeightTitle = "";

            for (let g of goals) {
                if (!g.weight || parseFloat(g.weight) === 0) {
                    hasZeroWeight = true;
                    zeroWeightTitle = g.title;
                    break;
                }
            }

            if (hasZeroWeight) {
                showToast(`Cannot submit: The goal "${zeroWeightTitle}" has 0% weight.`, 'error');
                return;
            }

            // --- 2. VALIDATION: Total Weight Sum ---
            const w = getW(targetUser[COL.lvl], targetUser[COL.job]);
            const allowedPct = w.i;
            let currentSum = 0;
            goals.forEach(g => currentSum += (g.weight || 0));
            const currentPct = Math.round(currentSum * 100);

            if (currentPct !== allowedPct) {
                showToast(`Total Weight is ${currentPct}%. It must be exactly ${allowedPct}%.`, 'error');
                return;
            }

            // --- 3. AMENDED TRANSITION LOGIC ---
            const myId = (user[COL.id] || '').toString();
            const targetId = (targetUser[COL.id] || '').toString();
            const viewingSelf = (myId === targetId);
            const uRole = getRole(user);
            const stat = targetUser[COL.stat] || 'Draft';

            let confirmTitle = "Confirm Submission";
            let confirmMsg = "Are you sure you want to proceed?";
            let newStatus = "";

            if (viewingSelf) {
                confirmMsg = "Submit to Manager? You won't be able to edit your goals anymore.";
                newStatus = "Submitted to Manager";
            } else if (isDirectSupervisor && stat === 'Submitted to Manager') {
                // --- VALIDATION: Check if manager rated all individual objectives ---
                const goals = targetUser[COL.goals] || [];
                const unratedGoals = goals.filter(g => !g.rating || g.rating === 0 || g.rating === '0');
                
                if (unratedGoals.length > 0) {
                    showToast(`Please rate all individual objectives before submitting. ${unratedGoals.length} objective(s) still need ratings.`, 'error');
                    return;
                }
                
                confirmMsg = "Approve & Submit to HR? Feedback and ratings will be finalized.";
                newStatus = "Submitted to HR";
            } else if ((uRole === 'Admin' || uRole === 'Master') && stat === 'Submitted to HR') {
                confirmTitle = "Final Approval";
                confirmMsg = "Perform Final Approval?";
                newStatus = "Approved";
            }

            if (!newStatus) return;

            showConfirm(confirmTitle, confirmMsg, "Proceed", "primary", async () => {
                const btn = document.getElementById('btn-submit-final');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
                }

                // --- FIX: INCLUDE THE ID IN THE PAYLOAD ---
                let u = {};
                u[COL.id] = targetUser[COL.id]; // <--- CRITICAL FIX
                u[COL.goals] = targetUser[COL.goals];
                u[COL.stat] = newStatus;

                // Use UPSERT instead of update because your PHP handle 'upsert' more robustly with IDs
                const { error } = await db.from('active_list').upsert(u);

                if (error) {
                    showToast("Update failed: " + (error.message || "Unauthorized"), 'error');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerText = "Try Again";
                    }
                } else {
                    logActivity('SUBMIT', `Status changed to: ${newStatus}`, targetUser[COL.id]);
                    showToast("Success! Reloading...", 'success');
                    // Small delay to ensure the DB processes before reload
                    setTimeout(() => location.reload(), 1000);
                }
            });
        }
        async function rejectCard() {
            showConfirm("Reject Scorecard", "Return this scorecard to the employee for editing?", "Reject & Return", "danger", async () => {
                const { error } = await db.from('active_list').update({ [COL.stat]: 'Returned' }).eq(COL.id, targetUser[COL.id]);
                if (error) showToast("Error: " + error.message, 'error');
                else {
                    logActivity('REJECT', 'Scorecard returned to employee', targetUser[COL.id]);
                    showToast("Card returned to Employee", 'success');
                    setTimeout(() => location.reload(), 1500);
                }
            });
        }

        function render(h) { document.getElementById('main-view').innerHTML = h; }

        // --- USER MODAL ---
        function openUserModal(id) {
            const isEdit = !!id;
            const modal = document.getElementById('user-modal');
            const title = document.getElementById('um-title');
            const btn = document.getElementById('um-btn');

            // Allow transitions
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('open'), 10);

            if (isEdit) {
                const u = allCompanyData.find(x => x[COL.id] === id);
                if (!u) return;
                title.innerText = "Edit Employee";
                btn.innerText = "Save Changes";
                document.getElementById('um-id').value = u[COL.id];
                document.getElementById('um-id').readOnly = true;
                document.getElementById('um-name').value = u[COL.name];
                document.getElementById('um-job').value = u[COL.job] || '';
                document.getElementById('um-div').value = u[COL.div] || '';
                document.getElementById('um-mgr').value = u[COL.mgr] || '';
                document.getElementById('um-role').value = u[COL.role] || '';
                document.getElementById('um-orig-id').value = u[COL.id];
            } else {
                title.innerText = "Add New Employee";
                btn.innerText = "Create User";
                document.getElementById('um-id').value = '';
                document.getElementById('um-id').readOnly = false;
                document.getElementById('um-name').value = '';
                document.getElementById('um-job').value = '';
                document.getElementById('um-div').value = '';
                document.getElementById('um-mgr').value = '';
                document.getElementById('um-role').value = '';
                document.getElementById('um-orig-id').value = '';
            }
        }

        function closeUserModal() {
            const modal = document.getElementById('user-modal');
            modal.classList.remove('open');
            setTimeout(() => modal.style.display = 'none', 300);
        }

        async function saveUser() {
            // Select inputs using your original IDs (um-)
            const id = document.getElementById('um-id').value.trim();
            const name = document.getElementById('um-name').value.trim();
            const email = document.getElementById('um-email').value.trim(); // New Field
            const phone = document.getElementById('um-phone').value.trim(); // New Field
            const job = document.getElementById('um-job').value.trim();
            const div = document.getElementById('um-div').value.trim();
            const mgr = document.getElementById('um-mgr').value.trim();
            const role = document.getElementById('um-role').value.trim();
            const origId = document.getElementById('um-orig-id').value;

            // Validation
            if (!id || !name) {
                showToast("ID and Name are required", "error");
                return;
            }

            // Build the user object using COL mapping
            let u = {};
            u[COL.id] = id;
            u[COL.name] = name;
            u[COL.email] = email; // New Mapping
            u[COL.phone] = phone; // New Mapping
            u[COL.job] = job;
            u[COL.div] = div;
            u[COL.mgr] = mgr;
            u[COL.role] = role;
            u[COL.pass] = "123"; // Default password as per your original code
            u[COL.lvl] = "L4";    // Default level as per your original code

            let error;
            if (origId) {
                // Update logic using the original ID to match record in Supabase
                const { error: err } = await db.from('active_list').update(u).eq(COL.id, origId);
                error = err;
            } else {
                // Insert logic for brand new records
                const { error: err } = await db.from('active_list').insert([u]);
                error = err;
            }

            if (error) {
                showToast("Error saving user: " + error.message, "error");
            } else {
                showToast("User saved successfully", "success");
                closeUserModal(); // Close modal using your original function name

                allCompanyData = await fetchAllData(); // Refresh the global cache

                // Refresh the Directory Table if it is currently visible
                if (document.getElementById('dir-table')) {
                    const q = document.querySelector('.search-box-container input') ?
                        document.querySelector('.search-box-container input').value : "";
                    searchDirectory(q);
                }
            }
        }
        function renderNav(r) {
            let h = '';
            // Helper for items
            const mkItem = (lbl, icon, fn) => `<div class="nav-item COMP-NAV" onclick="setActiveNav(this); ${fn}"><i class="${icon}"></i> <span>${lbl}</span></div>`;
            // Helper for sections
            const mkSec = (lbl) => `<div style="font-size:0.75rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; padding:16px 12px 8px 12px; margin-top:8px;">${lbl}</div>`;

            // 1. Administration Section
            if (r === 'Admin' || r === 'Master') {
                h += mkSec('Administration');
                h += mkItem('HR Admin', 'fa-solid fa-user-shield', 'loadHRAdmin()');
            }

            // 2. Management Section
            const isMgr = ['Chief', 'Director', 'Senior Manager', 'Manager', 'Admin', 'Master'].includes(r);
            if (isMgr) {
                h += mkSec('Management');
                if (['Chief', 'Director', 'Senior Manager', 'Manager', 'Admin', 'Master'].includes(r)) h += mkItem('My Team', 'fa-solid fa-users', 'loadTeam()');
                if (['Chief', 'Director', 'Senior Manager', 'Manager', 'Admin', 'Master'].includes(r)) h += mkItem('Progress', 'fa-solid fa-bars-progress', 'loadProgressDashboard()');
                if (['Chief', 'Director', 'Senior Manager', 'Manager', 'Admin', 'Master'].includes(r)) h += mkItem('Reports', 'fa-solid fa-chart-line', 'loadReports()');
            }

            // 3. Personal Section (Everyone)
            h += mkSec('Personal');
            h += mkItem('My Scorecard', 'fa-solid fa-address-card', `loadEval('${user[COL.id]}')`);

            document.getElementById('nav-menu').innerHTML = h;
        }
        function setActiveNav(el) {
            document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
        }

        // --- PERFORMANCE HISTORY MODAL ---
        async function showHistory(empId) {
            // Create and show modal
            let modal = document.getElementById('history-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'history-modal';
                modal.innerHTML = `
                    <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9000; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);">
                        <div style="background:white; width:90%; max-width:700px; max-height:90vh; border-radius:20px; overflow:hidden; display:flex; flex-direction:column;">
                            <div style="padding:24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                                <h3 style="margin:0; font-size:1.3rem; font-weight:700;"><i class="fa-solid fa-clock-rotate-left" style="color:var(--primary); margin-right:10px;"></i>Performance History</h3>
                                <button onclick="document.getElementById('history-modal').remove()" style="background:none; border:none; font-size:1.3rem; cursor:pointer; color:var(--text-muted);">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                            <div id="history-modal-content" style="padding:24px; overflow-y:auto; flex:1;"></div>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            } else {
                modal.style.display = 'block';
            }

            const contentDiv = document.getElementById('history-modal-content');
            contentDiv.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';

            try {
                const history = await getEmployeeHistory(empId);
                
                if (history.length === 0) {
                    contentDiv.innerHTML = `
                        <div style="text-align:center; padding:60px 20px; color:var(--text-muted);">
                            <i class="fa-solid fa-folder-open" style="font-size:3rem; opacity:0.3; margin-bottom:16px; display:block;"></i>
                            <div style="font-weight:600;">No Historical Records</div>
                            <div style="font-size:0.9rem; margin-top:8px;">This is the first performance cycle for this employee.</div>
                        </div>
                    `;
                    return;
                }

                const emp = history[0];
                let html = `
                    <div style="background:linear-gradient(135deg, #f8fafc, #ffffff); padding:20px; border-radius:12px; margin-bottom:24px; border:1px solid var(--border);">
                        <div style="font-size:1.3rem; font-weight:700; color:var(--text-main);">${escapeHTML(emp.name || 'Unknown Employee')}</div>
                        <div style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">${escapeHTML(emp.job || 'N/A')} • ${escapeHTML(emp.division || 'N/A')}</div>
                    </div>
                    
                    <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; font-weight:700;">
                        ${history.length} Cycle${history.length > 1 ? 's' : ''} Found
                    </div>
                `;

                for (const record of history) {
                    const goals = typeof record.goals === 'string' ? JSON.parse(record.goals || '[]') : (record.goals || []);
                    const status = record.status || 'Draft';
                    const cycle = record.cycle || '2025';
                    
                    // Calculate score
                    let score = 0;
                    let indivScore = 0;
                    if (goals.length > 0) {
                        const totalWeight = goals.reduce((sum, g) => sum + (parseFloat(g.weight) || 0), 0);
                        if (totalWeight > 0) {
                            indivScore = goals.reduce((sum, g) => sum + ((parseFloat(g.rating) || 0) * (parseFloat(g.weight) || 0)), 0);
                        }
                    }
                    
                    // This is simplified - in reality would need shared goals too
                    score = indivScore;
                    
                    let rating = '-';
                    let ratingColor = '#94a3b8';
                    if (score >= 5.5) { rating = 'ASTRONAUT'; ratingColor = '#0f766e'; }
                    else if (score >= 4.5) { rating = 'FLYER'; ratingColor = '#10b981'; }
                    else if (score >= 3.5) { rating = 'RUNNER'; ratingColor = '#3b82f6'; }
                    else if (score >= 2.5) { rating = 'WALKER'; ratingColor = '#f59e0b'; }
                    else if (score >= 1.5) { rating = 'STAGNANT'; ratingColor = '#ef4444'; }
                    else if (score > 0) { rating = 'IDLE'; ratingColor = '#94a3b8'; }

                    const isCurrentCycle = cycle === currentCycle;
                    const isPublished = status === 'Published' || status === 'Approved';

                    html += `
                        <div style="background:white; border:1px solid ${isCurrentCycle ? 'var(--primary)' : 'var(--border)'}; border-radius:16px; padding:20px; margin-bottom:16px; ${isCurrentCycle ? 'box-shadow:0 4px 15px rgba(13,148,136,0.15);' : ''}">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                                <div>
                                    <div style="font-size:1.8rem; font-weight:800; color:${isCurrentCycle ? 'var(--primary)' : 'var(--text-main)'};">
                                        ${cycle}
                                        ${isCurrentCycle ? '<span style="font-size:0.6rem; background:var(--primary); color:white; padding:3px 8px; border-radius:10px; margin-left:8px; vertical-align:middle;">CURRENT</span>' : ''}
                                    </div>
                                </div>
                                <span style="background:${isPublished ? '#d1fae5' : '#f1f5f9'}; color:${isPublished ? '#059669' : '#64748b'}; padding:6px 14px; border-radius:20px; font-size:0.8rem; font-weight:600;">
                                    ${escapeHTML(status)}
                                </span>
                            </div>
                            
                            ${isPublished ? `
                            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; background:#f8fafc; padding:16px; border-radius:12px;">
                                <div style="text-align:center;">
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Final Score</div>
                                    <div style="font-size:2rem; font-weight:800; color:var(--text-main);">${score > 0 ? score.toFixed(2) : '-'}</div>
                                </div>
                                <div style="text-align:center;">
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Rating</div>
                                    <div style="font-size:1.1rem; font-weight:800; color:${ratingColor}; margin-top:8px;">${rating}</div>
                                </div>
                                <div style="text-align:center;">
                                    <div style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Objectives</div>
                                    <div style="font-size:2rem; font-weight:800; color:var(--text-main);">${goals.length}</div>
                                </div>
                            </div>
                            ` : `
                            <div style="text-align:center; padding:20px; color:var(--text-muted); background:#f8fafc; border-radius:12px;">
                                <i class="fa-solid fa-lock" style="font-size:1.5rem; opacity:0.3; margin-bottom:8px; display:block;"></i>
                                <div style="font-size:0.9rem;">Results will be visible after publishing</div>
                            </div>
                            `}
                        </div>
                    `;
                }

                contentDiv.innerHTML = html;
            } catch (e) {
                console.error('Error loading history:', e);
                contentDiv.innerHTML = `
                    <div style="text-align:center; padding:40px; color:var(--danger);">
                        <i class="fa-solid fa-exclamation-triangle" style="font-size:2rem; margin-bottom:12px; display:block;"></i>
                        <div>Error loading history</div>
                        <div style="font-size:0.85rem; margin-top:8px;">${escapeHTML(e.message)}</div>
                    </div>
                `;
            }
        }

        // --- GLOBAL UI HELPERS ---
        function showToast(msg, type = 'success') {
            const c = document.getElementById('toast-container');
            const t = document.createElement('div');
            t.className = `toast ${type}`;
            // SECURITY: Auto-escape message to prevent XSS
            const safeMsg = escapeHTML(msg);
            t.innerHTML = `<div class="toast-icon"><i class="fa-solid ${type == 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i></div><div class="toast-msg">${safeMsg}</div>`;
            c.appendChild(t);
            // Force reflow
            void t.offsetWidth;
            requestAnimationFrame(() => t.classList.add('show'));
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4000);
        }

        let confirmCallback = null;
        function showConfirm(title, msg, yesText, type = 'primary', cb) {
            document.getElementById('conf-title').innerText = title;
            document.getElementById('conf-msg').innerText = msg;
            const btn = document.getElementById('conf-btn-yes');
            btn.innerText = yesText;
            btn.className = `btn btn-${type}`;
            // Fix icon based on type
            const icon = type === 'danger' ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : '<i class="fa-solid fa-check"></i> ';
            btn.innerHTML = icon + yesText;

            confirmCallback = cb;
            document.getElementById('confirm-overlay').classList.add('open');
        }
        function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('open'); confirmCallback = null; }
        function doConfirm() { if (confirmCallback) confirmCallback(); closeConfirm(); }

        function getRole(u, isManagerByReports) {
            if (!u) return 'Staff';

            // 1. CLEAN THE DATA
            // Convert to string, trim spaces, and make uppercase for comparison
            const job = (u[COL.job] || "").toString().trim().toUpperCase();

            // 2. DEFINE THE ONLY ALLOWED ADMIN TITLE
            const masterTitle = "HEAD OF EMPLOYEE GROWTH AND RELATION DEPARTMENT";

            // 3. STRICT CHECK
            // Only return 'Master' if the job matches EXACTLY.
            // We strictly ignore the 'access_role' column here.
            if (job === masterTitle) {
                return 'Master';
            }

            // 4. CHECK FOR OTHER ROLES
            // If they manage people (have reports), they are at least a Manager
            if (isManagerByReports) return 'Manager';

            // Check levels for standard hierarchy
            const l = (u[COL.lvl] || "").toUpperCase();
            if (l.includes('L1')) return 'Chief';
            if (l.includes('L2')) return 'Director';
            if (l.includes('L3')) return 'Senior Manager';
            if (l.includes('L4')) return 'Manager';

            return 'Staff';
        }

        function getW(l, j, empId = null) {
            const job = (j || "").toLowerCase().trim();
            const levelStr = (l || "").toUpperCase().trim();
            
            // Determine the company for this employee
            let company = 'Zain Iraq'; // Default
            if (empId) {
                company = getCompany(empId);
            } else if (typeof targetUser !== 'undefined' && targetUser && targetUser[COL.id]) {
                company = getCompany(targetUser[COL.id]);
            }
            
            // Get company-specific configuration
            const companyConfig = weightConfigurations[company] || weightConfigurations['Zain Iraq'] || DEFAULT_WEIGHT_CONFIG['Zain Iraq'];
            
            if (!companyConfig || !companyConfig.rules) {
                // Fallback to old hardcoded logic if no config exists
                return getWFallback(l, j);
            }
            
            // Sort rules by priority (lower number = higher priority)
            const sortedRules = [...companyConfig.rules].sort((a, b) => (a.priority || 99) - (b.priority || 99));
            
            // Find matching rule
            for (const rule of sortedRules) {
                if (rule.type === 'default') continue; // Check default last
                
                const matchValue = (rule.match || '').toLowerCase();
                
                if (rule.type === 'title') {
                    // Check if job title contains or matches the rule
                    if (matchValue && (job.includes(matchValue) || job === matchValue)) {
                        return { s: rule.shared, i: rule.individual };
                    }
                } else if (rule.type === 'level') {
                    // Check if level matches
                    const ruleLevel = matchValue.toUpperCase();
                    if (levelStr === ruleLevel || levelStr.includes(ruleLevel.replace('L', ''))) {
                        return { s: rule.shared, i: rule.individual };
                    }
                }
            }
            
            // Return default rule if exists
            const defaultRule = sortedRules.find(r => r.type === 'default');
            if (defaultRule) {
                return { s: defaultRule.shared, i: defaultRule.individual };
            }
            
            // Ultimate fallback
            return { s: 5, i: 95 };
        }
        
        // Fallback function (old hardcoded logic)
        function getWFallback(l, j) {
            const job = (j || "").toLowerCase().trim();
            const levelStr = (l || "").toUpperCase();
            const is = (role) => new RegExp(`\\b${role}\\b`).test(job);

            if (is('ceo') || job === 'chief executive officer') return { s: 100, i: 0 };
            if (is('cfo') || job === 'chief financial officer') return { s: 50, i: 50 };
            if (is('cco') || job === 'chief commercial officer' || is('cto') || job === 'chief technology officer') { return { s: 30, i: 70 }; }
            if (job.includes('chief')) return { s: 20, i: 80 };
            if (levelStr.includes('2') && job.includes('director')) return { s: 15, i: 85 };
            if ((levelStr.includes('3') || levelStr.includes('4')) && (job.includes('manager') || job.includes('head') || job.includes('senior'))) { return { s: 10, i: 90 }; }
            return { s: 5, i: 95 };
        }
        // --- HELPER: Recursive Downstream Lookup ---
        function getDownstream(managerId, allData) {
            if (!managerId) return [];

            const targetId = managerId.toString().toLowerCase().trim();

            // 1. Find Direct Reports
            const directReports = allData.filter(u => {
                const mRaw = u[COL.mgr] || "";
                const m = mRaw.toString().toLowerCase();
                // Matches if the column contains the ID (handles "Name (ID)" format)
                return m.includes(targetId);
            });

            let totalTeam = [...directReports];

            // 2. Recursively find reports for each direct report
            directReports.forEach(sub => {
                const subId = (sub[COL.id] || "").toString();

                // Prevent infinite loops (e.g. if someone accidentally reports to themselves)
                if (subId.toLowerCase() !== targetId) {
                    const deepReports = getDownstream(subId, allData);
                    totalTeam = totalTeam.concat(deepReports);
                }
            });

            // 3. Remove duplicates (unique by ID)
            const uniqueIds = new Set();
            return totalTeam.filter(item => {
                const id = item[COL.id];
                if (!uniqueIds.has(id)) {
                    uniqueIds.add(id);
                    return true;
                }
                return false;
            });
        }
        document.addEventListener('click', (e) => {
            // 1. Check if the clicked element is our button
            const btn = e.target.closest('.div-weights-btn');
            if (!btn) return;

            // 2. Get the data stored in the button attributes
            const goalIndex = Number(btn.getAttribute('data-goal'));
            const divName = btn.getAttribute('data-div');

            // 3. EXECUTE THE FUNCTION
            // This opens the modal that shows the manager list and weight boxes
            openDivisionWeights(goalIndex, divName);
        });
