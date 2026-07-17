import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigResponse, createConfigV2 } from '@camtom/shared';
import { createDefaultScreenState } from '../../hooks/useScreenState';
import { configFixture } from '../../test/config-fixture';

const admin = vi.hoisted(() => {
  class MockConfigAdminError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
      public readonly currentConfig?: ConfigResponse,
    ) { super(message); }
  }
  return {
    ConfigAdminError: MockConfigAdminError,
    readAdminToken: vi.fn(() => 'admin-token'),
    storeAdminToken: vi.fn(),
    updateServerConfig: vi.fn(),
  };
});

vi.mock('../../lib/config-admin', () => admin);

import { SettingsPanel } from '../SettingsPanel';

function versionedConfig(version: string, title: string): ConfigResponse {
  const config = configFixture();
  config.version = version;
  config.dashboard.title = title;
  config.configV2 = createConfigV2(config);
  config.configV2.global.title = title;
  return config;
}

function Harness({ initial }: { initial: ConfigResponse }) {
  const [authoritative, setAuthoritative] = useState(initial);
  const [preview, setPreview] = useState<ConfigResponse | null>(null);
  const [open, setOpen] = useState(true);
  const visible = preview ?? authoritative;
  return (
    <>
      <output data-testid="active-config" data-version={visible.version}>
        {visible.configV2?.global.title ?? visible.dashboard.title}
      </output>
      {open && (
        <SettingsPanel
          config={authoritative}
          screenState={createDefaultScreenState(['a', 'b'], 'a')}
          onApplyConfig={setPreview}
          onSavedConfig={setAuthoritative}
          onScreenStateChange={vi.fn()}
          onClose={() => { setPreview(null); setOpen(false); }}
        />
      )}
    </>
  );
}

describe('settings authoritative conflict lifecycle', () => {
  beforeEach(() => {
    admin.updateServerConfig.mockReset();
    admin.readAdminToken.mockReturnValue('admin-token');
  });

  it('keeps load-latest authoritative after closing settings', async () => {
    const initial = versionedConfig('v1', 'Initial');
    const latest = versionedConfig('v2', 'Latest remote');
    admin.updateServerConfig.mockRejectedValueOnce(
      new admin.ConfigAdminError('conflict', 409, latest),
    );
    render(<Harness initial={initial} />);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar en servidor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar última versión' }));
    expect(screen.getByTestId('active-config')).toHaveTextContent('Latest remote');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar configuración' }));
    expect(screen.getByTestId('active-config')).toHaveTextContent('Latest remote');
    expect(screen.getByTestId('active-config')).toHaveAttribute('data-version', 'v2');
  });

  it('completes 409, three-way rebase, explicit resolution, and save', async () => {
    const initial = versionedConfig('v1', 'Initial');
    const latest = versionedConfig('v2', 'Remote title');
    admin.updateServerConfig
      .mockRejectedValueOnce(new admin.ConfigAdminError('conflict', 409, latest))
      .mockImplementationOnce(async (body: { configV2: ConfigResponse['configV2'] }) => ({
        ...latest,
        version: 'v3',
        configV2: body.configV2,
      }));
    render(<Harness initial={initial} />);

    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    fireEvent.change(screen.getByDisplayValue('Initial'), { target: { value: 'Local title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en servidor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rebasar borrador' }));
    expect(await screen.findByText('global.title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usar mi cambio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en servidor' }));

    await waitFor(() => expect(screen.getByTestId('active-config')).toHaveAttribute('data-version', 'v3'));
    expect(screen.getByTestId('active-config')).toHaveTextContent('Local title');
    expect(admin.updateServerConfig.mock.calls[1][0]).toEqual(expect.objectContaining({
      expectedVersion: 'v2',
      configV2: expect.objectContaining({ global: expect.objectContaining({ title: 'Local title' }) }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar configuración' }));
    expect(screen.getByTestId('active-config')).toHaveTextContent('Local title');
  });
});
