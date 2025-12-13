document.addEventListener('DOMContentLoaded', () => {
    // Views
    const stationListView = document.getElementById('station-list-view');
    const stationDetailView = document.getElementById('station-detail-view');

    // Detail View Elements
    const backToListBtn = document.getElementById('back-to-list-btn');
    const detailStationId = document.getElementById('detail-station-id');
    const detailStationMeta = document.getElementById('detail-station-meta');
    const detailStatusTag = document.getElementById('detail-status-tag');
    const connectorDetails = document.getElementById('connector-details');
    const qrCodeContainer = document.getElementById('qr-code-container');
    const qrcodeElement = document.getElementById('qrcode');
    const editStationBtn = document.getElementById('edit-station-btn');
    const deleteStationBtn = document.getElementById('delete-station-btn');
    const detailEnergyContainer = document.getElementById('detail-energy-container');
    const detailEnergyValue = document.getElementById('detail-energy-value');
    const chargingProgressContainer = document.getElementById('charging-progress-container');
    const timeRemainText = document.getElementById('time-remain-text');

    // List View Elements
    const addStationBtn = document.getElementById('add-station-btn');
    const searchInput = document.getElementById('search-input');
    const stationTableBody = document.getElementById('station-table-body');

    // Modal Elements
    const addStationModal = document.getElementById('add-station-modal');
    const modalTitle = addStationModal.querySelector('.modal-header h3');
    const closeModalBtn = addStationModal.querySelector('.close-btn');
    const closeModalFooterBtn = addStationModal.querySelector('.close-modal-btn');
    const addModalBtn = addStationModal.querySelector('.add-modal-btn');
    const modalStationIdInput = document.getElementById('modal-station-id');
    const modalStationLocationInput = document.getElementById('modal-station-location');

    // State
    const stations = new Map();
    let ws = null;
    let currentEditId = null;
    let currentDetailId = null; // Track which station detail is being viewed
    let qrCodeInstance = null;

    // --- UTILS ---
    const showView = (viewToShow) => {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        viewToShow.classList.add('active');
    };

    const showModal = (show, stationToEdit = null) => {
        if (show) {
            currentEditId = stationToEdit ? stationToEdit.id : null;
            if (stationToEdit) {
                modalTitle.textContent = 'Edit Station';
                addModalBtn.textContent = 'SAVE';
                modalStationIdInput.value = stationToEdit.id;
                modalStationIdInput.disabled = true;
                modalStationLocationInput.value = stationToEdit.location || '';
            } else {
                modalTitle.textContent = 'Add New Station';
                addModalBtn.textContent = 'ADD';
                modalStationIdInput.value = '';
                modalStationIdInput.disabled = false;
                modalStationLocationInput.value = '';
            }
            addStationModal.style.display = 'flex';
        } else {
            addStationModal.style.display = 'none';
        }
    };

    const renderStationList = () => {
        stationTableBody.innerHTML = '';
        const searchTerm = searchInput.value.toLowerCase();
        stations.forEach(station => {
            if (station.id.toLowerCase().includes(searchTerm) ||
                (station.status && station.status.toLowerCase().includes(searchTerm)) || // Add check for status existence
                (station.location && station.location.toLowerCase().includes(searchTerm))) {
                
                const row = document.createElement('tr');
                row.dataset.id = station.id;
                const status = station.status || 'Unavailable';
                row.innerHTML = `
                    <td>${station.id}</td>
                    <td><span class="status-tag status-${status.toLowerCase()}">${status}</span></td>
                    <td>${station.location || 'N/A'}</td>
                    <td>${station.lastActivity || 'N/A'}</td>
                `;
                row.addEventListener('click', () => showStationDetail(station.id));
                stationTableBody.appendChild(row);
            }
        });
    };

    const showStationDetail = (stationId) => {
        currentDetailId = stationId; // Set the current detail ID
        const station = stations.get(stationId);
        if (!station) return;

        detailStationId.textContent = station.id;
        detailStationMeta.textContent = `${station.vendor || 'N/A'} / ${station.model || 'N/A'}`;
        
        // Call the new update function
        updateDetailViewStatus(station.status || 'Unavailable', station);

        // Generate QR Code
        if (qrcodeElement) {
            const url = `${window.location.origin}/customer/?stationId=${station.id}`;
            if (qrCodeInstance) {
                qrCodeInstance.clear();
                qrCodeInstance.makeCode(url);
            } else {
                qrCodeInstance = new QRCode(qrcodeElement, {
                    text: url,
                    width: 150,
                    height: 150,
                });
            }
        }
        
        showView(stationDetailView);
    };

    // Function to update the detail view based on status
    const updateDetailViewStatus = (status, stationData = {}) => {
        const safeStatus = status || 'Unavailable';
        // Update status tag
        detailStatusTag.textContent = safeStatus;
        detailStatusTag.className = `status-tag status-${safeStatus.toLowerCase()}`;

        // Update connector details
        connectorDetails.innerHTML = `<h4>Connector 1</h4><p>Status: ${safeStatus}</p>`;

        //QR code change by Status
        const busyStatuses = ['Preparing', 'Charging', 'Finishing'];
        if (busyStatuses.includes(safeStatus)) {
            qrCodeContainer.classList.add('hidden');
        } else {
            qrCodeContainer.classList.remove('hidden');
        }

        //Energy view
        const rawEnergy = parseFloat(stationData.energy);
        if (!isNaN(rawEnergy)) {
            detailEnergyContainer.classList.remove('hidden');
            const energyKwh = rawEnergy/ 1000;
            detailEnergyValue.textContent = energyKwh.toFixed(2); 
        } else {
            if (!busyStatuses.includes(safeStatus)) {
                 detailEnergyContainer.classList.add('hidden');
            }
        }

        //Loading view and Time View
        if (safeStatus === 'Charging') {
            chargingProgressContainer.classList.remove('hidden');
            if (stationData.timeRemaining) {
                timeRemainText.textContent = `${stationData.timeRemaining} remaining`;
            } else {
                timeRemainText.textContent = "-- min remaining";
            }
            const progressPercent = stationData.soc || 0; 
            const progressBarFill = document.querySelector('.progress-bar-fill');
            if (progressBarFill) {
                progressBarFill.style.width = `${progressPercent}%`;
            }
        } else {
            chargingProgressContainer.classList.add('hidden');
        }
    };

    const updateStationList = (stationData) => {
        const list = Array.isArray(stationData) ? stationData : [stationData];
        
        list.forEach(s => {
            const existing = stations.get(s.id) || {};
            // Merge dữ liệu mới vào dữ liệu cũ
            stations.set(s.id, { 
                ...existing, 
                ...s,
                lastActivity: s.lastActivity || new Date().toLocaleTimeString() 
            });
        });
        renderStationList();
    };

    // --- WEBSOCKET CONNECTION ---
    function connect() {
        const wsUrl = `ws://${window.location.host}/scada`;
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            let station;

            switch (data.type) {
                case 'fullStatus':
                    stations.clear();
                    updateStationList(data.chargePoints);
                    break;
                case 'connect':
                case 'boot':
                    updateStationList(data.state); // data.state chứa thông tin id, location...
                    break;
                case 'disconnect':
                    if (data.hardDelete) {
                        stations.delete(data.id);
                    } else {
                        const st = stations.get(data.id);
                        if (st) { 
                            st.status = 'Unavailable'; 
                            st.lastActivity = new Date().toLocaleTimeString();
                        }
                    }
                    renderStationList();
                    break;
                case 'status':
                    const st = stations.get(data.id);
                    if (st) { 
                        st.status = data.status;
                        renderStationList();
                    }
                    break;
                 case 'meterValue':
                    const mSt = stations.get(data.id);
                    if (mSt) {
                        const isSessionActive = ['Charging', 'SuspendedEV', 'SuspendedEVSE', 'Finishing'].includes(mSt.status);
                        if (isSessionActive || data.value === 0) {
                            if (data.value !== undefined) mSt.energy = data.value;
                            if (data.soc !== undefined) mSt.soc = data.soc;
                            if (data.timeRemaining !== undefined) mSt.timeRemaining = data.timeRemaining;
                        }
                    }
                    break;
            }

                if (currentDetailId) {
                    if ((data.id && data.id === currentDetailId) || 
                        (data.chargePoints && data.chargePoints.find(cp => cp.id === currentDetailId))) {
                
                            const currentStationData = stations.get(currentDetailId);
                            if (currentStationData) {
    
                            updateDetailViewStatus(currentStationData.status, currentStationData);
                            }
                }
            }
        };

        ws.onclose = () => {
            setTimeout(connect, 3000);
        };
    }

    // --- EVENT LISTENERS ---
    backToListBtn.addEventListener('click', () => {
        currentDetailId = null; 
        showView(stationListView);
    });

    deleteStationBtn.addEventListener('click', () => {
        if (currentDetailId && confirm(`Are you sure you want to delete station "${currentDetailId}"?`)) {
            stations.delete(currentDetailId);
            renderStationList();
            showView(stationListView);
        }
    });
    editStationBtn.addEventListener('click', () => {
        if (currentDetailId) {
            showModal(true, stations.get(currentDetailId));
        }
    });

    searchInput.addEventListener('input', renderStationList);
    addStationBtn.addEventListener('click', () => showModal(true));
    closeModalBtn.addEventListener('click', () => showModal(false));
    closeModalFooterBtn.addEventListener('click', () => showModal(false));

     addModalBtn.addEventListener('click', async () => {
        const id = modalStationIdInput.value.trim();
        const location = modalStationLocationInput.value.trim();

        if (!id) { alert("Please enter ID"); return; }

        if (currentEditId) {
            // Logic edit (bạn có thể tự thêm API PUT nếu muốn)
            alert("Edit feature currently supports visual update only.");
            const st = stations.get(currentEditId);
            if(st) { st.location = location; renderStationList(); }
        } else {
            // Logic ADD mới -> Gọi API lưu vào DB
            try {
                addModalBtn.disabled = true;
                addModalBtn.textContent = "Saving...";
                
                const res = await fetch('/api/stations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, location })
                });

                if (res.ok) {
                    // Thành công, WebSocket sẽ tự nhận tin nhắn 'connect' để cập nhật UI
                    showModal(false);
                } else {
                    const err = await res.json();
                    alert("Error: " + err.error);
                }
            } catch (e) {
                console.error(e);
                alert("Connection error");
            } finally {
                addModalBtn.disabled = false;
                addModalBtn.textContent = "ADD";
            }
        }
    });

    document.getElementById('delete-station-btn').addEventListener('click', async () => {
        if (currentDetailId && confirm(`Delete station "${currentDetailId}" permanently?`)) {
            try {
                const res = await fetch(`/api/stations/${currentDetailId}`, { method: 'DELETE' });
                if (res.ok) {
                    // Thành công, đợi WebSocket báo về hoặc tự xóa UI
                    showView(document.getElementById('station-list-view'));
                } else {
                    alert("Failed to delete");
                }
            } catch (e) {
                console.error(e);
            }
        }
    });

    connect();
})