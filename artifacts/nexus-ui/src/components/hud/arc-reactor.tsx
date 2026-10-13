import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface ArcRing {
  radius: number;
  strokeWidth: number;
  color: string;
  speed: number; // rotation degrees per second
  dashArray: string;
  opacity: number;
  reverse?: boolean;
  glow?: boolean;
}

interface ArcReactorProps {
  size?: number;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
  rings?: ArcRing[];
}

const defaultRings: ArcRing[] = [
  { radius: 140, strokeWidth: 1, color: 'rgba(0,212,255,0.15)', speed: 8, dashArray: '4 8', opacity: 0.6 },
  { radius: 118, strokeWidth: 2, color: 'rgba(0,212,255,0.5)', speed: 20, dashArray: '40 6 10 6', opacity: 0.8, glow: true },
  { radius: 96, strokeWidth: 1.5, color: 'rgba(100,180,255,0.4)', speed: -14, dashArray: '16 4', opacity: 0.7, reverse: true },
  { radius: 76, strokeWidth: 3, color: 'rgba(0,212,255,0.9)', speed: 30, dashArray: '60 8 6 8', opacity: 1, glow: true },
  { radius: 56, strokeWidth: 1, color: 'rgba(147,51,234,0.5)', speed: -40, dashArray: '8 4', opacity: 0.6, reverse: true },
  { radius: 40, strokeWidth: 2.5, color: 'rgba(0,212,255,0.7)', speed: 50, dashArray: '20 4 4 4', opacity: 0.9, glow: true },
];

export function ArcReactor({ size = 300, active = true, className = '', children, rings = defaultRings }: ArcReactorProps) {
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
      >
        <defs>
          <filter id="arc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="arc-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="core-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0,212,255,0.4)" />
            <stop offset="60%" stopColor="rgba(0,100,200,0.1)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* Background glow */}
        {active && (
          <circle cx={cx} cy={cy} r={120} fill="url(#core-gradient)" />
        )}

        {/* Rings */}
        {rings.map((ring, i) => {
          const circumference = 2 * Math.PI * ring.radius;
          return (
            <motion.circle
              key={i}
              cx={cx}
              cy={cy}
              r={ring.radius}
              fill="none"
              stroke={active ? ring.color : 'rgba(0,212,255,0.05)'}
              strokeWidth={ring.strokeWidth}
              strokeDasharray={ring.dashArray}
              opacity={active ? ring.opacity : 0.2}
              filter={ring.glow && active ? 'url(#arc-glow)' : undefined}
              animate={active ? { rotate: ring.reverse ? -360 : 360 } : { rotate: 0 }}
              transition={{
                duration: 360 / Math.abs(ring.speed),
                repeat: Infinity,
                ease: 'linear',
              }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
          );
        })}

        {/* Core dot */}
        <circle cx={cx} cy={cy} r={6} fill={active ? 'rgba(0,212,255,1)' : 'rgba(0,212,255,0.2)'} filter="url(#arc-glow-strong)" />
        <motion.circle
          cx={cx} cy={cy} r={12}
          fill="none"
          stroke="rgba(0,212,255,0.4)"
          strokeWidth={1}
          animate={active ? { r: [12, 18, 12], opacity: [0.4, 0.1, 0.4] } : {}}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Crosshair ticks */}
        {[0, 90, 180, 270].map(angle => {
          const rad = (angle * Math.PI) / 180;
          const x1 = cx + 150 * Math.cos(rad);
          const y1 = cy + 150 * Math.sin(rad);
          const x2 = cx + 140 * Math.cos(rad);
          const y2 = cy + 140 * Math.sin(rad);
          return (
            <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(0,212,255,0.5)" strokeWidth={2}
              opacity={active ? 0.8 : 0.1}
            />
          );
        })}

        {/* Degree markers */}
        {Array.from({ length: 36 }).map((_, i) => {
          const angle = (i * 10 * Math.PI) / 180;
          const inner = i % 9 === 0 ? 132 : 136;
          const x1 = cx + 140 * Math.cos(angle);
          const y1 = cy + 140 * Math.sin(angle);
          const x2 = cx + inner * Math.cos(angle);
          const y2 = cy + inner * Math.sin(angle);
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(0,212,255,0.3)" strokeWidth={i % 9 === 0 ? 2 : 0.5}
              opacity={active ? 0.6 : 0.05}
            />
          );
        })}
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// Compact version for smaller displays
export function MiniArcRing({ value, max = 100, size = 120, color = 'rgba(0,212,255,0.9)', label, sublabel }: {
  value: number; max?: number; size?: number; color?: string; label?: string; sublabel?: string;
}) {
  const pct = Math.min(value / max, 1);
  const r = (size / 2) - 14;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const cx = size / 2;
  const cy = size / 2;
  const alertColor = value > 90 ? '#ef4444' : value > 75 ? '#f59e0b' : color;

  return (
    <div className="relative flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <filter id={`mini-glow-${label}`}>
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {/* Background track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,212,255,0.08)" strokeWidth={8} />
        {/* Secondary decorative ring */}
        <circle cx={cx} cy={cy} r={r - 10} fill="none" stroke="rgba(0,212,255,0.05)" strokeWidth={1} strokeDasharray="3 5" />
        {/* Value arc */}
        <motion.circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={alertColor}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25} // start at top
          filter={`url(#mini-glow-${label})`}
          initial={{ strokeDasharray: `0 ${circ}` }}
          animate={{ strokeDasharray: `${dash} ${circ}` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={3} fill={alertColor} opacity={0.8} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
        <span className="text-xl font-bold" style={{ color: alertColor }}>{Math.round(value)}</span>
        {sublabel && <span className="text-[9px] opacity-60">{sublabel}</span>}
      </div>
      {label && <div className="text-[9px] font-mono uppercase tracking-widest text-primary/70 mt-1 text-center leading-tight">{label}</div>}
    </div>
  );
}
