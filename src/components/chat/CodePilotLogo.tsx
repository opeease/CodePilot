import { cn } from '@/lib/utils';

interface CodePilotLogoProps {
  className?: string;
}

export function CodePilotLogo({ className }: CodePilotLogoProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("rounded-full", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="delaoke-gradient" x1="120" y1="512" x2="904" y2="512" gradientUnits="userSpaceOnUse">
          <stop stopColor="#075FE8" />
          <stop offset="1" stopColor="#13CBB9" />
        </linearGradient>
        <filter id="delaoke-soft-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#0A6FEA" floodOpacity="0.16" />
        </filter>
      </defs>

      <rect width="1024" height="1024" rx="220" fill="#ffffff" />
      <g fill="url(#delaoke-gradient)" filter="url(#delaoke-soft-shadow)">
        <path d="M344 202H238c-72 0-132 59-132 132v118c0 45-30 85-73 98l-22 7v93l22 7c43 13 73 53 73 98v118c0 73 60 132 132 132h157l-83-82h-74c-27 0-50-23-50-50V748c0-68-36-125-91-153 55-28 91-85 91-153V334c0-28 23-50 50-50h106V202Z" />
        <path d="M680 202h106c73 0 132 59 132 132v118c0 45 30 85 73 98l22 7v93l-22 7c-43 13-73 53-73 98v118c0 73-59 132-132 132H629l83-82h74c28 0 50-23 50-50V748c0-68 36-125 91-153-55-28-91-85-91-153V334c0-28-22-50-50-50H680V202Z" />
        <path d="M512 219 565 321 512 423 459 321 512 219Z" />
        <path d="M291 320 424 404 512 330 600 404 733 320 687 522H337L291 320Z" />
        <path d="M321 560 489 544v335c-93-39-161-126-168-319Z" />
        <path d="M535 544 703 560c-7 193-75 280-168 319V544Z" />
      </g>
    </svg>
  );
}
