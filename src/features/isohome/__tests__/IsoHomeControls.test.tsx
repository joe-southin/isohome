import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IsoHomeControls } from '../IsoHomeControls';

const defaultProps = {
  selectedTerminus: 'KGX',
  onTerminusChange: vi.fn(),
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
  it('renders the terminus dropdown with 10 options', () => {
    render(<IsoHomeControls {...defaultProps} />);
    const select = screen.getByLabelText('London Terminus');
    expect(select).toBeInTheDocument();
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(10);
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

  it('calls onTerminusChange when selecting a new terminus', async () => {
    const onTerminusChange = vi.fn();
    render(<IsoHomeControls {...defaultProps} onTerminusChange={onTerminusChange} />);
    const select = screen.getByLabelText('London Terminus');
    await userEvent.selectOptions(select, 'PAD');
    expect(onTerminusChange).toHaveBeenCalledWith('PAD');
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
