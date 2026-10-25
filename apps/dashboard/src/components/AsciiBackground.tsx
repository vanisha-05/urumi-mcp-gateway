import React, { useEffect, useRef } from 'react';

export function AsciiBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;
    let mouseX = -1000;
    let mouseY = -1000;

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    handleResize();

    let time = 0;
    const spacing = 26; // Grid cell spacing in pixels
    const font = '13px "JetBrains Mono", monospace';

    const render = () => {
      time += 0.025;
      ctx.clearRect(0, 0, width, height);

      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const cols = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * spacing;
          const y = r * spacing;

          // Multi-frequency wave calculation for natural organic motion
          const wave1 = Math.sin(c * 0.12 + time * 0.8) * Math.cos(r * 0.12 + time * 0.6);
          const wave2 = Math.sin((c + r) * 0.08 - time * 0.5);
          const wave = (wave1 + wave2) * 0.5;

          // Mouse distance reaction
          const dx = x - mouseX;
          const dy = y - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const mouseInfluence = Math.max(0, 1 - dist / 180);

          // Calculate brightness / opacity
          const baseOpacity = 0.08;
          const waveOpacity = (wave + 1) * 0.09;
          const highlight = mouseInfluence * 0.55;
          const opacity = Math.min(0.85, baseOpacity + waveOpacity + highlight);

          // Subtle offset toward wave
          const offsetX = Math.sin(time + r * 0.2) * 1.5;
          const offsetY = Math.cos(time + c * 0.2) * 1.5;

          ctx.fillStyle = `rgba(255, 255, 255, ${opacity.toFixed(3)})`;
          ctx.fillText('+', x + offsetX, y + offsetY);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
