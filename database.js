const mysql = require('mysql2/promise');

// --- CẤU HÌNH KẾT NỐI ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',      
    user: process.env.DB_USER || 'root',           
    password: process.env.DB_PASSWORD || process.env.DB_ROOT_PASSWORD || 'L@m0981985353',          
    database: process.env.DB_NAME || 'ocpp_csms'   
};

let pool;

async function initDb() {
    try {
        pool = mysql.createPool(dbConfig);
        const connection = await pool.getConnection();
        console.log('[Database] Kết nối MySQL thành công.');
        connection.release();

        // 1. Tạo bảng gốc nếu chưa có
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS charge_points (
                id VARCHAR(255) PRIMARY KEY,
                vendor VARCHAR(255),
                model VARCHAR(255),
                last_seen DATETIME
            );
        `);

        // 2. AUTO MIGRATION: Tự động thêm các cột mới nếu thiếu
        try { await pool.execute("ALTER TABLE charge_points ADD COLUMN status VARCHAR(50) DEFAULT 'Offline'"); } catch (e) {}
        try { await pool.execute("ALTER TABLE charge_points ADD COLUMN location VARCHAR(255)"); } catch (e) {}
        try { await pool.execute("ALTER TABLE charge_points ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"); } catch (e) {}

        // Tạo bảng transactions
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INT PRIMARY KEY,
                charge_point_id VARCHAR(255),
                start_time DATETIME,
                stop_time DATETIME,
                meter_start INT,
                meter_stop INT,
                id_tag VARCHAR(255),
                FOREIGN KEY (charge_point_id) REFERENCES charge_points(id)
            );
        `);
        
        console.log('[Database] Kiểm tra cấu trúc bảng hoàn tất.');

    } catch (err) {
        console.error('[Database] Lỗi khởi tạo MySQL:', err.message);
    }
}

// --- CÁC HÀM TRUY VẤN ---

async function getAllChargePoints() {
    if (!pool) return [];
    try {
        // Sắp xếp theo last_seen để tránh lỗi nếu cột created_at chưa tồn tại ở DB cũ
        const [rows] = await pool.execute('SELECT * FROM charge_points ORDER BY last_seen DESC');
        return rows;
    } catch (err) {
        console.error('[Database] Lỗi getAllChargePoints:', err.message);
        return [];
    }
}

async function createChargePoint(id, location) {
    if (!pool) return;
    try {
        const sql = `
            INSERT INTO charge_points (id, location, status, vendor, model, last_seen, created_at)
            VALUES (?, ?, 'Unavailable', 'Unknown', 'Unknown', NULL, NOW())
        `;
        await pool.execute(sql, [id, location]);
        console.log(`[Database] Đã thêm/cập nhật trạm ${id}`);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            throw new Error(`Trạm sạc ID '${id}' đã tồn tại! Không thể thêm mới.`);
        }
        console.error('[Database] Lỗi createChargePoint:', err);
        throw err;
    }
}

// --- SỬA LỖI XÓA TRẠM TẠI ĐÂY ---
async function deleteChargePoint(id) {
    if (!pool) return;
    
    // Lấy riêng 1 connection để dùng Transaction (đảm bảo xóa sạch hoặc không xóa gì cả)
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction(); // Bắt đầu giao dịch

        // 1. Xóa các giao dịch liên quan trước (để gỡ khóa ngoại)
        await connection.execute('DELETE FROM transactions WHERE charge_point_id = ?', [id]);
        
        // 2. Sau đó mới xóa trạm sạc
        await connection.execute('DELETE FROM charge_points WHERE id = ?', [id]);

        await connection.commit(); // Xác nhận lưu thay đổi
        console.log(`[Database] Đã xóa trạm ${id} và toàn bộ lịch sử giao dịch.`);
    } catch (err) {
        await connection.rollback(); // Nếu lỗi thì hoàn tác
        console.error('[Database] Lỗi deleteChargePoint:', err);
        throw err;
    } finally {
        connection.release(); // Trả connection về hồ chứa
    }
}

