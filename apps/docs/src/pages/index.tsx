import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/core/lib/client/exports/useDocusaurusContext';
import styles from './index.module.css';

const PILLARS = [
  {
    icon: '🛡️',
    title: 'Repository-Local Boundary',
    description:
      'All governance state, session tracking, evidence logs, and handoff bundles live inside the target repository under .amber/. Zero cloud daemons, zero external telemetry.',
    link: '/concepts/target-repository',
    linkText: 'Learn about repository isolation →',
  },
  {
    icon: '⚡',
    title: '54 Declarative Action Verbs',
    description:
      'Amber models development through explicit verbs (Action Types) backed by strict JSON schemas. Agents act through governed CLI interfaces, not around them.',
    link: '/reference/action-types',
    linkText: 'Explore Action Types & schemas →',
  },
  {
    icon: '🔍',
    title: 'Four-Level Verifiable Assurance',
    description:
      'Claims are backed by immutable hash-chained receipts: unavailable, observed, replayable, and verified — with strict separation-of-duties verification.',
    link: '/concepts/evidence',
    linkText: 'Understand assurance levels →',
  },
  {
    icon: '🔄',
    title: 'Resumable Session Handoff',
    description:
      'Preserve multi-turn context, timeline checkpoints, uncommitted diffs, and recovery loadouts across agent boundaries and developer shifts.',
    link: '/guides/session-handoff-and-continuity',
    linkText: 'Read session handoff guide →',
  },
  {
    icon: '📜',
    title: 'Deny-Wins Policy Contracts',
    description:
      'Org and tenant policies form non-relaxable ceilings. Governed breakglass grants provide bounded single-use emergency authorizations with mandatory post-review.',
    link: '/reference/cli/policy',
    linkText: 'View policy evaluation contracts →',
  },
  {
    icon: '🔒',
    title: 'Zero Telemetry & Local Search',
    description:
      'Built as an independent, private static site with 100% client-side index search. Zero third-party trackers, analytics pixels, or external API calls.',
    link: '/about/boundaries',
    linkText: 'Check safety & telemetry boundaries →',
  },
];

