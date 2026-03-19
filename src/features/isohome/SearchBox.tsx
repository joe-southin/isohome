import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';

interface SearchResult {
  place_name: string;
  center: [number, number]; // [lng, lat]
}

interface SearchBoxProps {
  onSelect: (lng: number, lat: number, zoom: number) => void;
}

export function SearchBox({ onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=gb&types=place,postcode,locality,neighborhood&limit=5&access_token=${token}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setResults(
        (data.features ?? []).map((f: { place_name: string; center: [number, number] }) => ({
          place_name: f.place_name,
          center: f.center,
        })),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    setOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 250);
  };

  const handleSelect = (r: SearchResult) => {
    setQuery(r.place_name.split(',')[0]);
    setResults([]);
    setOpen(false);
    onSelect(r.center[0], r.center[1], 12);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={containerRef} className="absolute top-4 right-14 z-10" style={{ width: 260 }}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search location..."
          className="w-full bg-white rounded-lg shadow-lg pl-8 pr-8 py-2 text-sm border-0 outline-none focus:ring-2 focus:ring-blue-400"
          aria-label="Search for a location"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="mt-1 bg-white rounded-lg shadow-lg overflow-hidden text-sm">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handleSelect(r)}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 truncate"
              >
                {r.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
