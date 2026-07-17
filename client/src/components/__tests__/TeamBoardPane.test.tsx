import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, createConfigV2 } from '@camtom/shared';
import { configFixture } from '../../test/config-fixture';

vi.mock('../Dashboard', () => ({ Dashboard: () => <div>dashboard</div> }));
vi.mock('../FilterBar', () => ({ FilterBar: () => <button>filter control</button> }));
vi.mock('../FridayReport', () => ({ FridayReport: () => <div>report</div> }));

import { TeamBoardPane } from '../TeamBoardPane';

describe('TeamBoardPane controlled presentation', () => {
  it('removes focusable team, report, and filter controls on a remote-controlled display', () => {
    const config = configFixture();
    render(
      <TeamBoardPane
        paneId="left"
        pane={{ teamId: 'a', view: 'board', filter: EMPTY_FILTER }}
        teams={config.dashboard.teams ?? []}
        settingsByTeam={createConfigV2(config).teams}
        config={config}
        issues={[]}
        timers={new Map()}
        metadata={null}
        loading={false}
        error={null}
        readOnly
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vista controlada remotamente')).toHaveTextContent('Controlado desde la laptop');
  });
});
