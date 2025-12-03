const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec } = require('child_process');
const db = require('./database.js');
const os = require('os');
const {
    OPCUAServer,
    DataType,
    Variant,
    StatusCodes,
    AddressSpace,
    NodeClass
} = require("node-opcua");

//---Cấu hình thông số ban đầu---/
const BATTERY_CAPACITY = 42; // kWh
const CHARGING_SPEEDS = {
    'normal': 7.2,
    'fast': 14.4,
    'lightning': 21.6
};
 // Mapping tốc độ sạc sang số pha
const SPEED_TO_PHASES_COUNT = {
    'normal': 1,
    'fast': 2,
    'lightning': 3
};

const DEFAULT_START_SOC = randomIntNumber(10, 50); // Phần trăm SoC ban đầu khi bắt đầu phiên sạc

// --- BỘ QUẢN LÝ TRẠNG THÁI ---
const clients = {
    chargePoints: new Map(),
    dashboards: new Set()
};
const opcUaCreationLocks = new Set();

let opcUaServer;
let opcUaAddressSpace;

function randomIntNumber(min, max){
    return Math.floor(Math.random() * (max - min + 1)) + min;}

// --- HÀM TRUYỀN TIN ---
function broadcastToDashboards(message) {
    const serializedMessage = JSON.stringify(message);
    clients.dashboards.forEach(dashboard => {
        if (dashboard.readyState === WebSocket.OPEN) {
            dashboard.send(serializedMessage);
        }
    });
}

