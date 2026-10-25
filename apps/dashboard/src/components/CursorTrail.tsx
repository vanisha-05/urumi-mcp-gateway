import React, { useEffect, useState, useRef } from 'react';

export function CursorTrail() {
  const [visible, setVisible] = useState(false);
  const posRef = useRef({ x: -100, y: -100 });
  const trailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let currentX = -100;
    let currentY = -100;
    let targetX = -100;
    let targetY = -100;
    let animId: number;

    const onMouseMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!visible) setVisible(true);
    };

    const onMouseLeave = () => {
      setVisible(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    // Smooth lerp loop
    const updatePosition = () => {
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;

      if (trailRef.current) {
        trailRef.current.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      }

      animId = requestAnimationFrame(updatePosition);
    };

    animId = requestAnimationFrame(updatePosition);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      cancelAnimationFrame(animId);
    };
  }, [visible]);

  return (
    <div
      ref={trailRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s ease',
        willChange: 'transform',
      }}
    >
      <div className="loader cursor-loader">
        <div className="circle"></div>
        <div className="circle"></div>
        <div className="circle"></div>
        <div className="circle"></div>
        <div className="circle"></div>
        <div className="circle"></div>
        <div className="circle"></div>
        <div className="circle"></div>
      </div>
    </div>
  );
}
