import sys
import json
import random
import time
import uuid
import threading
from datetime import datetime
from OCPP_message import *

# --- CONFIGUARATION ---
UPDATE_INTERVAL = 5.0 

# ---  LOCAL STATE ---
client_state = {
    "is_charging": False,
    "transaction_id": None,
    "connector_id": 1
}

# Khóa để chống xung đột khi in ra console giữa Main Thread và Background Thread
print_lock = threading.Lock()

mock_configuration = {
    'HeartbeatInterval': {'value': '60', 'readonly': False},
    'ConnectionTimeOut': {'value': '1200', 'readonly': False},
    'SupportedFeatureProfiles': {'value': 'Core,RemoteTrigger,Configuration', 'readonly': True},
    'ChargeProfileMaxStackLevel': {'value': '10', 'readonly': True},
    'AllowOfflineTxForUnknownId': {'value': 'false', 'readonly': False}
}

# --- CÁC HÀM HỖ TRỢ ---

def safe_print(message):
    """In message ra stdout một cách an toàn (Thread-safe)"""
    with print_lock:
        print(json.dumps(message))
        sys.stdout.flush()

def utc_timestamp():
    return datetime.utcnow().isoformat() + "Z"

def create_call_message(action, payload):
    """Helper tạo bản tin CALL (Request)"""
    return [2, str(uuid.uuid4()), action, payload]

# --- XỬ LÝ REQUEST TỪ SERVER ---
def handle_request(action, payload, unique_id):
    """
    Xử lý một yêu cầu OCPP và trả về một thông điệp phản hồi hoàn chỉnh.
    """

    response_payload = {}
    extra_messages = [] # Danh sách các tin nhắn gửi kèm theo (Side effects)

    if action == "BootNotification":
        response_payload = boot_notification_response_payload(status="Accepted")
    elif action == "Heartbeat":
        response_payload = heartbeat_response_payload()
    elif action == "Authorize":
        response_payload = authorize_response_payload(status="Accepted")
    elif action == "StatusNotification":
        response_payload = status_notification_response_payload()
    elif action == "StartTransaction":
        # Local Start (ít dùng trong mô hình này, nhưng vẫn hỗ trợ)
        new_tx = random.randint(10000, 99999)
        client_state["transaction_id"] = new_tx
        client_state["is_charging"] = True
        response_payload = start_transaction_response_payload(transaction_id=new_tx)
        
    elif action == "MeterValues":
        response_payload = meter_values_response_payload()
    elif action == "StopTransaction":
        client_state["is_charging"] = False
        client_state["transaction_id"] = None
        response_payload = stop_transaction_response_payload(status="Accepted")
    
    elif action == "DataTransfer":
        response_payload = data_transfer_response_payload(status="Accepted")

    elif action == "ClearCache":
        response_payload = clear_cache_response_payload(status="Accepted")
    
    elif action == "ChangeConfiguration":
        key = payload.get('key')
        value = payload.get('value')
        if key in mock_configuration:
            if not mock_configuration[key]['readonly']:
                mock_configuration[key]['value'] = value
                response_payload = change_configuration_response_payload(status="Accepted")
            else:
                response_payload = change_configuration_response_payload(status="Rejected")
        else:
            response_payload = change_configuration_response_payload(status="NotSupported")

    elif action == "GetConfiguration":
        requested_keys = payload.get('key', [])
        if not requested_keys:
            requested_keys = mock_configuration.keys()
        config_keys = []
        unknown_keys = []
        for k in requested_keys:
            if k in mock_configuration:
                config_keys.append({
                    'key': k,
                    'readonly': mock_configuration[k]['readonly'],
                    'value': mock_configuration[k]['value']
                })
            else:
                unknown_keys.append(k)
        response_payload = get_configuration_response_payload(config_keys, unknown_keys)

    # --- XỬ LÝ REMOTE START (Dashboard ấn Start) ---
    elif action == "RemoteStartTransaction":
        id_tag = payload.get('idTag', 'REMOTE_USER')
        
        #Chờ server phản hồi rồi lưu ID
        client_state["is_charging"] = True 

        # 1. Chấp nhận lệnh
        response_payload = {"status": "Accepted"}
        
        # 2. Giả lập quy trình bắt đầu sạc chuẩn OCPP
        extra_messages.append(create_call_message("StatusNotification", {
            "connectorId": 1, "errorCode": "NoError", "status": "Preparing"
        }))
        extra_messages.append(create_call_message("StartTransaction", {
            "connectorId": 1, "idTag": id_tag, "meterStart": 0, "timestamp": utc_timestamp()
        }))
        extra_messages.append(create_call_message("StatusNotification", {
            "connectorId": 1, "errorCode": "NoError", "status": "Charging"
        }))

    # --- XỬ LÝ REMOTE STOP (Dashboard ấn Stop) ---
    elif action == "RemoteStopTransaction":
        tx_id = payload.get('transactionId')
        
        # Ngắt luồng gửi tin
        client_state["is_charging"] = False
        
        # 1. Chấp nhận lệnh
        response_payload = {"status": "Accepted"}
        
        # 2. Giả lập quy trình dừng sạc
        extra_messages.append(create_call_message("StatusNotification", {
            "connectorId": 1, "errorCode": "NoError", "status": "Finishing"
        }))
        
        # Gửi StopTransaction (Server nhận cái này sẽ chốt số cuối cùng)
        extra_messages.append(create_call_message("StopTransaction", {
            "transactionId": tx_id if tx_id else client_state["transaction_id"], 
            "meterStop": 0, # Gửi 0, Server tự dùng số liệu nội bộ của nó
            "timestamp": utc_timestamp(),
            "reason": "Remote"
        }))
        
        extra_messages.append(create_call_message("StatusNotification", {
            "connectorId": 1, "errorCode": "NoError", "status": "Available"
        }))
        
        client_state["transaction_id"] = None

    else:
        # print(f"[Python] Action không được hỗ trợ: {action}", file=sys.stderr)
        return [4, unique_id, "NotSupported", "Action not supported", {}]

    # Tạo thông điệp phản hồi chính
    response_msg = create_call_result_message(unique_id, response_payload)
    
    # Trả về danh sách: [Response cho Server] + [Các Request mới sinh ra]
    return [response_msg] + extra_messages

def main_loop():
    for line in sys.stdin:
        try:
            msg = json.loads(line)
            message_type_id = msg[0]
            unique_id = msg[1]
            
            # Chỉ xử lý CALL message (Server gọi xuống)
            if message_type_id == 2: 
                action = msg[2]
                payload = msg[3]
                
                messages_to_send = handle_request(action, payload, unique_id)
                
                # Gửi trả lại Server
                for m in messages_to_send:
                    safe_print(m)
                    # Delay nhỏ để server xử lý kịp thứ tự
                    if len(messages_to_send) > 1: 
                        time.sleep(0.1)
                        
            elif message_type_id == 3:
                payload = msg[2]
                
                if "transactionId" in payload:
                    server_tx_id = payload["transactionId"]
                    client_state["transaction_id"] = server_tx_id

        except (json.JSONDecodeError, ValueError):
            pass 
        except Exception as e:
            pass

if __name__ == "__main__":
    # print("[Python] Handler started in Dumb Mode.", file=sys.stderr)
    main_loop()