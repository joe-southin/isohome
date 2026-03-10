import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: string;
}

export function Tooltip({ content }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        className="text-gray-400 hover:text-gray-600 ml-1 focus:outline-none"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label="Help"
        tabIndex={0}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {visible && (
        <div
          role="tooltip"
          className="absolute left-5 top-0 z-20 w-56 bg-gray-800 text-white text-xs rounded-md px-2.5 py-1.5 shadow-lg pointer-events-none"
        >
          {content}
        </div>
      )}
    </span>
  );
}
