export type ArtDirectionKind =
  | 'moss-sky'
  | 'monochrome-editorial'
  | 'warm-orange-music'
  | 'cool-blue-cavern'
  | 'dark-timepiece';

export interface ProjectMediaConfig {
  /**
   * Optional path or URL to a screenshot rendered on the curved 3D page.
   * Example: '/assets/projects/my-site-poster.png'
   */
  screenshotUrl?: string;
  /**
   * Optional path or URL to a muted looping MP4/WebM capture played on hover/preview.
   * Example: '/assets/projects/my-site-preview.mp4'
   */
  videoUrl?: string;
  /**
   * Optional live website URL rendered inside an interactive iframe in the project detail modal.
   * Example: 'https://your-site.example.com'
   */
  liveEmbedUrl?: string;
}

export interface ProjectItem {
  id: string;
  indexNumber: string;
  pageNumber: string;
  title: string;
  category: string;
  year: string;
  headline: string;
  summary: string;
  isDemo: boolean;
  spreadIndex: number;
  side: 'left' | 'right';
  artDirection: ArtDirectionKind;
  palette: {
    bg: string;
    fg: string;
    accent: string;
    muted: string;
  };
  hasAnimatedPreview: boolean;
  previewLabel: string;
  destinationUrl?: string;
  media?: ProjectMediaConfig;
  details: {
    role: string;
    clientLabel: string;
    deliverables: string[];
    overview: string;
    highlights: string[];
  };
}

export type PageSlot =
  | { kind: 'contents' }
  | { kind: 'coming-soon' }
  | { kind: 'reserved-stack' }
  | { kind: 'project'; project: ProjectItem };

export interface BookSpread {
  spreadIndex: number;
  label: string;
  left: PageSlot;
  right: PageSlot;
}

/**
 * Physical book volume allocation: 20 pages = 10 physical spreads.
 * Active spreads below stop cleanly at the "More works coming soon" spread
 * so visitors cannot flip into blank placeholder sheets.
 */
export const PHYSICAL_PAGE_COUNT = 20;
export const PHYSICAL_SPREAD_COUNT = PHYSICAL_PAGE_COUNT / 2;