async function updateChargePoint(id, vendor, model) {
    if (!pool) return;
    try {
        const sql = `
            INSERT INTO charge_points (id, vendor, model, last_seen, status) 
            VALUES (?, ?, ?, NOW(), 'Available')
            ON DUPLICATE KEY UPDATE 
                vendor = VALUES(vendor), 
                model = VALUES(model), 
                last_seen = NOW(),
                status = 'Available'
        `;
        await pool.execute(sql, [id, vendor, model]);
    } catch (err) {
        console.error(`[Database] Lỗi updateChargePoint ${id}:`, err);
    }
}

async function updateChargePointStatus(id, status) {
    if (!pool) return;
    try {
        const sql = 'UPDATE charge_points SET status = ?, last_seen = NOW() WHERE id = ?';
        await pool.execute(sql, [status, id]);
    } catch (err) {
        console.error(`[Database] Lỗi update status ${id}:`, err);
    }
}

async function recordHeartbeat(id) {
    if (!pool) return;
    try {
        const sql = 'UPDATE charge_points SET last_seen = NOW() WHERE id = ?';
        await pool.execute(sql, [id]);
    } catch (err) {
        console.error(`[Database] Lỗi heartbeat ${id}:`, err);
    }
}

async function startTransaction(chargePointId, transactionId, idTag, meterStart) {
    if (!pool) return;
    try {
        const sql = 'INSERT INTO transactions (id, charge_point_id, start_time, meter_start, id_tag) VALUES (?, ?, ?, ?, ?)';
        await pool.execute(sql, [transactionId, chargePointId, new Date(), meterStart, idTag]);
    } catch (err) {
        console.error(`[Database] Lỗi startTransaction ${transactionId}:`, err);
    }
}

async function stopTransaction(transactionId, meterStop) {
    if (!pool) return;
    try {
        const sql = 'UPDATE transactions SET stop_time = ?, meter_stop = ? WHERE id = ?';
        await pool.execute(sql, [new Date(), meterStop, transactionId]);
    } catch (err) {
        console.error(`[Database] Lỗi stopTransaction ${transactionId}:`, err);
    }
}

async function getRecentTransactions() {
    if (!pool) return [];
    try {
        const sql = `
            SELECT t.id, t.charge_point_id, t.id_tag, 
                   t.start_time, t.stop_time, 
                   t.meter_start, t.meter_stop,
                   (t.meter_stop - t.meter_start) as total_energy
            FROM transactions t
            ORDER BY t.start_time DESC 
            LIMIT 50
        `;
        const [rows] = await pool.execute(sql);
        return rows;
    } catch (err) {
        console.error('[Database] Lỗi getRecentTransactions:', err);
        return [];
    }
}

async function getTransactionsByDate(startDate, endDate) {
    if (!pool) return [];
    try {
        const sql = `
            SELECT t.id, t.charge_point_id, t.id_tag, 
                   t.start_time, t.stop_time, 
                   t.meter_start, t.meter_stop,
                   (t.meter_stop - t.meter_start) as total_energy
            FROM transactions t
            WHERE t.start_time >= ? AND t.start_time <= ?
            ORDER BY t.start_time ASC
        `;
        const [rows] = await pool.execute(sql, [startDate, endDate]);
        return rows;
    } catch (err) {
        console.error('[Database] Lỗi getTransactionsByDate:', err.message);
        return [];
    }
}

async function getTransactionsByIdTag(idTag) {
    if (!pool) return [];
    try {
        const sql = `
            SELECT t.id, t.charge_point_id, t.id_tag, 
                   t.start_time, t.stop_time, 
                   t.meter_start, t.meter_stop,
                   (t.meter_stop - t.meter_start) as total_energy,
                   cp.location  
            FROM transactions t
            LEFT JOIN charge_points cp ON t.charge_point_id = cp.id
            WHERE t.id_tag = ?
            ORDER BY t.start_time DESC
        `;
        const [rows] = await pool.execute(sql, [idTag]);
        return rows;
    } catch (err) {
        console.error('[Database] Lỗi getTransactionsByIdTag:', err.message);
        return [];
    }
}

module.exports = {
    initDb,
    getAllChargePoints,
    createChargePoint,
    deleteChargePoint,
    updateChargePoint,
    updateChargePointStatus,
    recordHeartbeat,
    startTransaction,
    stopTransaction,
    getRecentTransactions,
    getTransactionsByDate,
    getTransactionsByIdTag
};