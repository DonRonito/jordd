#!/usr/bin/env python3
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "jordd-data.json"
STATIC_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
    "/manifest.webmanifest": "manifest.webmanifest",
    "/sw.js": "sw.js",
    "/icons/icon.svg": "icons/icon.svg",
    "/icons/icon-maskable.svg": "icons/icon-maskable.svg",
}

SESSION_COOKIE_NAME = "jordd_session"
SESSION_LIFETIME_DAYS = 30
CLAIM_CODE_TTL_MINUTES = 15
DEFAULT_UPLOAD_INTERVAL_MINUTES = 60
OFFLINE_GRACE_MULTIPLIER = 2
DEMO_USER_EMAIL = "test"
DEMO_USERNAME = "test"
DEMO_PASSWORD = "test"

db_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class SessionContext:
    user: Dict[str, Any]
    session: Dict[str, Any]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def parse_iso_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def build_empty_db() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "users": [],
        "sessions": [],
        "sensors": [],
        "sensor_readings": [],
        "sensor_claim_codes": [],
    }


def load_db() -> Dict[str, Any]:
    if not DATA_PATH.exists():
        return build_empty_db()

    try:
        payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        db = build_empty_db()
        for key in db:
            db[key] = list(payload.get(key, []))
        return db
    except (OSError, ValueError, json.JSONDecodeError):
        return build_empty_db()


db: Dict[str, Any] = load_db()


def save_db() -> None:
    DATA_PATH.write_text(json.dumps(db, indent=2) + "\n", encoding="utf-8")


def generate_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def issue_random_token(length: int = 24) -> str:
    return secrets.token_urlsafe(length)


def hash_password(password: str, salt_hex: Optional[str] = None) -> Dict[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return {"salt": salt.hex(), "hash": digest.hex()}


def verify_password(password: str, password_hash: str, salt_hex: str) -> bool:
    expected = hash_password(password, salt_hex)["hash"]
    return hmac.compare_digest(expected, password_hash)


def require_string(payload: Dict[str, Any], field: str, label: str) -> str:
    value = str(payload.get(field, "")).strip()
    if not value:
        raise ApiError(f"{label} mangler.", HTTPStatus.BAD_REQUEST)
    return value


def find_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    lower_email = email.lower()
    return next((user for user in db["users"] if user["email"].lower() == lower_email), None)


def find_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    lower_username = username.lower()
    return next((user for user in db["users"] if str(user.get("username", "")).lower() == lower_username), None)


def find_user_by_login(identifier: str) -> Optional[Dict[str, Any]]:
    return find_user_by_email(identifier) or find_user_by_username(identifier)


def find_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    return next((user for user in db["users"] if user["id"] == user_id), None)


def find_sensor_by_id(sensor_id: str) -> Optional[Dict[str, Any]]:
    return next((sensor for sensor in db["sensors"] if sensor["id"] == sensor_id), None)


def find_sensor_by_device_uid(device_uid: str) -> Optional[Dict[str, Any]]:
    return next((sensor for sensor in db["sensors"] if sensor["device_uid"] == device_uid), None)


def find_sensor_by_device_token(device_token: str) -> Optional[Dict[str, Any]]:
    return next((sensor for sensor in db["sensors"] if sensor["device_token"] == device_token), None)


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "username": user.get("username", ""),
        "displayName": user["display_name"],
        "createdAt": user["created_at"],
    }


def create_session(user_id: str) -> Dict[str, Any]:
    session = {
        "id": generate_id("ses"),
        "token": issue_random_token(),
        "user_id": user_id,
        "created_at": utc_now_iso(),
        "expires_at": (utc_now() + timedelta(days=SESSION_LIFETIME_DAYS)).isoformat(),
    }
    db["sessions"].append(session)
    return session


def prune_expired_sessions() -> None:
    now = utc_now()
    db["sessions"] = [
        session
        for session in db["sessions"]
        if (parse_iso_datetime(session.get("expires_at", "")) or now) > now
    ]


