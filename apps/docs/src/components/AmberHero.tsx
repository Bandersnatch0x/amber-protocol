import React, { useState, useEffect, useRef } from 'react';
import Link from '@docusaurus/Link';
import { Shield, Menu, X } from 'lucide-react';
import * as THREE from 'three';
import styles from './AmberHero.module.css';

/**
 * 3D Amber Crystal & Golden Particle Background
 * Replaces generic video with an interactive, locally-rendered Amber Gem & Resin Particle Nebula.
 */
const AmberCrystalBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || typeof window === 'undefined') return;

    const canvas = canvasRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    camera.position.z = 190;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Ambient & Point Lights
    const ambientLight = new THREE.AmbientLight(0x1a1205, 1.5);
    scene.add(ambientLight);

    const amberLight = new THREE.PointLight(0xf59e0b, 2.5, 400);
    amberLight.position.set(0, 0, 50);
    scene.add(amberLight);

    // 1. Central Amber Crystal (Faceted Icosahedron)
    const crystalGroup = new THREE.Group();
    crystalGroup.position.set(window.innerWidth > 996 ? 90 : 0, 0, 0);
    scene.add(crystalGroup);

    // Outer wireframe shell
    const outerGeo = new THREE.IcosahedronGeometry(48, 0);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    const outerCrystal = new THREE.Mesh(outerGeo, outerMat);
    crystalGroup.add(outerCrystal);

    // Inner translucent faceted crystal
    const innerGeo = new THREE.IcosahedronGeometry(42, 0);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      emissive: 0x78350f,
      roughness: 0.15,
      metalness: 0.85,
      transparent: true,
      opacity: 0.55,
      flatShading: true,
    });
    const innerCrystal = new THREE.Mesh(innerGeo, innerMat);
    crystalGroup.add(innerCrystal);

    // Core Glowing Polyhedron
    const coreGeo = new THREE.OctahedronGeometry(22, 0);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
    });
    const coreCrystal = new THREE.Mesh(coreGeo, coreMat);
    crystalGroup.add(coreCrystal);

    // 2. Orbital Governance Rings (围绕琥珀内核的治理规则环)
    const ringGeo1 = new THREE.TorusGeometry(68, 0.6, 16, 100);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.2,
    });
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
    ring1.rotation.x = Math.PI / 3;
    crystalGroup.add(ring1);

    const ringGeo2 = new THREE.TorusGeometry(78, 0.4, 16, 100);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.15,
    });
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
    ring2.rotation.y = Math.PI / 4;
    ring2.rotation.x = Math.PI / 6;
    crystalGroup.add(ring2);

    // 3. Floating Amber Resin Particles & Embers (悬浮琥珀微粒与流光)
    const particleCount = 200;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);

    const c1 = new THREE.Color(0xf59e0b); // Amber Gold
    const c2 = new THREE.Color(0xfbbf24); // Amber Light
    const c3 = new THREE.Color(0xd97706); // Deep Amber

    for (let i = 0; i < particleCount; i++) {
      particlePos[i * 3] = (Math.random() - 0.5) * 500;
      particlePos[i * 3 + 1] = (Math.random() - 0.5) * 300;
      particlePos[i * 3 + 2] = (Math.random() - 0.5) * 200;

      const rand = Math.random();
      const c = rand > 0.6 ? c1 : rand > 0.3 ? c2 : c3;
      particleColors[i * 3] = c.r;
      particleColors[i * 3 + 1] = c.g;
      particleColors[i * 3 + 2] = c.b;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 3,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Animation Loop
    let animationFrameId: number;
    let clock = new THREE.Clock();
    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 0.3;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 0.3;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const animate = () => {
      const time = clock.getElapsedTime();

      // Rotate Amber Crystal with organic breathing motion
      outerCrystal.rotation.y = time * 0.15;
      outerCrystal.rotation.x = time * 0.08;

      innerCrystal.rotation.y = -time * 0.2;
      innerCrystal.rotation.z = time * 0.1;

      coreCrystal.rotation.x = time * 0.3;
      coreCrystal.rotation.y = time * 0.25;

      ring1.rotation.z = time * 0.08;
      ring2.rotation.z = -time * 0.06;

      // Parallax with mouse
      crystalGroup.rotation.y += (mouseX - crystalGroup.rotation.y) * 0.05;
      crystalGroup.rotation.x += (mouseY - crystalGroup.rotation.x) * 0.05;

      // Floating resin particles movement
      const pos = particleGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i++) {
        pos[i * 3 + 1] += Math.sin(time * 0.5 + pos[i * 3] * 0.01) * 0.08;
        pos[i * 3] += Math.cos(time * 0.3 + pos[i * 3 + 1] * 0.01) * 0.04;
      }
      particleGeo.attributes.position.needsUpdate = true;

      // Pulsing amber core glow
      const scale = 1 + Math.sin(time * 2) * 0.04;
      coreCrystal.scale.set(scale, scale, scale);

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
      crystalGroup.position.set(newW > 996 ? 90 : 0, 0, 0);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      outerGeo.dispose();
      outerMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      ringGeo1.dispose();
      ringMat1.dispose();
      ringGeo2.dispose();
      ringMat2.dispose();
      particleGeo.dispose();
      particleMat.dispose();
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
      {/* 4 Vertical Lines */}
      {verticalPositions.map((left, i) => (
        <div
          key={`v-${i}`}
          className={`${styles.vLine} anim-grid-v`}
          style={{ left, animationDelay: `${600 + i * 100}ms` }}
        />
      ))}

      {/* 2 Horizontal Lines */}
      {horizontalPositions.map((top, i) => (
        <div
          key={`h-${i}`}
          className={`${styles.hLine} anim-grid-h`}
          style={{ top, animationDelay: `${800 + i * 150}ms` }}
        />
      ))}

      {/* 8 Plus Marks at Intersections */}
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
      {/* Connector Lines in Elbow Pairs */}
      {/* Node 1: CORE_ENGINE */}
      <ConnectorLine x1="38%" y1="14%" x2="52%" y2="14%" delay={1200} />
      <ConnectorLine x1="52%" y1="14%" x2="60%" y2="27%" delay={1400} />

      {/* Node 2: VERIFIABLE_EVIDENCE */}
      <ConnectorLine x1="32%" y1="58%" x2="20%" y2="74%" delay={1500} />
      <ConnectorLine x1="20%" y1="74%" x2="6%" y2="74%" delay={1700} />

      {/* Node 3: CONTINUITY_HANDOFF */}
      <ConnectorLine x1="78%" y1="53%" x2="63%" y2="53%" delay={1800} />
      <ConnectorLine x1="63%" y1="53%" x2="50%" y2="63%" delay={2000} />

      {/* Node 1 Square & Label */}
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

      {/* Node 2 Square & Label */}
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

      {/* Node 3 Square & Label */}
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
    { number: '04', label: 'CONTINUITY', delay: 650, to: '/guides/session-handoff' },
  ];

  return (
    <section className={styles.heroSection}>
      {/* 3D Amber Crystal & Resin Particle Nebula Background */}
      <AmberCrystalBackground />

      <div className={styles.contentLayer}>
        {/* 7. Top Navigation */}
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
            <Shield className="w-[15px] h-[15px] text-[#F59E0B]" strokeWidth={1.5} />
            <span className={styles.agentText}>agent::v1.6.0</span>
            <span className={styles.governedBadge}>[ GOVERNED ]</span>
            <span className={styles.statusLabel}>STATUS:</span>
            <span className={styles.chip}>ASSURANCE_L4</span>
          </div>

          {/* Hamburger Button for Mobile */}
          <button
            className={`${styles.hamburgerBtn} anim-fade-in`}
            style={{ animationDelay: '400ms' }}
            aria-label="Toggle menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span
              className={`absolute transition-all duration-300 ${
                menuOpen ? 'opacity-0 rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'
              }`}
            >
              <Menu className="w-[22px] h-[22px] text-white" strokeWidth={1.5} />
            </span>
            <span
              className={`absolute transition-all duration-300 ${
                menuOpen ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50'
              }`}
            >
              <X className="w-[22px] h-[22px] text-white" strokeWidth={1.5} />
            </span>
          </button>
        </nav>

        {/* 8. Mobile Menu Overlay */}
        <div className={`${styles.mobileMenu} ${menuOpen ? styles.menuVisible : styles.menuHidden}`}>
          <div className={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
          <div className={styles.menuPanel}>
            <button
              className={styles.closeBtn}
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X className="w-[22px] h-[22px] text-white" strokeWidth={1.5} />
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

            <div className={styles.mobileStatusBlock}>
              <div className={styles.mobileStatusRow1}>
                <Shield className="w-[15px] h-[15px] text-[#F59E0B]" strokeWidth={1.5} />
                <span className={styles.agentText}>agent::v1.6.0</span>
                <span className={styles.governedBadge}>[ GOVERNED ]</span>
              </div>
              <div className={styles.mobileStatusRow2}>
                <span className={styles.agentText}>STATUS:</span>
                <span className={styles.chip}>ASSURANCE_L4</span>
              </div>
            </div>
          </div>
        </div>

        {/* 9. Main Heading */}
        <h1 className={`${styles.heading} anim-fade-up`} style={{ animationDelay: '400ms' }}>
          Governed Agents.
          <br />
          Verifiable Output.
        </h1>

        {/* 10. Grid Lines & Plus Marks */}
        <GridLines />

        {/* 11. Central Nodes (Desktop) */}
        <CentralNodes />

        {/* 12. Bottom Row */}
        <div className={styles.bottomRow}>
          {/* Left CTA Button */}
          <Link
            to="/start-here/first-governed-workflow"
            className={`${styles.ctaBtn} anim-fade-up`}
            style={{ animationDelay: '900ms' }}
          >
            <span className={styles.ctaGlyph}>◆</span>
            <span className={styles.ctaText}>Start Governed Workflow</span>
          </Link>

          {/* Right Info Card */}
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
