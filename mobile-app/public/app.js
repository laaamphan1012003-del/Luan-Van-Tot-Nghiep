if (localStorage.getItem('isLoggedIn') !== 'true') {
    window.location.href = 'auth/index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    // --- VIEW MANAGEMENT ---
    const statusBackBtn = document.getElementById('status-back-btn');
    const views = document.querySelectorAll('.view');

    const switchView = (viewId) => {
        views.forEach(view => {
            if (view.id === viewId) {
                view.classList.add('active');
            } else {
                view.classList.remove('active');
            }
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    let isChargingSessionActive = false;

    // --- LOGIC SIDEBAR & USER ---
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    // Hàm đóng menu
    const closeSidebar = () => {
        if (sidebar) sidebar.classList.remove('show');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    };

    // Hàm mở menu
    const openSidebar = () => {
        if (sidebar) sidebar.classList.add('show');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
    };

    // Sự kiện nút Toggle (3 gạch)
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar.classList.contains('show')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    // Đóng sidebar khi click ra ngoài
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }

    // Tab (Home / Profile)
    window.switchMainTab = (tabName) => {
        const btnHome = document.getElementById('nav-btn-home');
        const btnProfile = document.getElementById('nav-btn-profile');
        
        if (btnHome) btnHome.classList.remove('active');
        if (btnProfile) btnProfile.classList.remove('active');

        if (tabName === 'home' && btnHome) btnHome.classList.add('active');
        if (tabName === 'profile' && btnProfile) btnProfile.classList.add('active');

        // Update nội dung tab active
        document.querySelectorAll('.main-tab').forEach(tab => tab.classList.remove('active'));
        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) targetTab.classList.add('active');

        const headerTitle = document.getElementById('header-title');
        if (headerTitle) headerTitle.textContent = tabName === 'home' ? 'Charging' : 'Users';

        // Đóng menu nếu đang ở mobile 
        if (window.innerWidth <= 768) {
            setTimeout(() => {
                closeSidebar();
            }, 50); 
        }
    };

    // 2. Gán sự kiện trực tiếp 
    const navBtnHome = document.getElementById('nav-btn-home');
    const navBtnProfile = document.getElementById('nav-btn-profile');

    if (navBtnHome) {
        navBtnHome.addEventListener('click', (e) => {
            e.preventDefault(); 
            switchMainTab('home');
        });
    }

    if (navBtnProfile) {
        navBtnProfile.addEventListener('click', (e) => {
            e.preventDefault();
            switchMainTab('profile');
        });
    }
    // Load User Info
    const loadUserInfo = () => {
        const userJson = localStorage.getItem('currentUser');
        if (userJson) {
            const user = JSON.parse(userJson);
            const fullName = `${user.lastname || ''} ${user.firstname || ''}`.trim();
            const idTag = user.idTag || '--';
            
            // Update Sidebar
            document.getElementById('display-name').textContent = fullName || 'User';
            document.getElementById('display-email').textContent = user.email || '';

            // Update ID Tag
            const displayIdTag = document.getElementById('display-idtag');
            if(displayIdTag) displayIdTag.textContent = idTag;
            
            // Update Profile Tab
            document.getElementById('profile-name').textContent = fullName || 'User';
            document.getElementById('profile-email-text').textContent = user.email || '';
            document.getElementById('info-lastname').textContent = user.lastname || '--';
            document.getElementById('info-firstname').textContent = user.firstname || '--';

            // Update ID Tag in Profile
            const infoIdTag = document.getElementById('info-idtag');
            if(infoIdTag) infoIdTag.textContent = idTag;
            
            // Avatar Initials 
            const initial = (user.firstname ? user.firstname[0] : 'U').toUpperCase();
            const avatarEl = document.getElementById('avatar-initials');
            if(avatarEl) avatarEl.textContent = initial;
        }
    };
    loadUserInfo();

    // --- LOGIC LOGOUT ---
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if(confirm('Bạn có chắc chắn muốn đăng xuất?')) {
                // 1. Kiểm tra nếu đang trong phiên sạc
                if (typeof isChargingSessionActive !== 'undefined' && isChargingSessionActive) {
                    alert("Vui lòng ngắt kết nối sạc trước khi đăng xuất!");
                    return;
                }

                // 2. Xóa toàn bộ dữ liệu phiên
                localStorage.removeItem('isLoggedIn');      
                localStorage.removeItem('currentUser');     
                localStorage.removeItem('savedBackendUrl');
                localStorage.removeItem('savedChargeboxId');
                localStorage.removeItem('ocpp_session_state');
                
                // Đóng socket nếu có
                if (typeof websocket !== 'undefined' && websocket) {
                    websocket.close();
                }

                // 3. CHUYỂN HƯỚNG VỀ TRANG LOGIN 
                window.location.href = 'auth/index.html'; 
            }
        });
    }

    // --- LOGIC BACK BUTTON (LOGOUT) ---
    if (statusBackBtn) {
        statusBackBtn.addEventListener('click', () => {
            if (isChargingSessionActive) {
                alert("Please stop charging before disconnecting.");
                return;
            }
            
            //Delete saved Data
            localStorage.removeItem('savedBackendUrl');
            localStorage.removeItem('savedChargeboxId');
            localStorage.removeItem('ocpp_session_state');

            if (websocket) {
                websocket.close();
                websocket = null;
            }

            const connectorsContainer = document.getElementById('connectors-container');
            if (connectorsContainer) {
                connectorsContainer.innerHTML = `
                    <div class="connector-placeholder">
                        <i class="fa-solid fa-plug-circle-xmark"></i>
                        <p>Disconnected</p>
                    </div>
                `;
            }
            switchView('connection-view');
        });
    }

    // --- OCPP CONNECTION LOGIC ---
    const connectBtn = document.getElementById('connect-btn');
    const backendUrlInput = document.getElementById('backend-url-input');
    const chargeboxIdInput = document.getElementById('chargebox-id-input');
    const statusBanner = document.querySelector('.connection-status-banner');
    const connectorsContainer = document.getElementById('connectors-container');
    const toggleScannerBtn = document.getElementById('toggle-scanner-btn');
    const qrReaderElement = document.getElementById('qr-reader');
    
    let websocket = null;
    let chargePoint = null;
    let html5QrCode = null;
    let isScanning = false;
    let isReconnecting = false;

    // --- AUTO CONNECT ---
    const savedUrl = localStorage.getItem('savedBackendUrl');
    const savedId = localStorage.getItem('savedChargeboxId');
    
    if (savedUrl && savedId) {
        console.log("Found saved session. Auto-connecting...");
        backendUrlInput.value = savedUrl;
        chargeboxIdInput.value = savedId;
        setTimeout(() => connectToStation(), 500);
    }

    // --- QR CODE SCANNER ---
    const startScanner = async () => {
        try {
            if (!html5QrCode) {
                html5QrCode = new Html5Qrcode("qr-reader");
            }
            
            qrReaderElement.classList.add('active');
            toggleScannerBtn.classList.add('active');
            toggleScannerBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Scanner';
            isScanning = true;

            await html5QrCode.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                onScanSuccess,
                onScanError
            );
        } catch (err) {
            console.error("Unable to start scanner:", err);
            alert("Camera access denied or not available. Please use manual entry.");
            stopScanner();
        }
    };

    const stopScanner = async () => {
        if (html5QrCode && isScanning) {
            try {
                await html5QrCode.stop();
                qrReaderElement.classList.remove('active');
                toggleScannerBtn.classList.remove('active');
                toggleScannerBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Start Scanner';
                isScanning = false;
            } catch (err) {
                console.error("Error stopping scanner:", err);
            }
        }
    };

    const onScanSuccess = (decodedText) => {
        console.log(`QR Code detected: ${decodedText}`);
        stopScanner();
        parseAndFillFromUrl(decodedText);
        
        // Show success message
        statusBanner.style.display = 'block';
        statusBanner.className = 'connection-status-banner success';
        statusBanner.textContent = 'QR Code scanned successfully! Click Connect to proceed.';
    };

    const onScanError = (error) => {
        // Silent error handling for continuous scanning
    };

    const parseAndFillFromUrl = (url) => {
        try {
            const urlObj = new URL(url);
            const stationId = urlObj.searchParams.get('stationId');
            
            if (stationId) {
                // Extract protocol and host from current location or scanned URL
                const protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
                const backendUrl = `${protocol}//${urlObj.host}`;
                
                backendUrlInput.value = backendUrl;
                chargeboxIdInput.value = stationId;
                
                console.log(`Auto-filled: Backend=${backendUrl}, Station=${stationId}`);
            }
        } catch (err) {
            console.error("Invalid URL format:", err);
            alert("Invalid QR code format. Please scan a valid station QR code.");
        }
    };

    // Toggle scanner on button click
    toggleScannerBtn.addEventListener('click', () => {
        if (isScanning) {
            stopScanner();
        } else {
            startScanner();
        }
    });

    // Check URL parameters on page load
    const urlParams = new URLSearchParams(window.location.search);
    const stationIdParam = urlParams.get('stationId');
    
    if (stationIdParam) {
        // Auto-fill from URL parameters
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const backendUrl = `${protocol}//${window.location.host}`;
        backendUrlInput.value = backendUrl;
        chargeboxIdInput.value = stationIdParam;
        switchView('connection-view');
        
        // Switch to connection view
        navItems.forEach(i => i.classList.remove('active'));
        document.querySelector('[data-view="connection-view"]').classList.add('active');
        views.forEach(view => {
            view.classList.toggle('active', view.id === 'connection-view');
        });
        
        // Show success banner
        statusBanner.style.display = 'block';
        statusBanner.className = 'connection-status-banner success';
        statusBanner.textContent = `Station ${stationIdParam} loaded from QR code. Click Connect to proceed.`;
    }

    const generateUniqueId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const sendMessage = (type, uniqueId, action, payload = {}) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            const message = [type, uniqueId, action, payload];
            websocket.send(JSON.stringify(message));
            console.log('SENT:', message);
            return message;
        }
        return null;
    };
    
    const sendRequest = (action, payload) => sendMessage(2, generateUniqueId(), action, payload);
    const sendResponse = (uniqueId, payload) => sendMessage(3, uniqueId, payload);

    // ---  MAIN-CONNECTION CONSTRUCT ---
    const connectToStation = () => {
        const backendUrl = backendUrlInput.value.trim();
        const chargeboxId = chargeboxIdInput.value.trim();

        if (!backendUrl || !chargeboxId) {
            alert('Please provide both Backend URL and Chargebox ID.');
            return;
        }

        // SAVE THE CONNECTION INFORMATION
        localStorage.setItem('savedBackendUrl', backendUrl);
        localStorage.setItem('savedChargeboxId', chargeboxId);

        if (websocket && websocket.readyState === WebSocket.OPEN) {
            isReconnecting = true;
            websocket.close();
            console.log("Closing existing connection before reconnecting...");
        }

        // CHANGE TO VIEW-STATUS
        switchView('status-view');

        const fullUrl = `${backendUrl}/${chargeboxId}`;
        statusBanner.style.display = 'block';
        statusBanner.className = 'connection-status-banner';
        statusBanner.textContent = `Connecting to ${fullUrl}...`;

        if (websocket) websocket.close();

        websocket = new WebSocket(fullUrl);

        websocket.onopen = () => {
            console.log('Connected');
            isReconnecting = false;
            statusBanner.classList.add('success');
            statusBanner.textContent = `Successfully connected to ${chargeboxId}.`;
            chargePoint = new ChargePointStatus(chargeboxId, sendRequest, sendResponse, (isCharging) => {
                isChargingSessionActive = isCharging;

                if (statusBackBtn) {
                    statusBackBtn.style.display = isCharging ? 'none' : 'flex';
                }
            });

            connectorsContainer.innerHTML = '';
            connectorsContainer.appendChild(chargePoint.getElement());
            
            sendRequest("BootNotification", { chargePointVendor: "MicroOcppUI", chargePointModel: "WebSim" });
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            console.log('RECEIVED:', message);
            if (message && message[2] && message[2].status) {
                const status = message[2].status;
                // Nếu trạng thái là Offline hoặc Faulted -> Reset về màn hình trống
                if (status === 'Offline' || status === 'Faulted') {
                    resetToEmptyState();
                    if (websocket) websocket.close();
                    return;
                }
            }
            if (chargePoint) {
                chargePoint.handleMessage(message);
            }
        };

        websocket.onerror = () => {
            statusBanner.classList.add('error');
            statusBanner.textContent = `Error while connecting to ${fullUrl}.`;
            isReconnecting = false; 
        };
        
        websocket.onclose = () => {
            console.log("WebSocket closed");
            // RECONNECT (3S)
            if (document.getElementById('status-view').classList.contains('active')) {
                console.log("Auto reconnecting in 3s...");
                setTimeout(() => {
                    connectToStation();
                }, 3000);
            } else {
                if (chargePoint) {
                    chargePoint = null;
                }
            }
        };
    };

    // CONNECT BUTTON EVENT-LISTENER
    connectBtn.addEventListener('click', connectToStation);

    const resetToEmptyState = () => {
        console.log("Resetting to empty state...");
        
        if (connectorsContainer) {
            connectorsContainer.innerHTML = `
                <div class="connector-placeholder">
                    <i class="fa-solid fa-plug-circle-xmark"></i>
                    <p>Please connect to a Charge Point using the Connection tab below.</p>
                </div>
            `;
        }

        switchView('connection-view');

        chargePoint = null; 
        
        // STATUS BANNER UPDATE
        statusBanner.style.display = 'block';
        statusBanner.className = 'connection-status-banner error';
        statusBanner.textContent = 'Disconnected. Please connect again.';
    };

    // --- CHARGE POINT STATUS CLASS ---
    class ChargePointStatus {
        constructor(id, sendRequestCallback, sendResponseCallback, onChargingStateChange) {
            this.id = id;
            this.sendRequest = sendRequestCallback;
            this.sendResponse = sendResponseCallback;
            this.onChargingStateChange = onChargingStateChange;

            this.transactionId = null;
            this.meterValue = 0;
            this.meterValueIntervalId = null;
            this.isPluggedIn = false;
            this.isEvReady = false;
            this.isRestored = false;
            this.isStopping = false; 
            
            // Charging parameters
            this.BATTERY_CAPACITY = 42; // kWh
            
            // Charge speed options
            this.chargeSpeedOptions = {
                normal: { power: 7.2, price: 3500, label: 'Normal', icon: 'fa-battery-half' },
                fast: { power: 14.4, price: 3600, label: 'Fast', icon: 'fa-bolt' },
                lightning: { power: 21.6, price: 3800, label: 'Lightning', icon: 'fa-bolt-lightning' }
            };
            
            this.SERVICE_FEE_FIXED = 5000; 
            this.PARKING_FEE_PER_MIN = 100;
            this.selectedChargeSpeed = 'normal'; // default speed
            this.CHARGING_POWER = this.chargeSpeedOptions[this.selectedChargeSpeed].power;
            this.PRICE_PER_KWH = this.chargeSpeedOptions[this.selectedChargeSpeed].price;
            
            // Battery levels
            const randomSoC = Math.floor(Math.random() * (50 - 10 + 1)) + 10;
            this.currentPowerLevel = parseInt(localStorage.getItem('currentPowerLevel')) || randomSoC;
            
            localStorage.setItem('currentPowerLevel', this.currentPowerLevel.toString());
            this.targetPowerLevel = 100;
            
            this.chargingStartTime = null;
            this.chargingStartPercentage = null;
            this.chargingDuration = null; // in seconds
            
            // Payment parameters
            this.selectedPaymentMethod = 'vietqr'; // default payment method
            this.currentPaymentAmount = 0;

            this.configuration = {
                'HeartbeatInterval': '60',
                'ConnectionTimeOut': '120',
                'SupportedFeatureProfiles': 'Core,RemoteTrigger,Configuration',
                'ChargeProfileMaxStackLevel': '10',
                'AllowOfflineTxForUnknownId': 'false'
            };
            
            this.createElement();
            this.cacheDOMElements();
            this.addEventListeners();
            this.updateStatusUI('Offline');
            this.loadLocalState();
            this.sendInitialSoC();
        }

        saveLocalState() {
            const state = {
                transactionId: this.transactionId,
                status: this.transactionId ? 'Charging' : (this.isPluggedIn ? 'Unavailable' : 'Available'),
                isPluggedIn: this.isPluggedIn,
                isEvReady: this.isEvReady,
                chargeSpeed: this.selectedChargeSpeed,
                meterValue: this.meterValue,
                timestamp: Date.now()
            };
            localStorage.setItem('ocpp_session_state', JSON.stringify(state));
        }

        loadLocalState() {
            const savedJson = localStorage.getItem('ocpp_session_state');
            if (savedJson) {
                try {
                    const state = JSON.parse(savedJson);
                    console.log("Loaded local state:", state);
                    
                    if (state.status === 'Charging' && state.transactionId) {
                        this.transactionId = state.transactionId;
                        this.isPluggedIn = true;
                        this.isEvReady = true;
                        this.meterValue = state.meterValue || 0;
                        this.selectedChargeSpeed = state.chargeSpeed || 'normal';
                        
                        // Set UI
                        this.dom.plugStatusBtn.classList.add('active');
                        this.dom.plugStatusText.textContent = 'Plugged In';
                        this.dom.evStatusBtn.classList.add('active');
                        this.dom.plugStatusBtn.disabled = true;
                        this.dom.evStatusBtn.disabled = true;

                        this.updateStatusUI('Charging');
                        this.showChargingProgress();
                        this.startSendingMeterValues(this.transactionId); 
                    } else {
                        this.updateStatusUI('Available');
                    }
                } catch (e) {
                    console.error("Error loading local state", e);
                    this.updateStatusUI('Available');
                }
            } else {
                this.updateStatusUI('Available');
            }
        }

        clearLocalState() {
            localStorage.removeItem('ocpp_session_state');
        }

        destroy() {
            if (this.meterValueIntervalId) clearInterval(this.meterValueIntervalId);
        }

        sendInitialSoC() {
        if (this.sendRequest) {
            this.sendRequest("DataTransfer", {
                vendorId: "OCPP_Simulator",
                messageId: "SetInitialSoC",
                data: this.currentPowerLevel.toString()
            });
        }
    }

        createElement() {
            this.element = document.createElement('div');
            this.element.className = 'status-card';
            this.element.innerHTML = `
                <div class="status-display status-available">
                    <div class="status-icon-wrapper"><i class="fas fa-check-circle status-icon"></i></div>
                    <div class="status-text">Available</div>
                </div>
                <div class="connector-section">
                    <div class="connector-header"><h4>Connector 1</h4><div class="live-indicator"><span class="dot"></span> LIVE</div></div>
                    <div class="connector-status-grid">
                        <button class="connector-status-item interactive plug-status-btn"><i class="fas fa-plug"></i><span class="connector-status-text">Unplugged</span></button>
                        <button class="connector-status-item interactive ev-status-btn" disabled><i class="fas fa-car"></i><span class="ev-status-text">Ready</span></button>
                    </div>
                </div>
                <div class="metrics-grid">
                    <div class="metric-item"><span class="metric-label">Energy</span><span class="metric-value energy-value">0.00 kWh</span></div>
                    <div class="metric-item"><span class="metric-label">Power</span><span class="metric-value power-value">0.0 kW</span></div>
                </div>
                
                <!-- Payment Section -->
                <div class="payment-section" style="display: none;">
                    <div class="payment-header">
                        <h4><i class="fas fa-bolt"></i> Select Charging Target</h4>
                    </div>
                    
                    <div class="battery-status">
                        <div class="battery-info-row">
                            <span class="battery-label">Current Level:</span>
                            <span class="battery-current">${this.currentPowerLevel}%</span>
                        </div>
                        <div class="battery-info-row">
                            <span class="battery-label">Target Level:</span>
                            <span class="battery-target">100%</span>
                        </div>
                    </div>
                    
                    <div class="slider-container">
                        <input type="range" class="target-slider" min="${this.currentPowerLevel}" max="100" value="100" step="1">
                        <div class="slider-labels">
                            <span>${this.currentPowerLevel}%</span>
                            <span>100%</span>
                        </div>
                    </div>
                    
                    <!-- Charge Speed Selector -->
                    <div class="charge-speed-section">
                        <h5 class="speed-section-title"><i class="fas fa-gauge-high"></i> Charging Speed</h5>
                        <div class="charge-speed-grid">
                            <button class="charge-speed-btn active" data-speed="normal">
                                <i class="fas fa-battery-half"></i>
                                <span class="speed-name">Normal</span>
                                <span class="speed-details">7.2 kW</span>
                                <span class="speed-price">3,500₫/kWh</span>
                            </button>
                            <button class="charge-speed-btn" data-speed="fast">
                                <i class="fas fa-bolt"></i>
                                <span class="speed-name">Fast</span>
                                <span class="speed-details">14.4 kW</span>
                                <span class="speed-price">3,600₫/kWh</span>
                            </button>
                            <button class="charge-speed-btn" data-speed="lightning">
                                <i class="fas fa-bolt-lightning"></i>
                                <span class="speed-name">Lightning</span>
                                <span class="speed-details">21.6 kW</span>
                                <span class="speed-price">3,800₫/kWh</span>
                            </button>
                        </div>
                    </div>
                    
                    <div class="charging-estimate">
                        <div class="estimate-item">
                            <i class="fas fa-clock"></i>
                            <div class="estimate-content">
                                <span class="estimate-label">Estimated Time</span>
                                <span class="estimate-value time-estimate">37 mins</span>
                            </div>
                        </div>
                        <div class="estimate-item">
                            <i class="fas fa-money-bill-wave"></i>
                            <div class="estimate-content">
                                <span class="estimate-label">Estimated Cost</span>
                                <span class="estimate-value cost-estimate">37,000 VND</span>
                            </div>
                        </div>
                    </div>
                    
                    <button class="action-btn confirm-payment-btn">
                        <i class="fas fa-check-circle"></i> Continue to Payment
                    </button>
                </div>
                
                <!-- Payment Method Selection -->
                <div class="payment-method-section" style="display: none;">
                    <div class="payment-method-header">
                        <h4><i class="fas fa-credit-card"></i> Select Payment Method</h4>
                        <p class="payment-instruction">Choose how you want to pay</p>
                    </div>
                    <div class="payment-method-grid">
                        <button class="payment-method-btn vietqr-btn active" data-method="vietqr">
                            <i class="fas fa-qrcode"></i>
                            <span class="method-name">VietQR</span>
                            <span class="method-desc">Bank Transfer</span>
                        </button>
                        <button class="payment-method-btn stripe-btn" data-method="stripe">
                            <i class="fab fa-cc-stripe"></i>
                            <span class="method-name">Stripe</span>
                            <span class="method-desc">Card Payment</span>
                        </button>
                    </div>
                    <div class="payment-amount-summary">
                        <span class="summary-label">Total Amount:</span>
                        <span class="summary-value">0 VND</span>
                    </div>
                    <button class="action-btn proceed-payment-btn enabled">
                        <i class="fas fa-arrow-right"></i> Proceed to Payment
                    </button>
                    <button class="action-btn back-btn payment-method-back-btn">
                        <i class="fas fa-arrow-left"></i> Back
                    </button>
                </div>
                
                <!-- VietQR Payment Section -->
                <div class="vietqr-section" style="display: none;">
                    <div class="vietqr-header">
                        <h4><i class="fas fa-qrcode"></i> Scan to Pay</h4>
                        <p class="qr-instruction">Scan this QR code to complete payment</p>
                    </div>
                    <div class="qr-code-container">
                        <img class="vietqr-image" src="" alt="VietQR Payment">
                    </div>
                    <div class="payment-amount-display">
                        <span class="amount-label">Amount:</span>
                        <span class="amount-value">0 VND</span>
                    </div>
                </div>
                
                <!-- Stripe Payment Section -->
                <div class="stripe-section" style="display: none;">
                    <div class="stripe-header">
                        <h4><i class="fab fa-cc-stripe"></i> Card Payment</h4>
                    </div>
                    <div class="stripe-form">
                        <div class="card-display">
                            <div class="card-chip"></div>
                            <div class="card-number-display">•••• •••• •••• ••••</div>
                            <div class="card-info-row">
                                <span class="card-holder-display">CARD HOLDER</span>
                                <span class="card-expiry-display">MM/YY</span>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="stripe-card-number">Card Number</label>
                            <input type="text" id="stripe-card-number" placeholder="4242 4242 4242 4242" maxlength="19">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="stripe-expiry">Expiry Date</label>
                                <input type="text" id="stripe-expiry" placeholder="MM/YY" maxlength="5">
                            </div>
                            <div class="form-group">
                                <label for="stripe-cvc">CVC</label>
                                <input type="text" id="stripe-cvc" placeholder="123" maxlength="3">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="stripe-name">Cardholder Name</label>
                            <input type="text" id="stripe-name" placeholder="JOHN DOE">
                        </div>
                        <div class="stripe-amount-display">
                            <span class="amount-label">Amount to Pay:</span>
                            <span class="amount-value">0 VND</span>
                        </div>
                        <button class="action-btn stripe-pay-btn">
                            <i class="fas fa-lock"></i> Pay Now
                        </button>
                        <button class="action-btn back-btn stripe-back-btn">
                            <i class="fas fa-arrow-left"></i> Back
                        </button>
                    </div>
                </div>
                
                <!-- Charging Progress Section -->
                <div class="charging-progress-section" style="display: none;">
                    <div class="charging-info">
                        <div class="charging-status-row">
                            <span class="charging-label">Charging</span>
                            <span class="charging-percentage">${this.currentPowerLevel}% → <span class="charging-target">100%</span></span>
                        </div>
                        <div class="progress-bar-container">
                            <div class="progress-bar-fill" style="width: ${this.currentPowerLevel}%"></div>
                        </div>
                        <div class="charging-time-row">
                            <span class="time-label">Time Remaining:</span>
                            <span class="time-remaining">00:00:00</span>
                        </div>
                    </div>
                </div>
                
                <div class="action-footer"><button class="action-btn start-stop-btn" disabled>Start Charging</button></div>
            `;
        }
        
        cacheDOMElements() {
            this.dom = {
                statusDisplay: this.element.querySelector('.status-display'),
                statusIcon: this.element.querySelector('.status-icon'),
                statusText: this.element.querySelector('.status-text'),
                startStopBtn: this.element.querySelector('.start-stop-btn'),
                plugStatusBtn: this.element.querySelector('.plug-status-btn'),
                evStatusBtn: this.element.querySelector('.ev-status-btn'),
                plugStatusText: this.element.querySelector('.plug-status-btn .connector-status-text'),
                evStatusText: this.element.querySelector('.ev-status-btn .ev-status-text'),
                energyValue: this.element.querySelector('.energy-value'),
                powerValue: this.element.querySelector('.power-value'),
                // Payment section elements
                paymentSection: this.element.querySelector('.payment-section'),
                batteryCurrent: this.element.querySelector('.battery-current'),
                targetSlider: this.element.querySelector('.target-slider'),
                batteryTarget: this.element.querySelector('.battery-target'),
                sliderLabels: this.element.querySelector('.slider-labels'),
                chargeSpeedBtns: this.element.querySelectorAll('.charge-speed-btn'),
                timeEstimate: this.element.querySelector('.time-estimate'),
                costEstimate: this.element.querySelector('.cost-estimate'),
                confirmPaymentBtn: this.element.querySelector('.confirm-payment-btn'),
                // Payment method selection elements
                paymentMethodSection: this.element.querySelector('.payment-method-section'),
                paymentMethodBackBtn: this.element.querySelector('.payment-method-back-btn'),
                paymentMethodBtns: this.element.querySelectorAll('.payment-method-btn'),
                vietqrMethodBtn: this.element.querySelector('.vietqr-btn'),
                stripeMethodBtn: this.element.querySelector('.stripe-btn'),
                summaryValue: this.element.querySelector('.summary-value'),
                proceedPaymentBtn: this.element.querySelector('.proceed-payment-btn'),
                // VietQR section elements
                vietqrSection: this.element.querySelector('.vietqr-section'),
                vietqrImage: this.element.querySelector('.vietqr-image'),
                amountValue: this.element.querySelector('.amount-value'),
                // Charging progress elements
                chargingProgressSection: this.element.querySelector('.charging-progress-section'),
                chargingPercentage: this.element.querySelector('.charging-percentage'),
                chargingTarget: this.element.querySelector('.charging-target'),
                progressBarFill: this.element.querySelector('.progress-bar-fill'),
                timeRemaining: this.element.querySelector('.time-remaining'),
            };
        }
        
        generateVietQR(amount) {
            // VietQR API format: https://img.vietqr.io/image/[BANK_ID]-[ACCOUNT_NUMBER]-[TEMPLATE].png?amount=[AMOUNT]&addInfo=[DESCRIPTION]
            const bankId = 'MB'; // MB Bank (you can change this)
            const accountNumber = '0123456789'; // Your account number
            const template = 'compact2'; // QR template style
            const description = encodeURIComponent('Charging Payment');
            
            return `https://img.vietqr.io/image/${bankId}-${accountNumber}-${template}.png?amount=${amount}&addInfo=${description}&accountName=EV%20Charging`;
        }
        
        showToast(message) {
            // Create toast element
            const toast = document.createElement('div');
            toast.className = 'payment-toast';
            toast.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <span>${message}</span>
            `;
            document.body.appendChild(toast);
            
            // Trigger animation
            setTimeout(() => toast.classList.add('show'), 10);
            
            // Remove after 3 seconds
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => document.body.removeChild(toast), 300);
            }, 3000);
        }

        calculateChargingEstimate(targetLevel) {
            // Calculate energy needed (kWh)
            let percentageDiff = targetLevel - this.currentPowerLevel;
            if (percentageDiff < 0) percentageDiff = 0;
            const energyNeeded = (percentageDiff / 100) * this.BATTERY_CAPACITY;
            
            // Calculate time (hours)
            const timeHours = energyNeeded / this.CHARGING_POWER;
            const timeMinutes = Math.round(timeHours * 60);
            
            // Calculate cost (VND)
            const energyCost = Math.round(energyNeeded * this.PRICE_PER_KWH);

            const timeCost = percentageDiff > 0 ? (timeMinutes * this.PARKING_FEE_PER_MIN) : 0;

            const serviceCost = percentageDiff > 0 ? this.SERVICE_FEE_FIXED : 0;

            const totalCost = energyCost + timeCost + serviceCost;
            
            return {
                timeMinutes,
                cost: totalCost,
                energyNeeded
            };
        }

        formatTime(minutes) {
            if (minutes < 60) {
                return `${minutes} mins`;
            } else {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
            }
        }

        updateEstimates() {
            const estimate = this.calculateChargingEstimate(this.targetPowerLevel);
            this.dom.timeEstimate.textContent = this.formatTime(estimate.timeMinutes);
            this.dom.costEstimate.textContent = `${estimate.cost.toLocaleString()} VND`;
            
            if (this.targetPowerLevel > this.currentPowerLevel) {
                this.dom.confirmPaymentBtn.disabled = false;
                this.dom.confirmPaymentBtn.classList.add('enabled');
            } else {
                this.dom.confirmPaymentBtn.disabled = true;
                this.dom.confirmPaymentBtn.classList.remove('enabled');
            }
        }

        addEventListeners() {
            this.dom.plugStatusBtn.addEventListener('click', () => {
                this.isPluggedIn = !this.isPluggedIn;
                this.dom.plugStatusBtn.classList.toggle('active', this.isPluggedIn);
                this.dom.plugStatusText.textContent = this.isPluggedIn ? 'Plugged In' : 'Unplugged';
                
                if (this.isPluggedIn) {
                    this.dom.evStatusBtn.disabled = false;
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Unavailable", errorCode: "NoError" });
                    this.updateStatusUI('Unavailable');
                } else {
                    this.isEvReady = false;
                    this.dom.evStatusBtn.disabled = true;
                    this.dom.evStatusBtn.classList.remove('active');
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" });
                    this.updateStatusUI('Available');
                }
                this.saveLocalState();
            });

            this.dom.evStatusBtn.addEventListener('click', () => {
                this.isEvReady = !this.isEvReady;
                this.dom.evStatusBtn.classList.toggle('active', this.isEvReady);
                
                if (this.isEvReady && this.isPluggedIn) {
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Preparing", errorCode: "NoError" });
                    this.updateStatusUI('Preparing');
                    this.showPaymentSection();
                } else if (this.isPluggedIn) {
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Unavailable", errorCode: "NoError" });
                    this.updateStatusUI('Unavailable');
                    this.hidePaymentSection();
                }
                this.saveLocalState();
            });

            // Target slider
            this.dom.targetSlider.addEventListener('input', (e) => {
                this.targetPowerLevel = parseInt(e.target.value);
                this.dom.batteryTarget.textContent = `${this.targetPowerLevel}%`;
                this.updateEstimates();
            });
            
            // Charge speed selection buttons
            this.dom.chargeSpeedBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    this.dom.chargeSpeedBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.selectedChargeSpeed = btn.dataset.speed;
                    
                    const speedConfig = this.chargeSpeedOptions[this.selectedChargeSpeed];
                    this.CHARGING_POWER = speedConfig.power;
                    this.PRICE_PER_KWH = speedConfig.price;
                    
                    this.updateEstimates();
                });
            });
            
            // Confirm payment and show payment method selector
            this.dom.confirmPaymentBtn.addEventListener('click', () => {
                const estimate = this.calculateChargingEstimate(this.targetPowerLevel);
                this.currentPaymentAmount = estimate.cost;
                this.showPaymentMethodSelector(estimate.cost);
            });
            
            // Payment method selection buttons
            this.dom.paymentMethodBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    this.dom.paymentMethodBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.selectedPaymentMethod = btn.dataset.method;
                });
            });
            
            // Proceed to payment button
            this.dom.proceedPaymentBtn.addEventListener('click', () => {
                if (this.selectedPaymentMethod === 'vietqr') {
                    this.showVietQRPayment(this.currentPaymentAmount);
                } else if (this.selectedPaymentMethod === 'stripe') {
                    this.showStripePayment(this.currentPaymentAmount);
                }
            });
            
            // Back button handlers
            this.dom.paymentMethodBackBtn.addEventListener('click', () => {
                this.dom.paymentMethodSection.style.display = 'none';
                this.selectedPaymentMethod = null;
                this.showPaymentSection();
            });
            
            // Stop charging button
            this.dom.startStopBtn.addEventListener('click', () => {
                if (this.transactionId) {
                    this.stopChargingProcess();
                }
            });
        }

        refreshPaymentUI() {
            // Update current battery level display
            this.dom.batteryCurrent.textContent = `${this.currentPowerLevel}%`;
            
            // Update slider min value and current value
            this.dom.targetSlider.min = this.currentPowerLevel;
            this.dom.targetSlider.value = Math.max(this.currentPowerLevel, this.targetPowerLevel);
            this.targetPowerLevel = parseInt(this.dom.targetSlider.value);
            
            // Update slider labels
            this.dom.sliderLabels.innerHTML = `
                <span>${this.currentPowerLevel}%</span>
                <span>100%</span>
            `;
            
            // Update target display
            this.dom.batteryTarget.textContent = `${this.targetPowerLevel}%`;
        }

        showPaymentSection() {
            this.refreshPaymentUI();
            this.dom.paymentSection.style.display = 'block';
            this.updateEstimates();
        }

        hidePaymentSection() {
            this.dom.paymentSection.style.display = 'none';
        }

        showPaymentMethodSelector(amount) {
            this.hidePaymentSection();
            
            if (!this.selectedPaymentMethod) {
                this.selectedPaymentMethod = 'vietqr';
            }
            
            this.dom.paymentMethodBtns.forEach(btn => {
                if (btn.dataset.method === this.selectedPaymentMethod) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
            
            this.dom.summaryValue.textContent = `${amount.toLocaleString()} VND`;
            
            this.dom.plugStatusBtn.disabled = true;
            this.dom.evStatusBtn.disabled = true;
            
            this.dom.paymentMethodSection.style.display = 'block';
        }

        showVietQRPayment(amount) {
            this.dom.paymentMethodSection.style.display = 'none';
            
            const qrUrl = this.generateVietQR(amount);
            this.dom.vietqrImage.src = qrUrl;
            this.dom.amountValue.textContent = `${amount.toLocaleString()} VND`;
            
            this.dom.plugStatusBtn.disabled = true;
            this.dom.evStatusBtn.disabled = true;
            
            this.dom.vietqrSection.style.display = 'block';
            
            setTimeout(() => {
                this.dom.vietqrSection.style.display = 'none';
                this.showToast('Payment successful!');
                
                setTimeout(() => {
                    this.startChargingProcess();
                    this.showChargingProgress();
                }, 500);
            }, 5000);
        }

        showStripePayment(amount) {
            this.dom.paymentMethodSection.style.display = 'none';
            
            if (typeof window.navigateToStripePayment === 'function') {
                window.navigateToStripePayment(amount);
            }
        }

        processStripePayment() {
            const cardNumber = this.dom.stripeCardNumber.value.replace(/\s/g, '');
            const expiry = this.dom.stripeExpiry.value;
            const cvc = this.dom.stripeCvc.value;
            const name = this.dom.stripeName.value;
            
            if (!cardNumber || cardNumber.length < 13) {
                alert('Please enter a valid card number');
                return;
            }
            
            if (!expiry || expiry.length !== 5) {
                alert('Please enter expiry date (MM/YY)');
                return;
            }
            
            if (!cvc || cvc.length < 3) {
                alert('Please enter CVC');
                return;
            }
            
            if (!name) {
                alert('Please enter cardholder name');
                return;
            }
            
            this.dom.stripePayBtn.disabled = true;
            this.dom.stripePayBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            
            setTimeout(() => {
                this.dom.stripeSection.style.display = 'none';
                
                this.dom.stripePayBtn.disabled = false;
                this.dom.stripePayBtn.innerHTML = '<i class="fas fa-lock"></i> Pay Now';
                
                this.showToast('Payment successful!');
                
                setTimeout(() => {
                    this.startChargingProcess();
                    this.showChargingProgress();
                }, 500);
            }, 2000);
        }

        showChargingProgress() {
            this.dom.chargingProgressSection.style.display = 'block';
            this.dom.startStopBtn.disabled = false;
            this.dom.startStopBtn.textContent = 'Stop Charging';
            this.dom.startStopBtn.className = 'action-btn start-stop-btn stop';
            
            this.dom.chargingTarget.textContent = `${this.targetPowerLevel}%`;
            
            const estimate = this.calculateChargingEstimate(this.targetPowerLevel);
            this.chargingDuration = estimate.timeMinutes * 60;
            this.chargingStartTime = Date.now();
            
            this.chargingStartPercentage = this.currentPowerLevel;
            
            this.updateChargingProgress();
        }

        hideChargingProgress() {
            this.dom.chargingProgressSection.style.display = 'none';
        }

        updateChargingProgress() {
            const currentPercentage = this.currentPowerLevel;

            if(this.dom.chargingPercentage) {
                 this.dom.chargingPercentage.innerHTML = `${Math.floor(currentPercentage)}% → <span class="charging-target">${this.targetPowerLevel}%</span>`;
            }
            if(this.dom.progressBarFill) {
                this.dom.progressBarFill.style.width = `${currentPercentage}%`;
            }

            if (currentPercentage >= this.targetPowerLevel && this.transactionId) {
                this.stopChargingProcess(); 
            }
        }

        getElement() { return this.element; }

        handleMessage(message) {
            const [type, uniqueId, actionOrPayload, payload] = message;

            if (type === 2) {
                this.handleRemoteCommand(uniqueId, actionOrPayload, payload);
            } else if (type === 3) {
                if (actionOrPayload.status === 'Accepted') {
                    if (this.transactionId && this.isPluggedIn) {
                        this.sendRequest("StatusNotification", { connectorId: 1, status: "Charging", errorCode: "NoError" });
                    }
                }

                if (actionOrPayload.transactionId && actionOrPayload.idTagInfo && actionOrPayload.idTagInfo.status === 'Accepted') {
                    console.log(`Transaction confirmed by server with ID: ${actionOrPayload.transactionId}`);
                    this.transactionId = actionOrPayload.transactionId;
                    this.saveLocalState();
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Charging", errorCode: "NoError" });
                    this.startSendingMeterValues(this.transactionId);
                    this.updateStatusUI('Charging');
                }
            }
        }

        handleRemoteCommand(uniqueId, action, payload) {
            console.log(`Handling remote command: ${action}`);
            switch(action) {
                case 'RemoteStartTransaction':
                    if (this.isPluggedIn && this.isEvReady) {
                        this.sendResponse(uniqueId, { status: "Accepted" });
                        this.startChargingProcess(payload.idTag);
                    } else {
                        this.sendResponse(uniqueId, { status: "Rejected" });
                        console.log("Rejected RemoteStart: Not Plugged in or Not Ready.");
                    }
                    break;

                case 'RemoteStopTransaction':
                    if (payload.transactionId == this.transactionId) {
                        this.sendResponse(uniqueId, { status: "Accepted" });
                        this.stopChargingProcess();
                    } else {
                        console.error(`Rejected StopTransaction. Server ID: ${payload.transactionId}, Local ID: ${this.transactionId}`);
                        this.sendResponse(uniqueId, { status: "Rejected" });
                    }
                    break;

                case 'DataTransfer':
                    // RestoreSession OR SyncState
                    if (payload.vendorId === 'OCPP_Simulator' && (payload.messageId === 'RestoreSession' || payload.messageId === 'SyncState')) {
                        console.log(`Received ${payload.messageId} from server:`, payload.data);
                        try {
                            const state = JSON.parse(payload.data);

                            if (this.isStopping && state.status === 'Charging') {
                                console.log("SyncState ignored: Server says Charging but App is Stopping.");
                                this.sendResponse(uniqueId, { status: "Accepted" });
                                return; 
                            }
                            
                            // 1. UPDATE ÌNORMATION
                            this.meterValue = parseFloat(state.energy) || 0;
                            this.currentPowerLevel = parseFloat(state.soc) || this.currentPowerLevel;
                            const currentPowerKw = parseFloat(state.power) || 0;
                            
                            // 2. UPDATE UI
                            this.dom.energyValue.textContent = `${(this.meterValue / 1000).toFixed(2)} kWh`;
                            this.dom.powerValue.textContent = `${currentPowerKw.toFixed(1)} kW`;
                            if(this.dom.progressBarFill) {
                                this.dom.chargingPercentage.innerHTML = `${Math.floor(this.currentPowerLevel)}% → <span class="charging-target">${this.targetPowerLevel}%</span>`;
                                this.dom.progressBarFill.style.width = `${this.currentPowerLevel}%`;
                            }
                            if (state.timeRemaining) {
                                this.dom.timeRemaining.textContent = state.timeRemaining;
                            }

                            //3. App follow server
                            if (state.status === 'Charging') {
                                if (!this.transactionId || !this.isChargingSessionActive) {
                                    console.log("SyncState: Detected Charging session. Forcing UI update.");
                                    
                                    this.transactionId = state.transactionId || ("RESTORED-" + Date.now());
                                    
                                    // TURN ON STATUS
                                    this.isPluggedIn = true; 
                                    this.isEvReady = true;
                                    this.dom.plugStatusBtn.classList.add('active');
                                    this.dom.plugStatusText.textContent = 'Plugged In';
                                    this.dom.evStatusBtn.classList.add('active');
                                    this.dom.plugStatusBtn.disabled = true;
                                    this.dom.evStatusBtn.disabled = true;

                                    this.updateStatusUI('Charging');
                                    this.showChargingProgress();
                                    
                                    this.startSendingMeterValues(this.transactionId);

                                    this.saveLocalState();
                                }
                            } 
                            else if (state.status === 'Available' && this.transactionId) {
                                console.log("SyncState: Server says Available. Stopping local session.");
                                this.stopChargingProcess();
                            }

                            this.sendResponse(uniqueId, { status: "Accepted" });
                        } catch (e) {
                            console.error("Failed to process server state:", e);
                            this.sendResponse(uniqueId, { status: "Rejected" });
                        }
                    } 
                    else {
                        console.log(`Received DataTransfer:`, payload);
                        this.sendResponse(uniqueId, { status: "Accepted", data: "Processed" });
                    }
                    break;

                case 'GetConfiguration':
                    const requestedKeys = payload.key || Object.keys(this.configuration);
                    const configurationKey = [];
                    const unknownKey = [];
                    requestedKeys.forEach(k => {
                        if (this.configuration.hasOwnProperty(k)) {
                            configurationKey.push({ key: k, readonly: false, value: this.configuration[k] });
                        } else {
                            unknownKey.push(k);
                        }
                    });
                    this.sendResponse(uniqueId, { configurationKey, unknownKey });
                    break;

                case 'ChangeConfiguration':
                    const { key, value } = payload;
                    if (this.configuration.hasOwnProperty(key)) {
                        this.configuration[key] = value;
                        console.log(`Configuration updated: ${key} = ${value}`);
                        this.sendResponse(uniqueId, { status: "Accepted" });
                    } else {
                        this.sendResponse(uniqueId, { status: "NotSupported" });
                    }
                    break;

                case 'ClearCache':
                    console.log("Simulating ClearCache... Authorization cache cleared.");
                    this.sendResponse(uniqueId, { status: "Accepted" });
                    break;
                
                default:
                     this.sendResponse(uniqueId, { status: "Rejected" });
            }
        }

        startChargingProcess(manualIdTag = null) {
            let idTagToSend = manualIdTag;
            
            if (!idTagToSend) {
                const userJson = localStorage.getItem('currentUser');
                if (userJson) {
                    const user = JSON.parse(userJson);
                    idTagToSend = user.idTag; 
                } else {
                    idTagToSend = "GUEST_USER";
                }
            }

            this.sendRequest("DataTransfer", {
                vendorId: "ChargingSpeed",
                messageId: "SpeedSelection",
                data: this.selectedChargeSpeed
            });
            
            this.sendRequest("DataTransfer", {
                vendorId: "OCPP_Simulator",
                messageId: "SetTargetSoC",
                data: this.targetPowerLevel.toString()
            });

            this.sendRequest("Authorize", { idTag: idTagToSend });
            this.sendRequest("StartTransaction", { 
                connectorId: 1, 
                idTag: idTagToSend, 
                meterStart: 0, 
                timestamp: new Date().toISOString()
            });
        }

        stopChargingProcess() {
            this.isStopping = true;

            this.sendRequest("StopTransaction", { 
                transactionId: this.transactionId, 
                meterStop: this.meterValue, 
                timestamp: new Date().toISOString() 
            });
            this.stopSendingMeterValues();
            this.hideChargingProgress();
            if (this.dom.timeRemaining) this.dom.timeRemaining.textContent = "00:00:00";
            this.sendRequest("StatusNotification", { connectorId: 1, status: "Finishing", errorCode: "NoError" });
            this.updateStatusUI('Finishing');
            
            this.clearLocalState();

            setTimeout(() => {
                this.isEvReady = false;
                this.dom.evStatusBtn.classList.remove('active');

                const newStatus = this.isPluggedIn ? "Unavailable" : "Available";
                this.sendRequest("StatusNotification", { connectorId: 1, status: newStatus, errorCode: "NoError" });
                this.updateStatusUI(newStatus);
                this.hidePaymentSection();
                this.transactionId = null; 
                this.chargingStartTime = null;
                this.isStopping = false;

                this.dom.plugStatusBtn.disabled = false;
                if (this.isPluggedIn) {
                    this.dom.evStatusBtn.disabled = false; 
                }
            }, 2000);
        }

        updateStatusUI(status) {
            this.dom.statusDisplay.className = 'status-display';
            const btn = this.dom.startStopBtn;
            this.dom.plugStatusBtn.disabled = true;
            this.dom.evStatusBtn.disabled = true;

            const isCharging = (status === 'Charging' || status === 'Preparing' || status === 'Finishing');
            if (this.onChargingStateChange) this.onChargingStateChange(isCharging);

            switch (status) {
                case 'Available':
                    this.dom.statusDisplay.classList.add('status-available');
                    this.dom.statusIcon.className = 'fas fa-check-circle status-icon';
                    this.dom.statusText.textContent = 'Available';
                    this.dom.plugStatusBtn.disabled = false;
                    this.dom.startStopBtn.style.display = 'none';
                    break;
                case 'Unavailable':
                    this.dom.statusDisplay.classList.add('status-unavailable');
                    this.dom.statusIcon.className = 'fas fa-pause-circle status-icon';
                    this.dom.statusText.textContent = 'Plugged In';
                    this.dom.plugStatusBtn.disabled = false;
                    this.dom.evStatusBtn.disabled = false;
                    this.dom.startStopBtn.style.display = 'none';
                    break;
                case 'Preparing':
                    this.dom.statusDisplay.classList.add('status-charging');
                    this.dom.statusIcon.className = 'fas fa-plug status-icon';
                    this.dom.statusText.textContent = 'Preparing';
                    this.dom.plugStatusBtn.disabled = false;
                    this.dom.evStatusBtn.disabled = false;
                    this.dom.startStopBtn.style.display = 'none';
                    break;
                case 'Charging':
                    this.dom.statusDisplay.classList.add('status-charging');
                    this.dom.statusIcon.className = 'fas fa-bolt status-icon';
                    this.dom.statusText.textContent = 'Charging';
                    this.dom.startStopBtn.style.display = 'block';
                    break;
                case 'Finishing':
                    this.dom.statusDisplay.classList.add('status-charging');
                    this.dom.statusIcon.className = 'fas fa-spinner fa-spin status-icon';
                    this.dom.statusText.textContent = 'Finishing...';
                    this.dom.startStopBtn.style.display = 'none';
                    break;
                case 'Offline':
                    this.dom.statusDisplay.classList.add('status-error');
                    this.dom.statusIcon.className = 'fas fa-times-circle status-icon';
                    this.dom.statusText.textContent = 'Offline';
                    this.dom.startStopBtn.style.display = 'none';
                    break;
            }
        }
        
        startSendingMeterValues(txId) {
            if (this.meterValueIntervalId) clearInterval(this.meterValueIntervalId);
            this.meterValueIntervalId = setInterval(() => {
                const powerKw = this.CHARGING_POWER || 7.2;
                
                this.saveLocalState();
            }, 5000);
        }
        
        stopSendingMeterValues() {
            clearInterval(this.meterValueIntervalId);
            this.dom.energyValue.textContent = '0.00 kWh';
            this.dom.powerValue.textContent = '0.0 kW';
        }
    }

    // --- STRIPE DEDICATED SCREEN HANDLERS ---
    const stripePaymentView = document.getElementById('stripe-payment-view');
    const stripeBackNavBtn = document.getElementById('stripe-back-nav-btn');
    const stripeCardNumberInput = document.getElementById('stripe-card-number-input');
    const stripeExpiryInput = document.getElementById('stripe-expiry-input');
    const stripeCvcInput = document.getElementById('stripe-cvc-input');
    const stripeNameInput = document.getElementById('stripe-name-input');
    const stripePaymentAmountValue = document.getElementById('stripe-payment-amount-value');
    const stripePaymentBtn = document.getElementById('stripe-payment-btn');
    const stripeCardNumberDisplay = document.querySelector('.stripe-card-number-display');
    const stripeCardHolderDisplay = document.querySelector('.stripe-card-holder-display');
    const stripeCardExpiryDisplay = document.querySelector('.stripe-card-expiry-display');

    // Navigate to stripe view from payment method selector
    window.navigateToStripePayment = function(amount) {
        // Update amount display
        if (stripePaymentAmountValue) {
            stripePaymentAmountValue.textContent = `${amount.toLocaleString()} VND`;
        }
        
        // Reset form
        if (stripeCardNumberInput) stripeCardNumberInput.value = '';
        if (stripeExpiryInput) stripeExpiryInput.value = '';
        if (stripeCvcInput) stripeCvcInput.value = '';
        if (stripeNameInput) stripeNameInput.value = '';
        if (stripeCardNumberDisplay) stripeCardNumberDisplay.textContent = '•••• •••• •••• ••••';
        if (stripeCardHolderDisplay) stripeCardHolderDisplay.textContent = 'CARD HOLDER';
        if (stripeCardExpiryDisplay) stripeCardExpiryDisplay.textContent = 'MM/YY';
        
        // Navigate to Stripe view
        views.forEach(view => view.classList.remove('active'));
        if (stripePaymentView) {
            stripePaymentView.classList.add('active');
            // Scroll to top when entering Stripe payment screen
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Back button from Stripe view
    if (stripeBackNavBtn) {
        stripeBackNavBtn.addEventListener('click', () => {
            // Navigate back to status view
            views.forEach(view => view.classList.remove('active'));
            document.getElementById('status-view').classList.add('active');
            navItems.forEach(i => i.classList.remove('active'));
            document.querySelector('[data-view="status-view"]').classList.add('active');
            
            // Re-show payment method selector if chargePoint exists
            if (chargePoint && chargePoint.dom && chargePoint.dom.paymentMethodSection) {
                chargePoint.dom.paymentMethodSection.style.display = 'block';
            }
        });
    }

    // Card input formatting for dedicated Stripe screen
    if (stripeCardNumberInput) {
        stripeCardNumberInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s/g, '');
            let formattedValue = value.match(/.{1,4}/g)?.join(' ') || value;
            e.target.value = formattedValue;
            if (stripeCardNumberDisplay) {
                stripeCardNumberDisplay.textContent = formattedValue || '•••• •••• •••• ••••';
            }
        });
    }

    if (stripeExpiryInput) {
        stripeExpiryInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.substring(0, 2) + '/' + value.substring(2, 4);
            }
            e.target.value = value;
            if (stripeCardExpiryDisplay) {
                stripeCardExpiryDisplay.textContent = value || 'MM/YY';
            }
        });
    }

    if (stripeNameInput) {
        stripeNameInput.addEventListener('input', (e) => {
            if (stripeCardHolderDisplay) {
                stripeCardHolderDisplay.textContent = e.target.value.toUpperCase() || 'CARD HOLDER';
            }
        });
    }

    // Pay button handler for dedicated Stripe screen
    if (stripePaymentBtn) {
        stripePaymentBtn.addEventListener('click', () => {
            // Validate inputs
            const cardNumber = stripeCardNumberInput ? stripeCardNumberInput.value.replace(/\s/g, '') : '';
            const expiry = stripeExpiryInput ? stripeExpiryInput.value : '';
            const cvc = stripeCvcInput ? stripeCvcInput.value : '';
            const name = stripeNameInput ? stripeNameInput.value : '';
            
            if (!cardNumber || cardNumber.length < 13) {
                alert('Please enter a valid card number');
                return;
            }
            
            if (!expiry || expiry.length !== 5) {
                alert('Please enter expiry date (MM/YY)');
                return;
            }
            
            if (!cvc || cvc.length < 3) {
                alert('Please enter CVC');
                return;
            }
            
            if (!name) {
                alert('Please enter cardholder name');
                return;
            }
            
            // Disable button and show processing
            stripePaymentBtn.disabled = true;
            stripePaymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            
            // Simulate payment processing (2 seconds)
            setTimeout(() => {
                // Re-enable button
                stripePaymentBtn.disabled = false;
                stripePaymentBtn.innerHTML = '<i class="fas fa-lock"></i> Pay Now';
                
                // Navigate back to status view
                views.forEach(view => view.classList.remove('active'));
                const statusView = document.getElementById('status-view');
                if (statusView) {
                    statusView.classList.add('active');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }

                // Highlight status view
                if (typeof navItems !== 'undefined') {
                    navItems.forEach(i => i.classList.remove('active'));
                    const navStatusBtn = document.querySelector('[data-view="status-view"]');
                    if (navStatusBtn) navStatusBtn.classList.add('active');
                }
                
                // Show success toast
                if (chargePoint) {
                    chargePoint.showToast('Payment successful!');
                    
                    // Start charging after toast
                    setTimeout(() => {
                        chargePoint.startChargingProcess();
                        chargePoint.showChargingProgress();
                    }, 500);
                }
            }, 2000);
        });
    }
});