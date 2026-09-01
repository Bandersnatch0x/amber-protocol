import React, { useState } from 'react';

export interface CommandBlockProps {
  context?: string; // e.g. "Target Repository" or "Local Workstation"
  nature?: 'read-only' | 'idempotent-write' | 'write' | 'destructive' | string;
  command: string;
  expectedOutput?: string;
}

export function CommandBlock({
  context = 'Target Repository',
  nature = 'read-only',
  command,
  expectedOutput,
}: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  const isReadOnly = nature.toLowerCase().includes('read');
  const badgeNatureClass = isReadOnly ? 'amber-badge-readonly' : 'amber-badge-write';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="amber-command-block" tabIndex={0}>
      <div className="amber-command-header">
        <span className="amber-badge amber-badge-target" title="Execution Context">
          📍 {context}
        </span>
        <span className={`amber-badge ${badgeNatureClass}`} title="Read/Write Nature">
          ⚡ {nature}
        </span>
        <button
          type="button"
          className="clean-btn"
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            fontSize: '0.8rem',
            cursor: 'pointer',
            border: '1px solid var(--ifm-color-emphasis-300)',
            borderRadius: '4px',
            background: 'var(--ifm-background-surface-color)',
            color: 'var(--ifm-color-emphasis-800)',
          }}
          aria-label={`Copy command: ${command}`}
          onClick={handleCopy}
        >
          {copied ? '✓ Copied' : '📋 Copy command'}
        </button>
      </div>
      <div className="amber-command-body">
        <code>{command}</code>
      </div>
      {expectedOutput && (
        <div className="amber-command-output">
          <strong>Expected Signal:</strong> <span>{expectedOutput}</span>
        </div>
      )}
    </div>
  );
}

export default CommandBlock;
