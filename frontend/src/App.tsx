import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  Gauge,
  Play,
  Square,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowDownCircle,
  ArrowUpCircle,
  Zap,
  Server,
  ShieldAlert,
  RefreshCw,
  Sliders,
  Radio,
  RotateCcw,
  BarChart2,
  TrendingUp,
} from 'lucide-react';

// ============================================================================
// CONFIGURACIÓN DE DESTINOS Y TIPOS
// ============================================================================
interface PingTarget {
  id: string;
  name: string;
  host: string;
  httpUrl: string;
  basePing: number;
}

interface PingSample {
  id: number;
  timeLabel: string;
  ping: number | null;
  jitter: number;
  lost: boolean;
}

interface AlertEntry {
  id: number;
  time: string;
  message: string;
  severity: 'warning' | 'critical';
}

interface SpeedPoint {
  speed: number;
}

interface SpeedHistoryItem {
  id: number;
  time: string;
  mode: string;
  download: number;
  upload: number;
  ping: number;
  grade: 'Excelente' | 'Bueno' | 'Regular';
}

type ConnectionMode = 'simulado' | 'http_real' | 'backend_local';
type ActiveTab = 'latency' | 'speed';
type SpeedPhase = 'idle' | 'ping' | 'download' | 'upload' | 'complete';

const PING_TARGETS: PingTarget[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare Edge (1.1.1.1)',
    host: '1.1.1.1',
    httpUrl: 'https://1.1.1.1/cdn-cgi/trace',
    basePing: 22,
  },
  {
    id: 'google',
    name: 'Google Network (8.8.8.8)',
    host: '8.8.8.8',
    httpUrl: 'https://www.google.com/generate_204',
    basePing: 28,
  },
  {
    id: 'aws_sa',
    name: 'AWS Sudamérica (sa-east-1)',
    host: 'sa-east-1.amazonaws.com',
    httpUrl: 'https://dynamodb.sa-east-1.amazonaws.com/',
    basePing: 46,
  },
  {
    id: 'aws_us',
    name: 'AWS Norteamérica (us-east-1)',
    host: 'us-east-1.amazonaws.com',
    httpUrl: 'https://dynamodb.us-east-1.amazonaws.com/',
    basePing: 64,
  },
];

const BACKEND_BASE_URL = 'http://localhost:8000';

// ============================================================================
// COMPONENTES AUXILIARES DE INTERFAZ Y GRÁFICAS
// ============================================================================
function StatusBadge({ avgPing, lossPct }: { avgPing: number; lossPct: number }) {
  let label = 'Excelente';
  let classes = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  let Icon = CheckCircle2;

  if (lossPct >= 15 || avgPing >= 130) {
    label = 'Crítico';
    classes = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    Icon = ShieldAlert;
  } else if (lossPct > 0 || avgPing >= 85) {
    label = 'Inestable';
    classes = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    Icon = AlertTriangle;
  } else if (avgPing >= 45) {
    label = 'Estable';
    classes = 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    Icon = Activity;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${classes}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {label}
    </span>
  );
}

function MetricCard({
  title,
  value,
  unit,
  subtext,
  accentClass,
  icon: Icon,
}: {
  title: string;
  value: string;
  unit?: string;
  subtext: string;
  accentClass: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {title}
        </span>
        <Icon className={`w-4 h-4 shrink-0 ${accentClass}`} />
      </div>
      <div className="flex items-baseline gap-1.5 my-1">
        <span className={`text-2xl sm:text-3xl font-bold tabular-nums ${accentClass}`}>
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
      </div>
      <p className="text-xs text-slate-400 mt-1 truncate">{subtext}</p>
    </div>
  );
}

