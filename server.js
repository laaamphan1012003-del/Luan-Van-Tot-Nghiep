const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
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
const DEFAULT_START_SOC = 26;

// --- BỘ QUẢN LÝ TRẠNG THÁI ---
const clients = {
    chargePoints: new Map(),
    dashboards: new Set()
};
const opcUaCreationLocks = new Set();

let opcUaServer;
let opcUaAddressSpace;

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

// Hàm helper để cập nhật giá trị 1 tag OPC UA
function updateOpcuaTag(chargePointId, tagName, value) {
    const cp = clients.chargePoints.get(chargePointId);
    if (cp && cp.opcuaNodes && cp.opcuaNodes[tagName]) {
        try {
            const node = cp.opcuaNodes[tagName];
            node.setValueFromSource(new Variant({ dataType: node.dataTypeObj.dataType, value: value }));
        } catch (err) {
            console.error(`[OPC UA] Lỗi khi cập nhật tag ${tagName} cho ${chargePointId}:`, err);
        }
    }
}

function createOpcUaNodesForChargePoint(chargePointId) {
    const namespace = opcUaAddressSpace.getOwnNamespace();
    const nsIndex = namespace.index;
    const chargePointsFolder = opcUaAddressSpace.findNode(`ns=${nsIndex};s=ChargePointsFolder`);

    if (!chargePointsFolder) {
        console.error("[OPC UA] Lỗi nghiêm trọng: Không tìm thấy 'ChargePointsFolder'.");
        return;
    }

    const folderNodeId = `ns=${nsIndex};s=${chargePointId}`;
    let chargePointFolder = opcUaAddressSpace.findNode(folderNodeId);

    const nodes = {};
    const variableNodeId = (name) => `ns=${nsIndex};s=${chargePointId}.${name}`;

    if (!chargePointFolder) {
        // --- Tạo mới mọi thứ ---
        console.log(`[OPC UA] Đang tạo thư mục mới cho ${chargePointId}`);
        try {
            chargePointFolder = namespace.addFolder(chargePointsFolder, {
                browseName: chargePointId,
                nodeId: folderNodeId
            });

        // Tạo các node con với explicit nodeId
        nodes.Status = namespace.addVariable({ componentOf: chargePointFolder, browseName: "Status", dataType: DataType.String, value: { dataType: DataType.String, value: "Connecting" }, nodeId: variableNodeId("Status") });
        nodes.Energy_Wh = namespace.addVariable({ componentOf: chargePointFolder, browseName: "Energy_Wh", dataType: DataType.Double, value: { dataType: DataType.Double, value: 0 }, nodeId: variableNodeId("Energy_Wh") });
        nodes.TransactionID = namespace.addVariable({ componentOf: chargePointFolder, browseName: "TransactionID", dataType: DataType.Int32, value: { dataType: DataType.Int32, value: 0 }, nodeId: variableNodeId("TransactionID") });
        nodes.Vendor = namespace.addVariable({ componentOf: chargePointFolder, browseName: "Vendor", dataType: DataType.String, value: { dataType: DataType.String, value: "" }, nodeId: variableNodeId("Vendor") });
        nodes.Model = namespace.addVariable({ componentOf: chargePointFolder, browseName: "Model", dataType: DataType.String, value: { dataType: DataType.String, value: "" }, nodeId: variableNodeId("Model") });
        nodes.RemoteStartTrigger = namespace.addVariable({ componentOf: chargePointFolder, browseName: "RemoteStart_Trigger", dataType: DataType.Boolean, value: { dataType: DataType.Boolean, value: false }, accessLevel: "CurrentRead | CurrentWrite", userAccessLevel: "CurrentRead | CurrentWrite", nodeId: variableNodeId("RemoteStart_Trigger") });
        nodes.RemoteStart_IdTag = namespace.addVariable({ componentOf: chargePointFolder, browseName: "RemoteStart_IdTag", dataType: DataType.String, value: { dataType: DataType.String, value: "0000" }, accessLevel: "CurrentRead | CurrentWrite", userAccessLevel: "CurrentRead | CurrentWrite", nodeId: variableNodeId("RemoteStart_IdTag") });
        nodes.RemoteStopTrigger = namespace.addVariable({ componentOf: chargePointFolder, browseName: "RemoteStop_Trigger", dataType: DataType.Boolean, value: { dataType: DataType.Boolean, value: false }, accessLevel: "CurrentRead | CurrentWrite", userAccessLevel: "CurrentRead | CurrentWrite", nodeId: variableNodeId("RemoteStop_Trigger") });
    
    } catch (err) {
            console.error(`[OPC UA] Lỗi khi tạo node cho ${chargePointId}:`, err.message);
            // Nếu lỗi do đã tồn tại (race condition), thử tìm lại lần nữa
            chargePointFolder = opcUaAddressSpace.findNode(folderNodeId);
        }

    if (chargePointFolder) {
        console.log(`[OPC UA] Sử dụng node folder đã tồn tại cho ${chargePointId}.`);
        nodes.Status = namespace.findNode(variableNodeId("Status"));
        nodes.Energy_Wh = namespace.findNode(variableNodeId("Energy_Wh"));
        nodes.TransactionID = namespace.findNode(variableNodeId("TransactionID"));
        nodes.Vendor = namespace.findNode(variableNodeId("Vendor"));
        nodes.Model = namespace.findNode(variableNodeId("Model"));
        nodes.RemoteStartTrigger = namespace.findNode(variableNodeId("RemoteStart_Trigger"));
        nodes.RemoteStart_IdTag = namespace.findNode(variableNodeId("RemoteStart_IdTag"));
        nodes.RemoteStopTrigger = namespace.findNode(variableNodeId("RemoteStop_Trigger"));
    }

    if (!nodes.RemoteStartTrigger || !nodes.RemoteStopTrigger || !nodes.RemoteStart_IdTag) {
        console.error(`[OPC UA] Lỗi: Không thể tìm thấy các node trigger cho ${chargePointId}. Hủy bỏ binding.`);
        return nodes; 
    }
    }

    try {
        // --- 1. START TRIGGER ---
        nodes.RemoteStartTrigger.bindVariable({     
            get: function() {
                return new Variant({ dataType: DataType.Boolean, value: false });
            },
            set: (variant, callback) => {
                const value = variant.value;
                if (value == true) { 
                    console.log(`[OPC UA] Nhận lệnh RemoteStart cho ${chargePointId}`);
                    try {
                        const dataValue = nodes.RemoteStart_IdTag.readValue();
                        const idTag = (dataValue.value && dataValue.value.value) ? dataValue.value.value : "0000";
                        
                        const targetCP = clients.chargePoints.get(chargePointId);
                        if (targetCP && targetCP.ws.readyState === WebSocket.OPEN) {
                            const uniqueId = uuidv4();
                            const ocppMessage = [2, uniqueId, "RemoteStartTransaction", { idTag: idTag, connectorId: 1 }];
                            targetCP.ws.send(JSON.stringify(ocppMessage));
                        }
                    } catch (err) {
                        console.error("[OPC UA] Lỗi khi đọc IdTag hoặc gửi lệnh Start:", err.message);
                    }
                    nodes.RemoteStartTrigger.setValueFromSource(new Variant({ dataType: DataType.Boolean, value: false }));
                }
                callback(null, StatusCodes.Good);
            }
        }, true); 

        // --- 2. STOP TRIGGER ---
        nodes.RemoteStopTrigger.bindVariable({    
            get: function() {
                return new Variant({ dataType: DataType.Boolean, value: false });
            },
            set: (variant, callback) => {
                const value = variant.value;
                if (value == true) { 
                    console.log(`[OPC UA] Nhận lệnh RemoteStop cho ${chargePointId}`);
                    try {
                        const targetCP = clients.chargePoints.get(chargePointId);
                        const state = targetCP ? targetCP.state : null;
                        if (state && state.transactionId && targetCP.ws.readyState === WebSocket.OPEN) {
                            const uniqueId = uuidv4();
                            const ocppMessage = [2, uniqueId, "RemoteStopTransaction", { transactionId: state.transactionId }];
                            targetCP.ws.send(JSON.stringify(ocppMessage));
                        }
                    } catch (err) {
                        console.error("[OPC UA] Lỗi khi gửi lệnh Stop:", err.message);
                    }
                    nodes.RemoteStopTrigger.setValueFromSource(new Variant({ dataType: DataType.Boolean, value: false }));
                }
                callback(null, StatusCodes.Good);
            }
        }, true); 

        console.log(`[OPC UA] Binding cho ${chargePointId} thành công.`);

    } catch (err) {
        console.error(`[OPC UA] Lỗi không mong muốn khi binding ${chargePointId}: ${err.message}`);
    }
    
    return nodes;
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
    const objectsFolder = opcUaAddressSpace.findNode("i=85");
    // Tạo một thư mục gốc cho các trạm sạc
    const namespace = opcUaAddressSpace.getOwnNamespace();
    const nsIndex = namespace.index;
    
    namespace.addFolder(objectsFolder, {
        browseName: "ChargePoints",
        nodeId: `ns=${nsIndex};s=ChargePointsFolder`
    });

    console.log("[OPC UA] Server đã được khởi tạo và sẵn sàng.");

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
            const data = await db.getRecentTransactions();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) { 
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
                    
                    // Báo cho các dashboard biết có trạm mới
                    broadcastToDashboards({ 
                        type: 'connect', 
                        id: id, 
                        state: { id, location, status: 'Unavailable', vendor: 'N/A', model: 'N/A' } 
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

    } else { // Kết nối từ trạm sạc
       const chargePointId = id;
        
        if (opcUaCreationLocks.has(chargePointId)) { ws.terminate(); return; }

        // --- SỬA: Kiểm tra kết nối cũ để Khôi phục (Reconnect) ---
        let existingCp = clients.chargePoints.get(chargePointId);
        let pythonHandler;
        let chargePointState;
        let opcuaNodes;
        let isReconnection = false;

        const activeStatuses = ['Preparing', 'Charging', 'Finishing', 'SuspendedEV', 'SuspendedEVSE'];
        
        if (existingCp && activeStatuses.includes(existingCp.state.status)) {
            console.log(`[Master] ${chargePointId} đang kết nối lại vào phiên sạc cũ (Status: ${existingCp.state.status}).`);
            isReconnection = true;
            
            // Dọn dẹp socket cũ nếu còn treo
            if (existingCp.ws) {
                try { existingCp.ws.terminate(); } catch(e){}
            }

            // Tái sử dụng state và process cũ
            chargePointState = existingCp.state;
            pythonHandler = existingCp.python;
            opcuaNodes = existingCp.opcuaNodes;

            // Xóa listeners cũ của Python process để tránh gửi data vào socket chết
            if (pythonHandler) {
                pythonHandler.stdout.removeAllListeners('data');
                pythonHandler.removeAllListeners('close');
                pythonHandler.stderr.removeAllListeners('data');
            }

            // Cập nhật socket mới vào map
            existingCp.ws = ws;
            
            // Báo ngay cho Dashboard trạng thái hiện tại
            db.recordHeartbeat(chargePointId);
            broadcastToDashboards({ type: 'connect', id: chargePointId, state: chargePointState });

        } else {
            if (existingCp) {
                if (existingCp.python) existingCp.python.kill();
                clients.chargePoints.delete(chargePointId);
            }
            
            console.log(`[Master] Spawning Python handler for '${chargePointId}'...`);
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
            
            opcUaCreationLocks.add(chargePointId);
            opcuaNodes = createOpcUaNodesForChargePoint(chargePointId);
            opcUaCreationLocks.delete(chargePointId);

            clients.chargePoints.set(chargePointId, { 
                ws: ws, state: chargePointState, python: pythonHandler, opcuaNodes: opcuaNodes
            });
        
            broadcastToDashboards({ type: 'connect', id: chargePointId, state: chargePointState });
            db.updateChargePoint(chargePointId, '', '');
            db.recordHeartbeat(chargePointId);
            db.updateChargePointStatus(chargePointId, 'Available');
        };

        ws.on('message', (message) => {
            const currentCp = clients.chargePoints.get(chargePointId);
                if (!currentCp || currentCp.ws !== ws) {
                return; 
            }
            const messageString = message.toString();
            console.log(`[Master -> Python] Forwarding message from ${chargePointId}: ${messageString}`);
            
            try {
                const parsedMessage = JSON.parse(messageString);
                const [,, action, payload] = parsedMessage;

                // Cập nhật DB Last Seen mỗi khi nhận message
                db.recordHeartbeat(chargePointId);

                if (action === 'BootNotification') {
                    chargePointState.vendor = payload.chargePointVendor;
                    chargePointState.model = payload.chargePointModel;
                    if (!isReconnection) {
                        chargePointState.status = 'Available';
                    }
                    
                    // Cập nhật thông tin vào DB
                    db.updateChargePoint(chargePointId, chargePointState.vendor, chargePointState.model);
                    
                    broadcastToDashboards({ type: 'boot', id: chargePointId, state: chargePointState });
                    updateOpcuaTag(chargePointId, "Vendor", chargePointState.vendor);
                    updateOpcuaTag(chargePointId, "Model", chargePointState.model);
                    updateOpcuaTag(chargePointId, "Status", chargePointState.status);

                    if (isReconnection && chargePointState.transactionId) {
                        console.log(`[Master] Gửi lệnh RestoreSession cho ${chargePointId}`);
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

                } else if (action === 'StatusNotification') {
                    chargePointState.status = payload.status;
                    broadcastToDashboards({ type: 'status', id: chargePointId, status: chargePointState.status });
                    updateOpcuaTag(chargePointId, "Status", chargePointState.status);
                } else if (action === 'StopTransaction') {
                    const txId = payload.transactionId;
                    const meterStop = payload.meterStop;
                    
                    // Cập nhật DB
                    if (txId) {
                        db.stopTransaction(txId, meterStop);
                    }

                    chargePointState.transactionId = null;
                    chargePointState.energy = 0; // Reset energy khi dừng
                    chargePointState.soc = DEFAULT_START_SOC; // Reset SOC
                    chargePointState.timeRemaining = '--:--:--';
                    chargePointState.chargeSpeed = null; // Reset charge speed khi dừng
                    broadcastToDashboards({ type: 'transactionStop', id: chargePointId, transactionId: null });
                    broadcastToDashboards({ type: 'meterValue', id: chargePointId, value: 0, soc: DEFAULT_START_SOC, timeRemaining: '--;--;--' }); // Gửi cập nhật energy về 0
                    broadcastToDashboards({ type: 'speedUpdate', id: chargePointId, speed: null }); // Reset speed trên dashboard
                    updateOpcuaTag(chargePointId, "TransactionID", 0); // Đặt về 0 hoặc null
                    updateOpcuaTag(chargePointId, "Energy_Wh", 0);
                }
                else if (action === 'MeterValues') {
                }

                // Handle DataTransfer for charging speed from mobile app
                else if (action === 'DataTransfer' && payload.vendorId === 'ChargingSpeed') {
                    const speed = payload.data; // 'normal', 'fast', or 'lightning'
                    console.log(`[Master] Nhận tốc độ sạc từ ${chargePointId}: ${speed}`);
                    chargePointState.chargeSpeed = speed;
                    broadcastToDashboards({ type: 'speedUpdate', id: chargePointId, speed: speed });
                }

                broadcastToDashboards({ type: 'log', direction: 'request', chargePointId, message: parsedMessage });
            } catch (e) { /* Bỏ qua lỗi */ }

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
                                 chargePointState.energy = 0; // Reset energy khi bắt đầu
                                 chargePointState.soc = DEFAULT_START_SOC; // Reset về 26% khi bắt đầu
                                 chargePointState.timeRemaining = '--:--:--';
                                 
                                 // Ghi vào DB (Start Transaction)
                                 db.startTransaction(chargePointId, payload.transactionId, "UNKNOWN_TAG", 0);
                                 broadcastToDashboards({ type: 'transactionStart', id: chargePointId, transactionId: chargePointState.transactionId });
                                 updateOpcuaTag(chargePointId, "TransactionID", payload.transactionId);
                                 updateOpcuaTag(chargePointId, "Energy_Wh", 0);
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
                if (['Preparing', 'Charging', 'Finishing'].includes(status)) {
                    console.log(`[Master] ${chargePointId} ngắt kết nối tạm thời (Session Active). Giữ state.`);
                    cp.ws = null; 
                    broadcastToDashboards({ type: 'disconnect', id: chargePointId, isTemporary: true });
                    updateOpcuaTag(chargePointId, "Status", "Disconnected");
                } else {
                    if (cp.python) cp.python.kill();
                    clients.chargePoints.delete(chargePointId);
                    db.updateChargePointStatus(chargePointId, 'Unavailable');
                    broadcastToDashboards({ type: 'disconnect', id: chargePointId });
                }
            }
        });
    }
});
setInterval(() => {
    const now = Date.now();
    
    clients.chargePoints.forEach((cp) => {
        const state = cp.state;
        if (!state || state.status !== 'Charging') {
            state.lastSimTime = now; // Reset time delta
            return;
        }

        // Tính thời gian trôi qua (giờ)
        const lastTime = state.lastSimTime || now;
        const deltaTimeHours = (now - lastTime) / 1000 / 3600;
        state.lastSimTime = now;
        // Lấy công suất sạc (kW)
        const speed = state.chargeSpeed || 'normal';
        const powerKw = CHARGING_SPEEDS[speed] || 7.2;

        // Tính năng lượng cộng thêm (Wh)
        const addedWh = powerKw * 1000 * deltaTimeHours;
        state.energy = (state.energy || 0) + addedWh;

        // Tính SOC & Time Remaining
        const addedSoc = (state.energy / 1000 / BATTERY_CAPACITY) * 100;
        let currentSoc = DEFAULT_START_SOC + addedSoc;
        if (currentSoc > 100) currentSoc = 100;
        state.soc = currentSoc.toFixed(0);

        const energyNeededKwh = ((100 - currentSoc) / 100) * BATTERY_CAPACITY;
        // Tránh chia cho 0
        const timeRemainingHours = powerKw > 0 ? energyNeededKwh / powerKw : 0;
        state.timeRemaining = formatTimeRemaining(timeRemainingHours);

        // Broadcast cập nhật xuống Dashboard và SCADA
        broadcastToDashboards({ 
            type: 'meterValue', 
            id: state.id, 
            value: state.energy, 
            soc: state.soc, 
            timeRemaining: state.timeRemaining
        });
        
        updateOpcuaTag(state.id, "Energy_Wh", state.energy);
    });
}, 1000);
function monitorOpcUaWrites(chargePointId, opcuaNodes) {
    
    // Theo dõi lệnh START
    opcuaNodes.RemoteStartTrigger.bindVariable({
        set: (variant, callback) => {
            const value = variant.value;
            if (value === true) {
                console.log(`[OPC UA] Nhận lệnh RemoteStart cho ${chargePointId}`);
                
                // Đọc IdTag mà WinCC đã nhập
                const idTag = opcuaNodes.RemoteStart_IdTag.readValue().value.value || "0000";

                // Tái sử dụng logic gửi lệnh từ dashboard
                const targetCP = clients.chargePoints.get(chargePointId);
                if (targetCP && targetCP.ws.readyState === WebSocket.OPEN) {
                    const uniqueId = uuidv4();
                    const ocppMessage = [2, uniqueId, "RemoteStartTransaction", { idTag: idTag, connectorId: 1 }];
                    targetCP.ws.send(JSON.stringify(ocppMessage));
                    console.log(`[Master] Đã gửi lệnh RemoteStartTransaction tới ${chargePointId} (từ OPC UA)`);
                }

                // Tự động reset trigger về false
                opcuaNodes.RemoteStartTrigger.setValueFromSource(new Variant({ dataType: DataType.Boolean, value: false }));
            }
            callback(null, StatusCodes.Good);
        }
    });

    // 2. Theo dõi lệnh STOP
    opcuaNodes.RemoteStopTrigger.bindVariable({
        set: (variant, callback) => {
            const value = variant.value;
            if (value === true) {
                console.log(`[OPC UA] Nhận lệnh RemoteStop cho ${chargePointId}`);
                
                const targetCP = clients.chargePoints.get(chargePointId);
                const state = targetCP ? targetCP.state : null;

                if (state && state.transactionId && targetCP.ws.readyState === WebSocket.OPEN) {
                    const uniqueId = uuidv4();
                    const ocppMessage = [2, uniqueId, "RemoteStopTransaction", { transactionId: state.transactionId }];
                    targetCP.ws.send(JSON.stringify(ocppMessage));
                    console.log(`[Master] Đã gửi lệnh RemoteStopTransaction tới ${chargePointId} (từ OPC UA)`);
                }
                
                // Tự động reset trigger về false
                opcuaNodes.RemoteStopTrigger.setValueFromSource(new Variant({ dataType: DataType.Boolean, value: false }));
            }
            callback(null, StatusCodes.Good);
        }
    });
}

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