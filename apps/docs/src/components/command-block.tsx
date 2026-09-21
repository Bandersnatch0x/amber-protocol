import React, { useState } from 'react';
import styles from './command-block.module.css';

export interface CommandBlockProps {
  context: string;
  nature: 'read-only' | 'governed-append' | 'gated-execution' | 'scaffold';
  command: string;
  expectedSignal: string;
}

export const CommandBlock: React.FC<CommandBlockProps> = ({
  context,
  nature,
  command,
  expectedSignal,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for clipboard
    }
  };

  const natureBadgeClass =
    nature === 'read-only'
      ? styles.badgeReadOnly
      : nature === 'governed-append'
        ? styles.badgeGoverned
        : nature === 'gated-execution'
          ? styles.badgeGated
          : styles.badgeScaffold;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.context}>{context}</span>
        <span className={`${styles.natureBadge} ${natureBadgeClass}`}>{nature}</span>
      </div>

      <div className={styles.commandRow}>
        <code className={styles.commandText}>{command}</code>
        <button
          className={styles.copyBtn}
          onClick={handleCopy}
          aria-label={copied ? 'Copied command to clipboard' : 'Copy command to clipboard'}
          title="Copy command"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      <div className={styles.footer}>
        <span className={styles.signalLabel}>Expected artifact or signal:</span>
        <span className={styles.signalValue}>{expectedSignal}</span>
      </div>
    </div>
  );
};

export default CommandBlock;
