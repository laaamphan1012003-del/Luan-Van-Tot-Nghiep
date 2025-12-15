# OCPP CSMS Simulator

Một hệ thống mô phỏng OCPP CSMS (Central System Management System) đầy đủ tính năng với giao diện Web Frontend và Backend Node.js/Python.

## Tính năng

- **OCPP 1.6 Protocol**: Hỗ trợ các thông điệp OCPP chuẩn
- **WebSocket Communication**: Giao tiếp real-time với các trạm sạc
- **OPC UA Server**: Tích hợp với hệ thống tự động hóa công nghiệp (cổng 4840)
- **MySQL Database**: Lưu trữ dữ liệu trạm sạc và giao dịch
- **Web Dashboard**: Giao diện quản lý trực quan
- **SCADA Interface**: Giao diện giám sát và điều khiển
- **Customer Portal**: Cổng thông tin cho người dùng cuối
- **Auto-Excel Tag Generator**: Tự động tạo file Excel tags cho WinCC/SCADA mỗi khi có trạm sạc mới kết nối.

## Yêu cầu hệ thống

### Chạy với Docker (Khuyên dùng)
- Docker Engine 20.10+
- Docker Compose 2.0+

### Chạy trực tiếp (Local Development)
- Node.js 16+
- Python 3.8+
- MySQL 8.0+

## Cài đặt và Chạy

### Option 1: Chạy với Docker (Khuyên dùng)

1. **Clone repository**
```bash
git clone <repository-url>
cd project-main
```

2. **Tạo file .env (tùy chọn)**
```bash
cp .env.example .env
# Chỉnh sửa .env nếu cần thay đổi mật khẩu hoặc cấu hình
```

3. **Khởi động ứng dụng**
```bash
docker-compose up -d
```

4. **Kiểm tra logs**
```bash
docker-compose logs -f app
```

5. **Truy cập ứng dụng**
- Dashboard: http://localhost:9000
- SCADA: http://localhost:9000/SCADA
- Customer Portal: http://localhost:9000/customer
- OPC UA Server: opc.tcp://localhost:4840

6. **Kill PID**
- Mở CMD bằng quyền admin
- Dán câu lệnh này để xem PORT đnag bị chiếm dungdụng bởi PID nào: netstat -ano | findstr :3000
- Kill PID: taskkill /PID {PID} /F

7. **Dừng ứng dụng**
```bash
docker-compose down
```

8. **Xóa dữ liệu và khởi động lại từ đầu**
```bash
docker-compose down -v
docker-compose up -d
```

### Option 2: Chạy trực tiếp (Local Development)

1. **Cài đặt MySQL và tạo database**
```sql
CREATE DATABASE ocpp_csms;
```

2. **Cấu hình database**
Chỉnh sửa `database.js` với thông tin kết nối MySQL của bạn.

3. **Cài đặt dependencies**
```bash
npm install
```

4. **Khởi động server**
```bash
npm start
```

5. **Truy cập ứng dụng**
- Dashboard: http://localhost:9000

## Cấu trúc dự án

```
kiet-project/
├── server.js              # Node.js WebSocket server chính
├── database.js            # MySQL connection pooling
├── OCPP_handler.py        # Python OCPP message handler
├── OCPP_message.py        # Python OCPP message helpers
├── public/                # Frontend files
│   ├── index.html         # Dashboard chính
│   ├── app.js             # Dashboard logic
│   ├── SCADA/             # SCADA interface
│   └── customer/          # Customer portal
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile             # Docker image definition
├── init.sql               # Database initialization script
└── AGENTS.md              # Developer guide
```

## Kiến trúc hệ thống

- **Node.js Server** (server.js): Quản lý WebSocket connections, routing, và state management
- **Python Handlers** (OCPP_handler.py): Xử lý logic OCPP messages cho mỗi charge point
- **MySQL Database**: Lưu trữ thông tin charge points và transactions
- **OPC UA Server**: Cho phép tích hợp với SCADA và PLC systems
- **Frontend**: Vanilla JavaScript với real-time WebSocket updates

## Ports

- **9000**: HTTP/WebSocket server (Dashboard, SCADA, Customer portal)
- **4840**: OPC UA server
- **3306**: MySQL database (chỉ trong Docker)

## Troubleshooting

### Container không khởi động
```bash
# Xem logs chi tiết
docker-compose logs

# Restart services
docker-compose restart
```

### Lỗi kết nối database
```bash
# Kiểm tra MySQL container đang chạy
docker-compose ps

# Kiểm tra MySQL logs
docker-compose logs mysql
```

### Port đã được sử dụng
Chỉnh sửa `docker-compose.yml` để thay đổi port mapping:
```yaml
ports:
  - "9001:9000"  # Thay đổi từ 9000 sang 9001
```

## Deployment

### Automated Deployment with GitHub Actions

This project includes automated deployment to a VPS using GitHub Actions.

**Setup Instructions**: See [.github/DEPLOYMENT.md](.github/DEPLOYMENT.md)

**Quick Setup**:
1. Add GitHub Secrets (SSH_HOST, SSH_USER, SSH_PRIVATE_KEY, database credentials)
2. Push to `main` branch or trigger workflow manually
3. Application will be deployed automatically

**Access Deployed Application**:
- Dashboard: `http://YOUR_VPS_IP:9000`
- SCADA: `http://YOUR_VPS_IP:9000/SCADA`
- Customer: `http://YOUR_VPS_IP:9000/customer`

### Manual Deployment

If you prefer manual deployment on your VPS:

```bash
# SSH to your VPS
ssh your-user@your-vps

# Clone repository
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO

# Create .env file
cp .env.example .env
# Edit .env with your database credentials

# Start application
docker-compose up -d

# View logs
docker-compose logs -f app
```

## Mobile App

📱 **Tauri v2 Mobile Application**

The customer portal is available as a native mobile app for Android!

**Location**: `mobile-app/`

**Features**:
- Native Android app
- QR code scanner for quick connection
- WebSocket OCPP 1.6 support
- Customer charge point simulation interface
- Native performance

**Releases**:
- APK builds are automatically generated via GitHub Actions
- Download the latest release from the [Releases page](https://github.com/bowber/kiet-project/releases)

## Development

Xem file `AGENTS.md` để biết thêm chi tiết về:
- Code style guidelines
- Naming conventions
- Error handling patterns
- Key architectural patterns

## License

ISC
