import { useState, useRef } from 'react';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: string;
}

export function Tooltip({ content }: TooltipProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.right + 8 });
    }
  };

  const hide = () => setPos(null);

  return (
    <span className="inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        className="text-gray-400 hover:text-gray-600 ml-1 focus:outline-none"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label="Help"
        tabIndex={0}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {pos && (
        <div
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-56 bg-gray-800 text-white text-xs rounded-md px-2.5 py-1.5 shadow-lg pointer-events-none"
        >
          {content}
        </div>
      )}
    </span>
  );
}
