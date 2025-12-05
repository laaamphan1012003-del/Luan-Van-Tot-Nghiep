document.addEventListener('DOMContentLoaded', () => {
    //Sidebar toggle
    const sidebarToggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('admin-sidebar');
    
    // Xử lý sự kiện toggle sidebar
    if (sidebarToggleBtn && sidebar) {
        sidebarToggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

// --- LOGIC CHART SELECTOR ---
    const chartViewSelect = document.getElementById('chart-view-select');
    if (chartViewSelect) {
        chartViewSelect.addEventListener('change', (e) => {
            const viewMode = e.target.value;
            updateChartView(viewMode);
        });
    }

    function updateChartView(viewMode) {
        const grid = document.querySelector('.charts-grid');
        const allCards = document.querySelectorAll('.chart-card');
        
        if (viewMode === 'all') {
            // Show all mode
            grid.classList.remove('single-view');
            allCards.forEach(card => {
                card.classList.remove('hidden', 'expanded');
                const wrapper = card.querySelector('.chart-canvas-wrapper');
                if(wrapper) wrapper.style.height = ''; // Reset inline style if any
            });
        } else {
            // Single chart mode
            grid.classList.add('single-view');
            allCards.forEach(card => {
                // Check if card matches selected view (based on ID or data-chart attribute)
                // Here we match based on card ID which we set in HTML: card-usageCountChart, etc.
                if (card.id === `card-${viewMode}`) {
                    card.classList.remove('hidden');
                    card.classList.add('expanded');
                } else {
                    card.classList.add('hidden');
                    card.classList.remove('expanded');
                }
            });
        }
        
        // Trigger resize for all charts to ensure they fit new container sizes
        setTimeout(() => {
            if(usageCountChart) usageCountChart.resize();
            if(energyChart) energyChart.resize();
            if(usageTimeChart) usageTimeChart.resize();
        }, 300); // Small delay for transition
    }

    // KHAI BÁO BIẾN TOÀN CỤC & CẤU HÌNH
    const chargersContainer = document.getElementById('chargers-container');
    const globalLogBody = document.getElementById('global-log-body');
    const MAX_LOG_ROWS = 100;

    let currentChartRange = '1d';

    // Mapping từ tốc độ sạc sang số pha (Load) hoạt động
    const SPEED_TO_LOADS = {
        'normal': [true, false, false],     // Load 1 only
        'fast': [true, true, false],        // Load 1 + 2
        'lightning': [true, true, true]     // Load 1 + 2 + 3
    };

    let ws; 
    
    const chargePointCards = new Map();
    
    let currentSqlData = [];

    // Biểu đồ thống kê (Chart.js)
    let usageCountChart = null;
    let energyChart = null;
    let usageTimeChart = null;
    
    
    if (!chargersContainer) {
        console.error('Error: Element with id "chargers-container" not found!');
        return;
    }
    if (!globalLogBody) {
        console.error('Error: Element with id "global-log-body" not found!');
        return;
    }

    // =========================================================================
    // PHẦN 1: QUẢN LÝ GIAO DIỆN (TABS, SIDEBAR, SEARCH)
    // =========================================================================

    window.openTab = function(viewId, elem) {
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
            content.style.display = '';
        });

        document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
            link.classList.remove('active');
        });
    
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.style.display = 'block';
        }
        
        if (elem) {
            elem.classList.add('active');
        } else {
            const link = document.querySelector(`.nav-link[onclick*="${viewId}"]`);
            if (link) link.classList.add('active');
        }

        if(viewId === 'database-view') {
            loadSqlData();
            updateCharts('1w');
        }
    }
    
    window.loadSqlData = async function() {
        const tbody = document.getElementById('sql-table-body');
        const dateInput = document.getElementById('search-date');
        
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="6" class="table-message loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading data...</td></tr>';
        
        try {
            // Logic lấy URL
            let url = '/api/history';
            if (dateInput && dateInput.value) {
                const start = `${dateInput.value}T00:00:00`;
                const end = `${dateInput.value}T23:59:59`;
                url = `/api/history?start=${start}&end=${end}`;
            }

            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            currentSqlData = await response.json();
            
            // Xóa bộ lọc cũ để thấy dữ liệu ngay
            if(document.getElementById('search-tx-id')) document.getElementById('search-tx-id').value = ''; 
            
            filterAndRenderSqlData();
    
        } catch (err) {
            console.error('Error fetching SQL data:', err);
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#de350b;">Connection Error.</td></tr>';
        }
    }

    window.filterAndRenderSqlData = function() {
        const tbody = document.getElementById('sql-table-body');
        const txSearch = document.getElementById('search-tx-id')?.value.toLowerCase() || '';
        const cpSearch = document.getElementById('search-cp-id')?.value.toLowerCase() || '';
        const dateSearch = document.getElementById('search-date')?.value || ''; 

        tbody.innerHTML = '';

        const filteredData = currentSqlData.filter(row => {
            const matchTx = row.id.toString().includes(txSearch);
            const matchCp = row.charge_point_id.toLowerCase().includes(cpSearch);
            
            let matchDate = true;
            if (dateSearch) {
                const rowDate = new Date(row.start_time).toISOString().split('T')[0];
                matchDate = rowDate === dateSearch;
            }

            return matchTx && matchCp && matchDate;
        });

        if (filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #6b778c;">No matching records found.</td></tr>';
            return;
        }

        filteredData.forEach(row => {
            const tr = document.createElement('tr');
            const startTime = new Date(row.start_time).toLocaleString();
            const stopTime = row.stop_time ? new Date(row.stop_time).toLocaleString() : '<span style="color:#0052cc; font-weight:600">Charging...</span>';
            const energy = row.total_energy !== null ? row.total_energy : (row.meter_stop - row.meter_start);

            tr.innerHTML = `
                <td>#${row.id}</td>
                <td><strong>${row.charge_point_id}</strong></td>
                <td><code style="background:#f4f5f7; padding:2px 5px; border-radius:3px; color:#0052cc">${row.id_tag || 'N/A'}</code></td>
                <td>${startTime}</td>
                <td>${stopTime}</td>
                <td style="color: #00875a; font-weight:bold;">${energy || 0} Wh</td>
            `;
            tbody.appendChild(tr);
        });
    }

    if(document.getElementById('search-tx-id')) {
        document.getElementById('search-tx-id').addEventListener('input', filterAndRenderSqlData);
        document.getElementById('search-cp-id').addEventListener('input', filterAndRenderSqlData);
        document.getElementById('search-date').addEventListener('change', filterAndRenderSqlData);
    }

    //--- CHART UPDATE ---
    function toLocalIsoString(date) {
        const pad = (num) => (num < 10 ? '0' : '') + num;
        return date.getFullYear() +
            '-' + pad(date.getMonth() + 1) +
            '-' + pad(date.getDate()) +
            'T' + pad(date.getHours()) +
            ':' + pad(date.getMinutes()) +
            ':' + pad(date.getSeconds());
    }

    // Cập nhật biểu đồ thống kê
    window.updateCharts = async function(range) {
        currentChartRange = range;
        // Update active button state
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
            if(btn.getAttribute('onclick').includes(range)) btn.classList.add('active');
        });

        // Calculate date range
        const end = new Date();
        const start = new Date();
        if(range === '1d') start.setDate(start.getDate() - 1);
        if(range === '1w') start.setDate(start.getDate() - 7);
        if(range === '1m') start.setMonth(start.getMonth() - 1);
        if(range === '3m') start.setMonth(start.getMonth() - 3);

        // Fetch data
        try {
            const response = await fetch(`/api/history?start=${toLocalIsoString(start)}&end=${toLocalIsoString(end)}`);
            if (!response.ok) throw new Error("Failed to fetch chart data");
            const data = await response.json();
            renderCharts(data, range);
        } catch (e) {
            console.error("Error updating charts:", e);
        }
    }

    const pieLabelsPlugin = {
        id: 'pieLabels',
        afterDatasetsDraw(chart, args, options) {
            const { ctx } = chart;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                const total = dataset.data.reduce((acc, val) => acc + val, 0);
                
                meta.data.forEach((element, index) => {
                    const value = dataset.data[index];
                    if (value > 0) {
                        const percentage = ((value / total) * 100).toFixed(1) + '%';
                        const { x, y } = element.tooltipPosition();
                        
                        ctx.save();
                        ctx.fillStyle = '#fff';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(percentage, x, y);
                        ctx.restore();
                    }
                });
            });
        }
    };

    const barLabelsPlugin = {
        id: 'barLabels',
        afterDatasetsDraw(chart, args, options) {
            const { ctx } = chart;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                meta.data.forEach((element, index) => {
                    const value = dataset.data[index];
                    if (value > 0) {
                        const { x, y } = element.tooltipPosition();
                        ctx.save();
                        ctx.fillStyle = '#172b4d';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText(value, x, y - 5);
                        ctx.restore();
                    }
                });
            });
        }
    };

    function updateRealTimeCharts(cpId) {
        // 1. Cập nhật Pie Chart (Tổng số phiên sạc)
        if (usageCountChart) {
            const labels = usageCountChart.data.labels;
            const dataIdx = labels.indexOf(cpId);
            
            if (dataIdx !== -1) {
                // Nếu trạm đã có trong biểu đồ, tăng số lượng
                usageCountChart.data.datasets[0].data[dataIdx] += 1;
            } else {
                // Nếu trạm chưa có (trạm mới), thêm vào
                usageCountChart.data.labels.push(cpId);
                usageCountChart.data.datasets[0].data.push(1);
                // Thêm màu ngẫu nhiên hoặc lấy từ mảng mẫu
                const bgColors = ['#0052cc', '#00875a', '#de350b', '#ff991f', '#5243aa', '#00b8d9', '#36b37e'];
                const nextColor = bgColors[usageCountChart.data.datasets[0].backgroundColor.length % bgColors.length];
                usageCountChart.data.datasets[0].backgroundColor.push(nextColor);
            }
            
            // Cập nhật số tổng hiển thị
            const totalDisplay = document.getElementById('total-sessions-display');
            if (totalDisplay) {
                const currentTotal = usageCountChart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                totalDisplay.innerHTML = `Total Sessions: ${currentTotal}`;
            }
            usageCountChart.update();
        }

        // 2. Cập nhật Line Chart (Chỉ hiệu quả khi đang xem View 1D - Theo giờ)
        // Nếu đang xem 1 tuần/1 tháng thì nên reload lại data từ server để chính xác hơn
        if (currentChartRange !== '1d') {
            updateCharts(currentChartRange); // Gọi reload data thường
            return;
        }

        if (usageTimeChart) {
            const now = new Date();
            const currentHourKey = now.getHours() + ":00"; // Ví dụ: "16:00"
            
            let labelIndex = usageTimeChart.data.labels.indexOf(currentHourKey);

            // Trường hợp 1: Giờ hiện tại chưa có trên trục X (Ví dụ bước sang giờ mới)
            if (labelIndex === -1) {
                usageTimeChart.data.labels.push(currentHourKey);
                // Sắp xếp lại label theo thứ tự thời gian (số nguyên)
                usageTimeChart.data.labels.sort((a, b) => parseInt(a) - parseInt(b));
                
                // Lấy lại index sau khi sort
                labelIndex = usageTimeChart.data.labels.indexOf(currentHourKey);

                // Thêm dữ liệu 0 cho giờ mới vào TẤT CẢ các dataset để tránh lỗi
                usageTimeChart.data.datasets.forEach(dataset => {
                    // Chèn số 0 vào đúng vị trí index
                    dataset.data.splice(labelIndex, 0, 0);
                });
            }

            // Trường hợp 2: Tìm dataset của trạm đang sạc (cpId)
            let dataset = usageTimeChart.data.datasets.find(ds => ds.label === cpId);

            if (dataset) {
                // Tăng giá trị tại khung giờ hiện tại
                dataset.data[labelIndex] += 1;
            } else {
                // Nếu dataset của trạm này chưa tồn tại (trạm mới), tạo mới
                const bgColors = ['#0052cc', '#00875a', '#de350b', '#ff991f', '#5243aa', '#00b8d9', '#36b37e'];
                const newColor = bgColors[usageTimeChart.data.datasets.length % bgColors.length];
                
                const newData = new Array(usageTimeChart.data.labels.length).fill(0);
                newData[labelIndex] = 1;

                usageTimeChart.data.datasets.push({
                    label: cpId,
                    data: newData,
                    borderColor: newColor,
                    backgroundColor: newColor,
                    tension: 0.1,
                    fill: false
                });
            }

            usageTimeChart.update();
        }
    }    

    function renderCharts(data, range) {
        const ctxUsage = document.getElementById('usageCountChart').getContext('2d');
        const ctxEnergy = document.getElementById('energyChart').getContext('2d');
        const ctxTime = document.getElementById('usageTimeChart').getContext('2d');

        // Process Data
        const stationCounts = {};
        const stationEnergy = {};
        let timeLabels = [];
        const stationTimeData = {}; 

        if (range === '1d') {
            // Nếu xem theo ngày: Tạo cứng danh sách từ 0:00 đến 23:00
            for (let i = 0; i < 24; i++) {
                timeLabels.push(`${i}:00`);
            }
        }

        // Aggregation logic
        data.forEach(tx => {
            const cp = tx.charge_point_id;
            const energy = tx.total_energy || (tx.meter_stop - tx.meter_start) || 0;
            
            // Pie and Bar data
            stationCounts[cp] = (stationCounts[cp] || 0) + 1;
            stationEnergy[cp] = (stationEnergy[cp] || 0) + energy;

            // Line chart data grouping
            const date = new Date(tx.start_time);
            let timeKey;
            if (range === '1d') {
                timeKey = date.getHours() + ":00"; // Group by hour
            } else {
                timeKey = date.toISOString().split('T')[0]; // Group by day
            }

            if (!stationTimeData[cp]) stationTimeData[cp] = {};
            stationTimeData[cp][timeKey] = (stationTimeData[cp][timeKey] || 0) + 1;
            
            if (range !== '1d' && !timeLabels.includes(timeKey)) {
                timeLabels.push(timeKey);
            }
        });

        // Sort time labels
        if (range !== '1d') {
             timeLabels.sort();
        }

        const bgColors = [
            '#0052cc', '#00875a', '#de350b', '#ff991f', '#5243aa', '#00b8d9', '#36b37e'
        ];

        // --- 1. Usage Count Pie Chart ---
       const totalSessions = Object.values(stationCounts).reduce((acc, val) => acc + val, 0);
        const totalSessionsDisplay = document.getElementById('total-sessions-display');
        if(totalSessionsDisplay) totalSessionsDisplay.innerHTML = `Total Sessions: ${totalSessions}`;

        if (usageCountChart) usageCountChart.destroy();
        usageCountChart = new Chart(ctxUsage, {
            type: 'pie',
            data: {
                labels: Object.keys(stationCounts),
                datasets: [{
                    data: Object.values(stationCounts),
                    backgroundColor: bgColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 12 } },
                    datalabels: {
                        formatter: (value, ctx) => {
                            // Chỉ hiện nếu > 5% để tránh lấn nhau
                            let sum = 0;
                            let dataArr = ctx.chart.data.datasets[0].data;
                            dataArr.map(data => { sum += data; });
                            let percentage = (value*100 / sum).toFixed(1);
                            if (percentage < 5) return ""; 
                            // Hiển thị: Số lượng (Phần trăm)
                            return `${value} (${percentage}%)`;
                        },
                        color: '#fff',
                        font: { weight: 'bold', size: 11 },
                        anchor: 'center',
                        align: 'center',
                        offset: 0,
                        textShadowColor: '#000',
                        textShadowBlur: 2
                    }
                }
            }
        });


        // --- 2. Energy Bar Chart ---
        if (energyChart) energyChart.destroy();
        energyChart = new Chart(ctxEnergy, {
            type: 'bar', // Column Chart
            data: {
                labels: Object.keys(stationEnergy),
                datasets: [{
                    label: 'Energy Consumed (kWh)',
                    data: Object.values(stationEnergy).map(e => (e/1000).toFixed(2)),
                    backgroundColor: bgColors,
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                scales: {
                    y: { 
                        beginAtZero: true, 
                        title: { display: true, text: 'Energy (kWh)' },
                        grid: { color: '#f0f0f0' }
                    },
                    x: { grid: { display: false } }
                },
                plugins: { 
                    legend: { display: false }, 
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        color: '#172b4d',
                        font: { weight: 'bold' },
                        formatter: (value) => value // Hiển thị số kWh trên đầu cột
                    }
                }
            }
        });

        // --- 3. Usage Frequency Over Time (Line Chart) ---
        // Prepare datasets for line chart
        const lineDatasets = Object.keys(stationTimeData).map((cp, index) => {
            return {
                label: cp,
                data: timeLabels.map(t => stationTimeData[cp][t] || 0),
                borderColor: bgColors[index % bgColors.length],
                backgroundColor: bgColors[index % bgColors.length],
                tension: 0.1,
                fill: false
            };
        });

        if (usageTimeChart) usageTimeChart.destroy();
        usageTimeChart = new Chart(ctxTime, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: lineDatasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Sessions' } },
                    x: { title: { display: true, text: range === '1d' ? 'Hour' : 'Date' } }
                }
            }
        });
    }

    // =========================================================================
    // PHẦN 2: LOGIC GIAO TIẾP WEBSOCKET & OCPP
    // =========================================================================

    function sendRemoteCommand(command, chargePointId, params = {}) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const message = { type: 'remoteCommand', command, chargePointId, params };
            ws.send(JSON.stringify(message));
            console.log(`[WEBSOCKET] Sent command '${command}' to '${chargePointId}'`, params);
        } else {
            alert('Mất kết nối tới Server. Vui lòng tải lại trang.');
        }
    }

    function parseOcppMessage(logData) {
        const { direction, message, action: originalAction, chargePointId } = logData;
        if (!Array.isArray(message)) return { action: 'Unknown', payload: {} };
        const [, , actionOrPayload, payload] = message;

        if (direction === 'request' && chargePointId === 'CSMS_Dashboard') {
             return { action: actionOrPayload, payload: payload };
        }
        if (direction === 'request') return { action: actionOrPayload, payload };
        if (direction === 'response') return { action: originalAction || 'Response', payload: actionOrPayload };
        if (direction === 'info') return { action: 'Info', payload: { message: message[1] }};
        return { action: 'Unknown', payload: {} };
    }

    function addLogRow(data) {
        if (!globalLogBody) return;
        const { action, payload } = parseOcppMessage(data);
        const row = document.createElement('tr');
        const isRequest = data.direction === 'request';
        const directionIcon = isRequest 
            ? '<i class="fa-solid fa-arrow-right-long" style="color:#0052cc"></i>' 
            : '<i class="fa-solid fa-arrow-left-long" style="color:#00875a"></i>';
        const directionText = data.chargePointId === 'CSMS_Dashboard' ? 'CSMS' : data.chargePointId;

        row.innerHTML = `
            <td style="color:#6b778c; font-size:0.85em;">${new Date().toLocaleTimeString()}</td>
            <td>${directionIcon} <small>${isRequest ? 'To' : 'From'}</small></td>
            <td><strong>${directionText}</strong></td>
            <td><span style="background:#ebecf0; padding:2px 6px; border-radius:3px; font-weight:500;">${action}</span></td>
            <td class="payload-cell"><pre>${JSON.stringify(payload, null, 2)}</pre></td>
        `;
        
        if(data.direction === 'info') {
            row.classList.add('info-log');
            row.querySelector('td:nth-child(2)').textContent = 'ℹ️';
        }

        globalLogBody.prepend(row);
        if (globalLogBody.rows.length > MAX_LOG_ROWS) {
            globalLogBody.deleteRow(-1);
        }
    }

    // =========================================================================
    // PHẦN 3: CLASS THẺ TRẠM SẠC (LOGIC NĂNG LƯỢNG VÀ THÔNG SỐ ĐIỆN)
    // =========================================================================
    
    class ChargePointCard {
        constructor(id, initialState) {
            this.id = id;
            this.state = { energy: 0, status: 'Unavailable', transactionId: null, chargeSpeed: null, ...initialState };
            this.activePhases = [true, false, false]; 
            this.autoLoadMode = false; // Chế độ tự động điều khiển Load từ mobile app
            this.simulationInterval = null;
            this.lastSimTime = 0;
            this.createElement();
            this.cacheDOM();
            this.addEventListeners();
            this.updateAll(this.state);
        }

        createElement() {
            this.element = document.createElement('div');
            this.element.className = 'charger-card';
            this.element.id = `charger-${this.id}`;
            this.element.dataset.cpId = this.id;

            this.element.innerHTML = `
                <div class="card-header">
                    <h3><i class="fa-solid fa-charging-station" style="color:#0052cc"></i> ${this.id}</h3>
                    <div class="header-icons">
                        <i class="fa-solid fa-heart-pulse heartbeat-icon"></i>
                        <div class="status-tag status-disconnected">
                            <span class="status-dot"></span>
                            <span class="status-text">Disconnected</span>
                        </div>
                    </div>
                </div>
                <div class="card-body">
                    <div class="info-row">
                        <span>Vendor: <strong class="vendor-info">N/A</strong></span>
                        <span>Model: <strong class="model-info">N/A</strong></span>
                    </div>
                    
                    <div class="load-section">
                        <h4 style="font-size:0.75em; color:#6b778c; text-transform:uppercase; margin:0 0 8px 0;">
                            Active Loads (Phases)
                            <span class="auto-mode-badge" style="display:none; background:#0052cc; color:#fff; padding:2px 6px; border-radius:3px; font-size:0.85em; margin-left:8px;">AUTO</span>
                        </h4>
                        <div class="load-selector">
                            <div class="load-rect active" data-index="0">Load 1</div>
                            <div class="load-rect" data-index="1">Load 2</div>
                            <div class="load-rect" data-index="2">Load 3</div>
                        </div>
                    </div>

                    <div class="electrical-params">
                        <div class="param-item"><span class="param-label">V (Avg Phase)</span><span class="param-value v-val">0 V</span></div>
                        <div class="param-item"><span class="param-label">Vab</span><span class="param-value vab-val">0 V</span></div>
                        <div class="param-item"><span class="param-label">Vbc</span><span class="param-value vbc-val">0 V</span></div>
                        <div class="param-item"><span class="param-label">Vca</span><span class="param-value vca-val">0 V</span></div>
                        <div class="param-item"><span class="param-label">I (Sum)</span><span class="param-value i-val">0 A</span></div>
                        <div class="param-item"><span class="param-label">Ia</span><span class="param-value ia-val">0 A</span></div>
                        <div class="param-item"><span class="param-label">Ib</span><span class="param-value ib-val">0 A</span></div>
                        <div class="param-item"><span class="param-label">Ic</span><span class="param-value ic-val">0 A</span></div>
                        <div class="param-item"><span class="param-label">P (Total)</span><span class="param-value p-val">0 kW</span></div>
                        <div class="param-item"><span class="param-label">Q (Total)</span><span class="param-value q-val">0 kVAR</span></div>
                        <div class="param-item"><span class="param-label">PF</span><span class="param-value pf-val">0.00</span></div>
                        <div class="param-item"></div> 
                    </div>

                    <div class="energy-section" style="margin-top:15px; padding-top:10px; border-top:1px dashed #dfe1e6; display:flex; justify-content:space-between; align-items:center">
                        <span class="energy-label" style="font-size:0.9em; color:#6b778c">Energy (E)</span>
                        <div class="energy-info-container" style="text-align:right">
                             <div class="energy-value energy-info" style="font-size:1.3em; font-weight:700; color:#00875a">0.00 kWh</div>
                        </div>
                    </div>
                </div>
                <div class="card-actions">
                     <button class="action-btn main-action-btn" disabled>Start Charging</button>
                </div>
                <!-- Advanced Controls -->
                <div class="advanced-controls">
                    <div class="advanced-header">Advanced Controls <i class="fa-solid fa-chevron-down"></i></div>
                    <div class="advanced-body">
                        <button class="action-btn advanced-btn get-config-btn">Get Config</button>
                        <button class="action-btn advanced-btn set-config-btn">Set Config</button>
                        <button class="action-btn advanced-btn clear-cache-btn">Clear Cache</button>
                        <button class="action-btn advanced-btn data-transfer-btn">Data Transfer</button>
                    </div>
                </div>
            `;
            chargersContainer.appendChild(this.element);
        }

        cacheDOM() {
            this.dom = {
                statusTag: this.element.querySelector('.status-tag'),
                statusText: this.element.querySelector('.status-text'),
                statusDot: this.element.querySelector('.status-dot'),
                vendorInfo: this.element.querySelector('.vendor-info'),
                modelInfo: this.element.querySelector('.model-info'),
                actionBtn: this.element.querySelector('.main-action-btn'),
                energyInfo: this.element.querySelector('.energy-info'),
                heartbeatIcon: this.element.querySelector('.heartbeat-icon'),
                loadRects: this.element.querySelectorAll('.load-rect'),
                autoModeBadge: this.element.querySelector('.auto-mode-badge'),
                vVal: this.element.querySelector('.v-val'),
                vabVal: this.element.querySelector('.vab-val'),
                vbcVal: this.element.querySelector('.vbc-val'),
                vcaVal: this.element.querySelector('.vca-val'),
                iVal: this.element.querySelector('.i-val'),
                iaVal: this.element.querySelector('.ia-val'),
                ibVal: this.element.querySelector('.ib-val'),
                icVal: this.element.querySelector('.ic-val'),
                pVal: this.element.querySelector('.p-val'),
                qVal: this.element.querySelector('.q-val'),
                pfVal: this.element.querySelector('.pf-val'),
                advancedHeader: this.element.querySelector('.advanced-header'),
                getConfigBtn: this.element.querySelector('.get-config-btn'),
                setConfigBtn: this.element.querySelector('.set-config-btn'),
                clearCacheBtn: this.element.querySelector('.clear-cache-btn'),
                dataTransferBtn: this.element.querySelector('.data-transfer-btn'),
            };
        }
        
        addEventListeners() {
            this.dom.actionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.state.transactionId) {
                    if (confirm(`Dừng sạc trạm ${this.id}?`)) {
                        sendRemoteCommand('RemoteStopTransaction', this.id, { transactionId: this.state.transactionId });
                        this.dom.actionBtn.textContent = 'Stopping...';
                        this.dom.actionBtn.disabled = true;
                    }
                } else {
                    const idTag = prompt(`Nhập thẻ ID để sạc trạm ${this.id}:`, "048E0B84");
                    if (idTag) {
                        sendRemoteCommand('RemoteStartTransaction', this.id, { idTag });
                        this.dom.actionBtn.textContent = 'Requesting...';
                        this.dom.actionBtn.disabled = true;
                    }
                }
            });

            this.dom.loadRects.forEach(rect => {
                rect.addEventListener('click', () => {
                    // Không cho phép thay đổi thủ công khi đang ở chế độ AUTO
                    if (this.autoLoadMode) {
                        console.log(`[Dashboard] Load selection blocked - Auto mode active for ${this.id}`);
                        return;
                    }
                    const index = parseInt(rect.dataset.index);
                    this.activePhases[index] = !this.activePhases[index];
                    if (this.activePhases[index]) {
                        rect.classList.add('active');
                    } else {
                        rect.classList.remove('active');
                    }
                    // Đã loại bỏ việc tính toán tại đây vì server sẽ đảm nhiệm
                });
            });

            // Advanced Controls
            this.dom.advancedHeader.addEventListener('click', () => {
                this.element.querySelector('.advanced-controls').classList.toggle('open');
            });

            this.dom.getConfigBtn.addEventListener('click', () => {
                const key = prompt("Enter configuration key to get (leave empty for all):");
                sendRemoteCommand('GetConfiguration', this.id, { key: key ? [key] : [] });
            });

            this.dom.setConfigBtn.addEventListener('click', () => {
                const key = prompt("Enter configuration key to change:");
                if (!key) return;
                const value = prompt(`Enter new value for ${key}:`);
                if (value === null) return;
                sendRemoteCommand('ChangeConfiguration', this.id, { key, value });
            });

            this.dom.clearCacheBtn.addEventListener('click', () => {
                if (confirm(`Are you sure you want to send ClearCache to ${this.id}?`)) {
                    sendRemoteCommand('ClearCache', this.id, {});
                }
            });

            this.dom.dataTransferBtn.addEventListener('click', () => {
                const vendorId = prompt("Enter Vendor ID:", "MyVendor");
                if (!vendorId) return;
                const messageId = prompt("Enter Message ID (optional):");
                const data = prompt("Enter data to transfer:");
                sendRemoteCommand('DataTransfer', this.id, { vendorId, messageId, data });
            });
        }

        updateAll(newState) {
            this.state = { ...this.state, ...newState };
            this.dom.vendorInfo.textContent = this.state.vendor || 'N/A';
            this.dom.modelInfo.textContent = this.state.model || 'N/A';
            this.updateConnectionStatus(true);
            this.updateStatus(this.state.status);
            this.updateTransaction(this.state.transactionId);
            
            // Nếu có chargeSpeed trong state, cập nhật auto load
            if (this.state.chargeSpeed) {
                this.setActivePhasesBySpeed(this.state.chargeSpeed);
            }

            if (this.state.electricalParams) {
                this.renderElectricalParameters(this.state.electricalParams);
            }
        }

        // Thiết lập các pha (Load) hoạt động dựa trên tốc độ sạc từ mobile app
        setActivePhasesBySpeed(speed) {
            if (speed && SPEED_TO_LOADS[speed]) {
                this.autoLoadMode = true;
                this.activePhases = [...SPEED_TO_LOADS[speed]];
                
                // Cập nhật UI
                this.dom.loadRects.forEach((rect, index) => {
                    if (this.activePhases[index]) {
                        rect.classList.add('active');
                    } else {
                        rect.classList.remove('active');
                    }
                    // Thêm style cho auto mode (giảm opacity để chỉ ra không thể click)
                    rect.style.cursor = 'not-allowed';
                    rect.style.opacity = '0.8';
                });
                
                // Hiển thị badge AUTO
                if (this.dom.autoModeBadge) {
                    this.dom.autoModeBadge.style.display = 'inline';
                    this.dom.autoModeBadge.textContent = `AUTO (${speed.charAt(0).toUpperCase() + speed.slice(1)})`;
                }
                
                console.log(`[Dashboard] Auto-set loads for ${this.id}: Speed=${speed}, Phases=${this.activePhases}`);
                // Bỏ gọi calculateElectricalParameters
            } else {
                // Reset về chế độ manual khi speed = null
                this.autoLoadMode = false;
                
                // Reset UI
                this.dom.loadRects.forEach(rect => {
                    rect.style.cursor = 'pointer';
                    rect.style.opacity = '1';
                });
                
                // Ẩn badge AUTO
                if (this.dom.autoModeBadge) {
                    this.dom.autoModeBadge.style.display = 'none';
                }
                
                console.log(`[Dashboard] Reset to manual mode for ${this.id}`);
            }
        }

        updateConnectionStatus(isConnected) {
            this.updateStatus(isConnected ? (this.state.status || 'Available') : 'Disconnected');
        }

        updateStatus(status) {
            this.state.status = status;
            this.dom.statusTag.className = 'status-tag';
            this.dom.statusText.textContent = status;

            const s = status.toLowerCase();
            if (s === 'available' || s === 'preparing') {
                this.state.transactionId = null;
                this.dom.statusTag.classList.add('status-available');
                this.stopSimulation(); 
            } else if (['charging', 'suspendedevse', 'suspendedev', 'finishing'].includes(s)) {
                this.dom.statusTag.classList.add('status-charging');
                this.startSimulation();
            } else if (s === 'faulted') {
                this.state.transactionId = null;
                this.dom.statusTag.classList.add('status-faulted');
                this.stopSimulation();
            } else {
                this.state.transactionId = null;
                this.dom.statusTag.classList.add('status-disconnected');
                this.stopSimulation();
            }

            this.updateActionButton();
            // Bỏ gọi calculateElectricalParameters
        }

        updateTransaction(transactionId) {
            this.state.transactionId = transactionId;
            if (transactionId && this.state.energy === undefined) {
                 this.state.energy = 0;
            }
            this.updateActionButton();
        }
        
        updateActionButton() {
            const btn = this.dom.actionBtn;
            if (this.state.transactionId) {
                btn.textContent = 'Stop Charging';
                btn.className = 'action-btn main-action-btn stop-btn';
                btn.disabled = false;
            } else {
                const isReady = this.state.status === 'Preparing';

                if (isReady) {
                    btn.textContent = 'Start Charging'
                    btn.className = 'action-btn main-action-btn start-btn';
                    btn.disabled = false;
                    btn.title = "";
                } else {
                    btn.className = 'action-btn main-action-btn'; 
                    btn.disabled = true;
                    btn.title = "";
                }
            }
        }

        updateEnergy(wh) {
            this.state.energy = wh;
            const kwh = (wh / 1000).toFixed(2);
            this.dom.energyInfo.textContent = `${kwh} kWh`;
        }

        updateSoC(soc) {
            this.state.soc = soc;
        }

        startSimulation() {
            // No-op: Logic đã chuyển về server
        }

        stopSimulation() {
            // No-op
        }

        runSimulationStep() {
            // Đã chuyển về server
        }
        
        // --- HÀM HIỂN THỊ GIÁ TRỊ TỪ SERVER (SỬA LỖI) ---
        renderElectricalParameters(params) {
            if (!params) return;

            const val = (v) => (v !== undefined && v !== null) ? v : 0;

            // Truy cập đúng thuộc tính trong params, không dùng biến chưa định nghĩa
            this.dom.vVal.textContent = `${val(params.v_avg)} V`;
            this.dom.vabVal.textContent = `${val(params.vab)} V`;
            this.dom.vbcVal.textContent = `${val(params.vbc)} V`;
            this.dom.vcaVal.textContent = `${val(params.vca)} V`;

            this.dom.iVal.textContent = `${val(params.i_sum)} A`;
            this.dom.iaVal.textContent = `${val(params.ia)} A`;
            this.dom.ibVal.textContent = `${val(params.ib)} A`;
            this.dom.icVal.textContent = `${val(params.ic)} A`;

            this.dom.pVal.textContent = `${val(params.p_total)} kW`;
            this.dom.qVal.textContent = `${val(params.q_total)} kVAR`;
            this.dom.pfVal.textContent = `${val(params.pf)}`;

            // Logic cập nhật số kWh khi không sạc (để hiển thị con số cuối cùng)
            if (this.state.status !== 'Charging' && params.Energy_kWh !== undefined) {
                this.dom.energyInfo.textContent = `${params.Energy_kWh.toFixed(2)} kWh`;
            }
        }

        triggerHeartbeat() {
            this.dom.heartbeatIcon.classList.add('active');
            setTimeout(() => {
                this.dom.heartbeatIcon.classList.remove('active');
            }, 1200);
        }
    }

    function connectDashboard() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/dashboard`;
        
        console.log(`[Dashboard] Connecting to ${wsUrl}...`);
        
        if (ws) ws.close();
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[Dashboard] Connected to CSMS');
            const statusBadge = document.getElementById('connection-status');
            if (statusBadge) {
                statusBadge.textContent = 'Connected';
                statusBadge.className = 'badge bg-success';
            }
        };

        ws.onmessage = (event) => {
            try {
                const parsedMessage = JSON.parse(event.data);
                const { type, ...data } = parsedMessage;

                // 1. Xử lý trạng thái đầy đủ ban đầu
                if (type === 'fullStatus') {
                    console.log("[Dashboard] Received full status:", data.chargePoints);
                    
                    // Clear UI cũ
                    if(chargersContainer) chargersContainer.innerHTML = '';
                    chargePointCards.clear();
                    
                    // Tạo thẻ cho từng trạm
                    if (data.chargePoints && Array.isArray(data.chargePoints)) {
                        data.chargePoints.forEach(cp => {
                            // Tạo instance từ Class ChargePointCard đã có
                            const card = new ChargePointCard(cp.id, cp);
                            chargePointCards.set(cp.id, card);
                        });
                    }
                    return;
                }
                
                // 2. Xử lý Log (Global Log)
                if (type === 'log') {
                    addLogRow(data);
                    return;
                }

                // 3. Xử lý cập nhật trạng thái trạm
                let card = chargePointCards.get(data.id);

                if (!card && (type === 'connect' || type === 'boot' || type === 'status')) {
                    console.log(`[Dashboard] New station detected: ${data.id}`);
                    const initialState = data.state || { id: data.id, status: data.status || 'Available' };
                    card = new ChargePointCard(data.id, initialState);
                    chargePointCards.set(data.id, card);
                }

                if (!card) return;

                // --- Cập nhật dữ liệu vào thẻ ---
                if (type === 'connect' || type === 'boot') {
                    card.updateAll(data.state);
                    card.updateConnectionStatus(true);
                    if (data.state.electricalParams) {
                        card.renderElectricalParameters(data.state.electricalParams);
                    }
                }
                
                if (type === 'disconnect') {
                    card.updateConnectionStatus(false);
                    setTimeout(() => {
                        // Chỉ thực hiện nếu thẻ vẫn tồn tại và đang ở trạng thái Disconnected
                        // (Tránh trường hợp trạm đã kết nối lại trong lúc chờ)
                        if (card && card.state.status === 'Disconnected') {
                            console.log(`[Dashboard] Auto-refresh: Wiping data for ${data.id} to clean state.`);
                            
                            // Tạo một state "trắng" hoàn toàn
                            const cleanState = {
                                status: 'Unavailable', // Giữ trạng thái Disconnected (hoặc 'Unavailable' nếu muốn màu xám)
                                vendor: 'N/A',
                                model: 'N/A',
                                transactionId: null,
                                chargeSpeed: null,      // Xóa chế độ sạc nhanh/chậm
                                energy: 0,
                                soc: 0,
                                electricalParams: {     // Về 0 hết
                                    v_avg: 0, vab: 0, vbc: 0, vca: 0,
                                    i_sum: 0, ia: 0, ib: 0, ic: 0,
                                    p_total: 0, q_total: 0, pf: 0,
                                    Energy_kWh: 0
                                }
                            };

                            // Gọi updateAll để áp dụng state mới (Vendor, Model sẽ về N/A)
                            card.updateAll(cleanState);
                            
                            // Ép giao diện hiển thị các thông số điện về 0 ngay lập tức
                            card.renderElectricalParameters(cleanState.electricalParams);
                            card.updateEnergy(0);
                            
                            // (Tùy chọn) Nếu bạn muốn reset cả các pha Load về mặc định (chỉ Load 1 active)
                            if (card.activePhases) {
                                card.activePhases = [true, false, false];
                                card.dom.loadRects.forEach((rect, index) => {
                                    if (index === 0) rect.classList.add('active');
                                    else rect.classList.remove('active');
                                    rect.style.cursor = 'pointer';
                                    rect.style.opacity = '1';
                                });
                                if (card.dom.autoModeBadge) card.dom.autoModeBadge.style.display = 'none';
                                card.autoLoadMode = false;
                            }
                        }
                    }, 5000);
                }
                
                if (type === 'status') {
                    card.updateStatus(data.status);
                    if (data.electricalParams) {
                        if (data.electricalParams) {
                            card.renderElectricalParameters(data.electricalParams);
                        }
                }
                }
                
                if (type === 'transactionStart') {
                    card.updateTransaction(data.transactionId);
                    updateRealTimeCharts(data.id);
                }
                
                if (type === 'transactionStop') {
                    card.updateTransaction(null);
                }
                
                if (type === 'meterValue') {
                    if (data.value !== undefined) card.updateEnergy(data.value);
                    if (data.soc !== undefined) card.updateSoC(data.soc);
                    
                    // Update thông số điện 
                    if (data.electricalParams) {
                        card.renderElectricalParameters(data.electricalParams);
                    }

                    // Log OCPP chuẩn
                    if (data.ocppStandardJson) {
                        // 1. In ra Console (F12) để debug
                        console.log(`[OCPP 1.6] MeterValues from ${data.id}:`, data.ocppStandardJson);

                        // 2. Thêm dòng này để đẩy log vào bảng System Log trên UI
                        addLogRow({
                            direction: 'request',     
                            chargePointId: data.id,
                            message: data.ocppStandardJson 
                        });
                    }
                }
                
                if (type === 'heartbeat') {
                    card.triggerHeartbeat();
                }
                
                if (type === 'speedUpdate') {
                    card.setActivePhasesBySpeed(data.speed);
                }

            } catch (e) {
                console.error("[Dashboard] Error processing message:", e);
            }
        };

        ws.onclose = () => {
            console.log('[Dashboard] Disconnected. Reconnecting in 3s...');
            const statusBadge = document.getElementById('connection-status');
            if (statusBadge) {
                statusBadge.textContent = 'Disconnected';
                statusBadge.className = 'badge bg-danger';
            }
            // Set all offline
            chargePointCards.forEach(card => card.updateConnectionStatus(false));
            setTimeout(connectDashboard, 3000);
        };
        
        ws.onerror = (err) => {
            console.error('[Dashboard] WebSocket error:', err);
            ws.close();
        };
    }
    
    connectDashboard();
});