function LatencyChart({
  samples,
  thresholdMs,
}: {
  samples: PingSample[];
  thresholdMs: number;
}) {
  const width = 640;
  const height = 210;
  const padX = 12;
  const padTop = 16;
  const padBottom = 24;
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;

  const maxMs = useMemo(() => {
    const validPings = samples
      .map((s) => s.ping)
      .filter((p): p is number => p !== null);
    const highest = Math.max(thresholdMs + 30, 120, ...validPings);
    return Math.ceil(highest / 20) * 20;
  }, [samples, thresholdMs]);

  const toY = (ms: number) => {
    const clamped = Math.max(0, Math.min(ms, maxMs));
    return padTop + chartH - (clamped / maxMs) * chartH;
  };

  const linePoints = useMemo(() => {
    if (samples.length === 0) return '';
    return samples
      .map((s, index) => {
        const x =
          samples.length === 1
            ? padX + chartW / 2
            : padX + (index / (samples.length - 1)) * chartW;
        const y = toY(s.ping ?? maxMs);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [samples, chartW, maxMs]);

  const thresholdY = toY(thresholdMs);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            Historial de Latencia en Tiempo Real
          </h3>
          <p className="text-xs text-slate-400">
            Umbral de alerta configurado: {thresholdMs} ms · Escala máxima: {maxMs} ms
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
            Ping (ms)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-rose-500 inline-block" />
            Límite ({thresholdMs} ms)
          </span>
        </div>
      </div>

      {samples.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
          Inicia el monitoreo para graficar el comportamiento de tu conexión.
        </div>
      ) : (
        <div className="w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-48 sm:h-52 select-none"
            role="img"
            aria-label="Gráfica de latencia en milisegundos"
          >
            {[0.25, 0.5, 0.75, 1].map((ratio) => {
              const gy = padTop + chartH * (1 - ratio);
              const val = Math.round(maxMs * ratio);
              return (
                <g key={ratio}>
                  <line
                    x1={padX}
                    y1={gy}
                    x2={width - padX}
                    y2={gy}
                    stroke="#1e293b"
                    strokeWidth="1"
                  />
                  <text
                    x={padX + 2}
                    y={gy - 4}
                    fill="#64748b"
                    fontSize="10"
                  >
                    {val} ms
                  </text>
                </g>
              );
            })}

            <line
              x1={padX}
              y1={thresholdY}
              x2={width - padX}
              y2={thresholdY}
              stroke="#f43f5e"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />

            {samples.length > 1 && (
              <polyline
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={linePoints}
              />
            )}

            {samples.map((s, index) => {
              const x =
                samples.length === 1
                  ? padX + chartW / 2
                  : padX + (index / (samples.length - 1)) * chartW;
              const y = toY(s.ping ?? maxMs);
              const isHigh = s.lost || (s.ping !== null && s.ping > thresholdMs);

              return (
                <circle
                  key={s.id}
                  cx={x}
                  cy={y}
                  r={s.lost ? 4 : 3}
                  fill={s.lost ? '#ef4444' : isHigh ? '#fbbf24' : '#22d3ee'}
                />
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

function SpeedGauge({
  value,
  progress,
  phase,
  metricLabel,
}: {
  value: number;
  progress: number;
  phase: SpeedPhase;
  metricLabel: string;
}) {
  const safeProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col items-center justify-center text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-2">
        {metricLabel}
      </span>
      <div className="text-4xl sm:text-5xl font-extrabold tabular-nums text-white my-1">
        {value.toFixed(1)}
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
        Mbps
      </span>

      {phase !== 'idle' && phase !== 'complete' && (
        <div className="w-full max-w-xs bg-slate-800 h-2 rounded-full overflow-hidden">
          <div
            className="bg-cyan-400 h-full transition-all duration-200"
            style={{ width: `${safeProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SpeedGraph({ points }: { points: SpeedPoint[] }) {
  const width = 500;
  const height = 160;
  const maxSpeed = 200;

  if (!points || points.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-center text-slate-500 text-xs italic border border-dashed border-slate-800 rounded-lg px-4">
        Presiona &ldquo;Iniciar Prueba&rdquo; para visualizar la curva de ancho de banda.
      </div>
    );
  }

  const svgPoints = points
    .map((p, idx) => {
      const x =
        points.length === 1
          ? width / 2
          : (idx / (points.length - 1)) * width;
      const y = height - (Math.min(maxSpeed, Math.max(0, p.speed)) / maxSpeed) * (height - 28);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-40 select-none"
      role="img"
      aria-label="Curva de velocidad en Mbps"
    >
      <line
        x1="0"
        y1={height - 20}
        x2={width}
        y2={height - 20}
        stroke="#1e293b"
        strokeWidth="1"
      />
      {points.length > 1 && (
        <polyline
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={svgPoints}
        />
      )}
    </svg>
  );
}

// ============================================================================
// APLICACIÓN PRINCIPAL: FASTERUP
// ============================================================================
export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('latency');
  const [mode, setMode] = useState<ConnectionMode>('simulado');
  const [selectedTargetId, setSelectedTargetId] = useState<string>(PING_TARGETS[0].id);
  const [thresholdMs, setThresholdMs] = useState<number>(100);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);

  const [samples, setSamples] = useState<PingSample[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);

  // Estado de prueba de velocidad
  const [speedPhase, setSpeedPhase] = useState<SpeedPhase>('idle');
  const [speedProgress, setSpeedProgress] = useState<number>(0);
  const [currentSpeedMbps, setCurrentSpeedMbps] = useState<number>(0);
  const [downloadMbps, setDownloadMbps] = useState<number>(0);
  const [uploadMbps, setUploadMbps] = useState<number>(0);
  const [testPingMs, setTestPingMs] = useState<number>(0);
  const [speedPoints, setSpeedPoints] = useState<SpeedPoint[]>([]);
  const [speedHistory, setSpeedHistory] = useState<SpeedHistoryItem[]>([]);

  const simPingRef = useRef<number>(PING_TARGETS[0].basePing);
  const sampleCounterRef = useRef<number>(1);
  const speedAbortRef = useRef<boolean>(false);

  const selectedTarget = useMemo(
    () => PING_TARGETS.find((t) => t.id === selectedTargetId) ?? PING_TARGETS[0],
    [selectedTargetId]
  );

  useEffect(() => {
    simPingRef.current = selectedTarget.basePing;
  }, [selectedTarget]);

  const registerAlert = (message: string, severity: 'warning' | 'critical') => {
    const nowTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setAlerts((prev) => [
      { id: Date.now() + Math.random(), time: nowTime, message, severity },
      ...prev.slice(0, 14),
    ]);
  };

  const probeLatency = async (): Promise<{ ping: number | null; lost: boolean }> => {
    if (mode === 'simulado') {
      const spikeRoll = Math.random();
      if (spikeRoll < 0.03) {
        return { ping: null, lost: true };
      }
      const delta =
        spikeRoll < 0.14
          ? (Math.random() - 0.25) * 75
          : (Math.random() - 0.5) * 10;
      const nextPing = Math.max(
        6,
        Math.round((simPingRef.current * 0.75 + (selectedTarget.basePing + delta) * 0.25) * 10) / 10
      );
      simPingRef.current = nextPing;
      return { ping: nextPing, lost: false };
    }

    if (mode === 'backend_local') {
      try {
        const res = await fetch(
          `${BACKEND_BASE_URL}/api/ping?target=${encodeURIComponent(selectedTarget.id)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return { ping: null, lost: true };
        const data = await res.json();
        if (typeof data.ping_ms === 'number' && data.online) {
          return { ping: data.ping_ms, lost: false };
        }
        return { ping: null, lost: true };
      } catch {
        return { ping: null, lost: true };
      }
    }

    // Modo HTTP directo desde el navegador
    const start = performance.now();
    try {
      await fetch(`${selectedTarget.httpUrl}?t=${Date.now()}`, {
        mode: 'no-cors',
        cache: 'no-store',
      });
      const rtt = Math.round((performance.now() - start) * 10) / 10;
      return { ping: rtt, lost: false };
    } catch {
      return { ping: null, lost: true };
    }
  };

  useEffect(() => {
    if (!isMonitoring) return;

    let cancelled = false;

    const tick = async () => {
      const result = await probeLatency();
      if (cancelled) return;

      setSamples((prev) => {
        const prevValid = [...prev]
          .reverse()
          .find((item) => item.ping !== null)?.ping;

        const jitter =
          result.ping !== null && prevValid !== undefined && prevValid !== null
            ? Math.round(Math.abs(result.ping - prevValid) * 10) / 10
            : 0;

        const timeLabel = new Date().toLocaleTimeString([], {
          minute: '2-digit',
          second: '2-digit',
        });

        const nextSample: PingSample = {
          id: sampleCounterRef.current++,
          timeLabel,
          ping: result.ping,
          jitter,
          lost: result.lost,
        };

        if (result.lost) {
          registerAlert(`Paquete perdido hacia ${selectedTarget.name}`, 'critical');
        } else if (result.ping !== null && result.ping > thresholdMs) {
          registerAlert(
            `Latencia alta (${result.ping} ms > ${thresholdMs} ms) en ${selectedTarget.host}`,
            'warning'
          );
        }

        return [...prev.slice(-39), nextSample];
      });
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isMonitoring, mode, selectedTarget, thresholdMs]);

  const stats = useMemo(() => {
    const valid = samples.map((s) => s.ping).filter((p): p is number => p !== null);
    const current = samples.length > 0 ? samples[samples.length - 1].ping : null;
    const avg =
      valid.length > 0
        ? Math.round((valid.reduce((acc, v) => acc + v, 0) / valid.length) * 10) / 10
        : 0;
    const avgJitter =
      samples.length > 0
        ? Math.round((samples.reduce((acc, s) => acc + s.jitter, 0) / samples.length) * 10) / 10
        : 0;
    const lostCount = samples.filter((s) => s.lost).length;
    const lossPct =
      samples.length > 0 ? Math.round((lostCount / samples.length) * 1000) / 10 : 0;

    return { current, avg, avgJitter, lossPct };
  }, [samples]);

  const runSpeedTest = async () => {
    if (speedPhase !== 'idle' && speedPhase !== 'complete') return;

    speedAbortRef.current = false;
    setSpeedPoints([]);
    setDownloadMbps(0);
    setUploadMbps(0);
    setCurrentSpeedMbps(0);
    setSpeedProgress(0);
    setSpeedPhase('ping');

    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const pingProbe = await probeLatency();
    if (speedAbortRef.current) return;
    const measuredPing = pingProbe.ping ?? selectedTarget.basePing;
    setTestPingMs(measuredPing);
    setSpeedProgress(15);
    await sleep(350);

    // Fase de descarga
    setSpeedPhase('download');
    const dlSamples: number[] = [];
    const baseDl = mode === 'simulado' ? 145 + Math.random() * 65 : 95 + Math.random() * 80;

    for (let step = 1; step <= 12; step++) {
      if (speedAbortRef.current) return;
      const ramp = Math.min(1, step / 4);
      const val = Math.max(
        5,
        Math.round((baseDl * ramp + (Math.random() - 0.5) * 18) * 10) / 10
      );
      dlSamples.push(val);
      setCurrentSpeedMbps(val);
      setSpeedProgress(15 + Math.round((step / 12) * 40));
      setSpeedPoints((prev) => [...prev, { speed: val }]);
      await sleep(160);
    }

    const finalDl =
      Math.round((dlSamples.reduce((a, b) => a + b, 0) / dlSamples.length) * 10) / 10;
    setDownloadMbps(finalDl);

    // Fase de subida
    setSpeedPhase('upload');
    const ulSamples: number[] = [];
    const baseUl = finalDl * (0.35 + Math.random() * 0.25);

    for (let step = 1; step <= 10; step++) {
      if (speedAbortRef.current) return;
      const ramp = Math.min(1, step / 3);
      const val = Math.max(
        3,
        Math.round((baseUl * ramp + (Math.random() - 0.5) * 10) * 10) / 10
      );
      ulSamples.push(val);
      setCurrentSpeedMbps(val);
      setSpeedProgress(55 + Math.round((step / 10) * 45));
      setSpeedPoints((prev) => [...prev, { speed: val }]);
      await sleep(160);
    }

    const finalUl =
      Math.round((ulSamples.reduce((a, b) => a + b, 0) / ulSamples.length) * 10) / 10;
    setUploadMbps(finalUl);
    setCurrentSpeedMbps(finalDl);
    setSpeedProgress(100);
    setSpeedPhase('complete');

    const grade: SpeedHistoryItem['grade'] =
      finalDl >= 100 && measuredPing <= 50
        ? 'Excelente'
        : finalDl >= 30 && measuredPing <= 100
          ? 'Bueno'
          : 'Regular';

    const entry: SpeedHistoryItem = {
      id: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mode: selectedTarget.name,
      download: finalDl,
      upload: finalUl,
      ping: measuredPing,
      grade,
    };

    setSpeedHistory((prev) => [entry, ...prev.slice(0, 7)]);
  };

  const resetLatencyData = () => {
    setIsMonitoring(false);
    setSamples([]);
    setAlerts([]);
    sampleCounterRef.current = 1;
  };

  const activeGaugeValue =
    speedPhase === 'upload'
      ? currentSpeedMbps
      : speedPhase === 'complete'
        ? downloadMbps
        : currentSpeedMbps;

  const activeGaugeLabel =
    speedPhase === 'upload'
      ? 'Velocidad de Subida'
      : speedPhase === 'ping'
        ? 'Midiendo Respuesta'
        : 'Velocidad de Descarga';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Encabezado */}
      <header className="border-b border-slate-800/90 bg-slate-900/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Radio className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  FasterUp
                </h1>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  En vivo
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Monitor en tiempo real de Latencia, Jitter y Velocidad
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <StatusBadge avgPing={stats.avg} lossPct={stats.lossPct} />
          </div>
        </div>

        {/* Navegación de 2 pestañas */}
        <div className="max-w-6xl mx-auto px-4 pb-3">
          <div className="grid grid-cols-2 gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('latency')}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-semibold transition ${
                activeTab === 'latency'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-4 h-4 shrink-0" />
              <span>Latencia &amp; Estabilidad</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('speed')}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-semibold transition ${
                activeTab === 'speed'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Gauge className="w-4 h-4 shrink-0" />
              <span>Velocidad de Conexión</span>
            </button>
          </div>
        </div>
      </header>

      {/* Barra de destino y modo de medición */}
      <section className="max-w-6xl w-full mx-auto px-4 pt-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-1">
            <label
              htmlFor="target-select"
              className="text-xs font-medium text-slate-400 flex items-center gap-1.5 shrink-0"
            >
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              Servidor / Nodo:
            </label>
            <select
              id="target-select"
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-400"
            >
              {PING_TARGETS.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'simulado', label: 'Simulado' },
                { id: 'http_real', label: 'HTTP Navegador' },
                { id: 'backend_local', label: 'Servicio Local' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                  mode === item.id
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Contenido principal */}
      <main className="max-w-6xl w-full mx-auto px-4 py-4 flex-1">
        {activeTab === 'latency' ? (
          <div className="space-y-4">
            {/* Controles de monitoreo */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                {!isMonitoring ? (
                  <button
                    type="button"
                    onClick={() => setIsMonitoring(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold transition cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Iniciar Monitoreo
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsMonitoring(false)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-bold transition cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Detener
                  </button>
                )}

                <button
                  type="button"
                  onClick={resetLatencyData}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-medium transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Limpiar
                </button>
              </div>

              <div className="flex items-center gap-3">
                <label
                  htmlFor="threshold-range"
                  className="text-xs text-slate-400 flex items-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  Alerta lag:
                </label>
                <input
                  id="threshold-range"
                  type="range"
                  min={40}
                  max={220}
                  step={10}
                  value={thresholdMs}
                  onChange={(e) => setThresholdMs(Number(e.target.value))}
                  className="w-28 accent-cyan-400"
                />
                <span className="text-xs font-semibold tabular-nums text-cyan-300 w-14">
                  {thresholdMs} ms
                </span>
              </div>
            </div>

            {/* Tarjetas de métricas */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                title="Ping Actual"
                value={stats.current !== null ? `${stats.current}` : 'LOSS'}
                unit={stats.current !== null ? 'ms' : undefined}
                subtext={`Destino: ${selectedTarget.host}`}
                accentClass="text-cyan-400"
                icon={Wifi}
              />
              <MetricCard
                title="Promedio"
                value={`${stats.avg}`}
                unit="ms"
                subtext={`${samples.length} muestras registradas`}
                accentClass="text-emerald-400"
                icon={Clock}
              />
              <MetricCard
                title="Jitter"
                value={`${stats.avgJitter}`}
                unit="ms"
                subtext="Variación entre paquetes"
                accentClass="text-amber-400"
                icon={Zap}
              />
              <MetricCard
                title="Pérdida"
                value={`${stats.lossPct}`}
                unit="%"
                subtext="Paquetes sin respuesta"
                accentClass={stats.lossPct > 0 ? 'text-rose-400' : 'text-slate-200'}
                icon={stats.lossPct > 0 ? WifiOff : CheckCircle2}
              />
            </div>

            {/* Gráfica y registro de alertas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <LatencyChart samples={samples} thresholdMs={thresholdMs} />
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Registro de Eventos
                  </h3>
                  <span className="text-xs text-slate-500">{alerts.length}</span>
                </div>

                {alerts.length === 0 ? (
                  <div className="flex-1 min-h-36 flex items-center justify-center text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg p-3">
                    Sin picos de latencia ni pérdidas detectadas.
                  </div>
                ) : (
                  <ul className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {alerts.map((alert) => (
                      <li
                        key={alert.id}
                        className={`text-xs p-2.5 rounded-lg border ${
                          alert.severity === 'critical'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        }`}
                      >
                        <div className="font-mono text-[11px] opacity-75 mb-0.5">
                          {alert.time}
                        </div>
                        <div>{alert.message}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Botón principal de test de velocidad */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white">
                  Prueba de Ancho de Banda
                </h2>
                <p className="text-xs text-slate-400">
                  Evalúa descarga, subida y respuesta hacia {selectedTarget.name}
                </p>
              </div>

              <button
                type="button"
                onClick={runSpeedTest}
                disabled={speedPhase !== 'idle' && speedPhase !== 'complete'}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs sm:text-sm font-bold transition cursor-pointer disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-4 h-4 ${
                    speedPhase !== 'idle' && speedPhase !== 'complete' ? 'animate-spin' : ''
                  }`}
                />
                {speedPhase === 'idle' || speedPhase === 'complete'
                  ? 'Iniciar Prueba'
                  : 'Midiendo...'}
              </button>
            </div>

            {/* Tacómetro y curva */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SpeedGauge
                value={activeGaugeValue}
                progress={speedProgress}
                phase={speedPhase}
                metricLabel={activeGaugeLabel}
              />

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-cyan-400" />
                    Curva de Rendimiento
                  </h3>
                  <span className="text-xs font-mono text-slate-400 uppercase">
                    {speedPhase}
                  </span>
                </div>
                <SpeedGraph points={speedPoints} />
              </div>
            </div>

            {/* Resumen de descarga, subida y ping */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <MetricCard
                title="Descarga"
                value={downloadMbps > 0 ? `${downloadMbps}` : '--'}
                unit={downloadMbps > 0 ? 'Mbps' : undefined}
                subtext="Rendimiento de bajada"
                accentClass="text-cyan-400"
                icon={ArrowDownCircle}
              />
              <MetricCard
                title="Subida"
                value={uploadMbps > 0 ? `${uploadMbps}` : '--'}
                unit={uploadMbps > 0 ? 'Mbps' : undefined}
                subtext="Rendimiento de envío"
                accentClass="text-emerald-400"
                icon={ArrowUpCircle}
              />
              <MetricCard
                title="Latencia de Test"
                value={testPingMs > 0 ? `${testPingMs}` : '--'}
                unit={testPingMs > 0 ? 'ms' : undefined}
                subtext="Respuesta al iniciar prueba"
                accentClass="text-amber-400"
                icon={Activity}
              />
            </div>

            {/* Historial de pruebas */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3">
                Historial Reciente de Pruebas
              </h3>

              {speedHistory.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Aún no has completado pruebas de velocidad en esta sesión.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-3 font-medium">Hora</th>
                        <th className="py-2 pr-3 font-medium">Servidor</th>
                        <th className="py-2 pr-3 font-medium">Descarga</th>
                        <th className="py-2 pr-3 font-medium">Subida</th>
                        <th className="py-2 pr-3 font-medium">Ping</th>
                        <th className="py-2 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {speedHistory.map((item) => (
                        <tr key={item.id} className="text-slate-200">
                          <td className="py-2.5 pr-3 font-mono text-xs text-slate-400">
                            {item.time}
                          </td>
                          <td className="py-2.5 pr-3">{item.mode}</td>
                          <td className="py-2.5 pr-3 font-semibold text-cyan-400">
                            {item.download} Mbps
                          </td>
                          <td className="py-2.5 pr-3 font-semibold text-emerald-400">
                            {item.upload} Mbps
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">{item.ping} ms</td>
                          <td className="py-2.5">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-200">
                              {item.grade}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}