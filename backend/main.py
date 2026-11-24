import asyncio
from contextlib import asynccontextmanager
import os
import time
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import LatencyEvent, MonitorConfig, SpeedTestResult, get_db, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="FasterUp API - NetTelemetry", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TARGETS: dict[str, dict[str, str | int]] = {
    "cloudflare": {"host": "1.1.1.1", "port": 443},
    "google": {"host": "8.8.8.8", "port": 53},
    "aws_sa": {"host": "dynamodb.sa-east-1.amazonaws.com", "port": 443},
    "aws_us": {"host": "dynamodb.us-east-1.amazonaws.com", "port": 443},
}


class PingResponse(BaseModel):
    target_id: str
    host: str
    port: int
    ping_ms: Optional[float]
    packet_loss: float
    online: bool
    timestamp: float


class SpeedTestCreate(BaseModel):
    mode: str = "standard"
    target_host: Optional[str] = None
    ping_ms: Optional[float] = None
    jitter_ms: Optional[float] = None
    download_mbps: float
    upload_mbps: float
    bytes_downloaded: Optional[int] = None
    bytes_uploaded: Optional[int] = None


class LatencyEventCreate(BaseModel):
    target: str
    ping_ms: Optional[float] = None
    jitter_ms: Optional[float] = None
    packet_loss_pct: Optional[float] = None
    threshold_ms: float = 100.0
    event_type: str


class MonitorConfigUpdate(BaseModel):
    name: str = "default"
    target: str = "1.1.1.1"
    ping_threshold_ms: float = 100.0
    download_min_mbps: Optional[float] = None
    upload_min_mbps: Optional[float] = None
    alerts_enabled: bool = True


async def measure_tcp_rtt(host: str, port: int, timeout: float = 1.5) -> Optional[float]:
    """Mide el tiempo de conexión TCP real (en ms) desde la máquina donde corre el backend."""
    start = time.perf_counter()
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        writer.close()
        await writer.wait_closed()
        return round(elapsed_ms, 2)
    except (asyncio.TimeoutError, OSError):
        return None


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nettelemetry-backend"}


@app.get("/api/health/db")
def health_db(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


@app.get("/api/ping", response_model=PingResponse)
async def api_ping(
    target: str = Query(default="cloudflare"),
    host: Optional[str] = Query(default=None),
    port: int = Query(default=443, ge=1, le=65535),
):
    if host and host.strip():
        resolved_host = host.strip()
        resolved_port = port
        target_id = "custom"
    else:
        preset = TARGETS.get(target)
        if not preset:
            raise HTTPException(status_code=400, detail="Destino no soportado")
        resolved_host = str(preset["host"])
        resolved_port = int(preset["port"])
        target_id = target

    rtt = await measure_tcp_rtt(resolved_host, resolved_port)

    return PingResponse(
        target_id=target_id,
        host=resolved_host,
        port=resolved_port,
        ping_ms=rtt,
        packet_loss=0.0 if rtt is not None else 100.0,
        online=rtt is not None,
        timestamp=time.time(),
    )


@app.get("/api/speedtest/download")
async def speedtest_download(
    bytes_size: int = Query(default=25_000_000, ge=100_000, le=100_000_000)
):
    """Envía un flujo de bytes aleatorios para medir transferencia hacia el cliente."""
    chunk_size = 256 * 1024
    remaining = bytes_size
    chunk = os.urandom(chunk_size)

    async def stream_generator():
        nonlocal remaining
        while remaining > 0:
            to_send = min(chunk_size, remaining)
            yield chunk[:to_send]
            remaining -= to_send
            await asyncio.sleep(0)

    return StreamingResponse(
        stream_generator(),
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/speedtest/upload")
async def speedtest_upload(request: Request):
    """Recibe datos enviados por el cliente y calcula el rendimiento de subida."""
    start = time.perf_counter()
    total_bytes = 0

    async for data in request.stream():
        total_bytes += len(data)

    duration = max(time.perf_counter() - start, 0.001)
    mbps = (total_bytes * 8) / (duration * 1_000_000)

    return {
        "bytes_received": total_bytes,
        "duration_seconds": round(duration, 3),
        "upload_mbps": round(mbps, 2),
    }


@app.post("/api/speedtest/results", status_code=201)
def create_speedtest_result(payload: SpeedTestCreate, db: Session = Depends(get_db)):
    row = SpeedTestResult(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "created_at": row.created_at,
        "data": payload.model_dump(),
    }


@app.get("/api/speedtest/results")
def list_speedtest_results(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(SpeedTestResult)
        .order_by(SpeedTestResult.created_at.desc(), SpeedTestResult.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "mode": r.mode,
            "target_host": r.target_host,
            "ping_ms": r.ping_ms,
            "jitter_ms": r.jitter_ms,
            "download_mbps": r.download_mbps,
            "upload_mbps": r.upload_mbps,
            "bytes_downloaded": r.bytes_downloaded,
            "bytes_uploaded": r.bytes_uploaded,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@app.post("/api/latency/events", status_code=201)
def create_latency_event(payload: LatencyEventCreate, db: Session = Depends(get_db)):
    row = LatencyEvent(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "created_at": row.created_at,
        "event_type": row.event_type,
    }


@app.get("/api/latency/events")
def list_latency_events(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(LatencyEvent)
        .order_by(LatencyEvent.created_at.desc(), LatencyEvent.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "target": r.target,
            "ping_ms": r.ping_ms,
            "jitter_ms": r.jitter_ms,
            "packet_loss_pct": r.packet_loss_pct,
            "threshold_ms": r.threshold_ms,
            "event_type": r.event_type,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@app.get("/api/config/{name}")
def get_monitor_config(name: str = "default", db: Session = Depends(get_db)):
    cfg = db.query(MonitorConfig).filter(MonitorConfig.name == name).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Configuración no encontrada")
    return {
        "id": cfg.id,
        "name": cfg.name,
        "target": cfg.target,
        "ping_threshold_ms": cfg.ping_threshold_ms,
        "download_min_mbps": cfg.download_min_mbps,
        "upload_min_mbps": cfg.upload_min_mbps,
        "alerts_enabled": cfg.alerts_enabled,
        "updated_at": cfg.updated_at,
    }


@app.put("/api/config/{name}")
def upsert_monitor_config(
    name: str,
    payload: MonitorConfigUpdate,
    db: Session = Depends(get_db),
):
    cfg = db.query(MonitorConfig).filter(MonitorConfig.name == name).first()
    if cfg:
        cfg.target = payload.target
        cfg.ping_threshold_ms = payload.ping_threshold_ms
        cfg.download_min_mbps = payload.download_min_mbps
        cfg.upload_min_mbps = payload.upload_min_mbps
        cfg.alerts_enabled = payload.alerts_enabled
    else:
        cfg = MonitorConfig(
            name=name,
            target=payload.target,
            ping_threshold_ms=payload.ping_threshold_ms,
            download_min_mbps=payload.download_min_mbps,
            upload_min_mbps=payload.upload_min_mbps,
            alerts_enabled=payload.alerts_enabled,
        )
        db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {
        "id": cfg.id,
        "name": cfg.name,
        "updated_at": cfg.updated_at,
    }