def active_claim_code_for_user(user_id: str) -> Optional[Dict[str, Any]]:
    now = utc_now()
    valid_codes = [
        claim_code
        for claim_code in db["sensor_claim_codes"]
        if claim_code["user_id"] == user_id
        and not claim_code.get("used_at")
        and (parse_iso_datetime(claim_code["expires_at"]) or now) > now
    ]
    if not valid_codes:
        return None
    valid_codes.sort(key=lambda item: item["created_at"], reverse=True)
    return valid_codes[0]


def latest_reading_for_sensor(sensor_id: str) -> Optional[Dict[str, Any]]:
    readings = [reading for reading in db["sensor_readings"] if reading["sensor_id"] == sensor_id]
    if not readings:
        return None
    readings.sort(key=lambda item: item["captured_at"], reverse=True)
    return readings[0]


def reading_payload(reading: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not reading:
        return None
    return {
        "temperatureC": reading.get("temperature_c"),
        "humidityPct": reading.get("humidity_pct"),
        "batteryMv": reading.get("battery_mv"),
        "batteryPct": reading.get("battery_pct"),
        "capturedAt": reading.get("captured_at"),
        "receivedAt": reading.get("received_at"),
    }


def build_sensor_card(sensor: Dict[str, Any]) -> Dict[str, Any]:
    latest = latest_reading_for_sensor(sensor["id"])
    last_seen = parse_iso_datetime(sensor.get("last_seen_at", ""))
    upload_interval_minutes = int(sensor.get("upload_interval_minutes") or DEFAULT_UPLOAD_INTERVAL_MINUTES)
    offline_threshold = timedelta(minutes=upload_interval_minutes * OFFLINE_GRACE_MULTIPLIER)
    is_online = bool(last_seen and utc_now() - last_seen <= offline_threshold)
    return {
        "id": sensor["id"],
        "name": sensor["name"],
        "deviceUid": sensor["device_uid"],
        "firmwareVersion": sensor.get("firmware_version", ""),
        "capabilities": sensor.get("capabilities", []),
        "uploadIntervalMinutes": upload_interval_minutes,
        "createdAt": sensor.get("created_at"),
        "claimedAt": sensor.get("claimed_at"),
        "lastSeenAt": sensor.get("last_seen_at"),
        "online": is_online,
        "latestReading": reading_payload(latest),
    }


def session_from_request(handler: "JorddHandler") -> Optional[SessionContext]:
    cookie_header = handler.headers.get("Cookie", "")
    cookie = SimpleCookie()
    cookie.load(cookie_header)
    morsel = cookie.get(SESSION_COOKIE_NAME)
    if not morsel:
        return None

    token = morsel.value
    prune_expired_sessions()
    session = next((item for item in db["sessions"] if item["token"] == token), None)
    if not session:
        return None

    user = find_user_by_id(session["user_id"])
    if not user:
        return None

    return SessionContext(user=user, session=session)


def require_session(handler: "JorddHandler") -> SessionContext:
    session = session_from_request(handler)
    if not session:
        raise ApiError("Du må logge inn for å fortsette.", HTTPStatus.UNAUTHORIZED)
    return session


def parse_numeric(value: Any, field_name: str) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ApiError(f"{field_name} må være et tall.", HTTPStatus.BAD_REQUEST) from error


def parse_authorization_bearer(header: str) -> str:
    if not header or not header.lower().startswith("bearer "):
        raise ApiError("Mangler gyldig device-token.", HTTPStatus.UNAUTHORIZED)
    return header.split(" ", 1)[1].strip()


def ensure_demo_data() -> None:
    demo_user = find_user_by_username(DEMO_USERNAME) or find_user_by_email(DEMO_USER_EMAIL)
    if not demo_user:
        password_blob = hash_password(DEMO_PASSWORD)
        demo_user = {
            "id": "usr_demo_test",
            "email": DEMO_USER_EMAIL,
            "username": DEMO_USERNAME,
            "display_name": "Testkonto",
            "password_hash": password_blob["hash"],
            "password_salt": password_blob["salt"],
            "created_at": (utc_now() - timedelta(days=14)).isoformat(),
        }
        db["users"].append(demo_user)
    else:
        demo_user["username"] = DEMO_USERNAME

    seed_sensors = [
        {
            "id": "sen_demo_living",
            "user_id": demo_user["id"],
            "device_uid": "ESP32-DEMO-LIVING",
            "name": "Stue",
            "firmware_version": "jordd-factory-0.1.0",
            "capabilities": ["temperature", "humidity", "battery"],
            "upload_interval_minutes": 60,
            "created_at": (utc_now() - timedelta(days=10)).isoformat(),
            "claimed_at": (utc_now() - timedelta(days=10)).isoformat(),
            "device_token": "demo-token-living",
            "last_seen_at": (utc_now() - timedelta(minutes=18)).isoformat(),
        },
        {
            "id": "sen_demo_bedroom",
            "user_id": demo_user["id"],
            "device_uid": "ESP32-DEMO-BEDROOM",
            "name": "Soverom",
            "firmware_version": "jordd-factory-0.1.0",
            "capabilities": ["temperature", "humidity", "battery"],
            "upload_interval_minutes": 60,
            "created_at": (utc_now() - timedelta(days=8)).isoformat(),
            "claimed_at": (utc_now() - timedelta(days=8)).isoformat(),
            "device_token": "demo-token-bedroom",
            "last_seen_at": (utc_now() - timedelta(minutes=71)).isoformat(),
        },
        {
            "id": "sen_demo_greenhouse",
            "user_id": demo_user["id"],
            "device_uid": "ESP32-DEMO-GREENHOUSE",
            "name": "Drivhus",
            "firmware_version": "jordd-factory-0.1.0",
            "capabilities": ["temperature", "humidity", "battery"],
            "upload_interval_minutes": 60,
            "created_at": (utc_now() - timedelta(days=5)).isoformat(),
            "claimed_at": (utc_now() - timedelta(days=5)).isoformat(),
            "device_token": "demo-token-greenhouse",
            "last_seen_at": (utc_now() - timedelta(hours=5)).isoformat(),
        },
    ]

    for seed_sensor in seed_sensors:
        existing_sensor = find_sensor_by_id(seed_sensor["id"])
        if existing_sensor:
            existing_sensor.update(seed_sensor)
        else:
            db["sensors"].append(seed_sensor)

    seed_readings = [
        {
            "id": "rdg_demo_living_latest",
            "sensor_id": "sen_demo_living",
            "temperature_c": 22.4,
            "humidity_pct": 45.0,
            "battery_mv": 4010,
            "battery_pct": 92,
            "captured_at": (utc_now() - timedelta(minutes=19)).isoformat(),
            "received_at": (utc_now() - timedelta(minutes=18)).isoformat(),
        },
        {
            "id": "rdg_demo_bedroom_latest",
            "sensor_id": "sen_demo_bedroom",
            "temperature_c": 19.6,
            "humidity_pct": 51.0,
            "battery_mv": 3880,
            "battery_pct": 74,
            "captured_at": (utc_now() - timedelta(minutes=74)).isoformat(),
            "received_at": (utc_now() - timedelta(minutes=71)).isoformat(),
        },
        {
            "id": "rdg_demo_greenhouse_latest",
            "sensor_id": "sen_demo_greenhouse",
            "temperature_c": 17.1,
            "humidity_pct": 68.0,
            "battery_mv": 3560,
            "battery_pct": 33,
            "captured_at": (utc_now() - timedelta(hours=5, minutes=3)).isoformat(),
            "received_at": (utc_now() - timedelta(hours=5)).isoformat(),
        },
    ]

    for seed_reading in seed_readings:
        existing_reading = next((reading for reading in db["sensor_readings"] if reading["id"] == seed_reading["id"]), None)
        if existing_reading:
            existing_reading.update(seed_reading)
        else:
            db["sensor_readings"].append(seed_reading)


class JorddHandler(BaseHTTPRequestHandler):
    server_version = "JorddCloudDev/0.3"

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("GET", parsed.path)
            return
        self.serve_static(parsed.path)

    def do_HEAD(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        self.serve_static(parsed.path, head_only=True)

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("POST", parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api("PATCH", parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_api(self, method: str, path: str) -> None:
        payload = {}
        if method in {"POST", "PATCH"}:
            payload = self.read_json_body()

        try:
            with db_lock:
                response, status, headers = self.dispatch_api(method, path, payload)
                save_db()
            self.send_json(response, status=status, extra_headers=headers)
        except ApiError as error:
            self.send_json({"error": str(error)}, status=error.status)
        except Exception as error:  # noqa: BLE001
            self.send_json({"error": f"Uventet feil: {error}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def dispatch_api(self, method: str, path: str, payload: Dict[str, Any]) -> tuple[Dict[str, Any], HTTPStatus, Dict[str, str]]:
        if method == "GET" and path == "/api/auth/session":
            session = session_from_request(self)
            return (
                {"authenticated": bool(session), "user": public_user(session.user) if session else None},
                HTTPStatus.OK,
                {},
            )

        if method == "POST" and path == "/api/auth/register":
            email = require_string(payload, "email", "E-post").lower()
            password = require_string(payload, "password", "Passord")
            display_name = require_string(payload, "displayName", "Navn")

            if "@" not in email:
                raise ApiError("E-postadressen ser ugyldig ut.", HTTPStatus.BAD_REQUEST)
            if len(password) < 8:
                raise ApiError("Passord må være minst 8 tegn.", HTTPStatus.BAD_REQUEST)
            if find_user_by_login(email):
                raise ApiError("Det finnes allerede en konto med denne e-posten.", HTTPStatus.CONFLICT)

            password_blob = hash_password(password)
            user = {
                "id": generate_id("usr"),
                "email": email,
                "username": "",
                "display_name": display_name,
                "password_hash": password_blob["hash"],
                "password_salt": password_blob["salt"],
                "created_at": utc_now_iso(),
            }
            db["users"].append(user)
            session = create_session(user["id"])
            return (
                {"authenticated": True, "user": public_user(user)},
                HTTPStatus.CREATED,
                {"Set-Cookie": session_cookie_header(session["token"], expires_at=session["expires_at"])},
            )

        if method == "POST" and path == "/api/auth/login":
            email = require_string(payload, "email", "E-post eller brukernavn").lower()
            password = require_string(payload, "password", "Passord")
            user = find_user_by_login(email)
            if not user or not verify_password(password, user["password_hash"], user["password_salt"]):
                raise ApiError("Feil e-post eller passord.", HTTPStatus.UNAUTHORIZED)
            session = create_session(user["id"])
            return (
                {"authenticated": True, "user": public_user(user)},
                HTTPStatus.OK,
                {"Set-Cookie": session_cookie_header(session["token"], expires_at=session["expires_at"])},
            )

        if method == "POST" and path == "/api/auth/logout":
            session = session_from_request(self)
            if session:
                db["sessions"] = [item for item in db["sessions"] if item["id"] != session.session["id"]]
            return ({"ok": True}, HTTPStatus.OK, {"Set-Cookie": clear_session_cookie_header()})

        if method == "POST" and path == "/api/auth/change-password":
            session = require_session(self)
            current_password = require_string(payload, "currentPassword", "Nåværende passord")
            new_password = require_string(payload, "newPassword", "Nytt passord")
            if len(new_password) < 8:
                raise ApiError("Nytt passord må være minst 8 tegn.", HTTPStatus.BAD_REQUEST)
            if not verify_password(current_password, session.user["password_hash"], session.user["password_salt"]):
                raise ApiError("Nåværende passord er feil.", HTTPStatus.UNAUTHORIZED)
            updated = hash_password(new_password)
            session.user["password_hash"] = updated["hash"]
            session.user["password_salt"] = updated["salt"]
            return ({"ok": True}, HTTPStatus.OK, {})

        if method == "GET" and path == "/api/app/account":
            session = require_session(self)
            sensor_count = len([sensor for sensor in db["sensors"] if sensor["user_id"] == session.user["id"]])
            return (
                {
                    "user": public_user(session.user),
                    "stats": {"sensorCount": sensor_count},
                },
                HTTPStatus.OK,
                {},
            )

        if method == "PATCH" and path == "/api/app/account":
            session = require_session(self)
            email = require_string(payload, "email", "E-post").lower()
            display_name = require_string(payload, "displayName", "Navn")
            existing = find_user_by_login(email)
            if existing and existing["id"] != session.user["id"]:
                raise ApiError("Denne e-posten er allerede i bruk.", HTTPStatus.CONFLICT)
            session.user["email"] = email
            session.user["display_name"] = display_name
            return ({"user": public_user(session.user)}, HTTPStatus.OK, {})

        if method == "GET" and path == "/api/app/dashboard":
            session = require_session(self)
            user_sensors = [sensor for sensor in db["sensors"] if sensor["user_id"] == session.user["id"]]
            user_sensors.sort(key=lambda item: item["created_at"], reverse=True)
            return (
                {
                    "user": public_user(session.user),
                    "activeClaimCode": serialize_claim_code(active_claim_code_for_user(session.user["id"])),
                    "items": [build_sensor_card(sensor) for sensor in user_sensors],
                },
                HTTPStatus.OK,
                {},
            )

        if method == "POST" and path == "/api/app/claim-codes":
            session = require_session(self)
            code = generate_claim_code()
            claim_code = {
                "id": generate_id("clm"),
                "code": code,
                "user_id": session.user["id"],
                "created_at": utc_now_iso(),
                "expires_at": (utc_now() + timedelta(minutes=CLAIM_CODE_TTL_MINUTES)).isoformat(),
                "used_at": None,
                "claimed_sensor_id": None,
            }
            db["sensor_claim_codes"].append(claim_code)
            return ({"claimCode": serialize_claim_code(claim_code)}, HTTPStatus.CREATED, {})

        if method == "POST" and path == "/api/device/claim":
            claim_code_value = require_string(payload, "claim_code", "Claim code").upper()
            device_uid = require_string(payload, "device_uid", "Device UID")
            firmware_version = require_string(payload, "firmware_version", "Firmware version")
            capabilities = payload.get("capabilities") or []

            claim_code = next((item for item in db["sensor_claim_codes"] if item["code"] == claim_code_value), None)
            if not claim_code:
                raise ApiError("Claim code ble ikke funnet.", HTTPStatus.NOT_FOUND)
            if claim_code.get("used_at"):
                raise ApiError("Claim code er allerede brukt.", HTTPStatus.CONFLICT)
            expires_at = parse_iso_datetime(claim_code["expires_at"])
            if not expires_at or expires_at <= utc_now():
                raise ApiError("Claim code har utløpt.", HTTPStatus.GONE)

            existing_sensor = find_sensor_by_device_uid(device_uid)
            if existing_sensor and existing_sensor.get("device_token"):
                raise ApiError("Denne sensoren er allerede claimed.", HTTPStatus.CONFLICT)

            sensor_id = generate_id("sen")
            sensor = existing_sensor or {
                "id": sensor_id,
                "user_id": claim_code["user_id"],
                "device_uid": device_uid,
                "name": f"Jordd Sensor {device_uid[-4:]}",
                "firmware_version": firmware_version,
                "capabilities": capabilities if isinstance(capabilities, list) else [],
                "upload_interval_minutes": DEFAULT_UPLOAD_INTERVAL_MINUTES,
                "created_at": utc_now_iso(),
                "claimed_at": utc_now_iso(),
                "device_token": issue_random_token(),
                "last_seen_at": None,
            }

            if existing_sensor:
                existing_sensor.update(
                    {
                        "user_id": claim_code["user_id"],
                        "firmware_version": firmware_version,
                        "capabilities": capabilities if isinstance(capabilities, list) else [],
                        "claimed_at": utc_now_iso(),
                        "device_token": issue_random_token(),
                    }
                )
                sensor = existing_sensor
            else:
                db["sensors"].append(sensor)

            claim_code["used_at"] = utc_now_iso()
            claim_code["claimed_sensor_id"] = sensor["id"]

            return (
                {
                    "sensor_id": sensor["id"],
                    "device_token": sensor["device_token"],
                    "upload_interval_minutes": sensor["upload_interval_minutes"],
                },
                HTTPStatus.OK,
                {},
            )

        if method == "POST" and path == "/api/device/readings":
            device_token = parse_authorization_bearer(self.headers.get("Authorization", ""))
            sensor = find_sensor_by_device_token(device_token)
            if not sensor:
                raise ApiError("Device-token er ugyldig.", HTTPStatus.UNAUTHORIZED)

            sensor_id = require_string(payload, "sensor_id", "Sensor ID")
            if sensor["id"] != sensor_id:
                raise ApiError("Sensor ID matcher ikke token.", HTTPStatus.FORBIDDEN)

            captured_at = str(payload.get("captured_at") or utc_now_iso()).strip()
            reading = {
                "id": generate_id("rdg"),
                "sensor_id": sensor_id,
                "temperature_c": parse_numeric(payload.get("temperature_c"), "temperature_c"),
                "humidity_pct": parse_numeric(payload.get("humidity_pct"), "humidity_pct"),
                "battery_mv": parse_numeric(payload.get("battery_mv"), "battery_mv"),
                "battery_pct": parse_numeric(payload.get("battery_pct"), "battery_pct"),
                "captured_at": captured_at,
                "received_at": utc_now_iso(),
            }
            db["sensor_readings"].append(reading)
            sensor["last_seen_at"] = reading["received_at"]
            sensor["firmware_version"] = str(payload.get("firmware_version") or sensor.get("firmware_version", ""))

            return (
                {
                    "ok": True,
                    "next_upload_interval_minutes": int(sensor.get("upload_interval_minutes") or DEFAULT_UPLOAD_INTERVAL_MINUTES),
                    "config_version": 1,
                },
                HTTPStatus.OK,
                {},
            )

        raise ApiError("Fant ikke endpoint.", HTTPStatus.NOT_FOUND)

    def read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ApiError(f"Ugyldig JSON: {error}", HTTPStatus.BAD_REQUEST) from error

    def serve_static(self, path: str, head_only: bool = False) -> None:
        file_name = STATIC_FILES.get(path, "index.html")
        file_path = (BASE_DIR / file_name).resolve()
        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if BASE_DIR.resolve() not in file_path.parents and file_path != BASE_DIR.resolve():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if file_path.name in {"index.html", "app.js", "styles.css", "manifest.webmanifest", "sw.js"}:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def send_json(
        self,
        payload: Dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}")


def generate_claim_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not any(item["code"] == code for item in db["sensor_claim_codes"]):
            return code


def serialize_claim_code(claim_code: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not claim_code:
        return None
    return {
        "code": claim_code["code"],
        "expiresAt": claim_code["expires_at"],
        "usedAt": claim_code.get("used_at"),
        "claimedSensorId": claim_code.get("claimed_sensor_id"),
    }


def format_cookie_expiry(value: str) -> str:
    expires_at = parse_iso_datetime(value)
    if not expires_at:
        expires_at = utc_now() + timedelta(days=SESSION_LIFETIME_DAYS)
    return expires_at.strftime("%a, %d %b %Y %H:%M:%S GMT")


def session_cookie_header(token: str, expires_at: str) -> str:
    return (
        f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; "
        f"Expires={format_cookie_expiry(expires_at)}"
    )


def clear_session_cookie_header() -> str:
    return f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT"


def main() -> None:
    with db_lock:
        ensure_demo_data()
        save_db()
    port = int(os.environ.get("PORT", "8090"))
    server = ThreadingHTTPServer(("0.0.0.0", port), JorddHandler)
    print(f"Jordd cloud dev server kjører på http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
