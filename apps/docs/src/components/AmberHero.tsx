import React, { useState, useEffect, useRef } from 'react';
import Link from '@docusaurus/Link';
import styles from './AmberHero.module.css';

/**
 * High-Craft 3D Amber Crystal & Resin Particle Nebula Background
 * Rendered with high-performance 2D Canvas 3D isometric projection.
 * Zero external dependencies.
 */
const AmberCrystalBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || typeof window === 'undefined') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // 3D Particles
    const particleCount = 140;
    interface Particle {
      x: number;
      y: number;
      z: number;
      size: number;
      alpha: number;
      color: string;
      vy: number;
    }

    const colors = ['#f59e0b', '#fbbf24', '#d97706', '#fde68a'];
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 600,
        z: Math.random() * 400 + 50,
        size: Math.random() * 2.5 + 1,
        alpha: Math.random() * 0.7 + 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vy: (Math.random() - 0.5) * 0.4,
      });
    }

    // 3D Polyhedron Vertices for Central Amber Crystal
    const vertices: [number, number, number][] = [
      [0, 1.6, 0],
      [1.2, 0.5, 0.9],
      [-1.2, 0.5, 0.9],
      [0, 0.5, -1.4],
      [1.2, -0.7, 0.9],
      [-1.2, -0.7, 0.9],
      [0, -0.7, -1.4],
      [0, -1.7, 0],
    ];

    const edges = [
      [0, 1], [0, 2], [0, 3],
      [1, 2], [2, 3], [3, 1],
      [1, 4], [2, 5], [3, 6],
      [4, 5], [5, 6], [6, 4],
      [7, 4], [7, 5], [7, 6],
    ];

    let animationFrameId: number;
    let angleX = 0;
    let angleY = 0;
    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / width - 0.5) * 0.4;
      mouseY = (e.clientY / height - 0.5) * 0.4;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Background Radial Amber Glow
      const centerX = width > 996 ? width * 0.65 : width * 0.5;
      const centerY = height * 0.48;

      const radial = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, width * 0.45);
      radial.addColorStop(0, 'rgba(245, 158, 11, 0.12)');
      radial.addColorStop(0.5, 'rgba(217, 119, 6, 0.04)');
      radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      angleY += 0.008 + (mouseX - angleY * 0.1) * 0.05;
      angleX += 0.004 + (mouseY - angleX * 0.1) * 0.05;

      // Draw Particles
      particles.forEach((p) => {
        p.y += p.vy;
        if (p.y > 300) p.y = -300;
        if (p.y < -300) p.y = 300;

        const fov = 350;
        const scale = fov / (fov + p.z);
        const px = centerX + p.x * scale;
        const py = centerY + p.y * scale;

        ctx.beginPath();
        ctx.arc(px, py, p.size * scale, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * scale;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 6 * scale;
        ctx.fill();
      });

      // 3D Projection Matrix
      const radX = angleX;
      const radY = angleY;
      const crystalScale = width > 768 ? 95 : 65;

      const projected = vertices.map(([x, y, z]) => {
        // Rotate Y
        let x1 = x * Math.cos(radY) + z * Math.sin(radY);
        let z1 = -x * Math.sin(radY) + z * Math.cos(radY);
        // Rotate X
        let y2 = y * Math.cos(radX) - z1 * Math.sin(radX);
        let z2 = y * Math.sin(radX) + z1 * Math.cos(radX);

        const fov = 300;
        const scale = fov / (fov + z2 * 35);
        return {
          x: centerX + x1 * crystalScale * scale,
          y: centerY + y2 * crystalScale * scale,
          scale,
        };
      });

      // Draw Crystal Edges
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#f59e0b';

      edges.forEach(([i, j]) => {
        const p1 = projected[i];
        const p2 = projected[j];

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = 1.4 * p1.scale;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
      });

      // Draw Crystal Vertices
      projected.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * p.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.globalAlpha = 0.9;
        ctx.fill();
      });

      // Draw Outer Orbital Halo
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, crystalScale * 1.5, crystalScale * 0.45, angleY * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.crystalCanvas} />;
};

interface NavItemProps {
  number: string;
  label: string;
  delay: number;
  to: string;
}

