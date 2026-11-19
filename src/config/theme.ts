export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface CameraPreset {
  position: Vec3Tuple;
  target: Vec3Tuple;
  fov: number;
}

export interface PropLayout {
  position: Vec3Tuple;
  rotationY: number;
  scale: number;
}

export interface SceneTheme {
  id: string;
  label: string;
  palette: {
    background: string;
    deskBase: string;
    deskGrainDark: string;
    deskGrainHighlight: string;
    coverCharcoal: string;
    coverMark: string;
    paperIvory: string;
    paperEdge: string;
    inkPrimary: string;
    inkMuted: string;
    accentWarm: string;
  };
  lighting: {
    keyColor: string;
    keyIntensity: number;
    keyPosition: Vec3Tuple;
    hemiSkyColor: string;
    hemiGroundColor: string;
    hemiIntensity: number;
    rimColor: string;
    rimIntensity: number;
    rimPosition: Vec3Tuple;
    spotColor: string;
    spotIntensity: number;
    spotPosition: Vec3Tuple;
    spotTarget: Vec3Tuple;
    spotAngle: number;
    spotPenumbra: number;
    spotDecay: number;
    exposure: number;
  };
  shader: {
    vignetteRadius: number;
    vignetteSoftness: number;
    vignetteStrength: number;
    saturation: number;
    contrast: number;
    warmth: number;
    grainAmount: number;
  };
  interaction: {
    hoverCoverAngleRad: number;
    hoverCoverTweenMs: number;
    cursorYawMaxRad: number;
    cursorPitchMaxRad: number;
  };
  materials: {
    deskRoughness: number;
    coverRoughness: number;
    coverMetalness: number;
    paperRoughness: number;
  };
  bookDimensions: {
    pageWidth: number;
    pageHeight: number;
    coverOverhang: number;
    coverThickness: number;
    maxStackHeight: number;
    spineRadius: number;
  };
  typography: {
    uiSans: string;
    bookSerif: string;
    mono: string;
  };
  camera: {
    desktopClosed: CameraPreset;
    desktopOpen: CameraPreset;
    tabletClosed: CameraPreset;
    tabletOpen: CameraPreset;
    mobileClosed: CameraPreset;
    mobileOpenLeft: CameraPreset;
    mobileOpenRight: CameraPreset;
  };
  props: {
    desktop: {
      succulent: PropLayout;
      pencil: PropLayout;
      coffee: PropLayout;
      cards: PropLayout;
    };
    tablet: {
      succulent: PropLayout;
      pencil: PropLayout;
      coffee: PropLayout;
      cards: PropLayout;
    };
    mobile: {
      succulent: PropLayout;
      pencil: PropLayout;
      coffee: PropLayout;
      cards: PropLayout;
    };
  };
}

export interface BookTimingConfig {
  openDurationMs: number;
  closeDurationMs: number;
  closeSweepDurationMs: number;
  singleTurnDurationMs: number;
  batchTurnDurationMs: number;
  batchTurnStaggerMs: number;
  maxBatchSheets: number;
  reducedMotionFadeMs: number;
  cameraReframeMs: number;
}

export const BOOK_TIMING: BookTimingConfig = {
  openDurationMs: 1400,
  closeDurationMs: 1620,
  closeSweepDurationMs: 960,
  singleTurnDurationMs: 1000,
  batchTurnDurationMs: 740,
  batchTurnStaggerMs: 110,
  maxBatchSheets: 3,
  reducedMotionFadeMs: 140,
  cameraReframeMs: 1000,
};

export interface ContactConfig {
  studioName: string;
  locationLabel: string;
  availabilityLabel: string;
  /**
   * Optional configured contact email. Leave null when no real address is supplied
   * so the UI never fabricates an email or renders a broken mailto link.
   */
  email: string | null;
  /**
   * Optional external booking or inquiry URL. Leave null if unconfigured.
   */
  inquiryUrl: string | null;
  /**
   * Optional social/portfolio links configured by the site owner.
   */
  channels: Array<{ label: string; value: string; href: string | null }>;
}

export interface SiteConfig {
  brandName: string;
  introHeading: string;
  introSupport: string;
  openCtaLabel: string;
  contactButtonLabel: string;
  contact: ContactConfig;
}

export const SITE_CONFIG: SiteConfig = {
  brandName: 'KIHURN.',
  introHeading: 'Selected work, page by page.',
  introSupport: 'Open the book to explore. Hover a page for motion, or click to view details.',
  openCtaLabel: 'Open portfolio',
  contactButtonLabel: 'Get in touch',
  contact: {
    studioName: 'KIHURN Studio',
    locationLabel: 'Configurable Studio Location',
    availabilityLabel: 'Available for select spatial & editorial commissions',
    email: import.meta.env?.VITE_CONTACT_EMAIL || null,
    inquiryUrl: import.meta.env?.VITE_CONTACT_URL || null,
    channels: [
      {
        label: 'GitHub',
        value: 'github.com/kihurn',
        href: 'https://github.com/kihurn',
      },
      {
        label: 'Direct Email',
        value: import.meta.env?.VITE_CONTACT_EMAIL || 'wongkihurn@gmail.com',
        href: `mailto:${import.meta.env?.VITE_CONTACT_EMAIL || 'wongkihurn@gmail.com'}`,
      },
      ...(import.meta.env?.VITE_CONTACT_URL
        ? [
            {
              label: 'Studio Inquiry',
              value: import.meta.env.VITE_CONTACT_URL,
              href: import.meta.env.VITE_CONTACT_URL,
            },
          ]
        : []),
    ],
  },
};