// Hàm helper format thời gian (HH:mm:ss)
function formatTimeRemaining(hours) {
    if (!isFinite(hours) || hours < 0) return "--:--:--";
    const totalSeconds = Math.floor(hours * 3600);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- HÀM TÍNH TOÁN THÔNG SỐ ĐIỆN  ---
function calculateServerElectricalParams(state) {
    // Logic giả lập nhiễu điện áp và dòng điện 
    const voltageNoise = () => (Math.random() - 0.5) * 3;
    
    let Va = 230 + voltageNoise();
    let Vb = 230 + voltageNoise();
    let Vc = 230 + voltageNoise();
    
    let Ia = 0, Ib = 0, Ic = 0;
    let P_total = 0, Q_total = 0, PF = 0;

    // Xác định số pha hoạt động dựa trên chargeSpeed hiện tại
    const speed = state.chargeSpeed || 'normal';
    const activePhaseCount = SPEED_TO_PHASES_COUNT[speed] || 1;
    
    // Mapping: normal -> Load 1, fast -> Load 1+2, lightning -> Load 1+2+3
    const activePhases = [
        activePhaseCount >= 1, // Phase A
        activePhaseCount >= 2, // Phase B
        activePhaseCount >= 3  // Phase C
    ];

    if (state.status === 'Charging') {
            const BASE_CURRENT = 32; 
            const currentNoise = () => (Math.random() - 0.5) * 0.5;

            if (activePhases[0]) Ia = BASE_CURRENT + currentNoise();
            if (activePhases[1]) Ib = BASE_CURRENT + currentNoise();
            if (activePhases[2]) Ic = BASE_CURRENT + currentNoise();

            const getPF = () => 0.98 + (Math.random() * 0.01);
            const PFa = activePhases[0] ? getPF() : 0;
            const PFb = activePhases[1] ? getPF() : 0;
            const PFc = activePhases[2] ? getPF() : 0;

            const Pa = (Va * Ia * PFa) / 1000;
            const Pb = (Vb * Ib * PFb) / 1000;
            const Pc = (Vc * Ic * PFc) / 1000;
            P_total = Pa + Pb + Pc;

            // Tính Q
            const Sa = (Va * Ia) / 1000;
            const Sb = (Vb * Ib) / 1000;
            const Sc = (Vc * Ic) / 1000;
            const Qa = Math.sqrt(Math.max(0, Sa*Sa - Pa*Pa));
            const Qb = Math.sqrt(Math.max(0, Sb*Sb - Pb*Pb));
            const Qc = Math.sqrt(Math.max(0, Sc*Sc - Pc*Pc));
            Q_total = Qa + Qb + Qc;

            if (activePhaseCount > 0) PF = (PFa + PFb + PFc) / activePhaseCount;
    } else {
        // Nếu không sạc, Reset dòng về 0 nhưng V vẫn có (đang nối lưới)
        Ia = 0; Ib = 0; Ic = 0;
    }

    const Vab = Va * Math.sqrt(3);
    const Vbc = Vb * Math.sqrt(3);
    const Vca = Vc * Math.sqrt(3);
    const V_avg = (Va + Vb + Vc) / 3;
    const I_sum = Ia + Ib + Ic;

    return {
        v_avg: parseFloat(V_avg.toFixed(1)),
        vab: parseFloat(Vab.toFixed(1)),
        vbc: parseFloat(Vbc.toFixed(1)),
        vca: parseFloat(Vca.toFixed(1)),
        i_sum: parseFloat(I_sum.toFixed(1)),
        ia: parseFloat(Ia.toFixed(1)),
        ib: parseFloat(Ib.toFixed(1)),
        ic: parseFloat(Ic.toFixed(1)),
        p_total: parseFloat(P_total.toFixed(2)),
        q_total: parseFloat(Q_total.toFixed(2)),
        pf: parseFloat(PF.toFixed(2))
    };
}

// Hàm helper để cập nhật giá trị 1 tag OPC UA
function updateOpcuaVariables(chargePointId, dataToUpdate) {
    const cp = clients.chargePoints.get(chargePointId);
    if (cp && cp.opcuaNodes) {
        try {
            for (const [key, value] of Object.entries(dataToUpdate)) {
                if (cp.opcuaNodes[key]) {
                    let type = DataType.Double;
                    if (typeof value === 'string') type = DataType.String;
                    if (typeof value === 'boolean') type = DataType.Boolean;
                    if (key === 'TransactionID') type = DataType.Int32;

                    cp.opcuaNodes[key].setValueFromSource(new Variant({ dataType: type, value: value }));
                }
            }
        } catch (err) {
            console.error(`[OPC UA] Lỗi update tag ${key} cho ${chargePointId}:`, err);
        }
    }
}

function createOpcUaNodesForChargePoint(chargePointId) {
    if (!opcUaAddressSpace) return null; 
    const namespace = opcUaAddressSpace.getOwnNamespace();
    const chargePointsFolder = opcUaAddressSpace.findNode(`ns=${namespace.index};s=ChargePointsFolder`);

    if (!chargePointsFolder) return;

    const cpNodeId = `ns=${namespace.index};s=${chargePointId}`;
    let cpFolder = opcUaAddressSpace.findNode(cpNodeId);
    
    // Object lưu trữ các node con để truy cập nhanh
    const nodes = {};

    // Định nghĩa danh sách biến chuẩn
    const variableDefs = [
        { name: "Status", type: DataType.String, init: "Offline" }, // Mặc định là Offline khi load từ DB
        { name: "ChargeSpeed", type: DataType.String, init: "" },
        { name: "Vendor", type: DataType.String, init: "" },
        { name: "Model", type: DataType.String, init: "" },
        { name: "TransactionID", type: DataType.Int32, init: 0 },
        { name: "SoC", type: DataType.Double, init: 0.0 },
        { name: "Energy_kWh", type: DataType.Double, init: 0.0 },
        { name: "Power_Total", type: DataType.Double, init: 0.0 },
        { name: "ReActivePower_Total", type: DataType.Double, init: 0.0 },
        { name: "PF", type: DataType.Double, init: 0.0 },
        { name: "Current_Total", type: DataType.Double, init: 0.0 },
        { name: "Current_a", type: DataType.Double, init: 0.0 },
        { name: "Current_b", type: DataType.Double, init: 0.0 },
        { name: "Current_c", type: DataType.Double, init: 0.0 },
        { name: "Voltage_Average", type: DataType.Double, init: 0.0 },
        { name: "Voltage_ab", type: DataType.Double, init: 0.0 },
        { name: "Voltage_bc", type: DataType.Double, init: 0.0 },
        { name: "Voltage_ac", type: DataType.Double, init: 0.0 },
        { name: "RemoteStart_Trigger", type: DataType.Boolean, init: false },
        { name: "RemoteStop_Trigger", type: DataType.Boolean, init: false },
        { name: "RemoteStart_IdTag", type: DataType.String, init: "0000" }
    ];

    if (!cpFolder) {
        console.log(`[OPC UA] Tạo Folder mới cho ${chargePointId}`);
        cpFolder = namespace.addFolder(chargePointsFolder, {
            browseName: chargePointId,
            nodeId: cpNodeId
        });

        // Tạo mới từng biến
        variableDefs.forEach(def => {
            const node = namespace.addVariable({
                componentOf: cpFolder,
                browseName: def.name,
                nodeId: `ns=${namespace.index};s=${chargePointId}_${def.name}`,
                dataType: def.type,
                value: { dataType: def.type, value: def.init },
                accessLevel: "CurrentRead | CurrentWrite",
                userAccessLevel: "CurrentRead | CurrentWrite"
            });
            nodes[def.name] = node;
            attachTriggerLogic(chargePointId, def.name, node, nodes);
        });
    } else {
        // --- LOGIC MỚI: TÌM LẠI NODE CŨ ĐÃ TẠO TỪ DB ---
        console.log(`[OPC UA] Folder ${chargePointId} đã có sẵn. Đang liên kết lại...`);
        variableDefs.forEach(def => {
            const nodeId = `ns=${namespace.index};s=${chargePointId}_${def.name}`;
            const existingNode = opcUaAddressSpace.findNode(nodeId);
            if (existingNode) {
                nodes[def.name] = existingNode;
                // Gán lại logic trigger vì khi tạo ở initialize có thể chưa có clients.chargePoints map
                existingNode.removeAllListeners("value_changed"); // Xóa listener cũ (nếu có) để tránh double
                attachTriggerLogic(chargePointId, def.name, existingNode, nodes);
            }
        });
    }

    return nodes;
}

function attachTriggerLogic(chargePointId, varName, node, allNodes) {
    if (varName === "RemoteStart_Trigger") {
        node.on("value_changed", (dataValue) => {
            if (dataValue.value.value === true) {
                console.log(`[OPC UA] TRIGGER: Remote Start ${chargePointId}`);
                const idTagNode = allNodes["RemoteStart_IdTag"];
                const idTag = idTagNode ? idTagNode.readValue().value.value : "0000";
                
                const targetCP = clients.chargePoints.get(chargePointId);
                if (targetCP && targetCP.ws && targetCP.ws.readyState === WebSocket.OPEN) {
                    const msg = [2, uuidv4(), "RemoteStartTransaction", { idTag: idTag, connectorId: 1 }];
                    targetCP.ws.send(JSON.stringify(msg));
                } else {
                    console.log(`[OPC UA] Không thể Start: Trạm ${chargePointId} chưa kết nối WebSocket.`);
                }
                setTimeout(() => node.setValueFromSource(new Variant({dataType: DataType.Boolean, value: false})), 500);
            }
        });
    }

    if (varName === "RemoteStop_Trigger") {
        node.on("value_changed", (dataValue) => {
            if (dataValue.value.value === true) {
                console.log(`[OPC UA] TRIGGER: Remote Stop ${chargePointId}`);
                const targetCP = clients.chargePoints.get(chargePointId);
                if (targetCP && targetCP.state && targetCP.state.transactionId) {
                    const msg = [2, uuidv4(), "RemoteStopTransaction", { transactionId: targetCP.state.transactionId }];
                    targetCP.ws.send(JSON.stringify(msg));
                }
                setTimeout(() => node.setValueFromSource(new Variant({dataType: DataType.Boolean, value: false})), 500);
            }
        });
    }
}

// Hàm khởi tạo và cấu hình OPC UA Server
async function initializeOpcUaServer() {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    let privateIp = null;
    let publicIp = null;

    for (const ifaceName in networkInterfaces) {
        const iface = networkInterfaces[ifaceName];
        if (!iface) continue;

        for (const alias of iface) {
            // Chỉ tìm IPv4 
            if (alias.family === 'IPv4' && !alias.internal) {
                
                // Lọc bỏ địa chỉ APIPA "rác"
                if (alias.address.startsWith('169.254.')) {
                    continue;
                }

                // Ưu tiên 1: Tìm địa chỉ LAN (Private)
                if (alias.address.startsWith('192.168.') || alias.address.startsWith('10.') || (alias.address.startsWith('172.') && parseInt(alias.address.split('.')[1], 10) >= 16 && parseInt(alias.address.split('.')[1], 10) <= 31)) {
                    privateIp = alias.address;
                    break; // Ngừng tìm trên card mạng này
                }

                // Ưu tiên 2: Lưu địa chỉ Public đầu tiên tìm thấy làm dự phòng
                if (!publicIp) {
                    publicIp = alias.address;
                }
            }
        }
        if (privateIp) break; // Đã tìm thấy IP private, ngừng tìm trên các card mạng khác
    }

    // Chọn IP theo thứ tự ưu tiên: Private > Public > Loopback
    const ipAddress = privateIp || publicIp || '127.0.0.1'; 
    console.log(`[OPC UA] Sử dụng địa chỉ IP: ${ipAddress}`);

    opcUaServer = new OPCUAServer({
        port: 4840, // Cổng OPC UA tiêu chuẩn
        resourcePath: "/UA/OcppCsmsServer",
        buildInfo: {
            productName: "OCPP CSMS Server",
            buildNumber: "1.0",
            buildDate: new Date()
        },
        alternateHostname: ipAddress,
        serverInfo: { applicationUri: `opc.tcp://${ipAddress}:4840/UA/OcppCsmsServer` }
    });

    await opcUaServer.initialize();

    // Lấy đối tượng addressSpace để thêm các biến
    opcUaAddressSpace = opcUaServer.engine.addressSpace;
    // Tạo một thư mục gốc cho các trạm sạc
    const namespace = opcUaAddressSpace.getOwnNamespace();
    const nsIndex = namespace.index;
    const objectsFolder = opcUaAddressSpace.findNode("i=85");

    namespace.addFolder(objectsFolder, {
        browseName: "ChargePoints",
        nodeId: `ns=${namespace.index};s=ChargePointsFolder`
    });

    // --- TỰ ĐỘNG LOAD TRẠM TỪ DATABASE ---
    try {
        console.log("[OPC UA] Đang đồng bộ danh sách trạm từ Database...");
        const dbStations = await db.getAllChargePoints();
        if (dbStations && dbStations.length > 0) {
            dbStations.forEach(station => {
                // Tạo sẵn node cho trạm, kể cả khi chưa online
                createOpcUaNodesForChargePoint(station.id);
                // Cập nhật trạng thái ban đầu là Status của DB (thường là Unavailable/Offline)
                // Lưu ý: createOpcUaNodesForChargePoint trả về nodes, nhưng ta chưa cần dùng ngay
            });
            console.log(`[OPC UA] Đã tạo sẵn ${dbStations.length} trạm sạc trên OPC UA.`);
        }
    } catch (e) {
        console.error("[OPC UA] Lỗi khi load trạm từ DB:", e);
    }

    // Bắt đầu server
    await opcUaServer.start();
    console.log(`[OPC UA] Server đang lắng nghe trên cổng ${opcUaServer.endpoints[0].port}`);
    console.log(`[OPC UA] Endpoint URL: ${opcUaServer.endpoints[0].endpointDescriptions()[0].endpointUrl}`);
}

// --- HTTP SERVER ---
const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Phân tích URL
    const urlParts = req.url.split('?')[0].split('/');
    const apiBase = urlParts[1]; // 'api'
    const resource = urlParts[2]; // 'history' hoặc 'stations'

    // 1. API: Lấy lịch sử giao dịch
    if (apiBase === 'api' && resource === 'history' && req.method === 'GET') {
        try {
            // Phân tích query parameters
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const start = urlObj.searchParams.get('start');
            const end = urlObj.searchParams.get('end');

            let data;
            if (start && end) {
                // Format ngày cho MySQL: 'YYYY-MM-DD HH:mm:ss'
                // Giả sử client gửi ISO string hoặc YYYY-MM-DD
                const formatDate = (isoStr) => isoStr.replace('T', ' ').split('.')[0];
                console.log(`[API] Fetching history from ${start} to ${end}`);
                data = await db.getTransactionsByDate(formatDate(start), formatDate(end));
            } else {
                data = await db.getRecentTransactions();
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) { 
            console.error("[API] Error fetching history:", e);
            res.writeHead(500); res.end(JSON.stringify({error: e.message})); 
        }
        return;
    }

    // 2. API: Quản lý Trạm Sạc (CẦN THIẾT CHO NÚT ADD)
    if (apiBase === 'api' && resource === 'stations') {
        // GET /api/stations
        if (req.method === 'GET') {
            try {
                const stations = await db.getAllChargePoints();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(stations));
            } catch (e) {
                res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // POST /api/stations (Thêm trạm mới)
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const { id, location } = JSON.parse(body);
                    if (!id) throw new Error("Missing ID");
                    
                    await db.createChargePoint(id, location);
                    createOpcUaNodesForChargePoint(id);
                    
                    // Báo cho các dashboard biết có trạm mới
                    broadcastToDashboards({ 
                        type: 'connect', 
                        id: id, 
                        state: { id, location, status: 'Unavailable', vendor: 'N/A', model: 'N/A' } 
                    });

                    // TỰ ĐỘNG CẬP NHẬT EXCEL
                    console.log("[System] Đang tự động cập nhật file Excel tag...");
                    exec('node generate_tags.js', (error, stdout, stderr) => {
                        if (error) {
                            console.error(`[Auto-Excel] Lỗi: ${error.message}`);
                            return;
                        }
                        if (stderr) {
                            console.error(`[Auto-Excel] Stderr: ${stderr}`);
                            return;
                        }
                        console.log(`[Auto-Excel] Thành công: ${stdout.trim()}`);
                    });

                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) { 
                    console.error("[API] Lỗi thêm trạm:", e);
                    res.writeHead(400); res.end(JSON.stringify({error: e.message})); 
                }
            });
            return;
        }

        // DELETE /api/stations/:id
        if (req.method === 'DELETE') {
            const stationId = urlParts[3];
            if (stationId) {
                try {
                    await db.deleteChargePoint(stationId);
                    // Ngắt kết nối nếu đang chạy
                    const cp = clients.chargePoints.get(stationId);
                    if (cp) {
                        if (cp.ws) cp.ws.close();
                        if (cp.python) cp.python.kill();
                        clients.chargePoints.delete(stationId);
                    }
                    
                    broadcastToDashboards({ type: 'disconnect', id: stationId, hardDelete: true });
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
                }
            }
            return;
        }
    }

    // 3. Xử lý file tĩnh (Static Files)
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }
    
    fs.readFile(filePath, (err, content) => {
        if (err) { 
            if(err.code == 'ENOENT') {
                fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, indexContent) => {
                     if(err) { res.writeHead(404); res.end('Not Found'); }
                     else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(indexContent); }
                });
            } else {
                res.writeHead(500); res.end('Internal Server Error');
            }
            return; 
        }
        
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/html';
        switch (ext) {
            case '.js': contentType = 'text/javascript'; break;
            case '.css': contentType = 'text/css'; break;
            case '.json': contentType = 'application/json'; break;
            case '.png': contentType = 'image/png'; break;
            case '.jpg': contentType = 'image/jpg'; break;
            case '.ico': contentType = 'image/x-icon'; break;
        }
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocket.Server({ server });