const LIFECYCLE_STEPS = [
  {
    step: '01 / INSPECT',
    title: 'Audit & Doctor',
    cmd: 'amber audit && amber doctor',
    desc: 'Perform read-only readiness inspection, verify agent-facing rules, and check repo guardrails.',
  },
  {
    step: '02 / PLAN',
    title: 'Plan & Gate Contract',
    cmd: 'amber plan && amber gate evaluate',
    desc: 'Scaffold atomic feature slices and evaluate gate contracts before execution begins.',
  },
  {
    step: '03 / TRACK',
    title: 'Session & Next Advice',
    cmd: 'amber session start && amber next',
    desc: 'Track turns in immutable timelines and receive deterministic next-action route advice.',
  },
  {
    step: '04 / ASSURE',
    title: 'Evidence & Approval',
    cmd: 'amber evidence record && amber approval consume',
    desc: 'Produce replayable evidence receipts settled under single-use human authorizations.',
  },
  {
    step: '05 / HANDOFF',
    title: 'Bundle & Continuity',
    cmd: 'amber handoff bundle && amber handoff validate',
    desc: 'Produce portable handoff packages and register distilled learnings back to repo memory.',
  },
];

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  const amberVersion = (siteConfig.customFields?.amberVersion as string) || '1.6.0';

  return (
    <Layout
      title="Amber Protocol — Governance & Verifiable Assurance for AI Coding Agents"
      description="Repository-local governance layer, deterministic guardrails, tamper-evident ledgers, and four-level evidence receipts for agent-assisted software engineering."
    >
      {/* Hero Section */}
      <header className={styles.heroSection}>
        <div className={styles.heroContainer}>
          <div className={styles.heroContent}>
            <div className={styles.heroBadge}>
              <span className={styles.heroBadgeDot} />
              Amber Protocol v{amberVersion} • Agent Governance Layer
            </div>
            <h1 className={styles.heroTitle}>
              Repository-Local Governance &amp;{' '}
              <span className={styles.heroHighlight}>Verifiable Assurance</span>{' '}
              for AI Coding Agents
            </h1>
            <p className={styles.heroSubtitle}>
              Amber Protocol surrounds agent-assisted software engineering with deterministic
              guardrails, tamper-evident ledgers, four-level evidence receipts, and multi-turn
              handoffs — with zero hidden prompts and zero autonomous command execution.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryBtn} to="/start-here/first-governed-workflow">
                Get Started (5 min) →
              </Link>
              <Link className={styles.secondaryBtn} to="/concepts">
                Core Concepts
              </Link>
              <Link className={styles.secondaryBtn} to="/reference/cli">
                CLI Reference (54 Verbs)
              </Link>
            </div>
          </div>

          <div className={styles.heroTerminal}>
            <div className={styles.terminalHeader}>
              <span className={`${styles.terminalDot} ${styles.dotRed}`} />
              <span className={`${styles.terminalDot} ${styles.dotYellow}`} />
              <span className={`${styles.terminalDot} ${styles.dotGreen}`} />
              <span className={styles.terminalTitle}>amber-governance-terminal</span>
            </div>
            <div className={styles.terminalBody}>
              <div className={styles.terminalLine}>
                <span className={styles.terminalPrompt}>$</span>
                <span className={styles.terminalCmd}>amber audit --target .</span>
                <div className={`${styles.terminalOutput} ${styles.terminalSuccess}`}>
                  ✅ Target repository classified (readiness: 100%)
                </div>
              </div>
              <div className={styles.terminalLine}>
                <span className={styles.terminalPrompt}>$</span>
                <span className={styles.terminalCmd}>amber doctor --target .</span>
                <div className={`${styles.terminalOutput} ${styles.terminalSuccess}`}>
                  ✅ 0 errors, 0 warnings. Guardrails verified.
                </div>
              </div>
              <div className={styles.terminalLine}>
                <span className={styles.terminalPrompt}>$</span>
                <span className={styles.terminalCmd}>
                  amber session start --goal &quot;Feature delivery&quot; --target .
                </span>
                <div className={styles.terminalOutput}>
                  Session initialized with ID s-20260901-a1b2. Active timeline registered.
                </div>
              </div>
              <div className={styles.terminalLine}>
                <span className={styles.terminalPrompt}>$</span>
                <span className={styles.terminalCmd}>amber next --target .</span>
                <div className={`${styles.terminalOutput} ${styles.terminalSuccess}`}>
                  👉 Recommended: amber plan --feature F024 --title &quot;Docs Site&quot;
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Core Architecture Pillars */}
        <section className={styles.section} aria-labelledby="pillars-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionBadge}>Core Architecture</div>
            <h2 id="pillars-heading" className={styles.sectionTitle}>
              Built for Trust, Auditability, and Control
            </h2>
            <p className={styles.sectionSubtitle}>
              Amber Protocol gives engineering teams mathematical and cryptographic certainty over
              what coding agents produce, inspect, and hand off.
            </p>
          </div>

          <div className={styles.grid3}>
            {PILLARS.map((pillar, idx) => (
              <article key={idx} className={styles.card}>
                <div className={styles.cardIcon} aria-hidden="true">
                  {pillar.icon}
                </div>
                <h3 className={styles.cardTitle}>{pillar.title}</h3>
                <p className={styles.cardBody}>{pillar.description}</p>
                <Link className={styles.cardLink} to={pillar.link}>
                  {pillar.linkText}
                </Link>
              </article>
            ))}
          </div>
        </section>

        {/* Five-Stage Governed Lifecycle Loop */}
        <section className={styles.workflowSection} aria-labelledby="workflow-heading">
          <div className={styles.workflowContainer}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionBadge}>Governed Workflow</div>
              <h2 id="workflow-heading" className={styles.sectionTitle}>
                The 5-Stage Governed Engineering Loop
              </h2>
              <p className={styles.sectionSubtitle}>
                Every unit of agent-assisted engineering moves through strict, verifiable lifecycle
                gates from initial audit to final acceptance and distilled knowledge write-back.
              </p>
            </div>

            <div className={styles.timelineGrid}>
              {LIFECYCLE_STEPS.map((item, idx) => (
                <div key={idx} className={styles.timelineItem}>
                  <div className={styles.timelineStep}>{item.step}</div>
                  <h3 className={styles.timelineTitle}>{item.title}</h3>
                  <code className={styles.timelineCode}>{item.cmd}</code>
                  <p className={styles.timelineDesc}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom Adoption CTA Banner */}
        <section className={styles.section} aria-labelledby="cta-heading">
          <div className={styles.ctaBanner}>
            <h2 id="cta-heading" className={styles.ctaTitle}>
              Ready to Govern Your AI-Assisted Workflows?
            </h2>
            <p className={styles.ctaDesc}>
              Adopt Amber Protocol in any existing Git repository in less than 3 minutes. Zero
              configuration files overwritten, zero cloud dependencies.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryBtn} to="/start-here/first-governed-workflow">
                Start First Governed Workflow →
              </Link>
              <Link className={styles.secondaryBtn} to="/guides/adopting-existing-project">
                Adoption Guide
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
