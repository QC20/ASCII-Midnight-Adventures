# Dust & Signal

**A small ASCII isometric adventure set in the Salt Flats.**

The old relay has gone dark. Cross the causeway, recover three capacitors, keep the raiders off your back, and bring the tower online.

## Play

**Live build:** <https://dust-and-signal.vercel.app>

Open `index.html` in a recent desktop or mobile browser. For a local web server, run:

```sh
python3 -m http.server 8080
```

Then visit <http://localhost:8080>.

### Controls

| Input | Action |
| --- | --- |
| `W A S D` or arrow keys | Move across the isometric grid |
| `Space` | Fire the pulse caster |
| `E` | Search a nearby cache or activate the relay |
| `M` or `Tab` | Open the field map |
| `Esc` | Pause or close the map |

Touch controls appear on narrow screens. The Motion button turns ambient animation down for a quieter display; the game also respects the operating system's reduced-motion preference.

## Design notes

The scene is drawn at runtime on a canvas using a fixed isometric tile grid and small, stable glyph patterns. Its dark reflecting pool, wind-shifted vegetation, and lone figure take their visual cue from the user-provided Ansenjeo “Water reflection test” recording. That nocturnal forest image is recast here as an irradiated salt marsh and a salvage run.

Several public projects informed the mix:

- [ASCII Realms](https://asciirealms.com/) demonstrates a dense glyph world with smooth real-time movement and colored text as the entire scene.
- [Cogmind](https://www.gridsagegames.com/cogmind/) is a reference for readable sci-fi glyphs, tactical encounters, and a modern interface around a traditional grid.
- [Cataclysm: Dark Days Ahead](https://cataclysmdda.org/) informs the survival-game vocabulary of scavenging, scarce supplies, and a post-apocalyptic world.
- [Dwarf Fortress Classic](https://www.bay12games.com/dwarves/) is a touchstone for expressive terrain, weather, and storytelling through a limited glyph palette.
- [Ansenjeo / Senje](https://www.instagram.com/reel/DeUqed7xIoO/) is the supplied visual reference for the reflective water, dense vegetation, and restrained motion.

The game code and scene are original; the references above informed the direction, not reused art or source code.

## Project files

- `index.html` — game shell and interface
- `styles.css` — responsive HUD and touch layout
- `game.js` — isometric glyph renderer, world, input, combat, and objectives