export const LAMPLIT_DESK_THEME: SceneTheme = {
  id: 'lamplit-desk',
  label: 'Lamplit Desk',
  palette: {
    background: '#080605',
    deskBase: '#3c2a1d',
    deskGrainDark: '#1c120c',
    deskGrainHighlight: '#503928',
    coverCharcoal: '#18181a',
    coverMark: '#f4f1ea',
    paperIvory: '#e6ded0',
    paperEdge: '#d4ccbc',
    inkPrimary: '#0c0b09',
    inkMuted: '#2e2a24',
    accentWarm: '#dfbc86',
  },
  lighting: {
    keyColor: '#fff2e2',
    keyIntensity: 0.86,
    keyPosition: { x: -0.92, y: 3.32, z: 0.88 },
    hemiSkyColor: '#a8b8d2',
    hemiGroundColor: '#241912',
    hemiIntensity: 0.22,
    rimColor: '#f6eadb',
    rimIntensity: 0.44,
    rimPosition: { x: 2.5, y: 2.8, z: -2.6 },
    spotColor: '#fff1df',
    spotIntensity: 32.5,
    spotPosition: { x: -0.42, y: 3.35, z: 0.52 },
    spotTarget: { x: 0.0, y: 0.0, z: -0.02 },
    spotAngle: Math.PI / 1.84,
    spotPenumbra: 0.94,
    spotDecay: 1.24,
    exposure: 1.05,
  },
  shader: {
    vignetteRadius: 0.8,
    vignetteSoftness: 0.82,
    vignetteStrength: 0.22,
    saturation: 0.98,
    contrast: 1.04,
    warmth: 0.008,
    grainAmount: 0.01,
  },
  interaction: {
    hoverCoverAngleRad: 0.175,
    hoverCoverTweenMs: 280,
    cursorYawMaxRad: 0.044,
    cursorPitchMaxRad: 0.02,
  },
  materials: {
    deskRoughness: 0.82,
    coverRoughness: 0.68,
    coverMetalness: 0.04,
    paperRoughness: 0.36,
  },
  bookDimensions: {
    // True 16:9 landscape page aspect (1.44 / 0.81 = 1.7778)
    pageWidth: 1.44,
    pageHeight: 0.81,
    coverOverhang: 0.032,
    coverThickness: 0.024,
    maxStackHeight: 0.084,
    spineRadius: 0.042,
  },
  typography: {
    uiSans: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    bookSerif: '"Fraunces", Georgia, serif',
    mono: '"JetBrains Mono", monospace',
  },
  camera: {
    desktopClosed: {
      position: { x: 0.0, y: 3.26, z: 2.42 },
      target: { x: 0.0, y: 0.02, z: -0.42 },
      fov: 35,
    },
    desktopOpen: {
      // Strong zoom-in framing the 16:9 open spread in the lower-center viewport while keeping side props & bottom pill unobstructed
      position: { x: 0.0, y: 3.36, z: 1.88 },
      target: { x: 0.0, y: 0.02, z: -0.15 },
      fov: 35,
    },
    tabletClosed: {
      position: { x: 0.0, y: 3.68, z: 2.68 },
      target: { x: 0.0, y: 0.02, z: -0.36 },
      fov: 38,
    },
    tabletOpen: {
      position: { x: 0.0, y: 3.92, z: 2.16 },
      target: { x: 0.0, y: 0.02, z: -0.14 },
      fov: 38,
    },
    mobileClosed: {
      position: { x: 0.0, y: 4.4, z: 2.94 },
      target: { x: 0.0, y: 0.02, z: -0.38 },
      fov: 42,
    },
    mobileOpenLeft: {
      position: { x: -0.72, y: 3.5, z: 1.92 },
      target: { x: -0.72, y: 0.02, z: 0.05 },
      fov: 44,
    },
    mobileOpenRight: {
      position: { x: 0.72, y: 3.5, z: 1.92 },
      target: { x: 0.72, y: 0.02, z: 0.05 },
      fov: 44,
    },
  },
  props: {
    desktop: {
      succulent: { position: { x: -1.72, y: 0, z: -0.08 }, rotationY: 0.3, scale: 0.9 },
      pencil: { position: { x: -1.68, y: 0, z: 0.62 }, rotationY: 0.42, scale: 0.9 },
      coffee: { position: { x: 1.72, y: 0, z: -0.06 }, rotationY: -0.35, scale: 0.88 },
      cards: { position: { x: 1.56, y: 0, z: 0.6 }, rotationY: 0.22, scale: 0.9 },
    },
    tablet: {
      succulent: { position: { x: -1.82, y: 0, z: -0.14 }, rotationY: 0.3, scale: 0.86 },
      pencil: { position: { x: -1.8, y: 0, z: 0.64 }, rotationY: 0.45, scale: 0.86 },
      coffee: { position: { x: 1.82, y: 0, z: -0.14 }, rotationY: -0.35, scale: 0.86 },
      cards: { position: { x: 1.62, y: 0, z: 0.62 }, rotationY: 0.22, scale: 0.86 },
    },
    mobile: {
      succulent: { position: { x: -1.16, y: 0, z: -0.86 }, rotationY: 0.3, scale: 0.78 },
      pencil: { position: { x: -0.98, y: 0, z: 0.76 }, rotationY: 0.66, scale: 0.78 },
      coffee: { position: { x: 1.16, y: 0, z: -0.84 }, rotationY: -0.35, scale: 0.78 },
      cards: { position: { x: 0.98, y: 0, z: 0.78 }, rotationY: 0.22, scale: 0.78 },
    },
  },
};
