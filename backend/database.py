import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("Falta la variable de entorno DATABASE_URL en backend/.env")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Entrega una sesión de base de datos por petición y la cierra al terminar."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class SpeedTestResult(Base):
    """Historial de pruebas de velocidad (descarga, subida, ping)."""
    __tablename__ = "speedtest_results"

    id = Column(Integer, primary_key=True, index=True)
    mode = Column(String(40), nullable=False, default="standard")
    target_host = Column(String(150), nullable=True)
    ping_ms = Column(Float, nullable=True)
    jitter_ms = Column(Float, nullable=True)
    download_mbps = Column(Float, nullable=False)
    upload_mbps = Column(Float, nullable=False)
    bytes_downloaded = Column(Integer, nullable=True)
    bytes_uploaded = Column(Integer, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )


class LatencyEvent(Base):
    """Registro de eventos de latencia, picos de ping o pérdida de conexión."""
    __tablename__ = "latency_events"

    id = Column(Integer, primary_key=True, index=True)
    target = Column(String(150), nullable=False)
    ping_ms = Column(Float, nullable=True)
    jitter_ms = Column(Float, nullable=True)
    packet_loss_pct = Column(Float, nullable=True)
    threshold_ms = Column(Float, nullable=False, default=100.0)
    event_type = Column(String(50), nullable=False)  # ej. "high_latency", "packet_loss", "recovered"
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )


class MonitorConfig(Base):
    """Configuración y umbrales guardados para FasterUp."""
    __tablename__ = "monitor_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, default="default")
    target = Column(String(150), nullable=False, default="1.1.1.1")
    ping_threshold_ms = Column(Float, nullable=False, default=100.0)
    download_min_mbps = Column(Float, nullable=True)
    upload_min_mbps = Column(Float, nullable=True)
    alerts_enabled = Column(Boolean, nullable=False, default=True)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


def init_db():
    """Crea todas las tablas declaradas en Base si todavía no existen en PostgreSQL."""
    Base.metadata.create_all(bind=engine)