// File: generate_tags.js
const XLSX = require('xlsx');
const mysql = require('mysql2/promise'); 

// 1. CẤU HÌNH DATABASE 
const DB_CONFIG = {
    host: 'localhost',
    user: 'root',           // Tên đăng nhập MySQL
    password: 'L@m0981985353',   // Mật khẩu MySQL
    database: 'ocpp_csms'   // Tên database dự án của bạn
};

// Cấu hình WinCC
const WINCC_CONNECTION_NAME = "Connection_1";
const NAMESPACE_INDEX = 1;
const OPC_UA_SERVER_STRING = "opc.tcp://192.168.1.8:4840/UA/OcppCsmsServer"

// 2. DANH SÁCH BIẾN 
const variableDefs = [
    { name: "Status", type: "String" },
    { name: "ChargeSpeed", type: "String" },
    { name: "Vendor", type: "String" },
    { name: "Model", type: "String" },
    { name: "TransactionID", type: "Int32" },
    { name: "SoC", type: "Double" },
    { name: "Energy_kWh", type: "Double" },
    { name: "Power_Total", type: "Double" },
    { name: "ReActivePower_Total", type: "Double" },
    { name: "PF", type: "Double" },
    { name: "Current_Total", type: "Double" },
    { name: "Current_a", type: "Double" },
    { name: "Current_b", type: "Double" },
    { name: "Current_c", type: "Double" },
    { name: "Voltage_Average", type: "Double" },
    { name: "Voltage_ab", type: "Double" },
    { name: "Voltage_bc", type: "Double" },
    { name: "Voltage_ac", type: "Double" },
    { name: "RemoteStart_Trigger", type: "Boolean" },
    { name: "RemoteStop_Trigger", type: "Boolean" },
    { name: "RemoteStart_IdTag", type: "String" }
];

function mapDataType(nodeType) {
    switch (nodeType) {
        case "Double": return "Real";
        case "Int32": return "DInt";
        case "Boolean": return "Bool";
        case "String": return "WString";
        default: return "Real";
    }
}

async function main() {
    let connection;
    try {
        console.log("Đang kết nối Database để lấy danh sách trạm...");
        
        // Tạo kết nối DB
        connection = await mysql.createConnection(DB_CONFIG);
        
        // Truy vấn lấy tất cả ID trạm sạc từ bảng charge_points
        const [rows] = await connection.execute('SELECT id FROM charge_points');
        const STATION_LIST = rows.map(row => row.id);

        console.log(`Tìm thấy ${STATION_LIST.length} trạm sạc:`, STATION_LIST);

        if (STATION_LIST.length === 0) {
            console.warn("⚠️ Không có trạm sạc nào trong database!");
            return;
        }

        // --- BẮT ĐẦU TẠO EXCEL ---
        const headers = ["Name", "Path", "Connection", "Access Method", "Address", "DataType"];
        const dataRows = [headers];

        STATION_LIST.forEach(stationId => {
            variableDefs.forEach(def => {
                const tagName = `${stationId}_${def.name}`;
                const address = `ns=${OPC_UA_SERVER_STRING};s=${stationId}_${def.name}`;
                const winccType = mapDataType(def.type);

                dataRows.push([
                    tagName,
                    "", 
                    WINCC_CONNECTION_NAME,
                    "<Absolute Access>",
                    address,
                    winccType
                ]);
            });
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet(dataRows);
        
        // Đặt tên sheet trùng với bảng tag bạn muốn paste vào 
        XLSX.utils.book_append_sheet(workbook, worksheet, "Hmi Tags"); 

        XLSX.writeFile(workbook, "WinCC_Tags_Auto.xlsx");

        console.log("File 'WinCC_Tags_Auto.xlsx' đã được cập nhật theo Database.");

    } catch (error) {
        console.error("Error:", error.message);
    } finally {
        if (connection) await connection.end(); 
    }
}

// Chạy hàm main
main();