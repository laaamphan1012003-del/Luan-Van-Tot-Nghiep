const XLSX = require('xlsx');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// Cấu hình Database kết nối nội bộ Docker
const DB_CONFIG = {
    host: process.env.DB_HOST || 'mysql_db', 
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root', 
    database: process.env.DB_NAME || 'ocpp_csms'
};

const WINCC_CONNECTION_NAME = "Connection_1";

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
        console.log("--> Bat dau tao file Excel Tags...");
        connection = await mysql.createConnection(DB_CONFIG);
        const [rows] = await connection.execute('SELECT id FROM charge_points');
        
        const STATION_LIST = rows.map(row => row.id);
        
        const headers = ["Name", "Path", "Connection", "Access Method", "Address", "DataType"];
        const dataRows = [headers];

        STATION_LIST.forEach(stationId => {
            variableDefs.forEach(def => {
                dataRows.push([
                    `${stationId}_${def.name}`,
                    "", 
                    WINCC_CONNECTION_NAME,
                    "<Absolute Access>",
                    `ns=1;s=${stationId}_${def.name}`, 
                    mapDataType(def.type)
                ]);
            });
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet(dataRows);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Hmi Tags"); 

        // Lưu vào thư mục public
        const outputDir = path.join(__dirname, 'public');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

        const outputPath = path.join(outputDir, 'WinCC_Tags_Auto.xlsx');
        XLSX.writeFile(workbook, outputPath);
        console.log(`--> THANH CONG! File da luu tai: ${outputPath}`);

    } catch (error) {
        console.error("--> LOI:", error.message);
    } finally {
        if (connection) await connection.end();
    }
}

main();