const NavItem: React.FC<NavItemProps> = ({ number, label, delay, to }) => (
  <Link
    to={to}
    className={`${styles.navItem} anim-fade-up`}
    style={{ animationDelay: `${delay}ms` }}
  >
    <span className={styles.navNumber}>{number}.</span>
    <span className={styles.navLabel}>{label}</span>
  </Link>
);

const GridLines: React.FC = () => {
  const verticalPositions = ['12.6%', '37.5%', '61.9%', '86.2%'];
  const horizontalPositions = ['32.7%', '71.4%'];

  return (
    <div className={styles.gridLinesContainer}>
      {verticalPositions.map((left, i) => (
        <div
          key={`v-${i}`}
          className={`${styles.vLine} anim-grid-v`}
          style={{ left, animationDelay: `${600 + i * 100}ms` }}
        />
      ))}

      {horizontalPositions.map((top, i) => (
        <div
          key={`h-${i}`}
          className={`${styles.hLine} anim-grid-h`}
          style={{ top, animationDelay: `${800 + i * 150}ms` }}
        />
      ))}

      {horizontalPositions.map((top, hi) =>
        verticalPositions.map((left, vi) => (
          <div
            key={`plus-${hi}-${vi}`}
            className={`${styles.plusMark} anim-scale-in`}
            style={{
              top,
              left,
              animationDelay: `${1000 + (hi * 4 + vi) * 80}ms`,
            }}
          >
            <div className={styles.plusH} />
            <div className={styles.plusV} />
          </div>
        ))
      )}
    </div>
  );
};

interface ConnectorLineProps {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
  delay: number;
}

