'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export function useDirtyState<T>(
  initialValue: T,
  onSave: (value: T) => Promise<void>
) {
  const [value, setValue] = useState(initialValue);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleChange = useCallback(
    (newValue: T) => {
      setValue(newValue);
      setIsDirty(true);
    },
    []
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave(value);
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }, [value, onSave]);

  const handleReset = useCallback(() => {
    setValue(initialValue);
    setIsDirty(false);
  }, [initialValue]);

  return {
    value,
    isDirty,
    isSaving,
    onChange: handleChange,
    onSave: handleSave,
    onReset: handleReset,
  };
}
