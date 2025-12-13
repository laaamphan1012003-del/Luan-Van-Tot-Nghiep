import json
import uuid
from datetime import datetime

def utc_timestamp():
    """
    Trả về chuỗi thời gian UTC theo định dạng ISO 8601, kết thúc bằng 'Z'.
    """
    return datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'

def create_call_result_message(unique_id, payload):
    """
    Tạo một thông điệp PHẢN HỒI (CALLRESULT) từ CSMS.
    """
    return [3, unique_id, payload]

# --- RESPONSE PAYLOAD ---

def boot_notification_response_payload(status="Accepted", interval=200):
    """Tạo payload phản hồi cho BootNotification.conf."""
    return {
        "status": status,
        "currentTime": utc_timestamp(),
        "interval": interval
    }

def heartbeat_response_payload():
    """Tạo payload phản hồi cho Heartbeat.conf."""
    return {"currentTime": utc_timestamp()}

def authorize_response_payload(status="Accepted"):
    """
    Tạo payload phản hồi cho Authorize.conf.
    """
    return {"idTagInfo": {"status": status}}

def start_transaction_response_payload(transaction_id, status="Accepted"):
    """Tạo payload phản hồi cho StartTransaction.conf."""
    return {
        "transactionId": transaction_id,
        "idTagInfo": {"status": status}
    }

def stop_transaction_response_payload(status="Accepted"):
    """Tạo payload phản hồi cho StopTransaction.conf."""
    return {"idTagInfo": {"status": status}}

def status_notification_response_payload():
    """Tạo payload phản hồi cho StatusNotification.conf."""
    return {} 

def meter_values_response_payload():
    """Tạo payload phản hồi cho MeterValues.conf."""
    return {} 

def data_transfer_response_payload(status="Accepted"):
    """Tạo payload phản hồi cho DataTransfer.conf."""
    return {"status": status}

def clear_cache_response_payload(status="Accepted"):
    """Tạo payload phản hồi cho ClearCache.conf."""
    return {"status": status}

def change_configuration_response_payload(status="Accepted"):
    return {"status": status}

def get_configuration_response_payload(configuration_key=None, unknown_key=None):
    response = {}
    if configuration_key is not None:
        response["configurationKey"] = configuration_key
    if unknown_key is not None:
        response["unknownKey"] = unknown_key
    return response