async function sendFullStatusToDashboard(ws) {
    try {
        const dbStations = await db.getAllChargePoints();
        const combinedList = dbStations.map(station => {
            const onlineCp = clients.chargePoints.get(station.id);
            if (onlineCp) {
                return { ...onlineCp.state, location: station.location };
            } else {
                return {
                    id: station.id,
                    status: station.status || 'Unavailable', // Lấy status từ DB
                    vendor: station.vendor,
                    model: station.model,
                    location: station.location,
                    lastActivity: station.last_seen
                };
            }
        });
        ws.send(JSON.stringify({ type: 'fullStatus', chargePoints: combinedList }));
    } catch (err) {
        console.error("Error sending full status:", err);
    }
}

wss.on('connection', async (ws, req) => {
    const urlParts = req.url.split('/');
    const id = urlParts.pop() || urlParts.pop();

    if (id === 'dashboard' || id === 'scada') {
        clients.dashboards.add(ws);
        console.log(`[Master] ${id.toUpperCase()} đã kết nối.`);
        await sendFullStatusToDashboard(ws);
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'remoteCommand') {
                    console.log(`[Master] Nhận lệnh từ dashboard:`, data);
                    const { command, chargePointId, params } = data;
                    const targetCP = clients.chargePoints.get(chargePointId);

                    if (targetCP && targetCP.ws.readyState === WebSocket.OPEN) {
                        const uniqueId = uuidv4();
                        const ocppMessage = [2, uniqueId, command, params || {}];
                        targetCP.ws.send(JSON.stringify(ocppMessage));
                        console.log(`[Master] Đã gửi lệnh ${command} tới ${chargePointId}`);
                        
                        broadcastToDashboards({
                            type: 'log',
                            direction: 'request',
                            chargePointId: 'CSMS_Dashboard',
                            message: [2, uniqueId, `(To ${chargePointId}) ${command}`, params || {}]
                        });

                    } else {
                        console.error(`[Master] Lỗi: Không tìm thấy hoặc không thể kết nối tới trạm ${chargePointId}`);
                    }
                }
            } catch (e) {
                console.error("Lỗi xử lý message từ dashboard:", e);
            }
        });

        ws.on('close', () => {
            clients.dashboards.delete(ws);
            console.log(`[Master] ${id.toUpperCase()} đã ngắt kết nối.`);
        });

    } else { 
        const chargePointId = id;
        
        if (opcUaCreationLocks.has(chargePointId)) { ws.terminate(); return; }

        let existingCp = clients.chargePoints.get(chargePointId);
        let pythonHandler;
        let chargePointState;
        let opcuaNodes;
        let isReconnection = false;
        
        // Kiểm tra xem có session nào đang chạy không
        // Sửa: Thêm 'Preparing' vào danh sách active statuses
        const activeStatuses = ['Preparing', 'Charging', 'Finishing', 'SuspendedEV', 'SuspendedEVSE'];
        
        if (existingCp && existingCp.state && activeStatuses.includes(existingCp.state.status)) {
            console.log(`[Master] ${chargePointId} kết nối lại vào phiên sạc cũ (Status: ${existingCp.state.status}). (Tx: ${existingCp.state.transactionId})`);
            isReconnection = true;
            
            // Đóng socket cũ nếu còn
            if (existingCp.ws) try { existingCp.ws.terminate(); } catch(e){}
            
            // Tái sử dụng mọi thứ
            chargePointState = existingCp.state;
            pythonHandler = existingCp.python;
            opcuaNodes = existingCp.opcuaNodes;
            
            // Xóa listeners cũ để tránh gửi data vào socket chết
            if (pythonHandler) {
                pythonHandler.stdout.removeAllListeners('data');
                pythonHandler.removeAllListeners('close');
                pythonHandler.stderr.removeAllListeners('data');
            }

            existingCp.ws = ws; // Gán socket mới vào
            
            db.recordHeartbeat(chargePointId);
            broadcastToDashboards({ type: 'connect', id: chargePointId, state: chargePointState });
        } else {
            // Kết nối mới hoàn toàn
            if (existingCp) {
                if (existingCp.python) existingCp.python.kill();
                clients.chargePoints.delete(chargePointId);
            }
            console.log(`[Master] Kết nối mới từ ${chargePointId}`);
            pythonHandler = spawn('python', ['OCPP_handler.py']);
            chargePointState = { 
                id: chargePointId, 
                vendor: '', model: '', status: 'Connecting', 
                transactionId: null, 
                energy: 0, 
                chargeSpeed: 'normal',
                soc: DEFAULT_START_SOC,
                timeRemaining: '--:--:--',
                lastSimTime: Date.now()
            };
            
            opcuaNodes = createOpcUaNodesForChargePoint(chargePointId);
            clients.chargePoints.set(chargePointId, { ws, state: chargePointState, python: pythonHandler, opcuaNodes });
            
            broadcastToDashboards({ type: 'connect', id: chargePointId, state: chargePointState });
            db.updateChargePoint(chargePointId, '', '');
            db.recordHeartbeat(chargePointId);
            db.updateChargePointStatus(chargePointId, 'Available');
        }

        ws.on('message', (message) => {
            const currentCp = clients.chargePoints.get(chargePointId);
            // Bảo vệ: Nếu socket này đã bị thay thế bởi reconnect khác thì thôi
            if (!currentCp || currentCp.ws !== ws) return;
            
            const messageString = message.toString();
            console.log(`[Master -> Python] Forwarding message from ${chargePointId}: ${messageString}`);
            
            try {
                const parsedMessage = JSON.parse(messageString);
                const [,, action, payload] = parsedMessage;
                db.recordHeartbeat(chargePointId);

                if (action === 'BootNotification') {
                    chargePointState.vendor = payload.chargePointVendor;
                    chargePointState.model = payload.chargePointModel;
                    
                    // Chỉ set Available nếu KHÔNG phải là reconnect đang có session
                    if (!isReconnection) {
                        chargePointState.status = 'Available';
                    }
                    
                    // Cập nhật thông tin vào DB
                    db.updateChargePoint(chargePointId, chargePointState.vendor, chargePointState.model);
                    
                    broadcastToDashboards({ type: 'boot', id: chargePointId, state: chargePointState });
                    updateOpcuaVariables(chargePointId, {
                        Vendor: chargePointState.vendor,
                        Model: chargePointState.model,
                        Status: chargePointState.status
                    });

                    // *** GỬI LỆNH PHỤC HỒI ***
                    if (isReconnection && chargePointState.transactionId) {
                        console.log(`[Master] Gửi lệnh RestoreSession cho ${chargePointId}`);
                        setTimeout(() => {
                            if (ws.readyState === WebSocket.OPEN) {
                                const restoreMsg = [2, uuidv4(), "DataTransfer", {
                                    vendorId: "OCPP_Simulator",
                                    messageId: "RestoreSession",
                                    data: JSON.stringify({
                                        status: chargePointState.status,
                                        transactionId: chargePointState.transactionId,
                                        energy: chargePointState.energy,
                                        soc: chargePointState.soc,
                                        timeRemaining: chargePointState.timeRemaining,
                                        chargeSpeed: chargePointState.chargeSpeed
                                    })
                                }];
                                ws.send(JSON.stringify(restoreMsg));
                            }
                        }, 500);
                    }
                } 
                else if (action === 'StatusNotification') {
                    // *** CHẶN LỆNH AVAILABLE NẾU ĐANG CÓ SESSION ***
                    if (isReconnection && chargePointState.transactionId && payload.status === 'Available') {
                        console.log(`[Master] CHẶN Status 'Available' từ ${chargePointId} vì đang có session ${chargePointState.transactionId}`);
                    } else {
                        chargePointState.status = payload.status;
                        broadcastToDashboards({ type: 'status', id: chargePointId, status: chargePointState.status });
                        updateOpcuaVariables(chargePointId, { Status: chargePointState.status });
                    }
                } 
                else if (action === 'StopTransaction') {
                    // Logic dừng sạc bình thường
                    const txId = payload.transactionId;
                    const meterStop = payload.meterStop;
                    
                    if (txId) {
                        db.stopTransaction(txId, meterStop);
                    }

                    chargePointState.transactionId = null;
                    chargePointState.energy = 0;
                    chargePointState.soc = DEFAULT_START_SOC;
                    chargePointState.timeRemaining = '--:--:--';
                    chargePointState.chargeSpeed = null;
                    broadcastToDashboards({ type: 'transactionStop', id: chargePointId, transactionId: null });
                    broadcastToDashboards({ type: 'meterValue', id: chargePointId, value: 0, soc: DEFAULT_START_SOC, timeRemaining: '--:--:--' });
                    broadcastToDashboards({ type: 'speedUpdate', id: chargePointId, speed: null });
                    updateOpcuaVariables(chargePointId, { 
                        TransactionID: 0, 
                        Energy_kWh: 0 
                    });
                }
                else if (action === 'MeterValues') {
                    // ...existing code...
                }
                else if (action === 'DataTransfer' && payload.vendorId === 'ChargingSpeed') {
                    const speed = payload.data;
                    console.log(`[Master] Nhận tốc độ sạc từ ${chargePointId}: ${speed}`);
                    chargePointState.chargeSpeed = speed;
                    broadcastToDashboards({ type: 'speedUpdate', id: chargePointId, speed: speed });
                    updateOpcuaVariables(chargePointId, { ChargeSpeed: payload.data });
                }

                broadcastToDashboards({ type: 'log', direction: 'request', chargePointId, message: parsedMessage });
            } catch (e) { }

            // Forward to Python
            if (clients.chargePoints.has(chargePointId)) {
                clients.chargePoints.get(chargePointId).python.stdin.write(messageString + '\n');
            }
        });

        let pythonBuffer = '';
        pythonHandler.stdout.on('data', (data) => {
            const currentCp = clients.chargePoints.get(chargePointId);
            if (!currentCp || currentCp.ws !== ws || ws.readyState !== WebSocket.OPEN) {
                return;
            }
            pythonBuffer += data.toString();
            let newlineIndex;

            while ((newlineIndex = pythonBuffer.indexOf('\n')) !== -1) {
                const responseString = pythonBuffer.substring(0, newlineIndex).trim();
                pythonBuffer = pythonBuffer.substring(newlineIndex + 1);

                if (responseString) {
                    console.log(`[Python -> Master] Received response for ${chargePointId}: ${responseString}`);
                    ws.send(responseString);
                    
                    try {
                        const responseJson = JSON.parse(responseString);
                        broadcastToDashboards({ type: 'log', direction: 'response', chargePointId, message: responseJson });
                        
                        const [,, payload] = responseJson;
                        if (payload && payload.transactionId) {
                             if (chargePointState) {
                                 chargePointState.transactionId = payload.transactionId;
                                 chargePointState.energy = 0;
                                 chargePointState.soc = DEFAULT_START_SOC;
                                 chargePointState.timeRemaining = '--:--:--';
                                 
                                 db.startTransaction(chargePointId, payload.transactionId, "UNKNOWN_TAG", 0);
                                 broadcastToDashboards({ type: 'transactionStart', id: chargePointId, transactionId: chargePointState.transactionId });
                                 updateOpcuaVariables(chargePointId, {
                                    TransactionID: payload.transactionId,
                                    Energy_kWh: 0
                                 });
                            }
                        }
                    } catch (e) {
                        console.error(`[Master] Error parsing JSON from Python for ${chargePointId}:`, e);
                    }
                }
            }
        });

        pythonHandler.stderr.on('data', (data) => {
            console.error(`[Python stderr for ${chargePointId}]: ${data.toString()}`);
        });

        pythonHandler.on('error', (err) => {
            console.error(`[Master] Failed to start Python process for ${chargePointId}:`, err);
            ws.close(1011, 'Internal server error');
        });

        pythonHandler.on('close', (code) => {
            console.log(`[Master] Python handler for ${chargePointId} exited with code ${code}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1012, 'Handler process terminated');
            }
        });

        ws.on('close', () => {
            const cp = clients.chargePoints.get(chargePointId);

            if (cp && cp.ws === ws) {
                const status = cp.state.status;
                // --- SỬA: Logic quan trọng để Dashboard không bị mất trạng thái ---
                if (['Charging', 'SuspendedEV', 'SuspendedEVSE', 'Preparing'].includes(status)) {
                    console.log(`[Master] ${chargePointId} mất kết nối nhưng đang SẠC/PREPARING. Giữ session.`);
                    cp.ws = null; 
                    // KHÔNG GỬI 'disconnect' -> Dashboard vẫn thấy là đang Online/Charging
                    // KHÔNG update OPC UA thành 'Disconnected' -> SCADA vẫn thấy bình thường
                } else {
                    console.log(`[Master] ${chargePointId} ngắt kết nối (Rảnh). Dọn dẹp.`);
                    if (cp.python) cp.python.kill();
                    clients.chargePoints.delete(chargePointId);
                    db.updateChargePointStatus(chargePointId, 'Unavailable');
                    broadcastToDashboards({ type: 'disconnect', id: chargePointId });
                    updateOpcuaVariables(chargePointId, { Status: "Offline" });
                }
            }
        });
    }
});

setInterval(() => {
    const now = Date.now();
    
    clients.chargePoints.forEach((cp) => {
        const state = cp.state;
        const electricalParams = calculateServerElectricalParams(state);
        if (!state || state.status !== 'Charging') {
            if (state) state.lastSimTime = now;
            broadcastToDashboards({ 
                type: 'meterValue', 
                id: state.id, 
                value: state.energy, 
                soc: state.soc, 
                timeRemaining: state.timeRemaining,
                electricalParams: electricalParams // <--- Thêm vào gói tin
            });
            return;
        }

        const lastTime = state.lastSimTime || now;
        const deltaTimeHours = (now - lastTime) / 1000 / 3600;
        state.lastSimTime = now;
        
        const speed = state.chargeSpeed || 'normal';
        const powerKw = CHARGING_SPEEDS[speed] || 7.2;

        const addedWh = powerKw * 1000 * deltaTimeHours;
        state.energy = (state.energy || 0) + addedWh;

        const addedSoc = (state.energy / 1000 / BATTERY_CAPACITY) * 100;
        let currentSoc = DEFAULT_START_SOC + addedSoc;
        if (currentSoc > 100) currentSoc = 100;
        state.soc = currentSoc.toFixed(0);

        const energyNeededKwh = ((100 - currentSoc) / 100) * BATTERY_CAPACITY;
        const timeRemainingHours = powerKw > 0 ? energyNeededKwh / powerKw : 0;
        state.timeRemaining = formatTimeRemaining(timeRemainingHours);

        broadcastToDashboards({ 
            type: 'meterValue', 
            id: state.id, 
            value: state.energy, 
            soc: state.soc, 
            timeRemaining: state.timeRemaining,
            electricalParams: electricalParams // <--- Thêm vào gói tin
        });
        
        const opcUpdateData = {
            SoC: parseFloat(state.soc),
            Energy_kWh: parseFloat((state.energy / 1000).toFixed(3)),

            // 2. Dữ liệu điện năng (Lấy từ calculateServerElectricalParams)
            Power_Total: electricalParams.p_total,
            ReActivePower_Total: electricalParams.q_total,
            PF: electricalParams.pf,
            Current_Total: electricalParams.i_sum,
            Current_a: electricalParams.ia,
            Current_b: electricalParams.ib,
            Current_c: electricalParams.ic,
            Voltage_Average: electricalParams.v_avg,
            Voltage_ab: electricalParams.vab,
            Voltage_bc: electricalParams.vbc,
            Voltage_ac: electricalParams.vca
        };

        updateOpcuaVariables(state.id, opcUpdateData);

        if (cp.ws && cp.ws.readyState === WebSocket.OPEN) {
            const syncMsg = [2, uuidv4(), "DataTransfer", {
                vendorId: "OCPP_Simulator",
                messageId: "SyncState",
                data: JSON.stringify({
                    energy: state.energy,
                    soc: state.soc,
                    timeRemaining: state.timeRemaining,
                    status: state.status
                })
            }];
            cp.ws.send(JSON.stringify(syncMsg));
        }
    });
}, 1000);

setInterval(() => {
    clients.chargePoints.forEach((cp) => {
        if (cp.state) {
            broadcastToDashboards({
                type: 'heartbeat',
                id: cp.state.id
            });
        }
    });
}, 5000);

// --- XỬ LÝ GRACEFUL SHUTDOWN ---
// Giúp giải phóng PORT và kill các tiến trình con khi server tắt
async function gracefulShutdown() {
    console.log('\n[System] Đang tắt server và dọn dẹp tài nguyên...');

    // 1. Dừng nhận kết nối mới
    server.close(() => {
        console.log('[System] HTTP/WebSocket Server đã đóng.');
    });

    // 2. Kill toàn bộ Python child processes đang chạy
    if (clients.chargePoints.size > 0) {
        console.log(`[System] Đang kill ${clients.chargePoints.size} tiến trình Python...`);
        clients.chargePoints.forEach((cp, id) => {
            if (cp.python) {
                cp.python.kill('SIGINT');
                console.log(`[System] Đã kill Python handler của ${id}`);
            }
        });
    }

    // 3. Shutdown OPC UA Server
    if (opcUaServer) {
        try {
            await opcUaServer.shutdown();
            console.log('[System] OPC UA Server đã dừng.');
        } catch (err) {
            console.error('[System] Lỗi khi dừng OPC UA Server:', err);
        }
    }

    // 4. Thoát
    console.log('[System] Hoàn tất dọn dẹp. Bye!');
    setTimeout(() => process.exit(0), 1000);
}

// Lắng nghe các tín hiệu tắt từ hệ thống
process.on('SIGINT', gracefulShutdown);  // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // Kill command

// --- KHỞI ĐỘNG SERVER ---
async function startServer() {
    try {
        await db.initDb();
        await initializeOpcUaServer();
        const PORT = process.env.PORT || 9000;
        
        exec('node generate_tags.js', (error, stdout, stderr) => {
            if (error) {
                // Lỗi nghiêm trọng 
                console.error(`[Auto-Excel] LỖI KHỞI ĐỘNG: ${error.message}`);
            }
            if (stderr) {
                // Lỗi nhỏ 
                console.error(`[Auto-Excel] Stderr: ${stderr}`);
            }
            if (stdout) {
                // Thông báo thành công từ generate_tags.js
                console.log(`[Auto-Excel] Khởi động thành công: ${stdout.trim()}`);
            }
        });

        // Xử lý lỗi port conflict
        server.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                console.error(`[LỖI NGHIÊM TRỌNG] Cổng ${PORT} đang bị chiếm dụng!`);
                console.error('Hãy thử chạy lệnh sau để kill process cũ:');
                console.error(`  - Windows: netstat -ano | findstr :${PORT} -> taskkill /PID <PID> /F`);
                console.error(`  - Linux/Mac: lsof -i :${PORT} -> kill -9 <PID>`);
                process.exit(1);
            }
        });

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`CSMS Master Server đang chạy trên cổng ${PORT}`);
        });
    } catch (error) {
        console.error("Không thể khởi động server do lỗi database:", error);
        process.exit(1);
    }
}

startServer();