document.addEventListener('DOMContentLoaded', () => {
    // --- VIEW MANAGEMENT ---
    const navLinks = document.querySelectorAll('.nav-link');
    const views = document.querySelectorAll('.view');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            const targetViewId = link.dataset.view;
            views.forEach(view => {
                view.style.display = view.id === targetViewId ? 'block' : 'none';
            });
        });
    });

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
        
        // Switch to connection view
        navLinks.forEach(l => l.classList.remove('active'));
        document.querySelector('[data-view="connection-view"]').classList.add('active');
        views.forEach(view => {
            view.style.display = view.id === 'connection-view' ? 'block' : 'none';
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


    connectBtn.addEventListener('click', () => {
        const backendUrl = backendUrlInput.value.trim();
        const chargeboxId = chargeboxIdInput.value.trim();

        if (!backendUrl || !chargeboxId) {
            alert('Please provide both Backend URL and Chargebox ID.');
            return;
        }

        const fullUrl = `${backendUrl}/${chargeboxId}`;
        statusBanner.style.display = 'block';
        statusBanner.className = 'connection-status-banner';
        statusBanner.textContent = `Connecting to ${fullUrl}...`;

        if (websocket) websocket.close();

        websocket = new WebSocket(fullUrl);

        websocket.onopen = () => {
            statusBanner.classList.add('success');
            statusBanner.textContent = `Successfully connected to ${chargeboxId}.`;
            chargePoint = new ChargePointStatus(chargeboxId, sendRequest, sendResponse);
            connectorsContainer.innerHTML = '';
            connectorsContainer.appendChild(chargePoint.getElement());
            
            sendRequest("BootNotification", { chargePointVendor: "MicroOcppUI", chargePointModel: "WebSim" });
        };

        websocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            console.log('RECEIVED:', message);
            if (chargePoint) {
                chargePoint.handleMessage(message);
            }
        };

        websocket.onerror = () => {
            statusBanner.classList.add('error');
            statusBanner.textContent = `Error while connecting to ${fullUrl}.`;
        };
        
        websocket.onclose = () => {
             if (chargePoint) {
                statusBanner.classList.add('error');
                statusBanner.textContent = `Connection with ${chargeboxId} closed.`;
                chargePoint = null;
             }
        };
    });

    // --- CHARGE POINT STATUS CLASS ---
    class ChargePointStatus {
        constructor(id, sendRequestCallback, sendResponseCallback) {
            this.id = id;
            this.sendRequest = sendRequestCallback;
            this.sendResponse = sendResponseCallback;
            this.transactionId = null;
            this.meterValue = 0;
            this.meterValueIntervalId = null;
            this.isPluggedIn = false;
            this.isEvReady = false;

            // --- MỚI: Kho cấu hình giả lập ---
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
                    <div class="metric-item"><span class="metric-label">Energy</span><span class="metric-value energy-value">0 Wh</span></div>
                    <div class="metric-item"><span class="metric-label">Power</span><span class="metric-value power-value">0 W</span></div>
                </div>
                <div class="action-footer"><button class="action-btn start-stop-btn" disabled>Start Charging</button></div>
                <!-- MỚI: Khu vực hành động tùy chỉnh -->
                <div class="custom-actions-section">
                    <h4>Custom Actions</h4>
                    <div class="data-transfer-form">
                        <input type="text" class="vendor-id-input" placeholder="Vendor ID" value="WebSimVendor">
                        <input type="text" class="data-input" placeholder="Data">
                        <button class="action-btn send-data-transfer-btn">Send DataTransfer</button>
                    </div>
                </div>
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
                // MỚI: Cache các phần tử mới
                vendorIdInput: this.element.querySelector('.vendor-id-input'),
                dataInput: this.element.querySelector('.data-input'),
                sendDataTransferBtn: this.element.querySelector('.send-data-transfer-btn'),
            };
        }

        addEventListeners() {
            this.dom.startStopBtn.addEventListener('click', () => this.handleLocalStartStop());
            
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
                this.checkStartButtonState();
            });

            this.dom.evStatusBtn.addEventListener('click', () => {
                this.isEvReady = !this.isEvReady;
                this.dom.evStatusBtn.classList.toggle('active', this.isEvReady);
                
                if (this.isEvReady && this.isPluggedIn) {
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Preparing", errorCode: "NoError" });
                    this.updateStatusUI('Preparing');
                } else if (this.isPluggedIn) {
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Unavailable", errorCode: "NoError" });
                    this.updateStatusUI('Unavailable');
                }
                
                this.checkStartButtonState();
            });

            // MỚI: Event listener để gửi DataTransfer
            this.dom.sendDataTransferBtn.addEventListener('click', () => {
                const vendorId = this.dom.vendorIdInput.value;
                const data = this.dom.dataInput.value;
                if (vendorId) {
                    this.sendRequest('DataTransfer', { vendorId, data });
                    this.dom.dataInput.value = '';
                } else {
                    alert('Vendor ID is required.');
                }
            });
        }

        getElement() { return this.element; }

        handleMessage(message) {
            const [type, uniqueId, actionOrPayload, payload] = message;

            if (type === 2) { // It's a CALL (a command from the server)
                this.handleRemoteCommand(uniqueId, actionOrPayload, payload);
            } else if (type === 3) { // It's a CALLRESULT (a response to our request)
                if (actionOrPayload.status === 'Accepted' && actionOrPayload.interval) {
                    this.sendRequest("StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" });
                    this.updateStatusUI('Available');
                }

                if (actionOrPayload.transactionId && actionOrPayload.idTagInfo && actionOrPayload.idTagInfo.status === 'Accepted') {
                    console.log(`Transaction confirmed by server with ID: ${actionOrPayload.transactionId}`);
                    this.transactionId = actionOrPayload.transactionId;
                    
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
                        // Từ chối lệnh vì chưa sẵn sàng
                        this.sendResponse(uniqueId, { status: "Rejected" });
                        console.log("Rejected RemoteStart: Not Plugged in or Not Ready.");
                    }
                    break;
                case 'RemoteStopTransaction':
                    if (payload.transactionId === this.transactionId) {
                        this.sendResponse(uniqueId, { status: "Accepted" });
                        this.stopChargingProcess();
                    } else {
                        console.error(`Rejected StopTransaction. Server ID: ${payload.transactionId}, Local ID: ${this.transactionId}`);
                        this.sendResponse(uniqueId, { status: "Rejected" });
                    }
                    break;
                
                // --- MỚI: Xử lý các lệnh nâng cao ---
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
                
                case 'DataTransfer':
                    console.log(`Received DataTransfer from server:`, payload);
                    this.sendResponse(uniqueId, { status: "Accepted", data: "Server data successfully processed." });
                    break;
                
                default:
                     this.sendResponse(uniqueId, { status: "Rejected" });
            }
        }
        
        handleLocalStartStop() {
            if (this.transactionId) {
                this.stopChargingProcess();
            } else {
                this.startChargingProcess("LOCAL_TAG");
            }
        }

        startChargingProcess(idTag) {
            this.sendRequest("Authorize", { idTag });
            this.sendRequest("StartTransaction", { 
                connectorId: 1, 
                idTag, 
                meterStart: 0, 
                timestamp: new Date().toISOString()
            });
        }

        stopChargingProcess() {
            this.sendRequest("StopTransaction", { 
                transactionId: this.transactionId, 
                meterStop: this.meterValue, 
                timestamp: new Date().toISOString() 
            });
            this.stopSendingMeterValues();
            this.sendRequest("StatusNotification", { connectorId: 1, status: "Finishing", errorCode: "NoError" });
            this.updateStatusUI('Finishing');
            
            setTimeout(() => {
                this.isEvReady = false;
                this.dom.evStatusBtn.classList.remove('active');

                const newStatus = this.isPluggedIn ? "Unavailable" : "Available";
                this.sendRequest("StatusNotification", { connectorId: 1, status: newStatus, errorCode: "NoError" });
                this.updateStatusUI(newStatus);
                this.transactionId = null; 
            }, 2000);
        }
        
        checkStartButtonState() {
            const isReadyToStart = this.isPluggedIn && this.isEvReady && this.dom.statusText.textContent === 'Preparing';
            this.dom.startStopBtn.disabled = !isReadyToStart;
        }

        updateStatusUI(status) {
            this.dom.statusDisplay.className = 'status-display';
            const btn = this.dom.startStopBtn;

            this.dom.plugStatusBtn.disabled = true;
            this.dom.evStatusBtn.disabled = true;
            btn.disabled = true;

            switch (status) {
                case 'Available':
                    this.dom.statusDisplay.classList.add('status-available');
                    this.dom.statusIcon.className = 'fas fa-check-circle status-icon';
                    this.dom.statusText.textContent = 'Available';
                    btn.textContent = 'Start Charging';
                    btn.className = 'action-btn start-stop-btn start';
                    this.dom.plugStatusBtn.disabled = false;
                    break;
                case 'Unavailable':
                    this.dom.statusDisplay.classList.add('status-unavailable');
                    this.dom.statusIcon.className = 'fas fa-pause-circle status-icon';
                    this.dom.statusText.textContent = 'Plugged In';
                    btn.textContent = 'Start Charging';
                    btn.className = 'action-btn start-stop-btn start';
                    this.dom.plugStatusBtn.disabled = false;
                    this.dom.evStatusBtn.disabled = false;
                    break;
                case 'Preparing':
                    this.dom.statusDisplay.classList.add('status-charging');
                    this.dom.statusIcon.className = 'fas fa-plug status-icon';
                    this.dom.statusText.textContent = 'Preparing';
                    btn.textContent = 'Start Charging';
                    btn.className = 'action-btn start-stop-btn start';
                    this.dom.plugStatusBtn.disabled = false;
                    this.dom.evStatusBtn.disabled = false;
                    this.checkStartButtonState();
                    break;
                case 'Charging':
                    this.dom.statusDisplay.classList.add('status-charging');
                    this.dom.statusIcon.className = 'fas fa-bolt status-icon';
                    this.dom.statusText.textContent = 'Charging';
                    btn.textContent = 'Stop Charging';
                    btn.className = 'action-btn start-stop-btn stop';
                    btn.disabled = false;
                    break;
                case 'Finishing':
                    this.dom.statusDisplay.classList.add('status-charging');
                    this.dom.statusIcon.className = 'fas fa-spinner fa-spin status-icon';
                    this.dom.statusText.textContent = 'Finishing...';
                    break;
                case 'Offline':
                    this.dom.statusDisplay.classList.add('status-error');
                    this.dom.statusIcon.className = 'fas fa-times-circle status-icon';
                    this.dom.statusText.textContent = 'Offline';
                    break;
            }
        }
        
        startSendingMeterValues(txId) {
            this.meterValue = 0;
            if (this.meterValueIntervalId) clearInterval(this.meterValueIntervalId);
            this.meterValueIntervalId = setInterval(() => {
                this.meterValue += 100;
                const power = Math.floor(Math.random() * (7000 - 6000 + 1) + 6000);
                this.dom.energyValue.textContent = `${this.meterValue} Wh`;
                this.dom.powerValue.textContent = `${power} W`;
                this.sendRequest("MeterValues", {
                    connectorId: 1,
                    transactionId: txId,
                    meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [{ value: this.meterValue.toString(), unit: "Wh" }] }]
                });
            }, 5000);
        }
        
        stopSendingMeterValues() {
            clearInterval(this.meterValueIntervalId);
            this.meterValue = 0;
            this.dom.energyValue.textContent = '0 Wh';
            this.dom.powerValue.textContent = '0 W';
        }
    }
});
