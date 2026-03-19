import { X, ExternalLink } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="How IsoHome works"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">How IsoHome works</h2>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="p-1 rounded hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600">
          IsoHome shows you <strong>where you can live and still commute into London</strong> within
          a chosen time budget. The shaded area on the map is everywhere you can reach a London
          terminus by driving or walking to a nearby station and taking the train.
        </p>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">London Termini</h3>
          <p className="text-sm text-gray-600">
            Choose which London stations to include. Each adds its own commute zone to the map.
            Selecting multiple merges them — useful for households with flexibility over which
            terminus to use. Leave all unselected to clear the map.
          </p>
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Max commute time</h3>
          <p className="text-sm text-gray-600">
            Set the maximum total journey: drive (or walk) to your local station + train to London.
            The shaded area updates to show everywhere reachable within that limit.
          </p>
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Transport modes</h3>
          <p className="text-sm text-gray-600">
            <strong>Train</strong> is always required. Toggle <strong>Car</strong> off to see only
            locations within walking distance of a station. Enable <strong>Walk</strong> to add a
            green overlay showing areas within walking distance of each station (up to the walk cap
            you set). Tube support is coming soon.
          </p>
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Map layers</h3>
          <p className="text-sm text-gray-600">
            <strong>Show stations</strong> marks local rail stations used in the calculation.{' '}
            <strong>Show rail lines</strong> overlays the UK main rail network.{' '}
            <strong>Show route on hover</strong> — move your cursor over the commute zone to see
            the drive route to station, the rail leg to London, and the total commute time.
          </p>
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">Desirability heatmap</h3>
          <p className="text-sm text-gray-600">
            Overlay three data layers within the commute zone: sunshine hours, house prices, and
            crime rates. Each is normalised using z-score + sigmoid so the scores are stable across
            different isochrones. Use the weight sliders to emphasise what matters most. Brighter
            colours mean higher desirability. Set a weight to 0 or uncheck a layer to exclude it.
          </p>
        </section>

        <a
          href="https://github.com/joe-southin/isohome#readme"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
        >
          Full methodology, maths and data sources
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
