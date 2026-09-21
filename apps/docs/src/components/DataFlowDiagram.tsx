import React, { useEffect, useRef } from 'react';
import styles from './DataFlowDiagram.module.css';

export const DataFlowDiagram: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || typeof window === 'undefined') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.parentElement?.clientWidth || 900);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 350);

    const particleCount = 65;
    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      alpha: number;
    }

    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 1,
        alpha: Math.random() * 0.6 + 0.2,
      });
    }

    let animId: number;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Move and draw particles
      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.globalAlpha = p.alpha;
        ctx.fill();

        // Connect nearby particles
        for (let j = idx + 1; j < particleCount; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 80) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = '#f59e0b';
            ctx.globalAlpha = (1 - dist / 80) * 0.15;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      });

      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      if (!canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className={styles.diagramWrapper}>
      {/* 2D Ambient Particle Canvas */}
      <canvas ref={canvasRef} className={styles.canvasBackground} />

      {/* Foreground Content */}
      <div className={styles.diagramContent}>
        <div className={styles.diagramHeader}>
          <div className={styles.diagramBadge}>[ OPERATIONAL_ONTOLOGY ]</div>
          <h2 className={styles.diagramTitle}>Governance Engineering Architecture</h2>
          <div className={styles.diagramSubtitle}>
            THE DETERMINISTIC DATA FLOW BEHIND AGENT-ASSISTED GOVERNANCE
          </div>
        </div>

        <div className={styles.flowContainer}>
          {/* 1. User Request Node */}
          <div className={styles.nodeCard}>
            <div className={styles.nodeTag}>INPUT</div>
            <div className={styles.nodeTitle}>USER REQUEST</div>
            <div className={styles.nodeSubtitle}>goal · inputs · constraints</div>
          </div>

          {/* SVG Connector 1 */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 50 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 80 L 45 80"
              className={styles.solidArrow}
              stroke="#f59e0b"
              strokeWidth="2"
            />
            <polygon points="45,76 50,80 45,84" fill="#f59e0b" />
          </svg>

          {/* 2. Branch Stack */}
          <div className={styles.branchStack}>
            <div className={styles.branchNode}>
              <span className={styles.branchDot} /> RESEARCH
            </div>
            <div className={styles.branchNode}>
              <span className={styles.branchDot} /> BUILD
            </div>
            <div className={styles.branchNode}>
              <span className={styles.branchDot} /> VERIFY
            </div>
          </div>

          {/* SVG Connector 2 */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 60 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 28 C 30 28, 40 75, 55 78"
              className={styles.flowLine}
              stroke="#f59e0b"
              strokeWidth="2"
            />
            <path
              d="M 5 80 L 55 80"
              className={styles.flowLine}
              stroke="#f59e0b"
              strokeWidth="2"
            />
            <path
              d="M 5 132 C 30 132, 40 85, 55 82"
              className={styles.flowLine}
              stroke="#f59e0b"
              strokeWidth="2"
            />
          </svg>

          {/* 3. Center Kernel */}
          <div className={styles.engineBoundary}>
            <div className={styles.engineCard}>
              <div className={styles.engineBeacon} />
              <div className={styles.engineLogo}>
                A<span>.</span>
              </div>
              <div className={styles.engineLabel}>AMBER PROTOCOL</div>
              <div className={styles.engineSub}>Deterministic Kernel</div>
            </div>
          </div>

          {/* SVG Connector 3 */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 50 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 80 L 45 80"
              className={styles.solidArrow}
              stroke="#f59e0b"
              strokeWidth="2"
            />
            <polygon points="45,76 50,80 45,84" fill="#f59e0b" />
          </svg>

          {/* 4. Synthesize Node */}
          <div className={`${styles.nodeCard} ${styles.pillNode}`}>
            <div className={styles.nodeTag}>INTEGRATE</div>
            <div className={styles.nodeTitle}>SYNTHESIZE</div>
            <div className={styles.nodeSubtitle}>state + evidence</div>
          </div>

          {/* SVG Connector 4 */}
          <svg
            className={styles.connectorSvg}
            viewBox="0 0 50 160"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 5 80 L 45 80"
              className={styles.solidArrow}
              stroke="#f59e0b"
              strokeWidth="2"
            />
            <polygon points="45,76 50,80 45,84" fill="#f59e0b" />
          </svg>

          {/* 5. Pass -> Ship Node */}
          <div className={styles.nodeCard}>
            <div className={styles.nodeTag}>DELIVER</div>
            <div className={styles.nodeTitle}>PASS → SHIP</div>
            <div className={styles.nodeSubtitle}>bounded output</div>
          </div>
        </div>

        {/* Footer Tagline */}
        <div className={styles.diagramFooter}>
          <div className={styles.tagline}>
            <span>STATE</span> · <span>ROUTING</span> · <span>VERIFICATION</span> · <span>RECOVERY</span>
          </div>
        </div>
      </div>
    </div>
  );
};
