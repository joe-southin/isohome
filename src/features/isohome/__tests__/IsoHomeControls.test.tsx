import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IsoHomeControls } from '../IsoHomeControls';
import type { TransportMode } from '../types';

const defaultTransportModes: TransportMode[] = [
  { id: 'train', label: 'Train', icon: '🚆', enabled: true, available: true },
  { id: 'car', label: 'Car', icon: '🚗', enabled: true, available: true },
  { id: 'walk', label: 'Walk', icon: '🚶', enabled: false, available: true },
  { id: 'tube', label: 'Tube', icon: '🚇', enabled: false, available: false },
];

const defaultProps = {
  selectedTermini: ['KGX'],
  onTerminiChange: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  selectedMinutesIndex: 2,
  onMinutesChange: vi.fn(),
  showStations: false,
  onShowStationsChange: vi.fn(),
  showRailLines: false,
  onShowRailLinesChange: vi.fn(),
  showRouteInfo: true,
  onShowRouteInfoChange: vi.fn(),
  transportModes: defaultTransportModes,
  onTransportModeChange: vi.fn(),
  walkCap: 15,
  onWalkCapChange: vi.fn(),
  isLoading: false,
  error: null,
  layerWeights: [
    { id: 'sunshine' as const, label: 'Sunshine', weight: 5, enabled: true, higherIsBetter: true, stats: { mean: 1660.8, stddev: 146.5 } },
    { id: 'house_price' as const, label: 'House price', weight: 5, enabled: true, higherIsBetter: false, stats: { mean: 192049, stddev: 76572 } },
    { id: 'crime' as const, label: 'Crime rate', weight: 5, enabled: true, higherIsBetter: false, stats: { mean: 51.8, stddev: 13.5 } },
  ],
  onLayerWeightsChange: vi.fn(),
  colormap: 'jet' as const,
  onColormapChange: vi.fn(),
};

