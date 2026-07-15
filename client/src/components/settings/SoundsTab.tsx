import React from 'react';
import { IconVolume } from '../Icons';
import { Section, FieldRow } from './layout';
import { Button } from '../ui/Button';

interface SoundsTabProps {
  previewVolume: number;
  setPreviewVolume: (value: number) => void;
  handlePreviewSound: (soundName: string) => void;
}

const SOUNDS = [
  { name: 'sparkle', label: 'New Urgent' },
  { name: 'tick', label: 'Warning' },
  { name: 'press', label: 'Breach' },
  { name: 'success', label: 'Success' },
  { name: 'chime', label: 'Chime' },
];

export function SoundsTab({ previewVolume, setPreviewVolume, handlePreviewSound }: SoundsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Volume">
        <FieldRow label="Preview Volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={previewVolume}
            onChange={(e) => setPreviewVolume(Number(e.target.value))}
            style={{ width: 200, accentColor: 'var(--color-tomato)' }}
          />
          <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.5)', minWidth: 30 }}>
            {Math.round(previewVolume * 100)}%
          </span>
        </FieldRow>
      </Section>

      <Section label="Sound Previews">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SOUNDS.map((snd) => (
            <Button
              key={snd.name}
              variant="neutral"
              onClick={() => handlePreviewSound(snd.name)}
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 'var(--radius-pill)',
                padding: '6px 14px',
                color: 'var(--color-mayo)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-xs)',
                letterSpacing: '0.05em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <IconVolume size={14} /> {snd.label}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
