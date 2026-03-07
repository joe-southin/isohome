import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IsoHomeControls } from '../IsoHomeControls';

const defaultProps = {
  selectedTermini: ['KGX'],
  onTerminiChange: vi.fn(),
  selectedMinutesIndex: 2,
  onMinutesChange: vi.fn(),
  showStations: false,
  onShowStationsChange: vi.fn(),
  showRailLines: false,
  onShowRailLinesChange: vi.fn(),
  isLoading: false,
  error: null,
};

describe('IsoHomeControls', () => {
  it('renders 11 terminus checkboxes', () => {
    render(<IsoHomeControls {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox').filter(
      (cb) => cb.getAttribute('aria-label') && cb.getAttribute('aria-label') !== 'Show stations' && cb.getAttribute('aria-label') !== 'Show rail lines'
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

  it('renders station toggle switch', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Show stations')).toBeInTheDocument();
  });

  it('renders rail lines toggle switch', () => {
    render(<IsoHomeControls {...defaultProps} />);
    expect(screen.getByLabelText('Show rail lines')).toBeInTheDocument();
  });

  it('calls onShowStationsChange when toggling', async () => {
    const onShowStationsChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} onShowStationsChange={onShowStationsChange} />);
    await userEvent.click(screen.getByLabelText('Show stations'));
    expect(onShowStationsChange).toHaveBeenCalled();
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
});
