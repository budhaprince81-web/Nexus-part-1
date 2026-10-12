import React, { useEffect, useRef, useCallback } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  opacity: number;
  hue: number;
  type: 'dot' | 'cross' | 'square';
}

interface ParticleSystemProps {
  count?: number;
  className?: string;
  interactive?: boolean;
  color?: string;
}

export function ParticleSystem({ count = 60, className = '', interactive = true }: ParticleSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  const createParticle = useCallback((w: number, h: number): Particle => {
    const types: Particle['type'][] = ['dot', 'dot', 'dot', 'cross', 'square'];
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3 - 0.1,
      life: Math.random() * 200,
      maxLife: 150 + Math.random() * 200,
      size: 1 + Math.random() * 2.5,
      opacity: 0,
      hue: 185 + Math.random() * 20, // cyan-ish
      type: types[Math.floor(Math.random() * types.length)],
    };
  }, []);

  const drawParticle = useCallback((ctx: CanvasRenderingContext2D, p: Particle) => {
    const fade = p.life < 30 ? p.life / 30 : p.life > p.maxLife - 30 ? (p.maxLife - p.life) / 30 : 1;
    const alpha = fade * 0.7;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `hsl(${p.hue}, 100%, 60%)`;
    ctx.strokeStyle = `hsl(${p.hue}, 100%, 60%)`;

    if (p.type === 'dot') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'cross') {
      const s = p.size;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y);
      ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s);
      ctx.stroke();
    } else {
      ctx.fillRect(p.x - p.size * 0.4, p.y - p.size * 0.4, p.size * 0.8, p.size * 0.8);
    }
    ctx.globalAlpha = 1;
  }, []);

  const drawConnections = useCallback((ctx: CanvasRenderingContext2D, particles: Particle[]) => {
    const MAX_DIST = 120;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          const alpha = (1 - dist / MAX_DIST) * 0.08;
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = `hsl(190, 100%, 55%)`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Init particles
    particlesRef.current = Array.from({ length: count }, () =>
      createParticle(canvas.width, canvas.height)
    );
    // Randomize starting life
    particlesRef.current.forEach(p => { p.life = Math.random() * p.maxLife; });

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    if (interactive) {
      canvas.addEventListener('mousemove', handleMouse);
      window.addEventListener('mousemove', handleMouse);
    }

    const animate = (time: number) => {
      const dt = Math.min(time - lastTimeRef.current, 50);
      lastTimeRef.current = time;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life += dt * 0.05;

        // Mouse repulsion
        if (interactive) {
          const dx = p.x - mouseRef.current.x;
          const dy = p.y - mouseRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 80 && dist > 0) {
            const force = (80 - dist) / 80 * 0.3;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        // Velocity damping
        p.vx *= 0.99;
        p.vy *= 0.99;

        p.x += p.vx * dt * 0.3;
        p.y += p.vy * dt * 0.3;

        // Wrap around
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        // Respawn
        if (p.life > p.maxLife) {
          Object.assign(p, createParticle(w, h));
          p.life = 0;
        }

        drawParticle(ctx, p);
      }

      drawConnections(ctx, particles);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      if (interactive) {
        canvas.removeEventListener('mousemove', handleMouse);
        window.removeEventListener('mousemove', handleMouse);
      }
    };
  }, [count, interactive, createParticle, drawParticle, drawConnections]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ opacity: 0.6 }}
    />
  );
}
