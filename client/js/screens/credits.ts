import Screen from "./screen.ts";
import type Game from "../game.ts";
import { ButtonList, type ButtonConfig } from "./common.ts";

// A shorter version of the credits in the README, plus myself. Each entry opens the corresponding site
const CREDITS: { title: string; entries: { text: string; url: string }[] }[] = [
  {
    title: "Created by",
    entries: [
      {
        text: "Hernan Rivas Acosta",
        url: "https://github.com/HernanRivasAcosta/",
      },
    ],
  },
  {
    title: "Graphics",
    entries: [
      {
        text: "Main logo by Eunoia",
        url: "https://www.fiverr.com/ashilpadarrel",
      },
      {
        text: "Environment by Averick",
        url: "https://www.fiverr.com/averickn",
      },
      {
        text: "Outer Buddies by Pupkin Assets",
        url: "https://trevor-pupkin.itch.io/outer-buddies",
      },
      {
        text: "Simple Keys by beamedeighth",
        url: "https://beamedeighth.itch.io/simplekeys-animated-pixel-keyboard-keys",
      },
      {
        text: "Hell icon by Freepik",
        url: "https://www.flaticon.com/free-icons/hell",
      },
      {
        text: "CRT shader by gingerbeardman",
        url: "https://github.com/gingerbeardman/webgl-crt-shader/",
      },
      {
        text: "Marquee by cecepbinsae",
        url: "https://www.freepik.com/free-vector/abstract-purple-background_177834912.htm",
      },
      {
        text: "Marquee by vectorpouch",
        url: "https://www.freepik.com/free-vector/road-hell-infernal-hot-cave-with-lava-fire_6198147.htm",
      },
    ],
  },
  {
    title: "Fonts",
    entries: [
      {
        text: "Cyberphont 3.0 by Finnmercury",
        url: "https://finnmercury.itch.io/cyberphont-30",
      },
      {
        text: "Area51 by DamienG",
        url: "https://damieng.com/typography/zx-origins/area51/",
      },
    ],
  },
  {
    title: "Music",
    entries: [
      {
        text: "Progress & Lastcop by fatal-snipe",
        url: "https://zxart.ee/eng/authors/f/fatal-snipe/",
      },
    ],
  },
  {
    title: "Tools",
    entries: [
      { text: "Sounds made with jsfxr", url: "https://sfxr.me/" },
      { text: "Maps made with Tiled", url: "https://www.mapeditor.org/" },
    ],
  },
];

// Width of the column the titles and entries are aligned to
const CREDITS_WIDTH = 220;
// Height of the scrolling area, the back button sits below it
const CREDITS_HEIGHT = 176;
const SECTION_SPACING = 6;
const BACK_SPACING = 14;

class CreditsScreen extends Screen {
  #urls: Map<string, string>;

  constructor(game: Game, params: Record<string, unknown> | null = null) {
    super(game, params);

    this.#urls = new Map();
    const buttons: ButtonConfig[] = [];
    CREDITS.forEach((section, s) => {
      buttons.push({
        id: `title_${s}`,
        text: section.title,
        label: true,
        align: "left",
        extraSpacing: s === 0 ? 0 : SECTION_SPACING,
      });
      section.entries.forEach((entry, e) => {
        const id = `credit_${s}_${e}`;
        this.#urls.set(id, entry.url);
        buttons.push({ id, text: entry.text, align: "right" });
      });
    });
    buttons.push({
      id: "back",
      text: "Back",
      extraSpacing: BACK_SPACING,
      pinned: true,
    });

    this.addChild(
      new ButtonList(
        this.game,
        buttons,
        "cyberphont3a",
        this.#onButtonSelected.bind(this),
        {
          loopButtons: false,
          buttonSpacing: 3,
          centerX: this.centerX,
          top: 16,
          width: CREDITS_WIDTH,
          maxHeight: CREDITS_HEIGHT,
        },
      ),
    );
  }

  update(alpha: number, dt: number): void {
    super.update(alpha, dt);

    if (this.game.inputMap.backBtn.justReleased) {
      this.game.sound.play("menuConfirm");
      this.close();
    }
  }

  #onButtonSelected(selection: string, _value: boolean): void {
    if (selection === "back") {
      this.close();
      return;
    }
    const url = this.#urls.get(selection);
    if (url !== undefined) {
      window.open(url, "_blank", "noopener");
    } else {
      console.error("Unknown credit selected", selection);
    }
  }
}

export default CreditsScreen;
