import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  model: {} as any,
  restartPairing: vi.fn(),
}));

vi.mock('../../hooks/useRemoteScreen', () => ({ useRemoteScreen: () => mocks.model }));
vi.mock('../../App', () => ({ default: () => <div>legacy local dashboard</div> }));

import { DisplayRoute } from '../DisplayRoute';

describe('DisplayRoute compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.model = {
  phase: 'local', features: { screenControlEnabled: false, requirePairing: false, captchaProvider: null, captchaSiteKey: null, configurationError: null },
      device: null, config: null, screenState: null, pairing: null,
      transport: 'polling', message: null, restartPairing: mocks.restartPairing,
    };
  });

  it('keeps the legacy root dashboard available while the feature is disabled', () => {
    render(<DisplayRoute legacyRoot />);
    expect(screen.getByText('legacy local dashboard')).toBeInTheDocument();
  });

  it('handles a cleared identity with a new one-time pairing code', () => {
    mocks.model = { ...mocks.model, phase: 'pairing', features: { screenControlEnabled: true, requirePairing: true, captchaProvider: 'turnstile', captchaSiteKey: 'site-key', configurationError: null }, pairing: { code: '123456', expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    render(<DisplayRoute />);
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText(/se usa una sola vez/i)).toBeInTheDocument();
  });

  it('offers re-pairing after revocation', () => {
    mocks.model = { ...mocks.model, phase: 'revoked', features: { screenControlEnabled: true, requirePairing: true, captchaProvider: 'turnstile', captchaSiteKey: 'site-key', configurationError: null } };
    render(<DisplayRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Volver a vincular' }));
    expect(mocks.restartPairing).toHaveBeenCalledOnce();
  });

  it('does not keep rendering stale remote state after transport is disabled with an error', () => {
    mocks.model = {
      ...mocks.model,
      phase: 'error',
      message: 'Configuración inválida',
      device: { id: 'device-1', allowedTeamIds: ['a'] },
      config: { version: 'old' },
      screenState: { reloadNonce: 'old' },
    };
    render(<DisplayRoute />);
    expect(screen.getByRole('alert')).toHaveTextContent('Configuración inválida');
    expect(screen.queryByText('legacy local dashboard')).not.toBeInTheDocument();
  });
});
