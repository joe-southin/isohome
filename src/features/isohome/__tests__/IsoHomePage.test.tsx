import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IsoHomePage } from '../IsoHomePage';

vi.mock('mapbox-gl', () => ({
  default: {
    Map: function () {
      return {
        on: vi.fn(),
        remove: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getSource: vi.fn(),
        getLayer: vi.fn(),
        setLayoutProperty: vi.fn(),
        addControl: vi.fn(),
      };
    },
    NavigationControl: function () {
      return {};
    },
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IsoHomePage', () => {
  it('renders without crashing', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByText('IsoHome')).toBeInTheDocument();
  });

  it('renders the terminus checkboxes', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByLabelText("King's Cross")).toBeInTheDocument();
    expect(screen.getByLabelText('Paddington')).toBeInTheDocument();
  });

  it('renders the time slider', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByLabelText(/Max commute/)).toBeInTheDocument();
  });

  it('renders the map container', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
  });

  it('defaults to KGX terminus checked', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByLabelText("King's Cross")).toBeChecked();
  });

  it('defaults to 60 min (index 2)', () => {
    renderWithProviders(<IsoHomePage />);
    expect(screen.getByText(/1 hour/)).toBeInTheDocument();
  });
});
