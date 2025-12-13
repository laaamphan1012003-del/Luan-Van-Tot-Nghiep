CREATE DATABASE IF NOT EXISTS ocpp_csms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE ocpp_csms;

-- 1. Bảng quản lý các trạm sạc
CREATE TABLE IF NOT EXISTS charge_points (
    id VARCHAR(255) PRIMARY KEY,
    vendor VARCHAR(255) DEFAULT 'Unknown',
    model VARCHAR(255) DEFAULT 'Unknown',
    location VARCHAR(255),
    status VARCHAR(50) DEFAULT 'Offline',
    last_seen DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng lịch sử giao dịch (Transactions)
CREATE TABLE IF NOT EXISTS transactions (
    id INT PRIMARY KEY, 
    charge_point_id VARCHAR(255),
    id_tag VARCHAR(255),
    start_time DATETIME,
    stop_time DATETIME,
    meter_start INT DEFAULT 0,
    meter_stop INT DEFAULT 0,
    FOREIGN KEY (charge_point_id) REFERENCES charge_points(id) ON DELETE CASCADE,
    INDEX idx_start_time (start_time),
    INDEX idx_charge_point (charge_point_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;