// Caption and title themes. Colours are ASS style colours: &HAABBGGRR.
function ass(hex, alpha = "00") {
  const clean = hex.replace("#", "");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

export const THEMES = {
  neon: {
    label: "Neon (default)",
    caption: {
      font: "Arial",
      bold: true,
      primary: ass("ffffff"),
      secondary: ass("c9d4e8"),
      outline: ass("0b0b12"),
      back: ass("ff2d95", "40"),
      borderStyle: 1,
      outlineWidth: 3,
      shadow: 3,
      spacing: 1,
      uppercase: false,
    },
    title: {
      font: "Arial",
      bold: true,
      primary: ass("ffffff"),
      box: ass("120e18", "b4"),
      outlineWidth: 16,
      spacing: 2,
      uppercase: false,
    },
  },

  clean: {
    label: "Clean (white on a soft box)",
    caption: {
      font: "Segoe UI",
      bold: true,
      primary: ass("ffffff"),
      secondary: ass("e6e6f0"),
      outline: ass("0b0b12", "30"),
      back: ass("0b0b12", "30"),
      borderStyle: 3,
      outlineWidth: 12,
      shadow: 0,
      spacing: 0.5,
      uppercase: false,
    },
    title: {
      font: "Segoe UI",
      bold: true,
      primary: ass("ffffff"),
      box: ass("0b0b12", "b4"),
      outlineWidth: 18,
      spacing: 1,
      uppercase: false,
    },
  },

  punch: {
    label: "Punch (yellow, heavy outline)",
    caption: {
      font: "Arial Black",
      bold: true,
      primary: ass("ffe600"),
      secondary: ass("ffffff"),
      outline: ass("000000"),
      back: ass("000000", "80"),
      borderStyle: 1,
      outlineWidth: 6,
      shadow: 0,
      spacing: 0,
      uppercase: true,
    },
    title: {
      font: "Arial Black",
      bold: true,
      primary: ass("ffe600"),
      box: ass("000000", "c0"),
      outlineWidth: 18,
      spacing: 1,
      uppercase: true,
    },
  },

  terminal: {
    label: "Terminal (mono, green)",
    caption: {
      font: "Consolas",
      bold: true,
      primary: ass("9dffb0"),
      secondary: ass("3f7a52"),
      outline: ass("06120a"),
      back: ass("000000", "a0"),
      borderStyle: 1,
      outlineWidth: 3,
      shadow: 0,
      spacing: 1.5,
      uppercase: false,
    },
    title: {
      font: "Consolas",
      bold: true,
      primary: ass("9dffb0"),
      box: ass("06120a", "c8"),
      outlineWidth: 14,
      spacing: 2,
      uppercase: false,
    },
  },

  classic: {
    label: "Classic (white, black outline)",
    caption: {
      font: "Arial",
      bold: false,
      primary: ass("ffffff"),
      secondary: ass("c8c8c8"),
      outline: ass("000000"),
      back: ass("000000", "80"),
      borderStyle: 1,
      outlineWidth: 4,
      shadow: 1,
      spacing: 0,
      uppercase: false,
    },
    title: {
      font: "Arial",
      bold: false,
      primary: ass("ffffff"),
      box: ass("000000", "a0"),
      outlineWidth: 16,
      spacing: 1,
      uppercase: false,
    },
  },
};

export const DEFAULT_THEME = "neon";

export function getTheme(name) {
  return THEMES[name] ?? THEMES[DEFAULT_THEME];
}

export function themeNames() {
  return Object.keys(THEMES);
}