describe('IsoHomeControls', () => {
  it('renders 11 terminus checkboxes', () => {
    render(<IsoHomeControls {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox').filter(
      (cb) => {
        const label = cb.getAttribute('aria-label') ?? '';
        return label !== 'Show stations' && label !== 'Show rail lines' &&
          label !== 'Show route on hover' && !label.includes('mode');
      }
    );
    expect(checkboxes).toHaveLength(11);
  });

  it('checks selected termini', () => {
    render(<IsoHomeControls {...defaultProps} selectedTermini={['KGX', 'STP']} />);
    expect(screen.getByLabelText("King's Cross")).toBeChecked();
    expect(screen.getByLabelText('St Pancras International')).toBeChecked();
    expect(screen.getByLabelText('Paddington')).not.toBeChecked();
  });

  it('renders the time slider', () => {
    render(<IsoHomeControls {...defaultProps} />);
    const slider = screen.getByLabelText(/Max commute/);
    expect(slider).toBeInTheDocument();
  });

  it('displays formatted time for selected index', () => {
    render(<IsoHomeControls {...defaultProps} selectedMinutesIndex={0} />);
    expect(screen.getByText(/30 min/)).toBeInTheDocument();
  });

  it('displays 1 hour for index 2', () => {
    render(<IsoHomeControls {...defaultProps} selectedMinutesIndex={2} />);
    expect(screen.getByText(/1 hour/)).toBeInTheDocument();
  });

  it('calls onTerminiChange when toggling a terminus', async () => {
    const onTerminiChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} onTerminiChange={onTerminiChange} />);
    await userEvent.click(screen.getByLabelText('Paddington'));
    expect(onTerminiChange).toHaveBeenCalledWith('PAD', true);
  });

  it('calls onTerminiChange with false when unchecking', async () => {
    const onTerminiChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} selectedTermini={['KGX']} onTerminiChange={onTerminiChange} />);
    await userEvent.click(screen.getByLabelText("King's Cross"));
    expect(onTerminiChange).toHaveBeenCalledWith('KGX', false);
  });

  it('calls onSelectAll when clicking All button', async () => {
    const onSelectAll = vi.fn();
    render(<IsoHomeControls {...defaultProps} onSelectAll={onSelectAll} />);
    await userEvent.click(screen.getByLabelText('Select all termini'));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it('calls onDeselectAll when clicking None button', async () => {
    const onDeselectAll = vi.fn();
    render(<IsoHomeControls {...defaultProps} onDeselectAll={onDeselectAll} />);
    await userEvent.click(screen.getByLabelText('Deselect all termini'));
    expect(onDeselectAll).toHaveBeenCalled();
  });

  it('disables All button when all termini selected', () => {
    const allCRS = ['KGX', 'PAD', 'WAT', 'VIC', 'LST', 'BFR', 'CST', 'CHX', 'EUS', 'MYB', 'STP'];
    render(<IsoHomeControls {...defaultProps} selectedTermini={allCRS} />);
    expect(screen.getByLabelText('Select all termini')).toBeDisabled();
  });

  it('disables None button when no termini selected', () => {
    render(<IsoHomeControls {...defaultProps} selectedTermini={[]} />);
    expect(screen.getByLabelText('Deselect all termini')).toBeDisabled();
  });

  it('renders station toggle switch', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Show stations')).toBeInTheDocument();
  });

  it('renders rail lines toggle switch', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Show rail lines')).toBeInTheDocument();
  });

  it('renders route info toggle switch', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Show route on hover')).toBeInTheDocument();
  });

  it('calls onShowStationsChange when toggling', async () => {
    const onShowStationsChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} onShowStationsChange={onShowStationsChange} />);
    await userEvent.click(screen.getByLabelText('Show stations'));
    expect(onShowStationsChange).toHaveBeenCalled();
  });

  it('renders transport mode checkboxes', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Train mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Car mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Walk mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Tube mode')).toBeInTheDocument();
  });

  it('train mode checkbox is always disabled', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Train mode')).toBeDisabled();
  });

  it('car mode checkbox is enabled and toggleable', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Car mode')).not.toBeDisabled();
  });

  it('tube mode checkbox is disabled (coming soon)', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Tube mode')).toBeDisabled();
  });

  it('walk mode checkbox is enabled', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Walk mode')).not.toBeDisabled();
  });

  it('calls onTransportModeChange when toggling car', async () => {
    const onTransportModeChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} onTransportModeChange={onTransportModeChange} />);
    await userEvent.click(screen.getByLabelText('Car mode'));
    expect(onTransportModeChange).toHaveBeenCalledWith('car', false);
  });

  it('shows loading indicator when isLoading is true', () => {
    render(<IsoHomeControls {...defaultProps} isLoading={true} />);
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.getByText('Loading isochrone...')).toBeInTheDocument();
  });

  it('does not show loading indicator when isLoading is false', () => {
    render(<IsoHomeControls {...defaultProps} isLoading={false} />);
    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
  });

  it('shows error alert when error is set', () => {
    render(<IsoHomeControls {...defaultProps} error="Something went wrong" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('does not show error alert when error is null', () => {
    render(<IsoHomeControls {...defaultProps} error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the How it works button', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByText('How it works')).toBeInTheDocument();
  });

  it('opens help modal when How it works is clicked', async () => {
    render(<IsoHomeControls {...defaultProps} />);
    await userEvent.click(screen.getByText('How it works'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes help modal when close button is clicked', async () => {
    render(<IsoHomeControls {...defaultProps} />);
    await userEvent.click(screen.getByText('How it works'));
    await userEvent.click(screen.getByLabelText('Close help'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the desirability layers button', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByText('Desirability layers')).toBeInTheDocument();
  });

  it('starts with desirability panel collapsed', () => {
    render(<IsoHomeControls {...defaultProps} />);
    const button = screen.getByText('Desirability layers');
    expect(button.closest('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Sunshine weight')).not.toBeInTheDocument();
  });

  it('expands desirability panel on click', async () => {
    render(<IsoHomeControls {...defaultProps} />);
    await userEvent.click(screen.getByText('Desirability layers'));
    expect(screen.getByText('Desirability layers').closest('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Sunshine weight')).toBeInTheDocument();
    expect(screen.getByLabelText('House price weight')).toBeInTheDocument();
  });

  it('calls onLayerWeightsChange when toggling a layer checkbox', async () => {
    const onLayerWeightsChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} onLayerWeightsChange={onLayerWeightsChange} />);
    await userEvent.click(screen.getByText('Desirability layers'));
    const sunshineCheckbox = screen.getByLabelText('Enable Sunshine');
    await userEvent.click(sunshineCheckbox);
    expect(onLayerWeightsChange).toHaveBeenCalled();
  });

  it('shows colormap selector when panel is open', async () => {
    render(<IsoHomeControls {...defaultProps} />);
    await userEvent.click(screen.getByText('Desirability layers'));
    expect(screen.getByText('Colormap')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jet')).toBeInTheDocument();
  });
});
