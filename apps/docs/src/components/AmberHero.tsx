import React, { useState } from 'react';
import Link from '@docusaurus/Link';
import { Shield, Menu, X } from 'lucide-react';
import styles from './AmberHero.module.css';

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
      stroke="rgba(245, 158, 11, 0.3)"
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
      {/* Background Atmosphere Video / Canvas Layer */}
      <video
        className="absolute inset-0 w-full h-full object-cover anim-fade-in opacity-30 pointer-events-none"
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260813_115057_94c3699b-0fd1-4124-bcf3-3626bb8c1f77.mp4"
        autoPlay
        muted
        loop
        playsInline
      />

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
            <span className={styles.ctaStar}>&#10022;</span>
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
                  fill="rgba(15,23,42,0.7)"
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