const ConnectorLine: React.FC<ConnectorLineProps> = ({ x1, y1, x2, y2, delay }) => (
  <svg
    className="absolute inset-0 w-full h-full pointer-events-none anim-fade-in"
    style={{ animationDelay: `${delay}ms` }}
  >
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="rgba(245, 158, 11, 0.35)"
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

const CentralNodes: React.FC = () => {
  return (
    <div className={styles.centralNodes}>
      <ConnectorLine x1="38%" y1="14%" x2="52%" y2="14%" delay={1200} />
      <ConnectorLine x1="52%" y1="14%" x2="60%" y2="27%" delay={1400} />

      <ConnectorLine x1="32%" y1="58%" x2="20%" y2="74%" delay={1500} />
      <ConnectorLine x1="20%" y1="74%" x2="6%" y2="74%" delay={1700} />

      <ConnectorLine x1="78%" y1="53%" x2="63%" y2="53%" delay={1800} />
      <ConnectorLine x1="63%" y1="53%" x2="50%" y2="63%" delay={2000} />

      {/* Node 1 */}
      <div
        className={`${styles.nodeSquare} anim-scale-in`}
        style={{ top: '27%', left: '60%', animationDelay: '1500ms' }}
      />
      <div
        className={`${styles.nodeLabelBlock} anim-slide-left`}
        style={{ top: '11%', left: '26%', animationDelay: '1100ms', maxWidth: '170px' }}
      >
        <div className={styles.nodeLabelTitle}>[ CORE_ENGINE ]</div>
        <div className={styles.nodeLabelDesc}>
          Deterministic kernel enforcing repo-local boundaries and Action Types.
        </div>
      </div>

      {/* Node 2 */}
      <div
        className={`${styles.nodeSquare} anim-scale-in`}
        style={{ top: '58%', left: '32%', animationDelay: '1800ms' }}
      />
      <div
        className={`${styles.nodeLabelBlock} anim-slide-left`}
        style={{ top: '76%', left: '3%', animationDelay: '1400ms', maxWidth: '170px' }}
      >
        <div className={styles.nodeLabelTitle}>[ VERIFIABLE_EVIDENCE ]</div>
        <div className={styles.nodeLabelDesc}>
          Four-tier cryptographic receipts settled under human authorizations.
        </div>
      </div>

      {/* Node 3 */}
      <div
        className={`${styles.nodeSquare} anim-scale-in`}
        style={{ top: '63%', left: '50%', animationDelay: '2100ms' }}
      />
      <div
        className={`${styles.nodeLabelBlock} anim-slide-right`}
        style={{ top: '50%', left: '78%', animationDelay: '1700ms', maxWidth: '180px' }}
      >
        <div className={styles.nodeLabelTitle}>[ CONTINUITY_HANDOFF ]</div>
        <div className={styles.nodeLabelDesc}>
          Multi-turn session timelines and portable state preservation across agents.
        </div>
      </div>
    </div>
  );
};

export const AmberHero: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { number: '01', label: 'SESSIONS', delay: 350, to: '/start-here' },
    { number: '02', label: 'EVIDENCE_GATES', delay: 450, to: '/concepts/evidence' },
    { number: '03', label: 'ONTOLOGY_GRAPH', delay: 550, to: '/concepts' },
    { number: '04', label: 'CONTINUITY', delay: 650, to: '/guides/session-handoff-and-continuity' },
  ];

  return (
    <section className={styles.heroSection}>
      {/* 3D Amber Crystal & Particle Background */}
      <AmberCrystalBackground />

      <div className={styles.contentLayer}>
        {/* Top Navigation */}
        <nav className={styles.nav}>
          <div className={styles.navLeftGroup}>
            <Link to="/" className={`${styles.wordmark} anim-fade-up`} style={{ animationDelay: '200ms' }}>
              AMBER <span>//</span> PROTOCOL
            </Link>
            <div className={styles.navLinks}>
              {navItems.map((item) => (
                <NavItem key={item.number} {...item} />
              ))}
            </div>
          </div>

          <div
            className={`${styles.navRightGroup} anim-slide-right`}
            style={{ animationDelay: '600ms' }}
          >
            <svg
              className="w-[15px] h-[15px] text-[#F59E0B]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className={styles.agentText}>agent::v1.6.0</span>
            <span className={styles.governedBadge}>[ GOVERNED ]</span>
            <span className={styles.statusLabel}>STATUS:</span>
            <span className={styles.chip}>ASSURANCE_L4</span>
          </div>

          {/* Hamburger Button */}
          <button
            className={`${styles.hamburgerBtn} anim-fade-in`}
            style={{ animationDelay: '400ms' }}
            aria-label="Toggle menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </nav>

        {/* Mobile Menu */}
        <div className={`${styles.mobileMenu} ${menuOpen ? styles.menuVisible : styles.menuHidden}`}>
          <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
          <div className={styles.menuPanel}>
            <button
              className={styles.closeBtn}
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className={styles.mobileNavList}>
              {navItems.map((item, i) => (
                <Link
                  key={item.number}
                  to={item.to}
                  className={styles.mobileNavItem}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    transitionDelay: menuOpen ? `${150 + i * 75}ms` : '0ms',
                  }}
                >
                  <span className={styles.mobileNavNum}>{item.number}.</span>
                  <span className={styles.mobileNavLabel}>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Main Heading */}
        <h1 className={`${styles.heading} anim-fade-up`} style={{ animationDelay: '400ms' }}>
          Governed Agents.
          <br />
          Verifiable Output.
        </h1>

        {/* Grid Lines */}
        <GridLines />

        {/* Central Nodes */}
        <CentralNodes />

        {/* Bottom Row */}
        <div className={styles.bottomRow}>
          <Link
            to="/start-here/first-governed-workflow"
            className={`${styles.ctaBtn} anim-fade-up`}
            style={{ animationDelay: '900ms' }}
          >
            <span className={styles.ctaGlyph}>◆</span>
            <span className={styles.ctaText}>Start Governed Workflow</span>
          </Link>

          <div
            className={`${styles.infoCardWrapper} anim-slide-right`}
            style={{ animationDelay: '1100ms' }}
          >
            <div className={styles.cardBadge}>NOT A FRAMEWORK — A GOVERNANCE LAYER</div>
            <div className={styles.cardBody}>
              <svg
                className={styles.cardPolygon}
                viewBox="0 0 280 168"
                preserveAspectRatio="none"
              >
                <polygon
                  points="0.5,0.5 279.5,0.5 279.5,167.5 30,167.5 0.5,137.5"
                  fill="rgba(15,23,42,0.75)"
                  stroke="#F59E0B"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <p className={styles.cardText}>
                Surrounds autonomous coding workflows with mathematical certainty,
                tamper-evident ledgers, and strict separation-of-duties verification.
              </p>
              <Link to="/concepts" className={styles.cardLink}>
                VIEW_GOVERNANCE_SPEC
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