export const DEMO_PROJECTS: ProjectItem[] = [
  {
    id: 'strata-canopy',
    indexNumber: '01',
    pageNumber: '02',
    title: 'Strata Canopy',
    category: 'Spatial Web',
    year: '2026',
    headline: 'Every layer tells a story.',
    summary:
      'An interactive ecological archive examining old-growth moss canopies, suspended root systems, and atmospheric moisture cycles.',
    isDemo: true,
    spreadIndex: 0,
    side: 'right',
    artDirection: 'moss-sky',
    palette: {
      bg: '#0f6bc4',
      fg: '#ffffff',
      accent: '#e0fa48',
      muted: '#cde7fb',
    },
    hasAnimatedPreview: true,
    previewLabel: 'Drifting canopy light & mist',
    details: {
      role: 'Art Direction & Interactive Atlas',
      clientLabel: 'Demo Placeholder — Replace with your website URL & capture',
      deliverables: ['WebGL Terrain Study', 'Interactive Canvas', 'Responsive Site'],
      overview:
        'Strata Canopy pairs vivid daylight photography with spatial scroll choreography. Replace the placeholder media config with your own website screenshot, looping capture, and live embed URL.',
      highlights: [
        'Full-bleed visual cover directly peeking beneath the closed hardcover',
        'Supports MP4/WebM hover previews or static website screenshots on the 3D sheet',
        'Opens into a live interactive website iframe inside this detail modal',
      ],
    },
  },
  {
    id: 'monolith-press',
    indexNumber: '02',
    pageNumber: '03',
    title: 'Monolith Press',
    category: 'Editorial System',
    year: '2026',
    headline: 'The weight of silent pages.',
    summary:
      'Monochrome typographic grid and digital exhibition identity built for an independent architectural publishing house.',
    isDemo: true,
    spreadIndex: 1,
    side: 'left',
    artDirection: 'monochrome-editorial',
    palette: {
      bg: '#111114',
      fg: '#f7f4ed',
      accent: '#f04a2e',
      muted: '#9e9b95',
    },
    hasAnimatedPreview: true,
    previewLabel: 'Rhythmic typographic grid shift',
    details: {
      role: 'Editorial Design & Type Architecture',
      clientLabel: 'Demo Placeholder — Replace with your website URL & capture',
      deliverables: ['Broadsheet Grid', 'Exhibition Catalogue', 'Digital Archive'],
      overview:
        'Built around stark charcoal-and-ivory contrast, Monolith Press treats negative space as structural architecture, pairing condensed grotesk headings with poised serif commentary.',
      highlights: [
        'Strict 12-column Swiss print proportions adapted to digital spreads',
        'Crisp monochrome tonal stepping with a single vermilion folio marker',
        'Animated specimen alignment preview on hover and keyboard focus',
      ],
    },
  },
  {
    id: 'solstice-tape',
    indexNumber: '03',
    pageNumber: '04',
    title: 'Solstice Tape',
    category: 'Audio Direction',
    year: '2026',
    headline: 'Warm analog frequencies.',
    summary:
      'Visual identity, interactive listening room, and live reactive motion graphics for electronic composer Theo Vance.',
    isDemo: true,
    spreadIndex: 1,
    side: 'right',
    artDirection: 'warm-orange-music',
    palette: {
      bg: '#2b0b01',
      fg: '#fff3e6',
      accent: '#ff6b14',
      muted: '#f7bc8e',
    },
    hasAnimatedPreview: true,
    previewLabel: 'Analog harmonic light trails',
    details: {
      role: 'Creative Direction & Motion Identity',
      clientLabel: 'Demo Placeholder — Replace with your website URL & capture',
      deliverables: ['Sleeve System', 'Tour Motion Loops', 'Listening Room UI'],
      overview:
        'Rooted in warm tape saturation and late-night studio glow, Solstice Tape pairs radiant amber light smears with crisp editorial liner notes.',
      highlights: [
        'Live procedural harmonic waveforms synced to the preview surface',
        'High-saturation tangerine-to-obsidian contrast tuned for dark rooms',
        'Ready for an external live audio web experience inside this modal',
      ],
    },
  },
  {
    id: 'subsurface-archive',
    indexNumber: '04',
    pageNumber: '05',
    title: 'Subsurface Archive',
    category: 'Spatial Archive',
    year: '2026',
    headline: 'See through complexity.',
    summary:
      'An interactive glacial cavern exploration mapping subterranean acoustic echoes and crystalline mineral formations.',
    isDemo: true,
    spreadIndex: 2,
    side: 'left',
    artDirection: 'cool-blue-cavern',
    palette: {
      bg: '#031226',
      fg: '#eef8ff',
      accent: '#2ec4ff',
      muted: '#8ec0e6',
    },
    hasAnimatedPreview: true,
    previewLabel: 'Bioluminescent caustic shimmer',
    details: {
      role: 'Spatial Experience & Visual Systems',
      clientLabel: 'Demo Placeholder — Replace with your website URL & capture',
      deliverables: ['3D Cavern Survey', 'Acoustic Telemetry UI', 'Interactive Web App'],
      overview:
        'Subsurface Archive brings deep glacial acoustics to the surface through layered cyan-cobalt lighting, drifting ice caustics, and restrained scientific captions.',
      highlights: [
        'Procedural ice-arch illumination with animated subsurface caustics',
        'Crisp poster framing on the book page; full case notes on click',
        'Keyboard-navigable archive entries synchronized with Contents',
      ],
    },
  },
  {
    id: 'nocturne-os',
    indexNumber: '05',
    pageNumber: '06',
    title: 'Nocturne OS',
    category: 'Interface System',
    year: '2026',
    headline: 'Quiet hours, distilled.',
    summary:
      'A distraction-free mobile timepiece and ambient focus shell with dot-matrix typography and monochrome dusk photography.',
    isDemo: true,
    spreadIndex: 2,
    side: 'right',
    artDirection: 'dark-timepiece',
    palette: {
      bg: '#0f1013',
      fg: '#f7f7f5',
      accent: '#ef4c36',
      muted: '#8d9096',
    },
    hasAnimatedPreview: true,
    previewLabel: 'Live timepiece & alpine shimmer',
    details: {
      role: 'Product Design & Motion Prototype',
      clientLabel: 'Demo Placeholder — Replace with your website URL & capture',
      deliverables: ['Hardware Lock-Screen UI', 'Dot-Matrix Display Type', 'Web Prototype'],
      overview:
        'Designed to reduce evening screen fatigue, Nocturne OS strips mobile interactions down to calm tabular numerals, tactile dot-matrix badges, and low-glare contrast.',
      highlights: [
        'Live animated clock face and alpine ridge light sweep in preview mode',
        'Custom pixel-grid display wordmark balancing hardware precision and warmth',
        'Click-through modal ready for live hosted web prototype embedding',
      ],
    },
  },
];

export const BOOK_SPREADS: BookSpread[] = [
  {
    spreadIndex: 0,
    label: 'Contents & Strata Canopy',
    left: { kind: 'contents' },
    right: { kind: 'project', project: DEMO_PROJECTS[0] },
  },
  {
    spreadIndex: 1,
    label: 'Monolith Press & Solstice Tape',
    left: { kind: 'project', project: DEMO_PROJECTS[1] },
    right: { kind: 'project', project: DEMO_PROJECTS[2] },
  },
  {
    spreadIndex: 2,
    label: 'Subsurface Archive & Nocturne OS',
    left: { kind: 'project', project: DEMO_PROJECTS[3] },
    right: { kind: 'project', project: DEMO_PROJECTS[4] },
  },
  {
    spreadIndex: 3,
    label: 'More Works Coming Soon',
    left: { kind: 'coming-soon' },
    right: { kind: 'reserved-stack' },
  },
];

export function getProjectById(id: string): ProjectItem | undefined {
  return DEMO_PROJECTS.find((p) => p.id === id);
}
